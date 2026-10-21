#!/usr/bin/env python3
"""TEVA HQ local Ollama jobs — lifecycle separate from message delivery."""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from copy import deepcopy
from pathlib import Path

HOME_HQ = Path(os.environ.get("TEVA_HQ_DIR") or (Path.home() / ".teva_hq"))
JOBS_DIR = Path(os.environ.get("TEVA_LOCAL_JOBS_DIR") or (HOME_HQ / "local_jobs"))
INDEX_PATH = Path(os.environ.get("TEVA_LOCAL_JOBS_INDEX") or (JOBS_DIR / "jobs_index.jsonl"))
MAX_FILE = int(os.environ.get("TEVA_LOCAL_JOBS_MAX_BYTES", str(4 * 1024 * 1024)))
MAX_PROMPT = int(os.environ.get("TEVA_INBOX_MAX_TEXT", "4096"))
AGENT_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
JOB_RE = re.compile(r"^job_[a-f0-9]{12,32}$")
PILOT_SEAT = "le2"

STATUSES = (
    "QUEUED", "RUNNING", "AWAITING_APPROVAL", "APPLIED", "REJECTED", "FAILED", "CANCELLED",
)

TRANSITIONS = {
    "QUEUED": {"RUNNING", "CANCELLED", "FAILED"},
    "RUNNING": {"AWAITING_APPROVAL", "FAILED", "CANCELLED"},
    "AWAITING_APPROVAL": {"APPLIED", "REJECTED", "CANCELLED"},
    "APPLIED": set(),
    "REJECTED": set(),
    "FAILED": set(),
    "CANCELLED": set(),
}

_lock = threading.RLock()


def _now_ms():
    return int(time.time() * 1000)


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def new_id():
    return "job_" + uuid.uuid4().hex[:16]


def _agent_path(agent_id, jobs_dir=None):
    return Path(jobs_dir or JOBS_DIR) / f"{agent_id}.jsonl"


def _ensure_dirs(jobs_dir=None):
    d = Path(jobs_dir or JOBS_DIR)
    d.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except OSError:
        pass
    return d


def _read_lines(path):
    try:
        raw = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out = []
    for line in raw:
        if not line.strip():
            continue
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def _rewrite_agent_file(agent_id, jobs, jobs_dir=None):
    path = _agent_path(agent_id, jobs_dir)
    by_id = {}
    order = []
    for j in jobs:
        jid = j.get("job_id")
        if not jid:
            continue
        if jid not in by_id:
            order.append(jid)
        by_id[jid] = j
    lines = [json.dumps(by_id[jid], ensure_ascii=False) for jid in order]
    data = ("\n".join(lines) + ("\n" if lines else "")).encode("utf-8")
    if len(data) > MAX_FILE:
        raise ValueError("job log full")
    tmp = path.with_suffix(".tmp")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _index_append(job_id, agent_id, ts, index_path=None):
    path = Path(index_path or INDEX_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    line = (json.dumps({"job_id": job_id, "agent_id": agent_id, "ts": ts}) + "\n").encode("utf-8")
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "ab") as f:
        f.write(line)


def _index_lookup(job_id, index_path=None):
    path = Path(index_path or INDEX_PATH)
    agent_id = None
    for rec in _read_lines(path):
        if rec.get("job_id") == job_id:
            agent_id = rec.get("agent_id")
    return agent_id


def create_job(agent_id, prompt, model=None, message_id=None, context_paths=None,
               seat_ids=None, pilot_only=True, jobs_dir=None, index_path=None):
    if not isinstance(agent_id, str) or not AGENT_RE.match(agent_id):
        return False, {"ok": False, "error": "invalid agent"}
    if seat_ids is not None and agent_id not in seat_ids:
        return False, {"ok": False, "error": "unknown agent"}
    if pilot_only and agent_id != PILOT_SEAT:
        return False, {"ok": False, "error": f"local jobs MVP limited to {PILOT_SEAT}"}
    if not isinstance(prompt, str) or not prompt.strip():
        return False, {"ok": False, "error": "prompt required"}
    prompt = prompt.strip()
    if len(prompt.encode("utf-8")) > MAX_PROMPT:
        return False, {"ok": False, "error": f"prompt over {MAX_PROMPT} bytes"}
    jid = new_id()
    now = _now_ms()
    iso = _now_iso()
    job = {
        "job_id": jid,
        "schema": 1,
        "agent_id": agent_id,
        "message_id": message_id,
        "status": "QUEUED",
        "provider": "ollama",
        "model": model,
        "prompt": prompt,
        "context_paths": list(context_paths or []),
        "tool_trace": [],
        "result_summary": None,
        "proposed_patch": [],  # list of {path, content} or {path, diff}
        "applied_paths": [],
        "error_code": None,
        "error_message": None,
        "created_at": iso,
        "updated_at": iso,
        "ts": now,
    }
    with _lock:
        _ensure_dirs(jobs_dir)
        rows = _read_lines(_agent_path(agent_id, jobs_dir))
        rows.append(job)
        try:
            _rewrite_agent_file(agent_id, rows, jobs_dir)
        except ValueError as e:
            return False, {"ok": False, "error": str(e)}
        _index_append(jid, agent_id, now, index_path)
    return True, job


def get_job(job_id, jobs_dir=None, index_path=None):
    if not isinstance(job_id, str) or not JOB_RE.match(job_id):
        return None
    with _lock:
        agent_id = _index_lookup(job_id, index_path)
        if not agent_id:
            d = Path(jobs_dir or JOBS_DIR)
            if d.is_dir():
                for f in d.glob("*.jsonl"):
                    if f.name == "jobs_index.jsonl":
                        continue
                    for j in _read_lines(f):
                        if j.get("job_id") == job_id:
                            return j
            return None
        for j in _read_lines(_agent_path(agent_id, jobs_dir)):
            if j.get("job_id") == job_id:
                return j
    return None


def list_jobs(agent_id=None, status=None, limit=50, jobs_dir=None):
    limit = max(1, min(int(limit or 50), 200))
    with _lock:
        d = Path(jobs_dir or JOBS_DIR)
        files = []
        if agent_id:
            if not AGENT_RE.match(agent_id):
                return []
            files = [_agent_path(agent_id, jobs_dir)]
        else:
            if d.is_dir():
                files = [f for f in d.glob("*.jsonl") if f.name != "jobs_index.jsonl"]
        by_id = {}
        for f in files:
            for j in _read_lines(f):
                jid = j.get("job_id")
                if jid:
                    by_id[jid] = j
        rows = list(by_id.values())
        if status:
            rows = [j for j in rows if j.get("status") == status]
        rows.sort(key=lambda j: -int(j.get("ts") or 0))
        return rows[:limit]


def transition(job_id, new_status, patch=None, jobs_dir=None, index_path=None):
    if new_status not in STATUSES:
        return False, {"ok": False, "error": "invalid status"}
    with _lock:
        agent_id = _index_lookup(job_id, index_path)
        job = None
        if not agent_id:
            d = Path(jobs_dir or JOBS_DIR)
            if d.is_dir():
                for f in d.glob("*.jsonl"):
                    if f.name == "jobs_index.jsonl":
                        continue
                    for j in _read_lines(f):
                        if j.get("job_id") == job_id:
                            job = j
                            agent_id = j.get("agent_id")
                            break
                    if job:
                        break
            if not job:
                return False, {"ok": False, "error": "unknown job"}
        else:
            for j in _read_lines(_agent_path(agent_id, jobs_dir)):
                if j.get("job_id") == job_id:
                    job = j
                    break
            if not job:
                return False, {"ok": False, "error": "unknown job"}

        cur = job.get("status")
        if cur == new_status:
            return True, job
        allowed = TRANSITIONS.get(cur) or set()
        if new_status not in allowed:
            return False, {"ok": False, "error": f"cannot transition {cur} → {new_status}"}

        updated = deepcopy(job)
        updated["status"] = new_status
        updated["updated_at"] = _now_iso()
        if patch:
            for k, v in patch.items():
                if k in ("job_id", "schema", "agent_id", "created_at", "ts"):
                    continue
                updated[k] = v
        rows = _read_lines(_agent_path(agent_id, jobs_dir))
        rows = [updated if r.get("job_id") == job_id else r for r in rows]
        try:
            _rewrite_agent_file(agent_id, rows, jobs_dir)
        except ValueError as e:
            return False, {"ok": False, "error": str(e)}
        return True, updated


def claim_next(agent_id=None, jobs_dir=None, index_path=None):
    """Atomically claim oldest QUEUED job → RUNNING. Returns job or None."""
    with _lock:
        queued = list_jobs(agent_id=agent_id, status="QUEUED", limit=50, jobs_dir=jobs_dir)
        if not queued:
            return None
        # oldest first
        queued.sort(key=lambda j: int(j.get("ts") or 0))
        job = queued[0]
        ok, updated = transition(
            job["job_id"], "RUNNING", jobs_dir=jobs_dir, index_path=index_path
        )
        return updated if ok else None


def append_tool_trace(job_id, entry, jobs_dir=None, index_path=None):
    job = get_job(job_id, jobs_dir, index_path)
    if not job:
        return False, {"ok": False, "error": "unknown job"}
    trace = list(job.get("tool_trace") or [])
    trace.append(entry)
    # cap trace length
    if len(trace) > 40:
        trace = trace[-40:]
    return transition(job_id, job["status"], {"tool_trace": trace},
                      jobs_dir=jobs_dir, index_path=index_path)
