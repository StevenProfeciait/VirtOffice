#!/usr/bin/env python3
"""TEVA HQ Phase 2: agent instruction messages with validated lifecycle (JSONL).

Distinct from inbox notes/reactions (saved-only). Status never includes EXECUTED —
execution is observed separately via state_aggregator / event_store.
"""
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
MESSAGES_DIR = Path(os.environ.get("TEVA_MESSAGES_DIR") or (HOME_HQ / "messages"))
INDEX_PATH = Path(os.environ.get("TEVA_MESSAGES_INDEX") or (MESSAGES_DIR / "messages_index.jsonl"))
MAX_CONTENT = int(os.environ.get("TEVA_INBOX_MAX_TEXT", "4096"))
MAX_FILE = int(os.environ.get("TEVA_MESSAGES_MAX_BYTES", str(2 * 1024 * 1024)))
MAX_RETRIES = 3
EXPIRE_MS = 24 * 60 * 60 * 1000
AGENT_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
MSG_RE = re.compile(r"^msg_[a-f0-9]{12,32}$")

STATUSES = (
    "DRAFT", "QUEUED", "DELIVERING", "DELIVERED", "ACKNOWLEDGED", "RESPONDED",
    "FAILED", "CANCELLED", "EXPIRED",
)

# from -> allowed to
TRANSITIONS = {
    "DRAFT": {"QUEUED", "CANCELLED"},
    "QUEUED": {"DELIVERING", "CANCELLED", "EXPIRED", "FAILED"},
    "DELIVERING": {"DELIVERED", "FAILED", "CANCELLED"},
    "DELIVERED": {"ACKNOWLEDGED", "FAILED", "CANCELLED", "RESPONDED"},
    "ACKNOWLEDGED": {"RESPONDED", "CANCELLED"},
    "FAILED": {"QUEUED", "CANCELLED"},
    "RESPONDED": set(),
    "CANCELLED": set(),
    "EXPIRED": set(),
}

_lock = threading.RLock()


def _now_ms():
    return int(time.time() * 1000)


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def new_id():
    return "msg_" + uuid.uuid4().hex[:16]


def _agent_path(agent_id, messages_dir=None):
    return Path(messages_dir or MESSAGES_DIR) / f"{agent_id}.jsonl"


def _ensure_dirs(messages_dir=None, index_path=None):
    d = Path(messages_dir or MESSAGES_DIR)
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


def _rewrite_agent_file(agent_id, messages, messages_dir=None):
    """Rewrite agent JSONL with latest record per message_id (keep order by created ts)."""
    path = _agent_path(agent_id, messages_dir)
    by_id = {}
    order = []
    for m in messages:
        mid = m.get("message_id")
        if not mid:
            continue
        if mid not in by_id:
            order.append(mid)
        by_id[mid] = m
    lines = []
    for mid in order:
        lines.append(json.dumps(by_id[mid], ensure_ascii=False))
    data = ("\n".join(lines) + ("\n" if lines else "")).encode("utf-8")
    if len(data) > MAX_FILE:
        raise ValueError("message log full")
    tmp = path.with_suffix(".tmp")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _index_append(message_id, agent_id, ts, index_path=None):
    path = Path(index_path or INDEX_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    line = (json.dumps({"message_id": message_id, "agent_id": agent_id, "ts": ts}) + "\n").encode("utf-8")
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "ab") as f:
        f.write(line)


def _index_lookup(message_id, index_path=None):
    path = Path(index_path or INDEX_PATH)
    agent_id = None
    for rec in _read_lines(path):
        if rec.get("message_id") == message_id:
            agent_id = rec.get("agent_id")
    return agent_id


def create_message(recipient_agent_id, content, runtime="none", adapter="unsupported",
                   task_id=None, seat_ids=None, messages_dir=None, index_path=None):
    """Create QUEUED instruction. Returns (ok, message_or_error)."""
    if not isinstance(recipient_agent_id, str) or not AGENT_RE.match(recipient_agent_id):
        return False, {"ok": False, "error": "invalid recipient"}
    if seat_ids is not None and recipient_agent_id not in seat_ids:
        return False, {"ok": False, "error": "unknown agent"}
    if recipient_agent_id == "needs-steve":
        return False, {"ok": False, "error": "needs-steve is not a message recipient"}
    if not isinstance(content, str) or not content.strip():
        return False, {"ok": False, "error": "content required"}
    content = content.strip()
    if len(content.encode("utf-8")) > MAX_CONTENT:
        return False, {"ok": False, "error": f"content over {MAX_CONTENT} bytes"}
    mid = new_id()
    now = _now_ms()
    iso = _now_iso()
    msg = {
        "message_id": mid,
        "schema": 2,
        "sender_id": "Steve",
        "recipient_agent_id": recipient_agent_id,
        "task_id": task_id,
        "message_type": "instruction",
        "content": content,
        "created_at": iso,
        "updated_at": iso,
        "ts": now,
        "status": "QUEUED",
        "delivery_attempts": 0,
        "delivered_at": None,
        "acknowledged_at": None,
        "responded_at": None,
        "response_message_id": None,
        "response_text": None,
        "error_code": None,
        "error_message": None,
        "correlation_id": mid,
        "adapter": adapter,
        "runtime": runtime,
        "handoff": None,
    }
    with _lock:
        _ensure_dirs(messages_dir, index_path)
        existing = _read_lines(_agent_path(recipient_agent_id, messages_dir))
        existing.append(msg)
        try:
            _rewrite_agent_file(recipient_agent_id, existing, messages_dir)
        except ValueError as e:
            return False, {"ok": False, "error": str(e)}
        _index_append(mid, recipient_agent_id, now, index_path)
    return True, msg


def get_message(message_id, messages_dir=None, index_path=None):
    if not isinstance(message_id, str) or not MSG_RE.match(message_id):
        return None
    with _lock:
        agent_id = _index_lookup(message_id, index_path)
        if not agent_id:
            # slow scan
            d = Path(messages_dir or MESSAGES_DIR)
            if d.is_dir():
                for f in d.glob("*.jsonl"):
                    if f.name == "messages_index.jsonl":
                        continue
                    for m in _read_lines(f):
                        if m.get("message_id") == message_id:
                            return _maybe_expire(m, messages_dir)
            return None
        for m in _read_lines(_agent_path(agent_id, messages_dir)):
            if m.get("message_id") == message_id:
                return _maybe_expire(m, messages_dir)
    return None


def _maybe_expire(msg, messages_dir=None):
    if msg.get("status") in ("QUEUED", "DELIVERING"):
        age = _now_ms() - int(msg.get("ts") or 0)
        if age > EXPIRE_MS:
            ok, updated = transition(msg["message_id"], "EXPIRED", messages_dir=messages_dir)
            if ok:
                return updated
    return msg


def list_messages(agent_id=None, status=None, limit=50, messages_dir=None):
    limit = max(1, min(int(limit or 50), 200))
    with _lock:
        d = Path(messages_dir or MESSAGES_DIR)
        files = []
        if agent_id:
            if not AGENT_RE.match(agent_id):
                return []
            files = [_agent_path(agent_id, messages_dir)]
        else:
            if d.is_dir():
                files = [f for f in d.glob("*.jsonl") if f.name != "messages_index.jsonl"]
        by_id = {}
        for f in files:
            for m in _read_lines(f):
                mid = m.get("message_id")
                if mid:
                    by_id[mid] = m
        rows = list(by_id.values())
        if status:
            rows = [m for m in rows if m.get("status") == status]
        rows.sort(key=lambda m: -int(m.get("ts") or 0))
        return rows[:limit]


def transition(message_id, new_status, patch=None, messages_dir=None, index_path=None):
    """Apply a permitted status transition. Returns (ok, message_or_error)."""
    if new_status not in STATUSES:
        return False, {"ok": False, "error": "invalid status"}
    with _lock:
        agent_id = _index_lookup(message_id, index_path)
        if not agent_id:
            msg = None
            d = Path(messages_dir or MESSAGES_DIR)
            if d.is_dir():
                for f in d.glob("*.jsonl"):
                    if f.name == "messages_index.jsonl":
                        continue
                    for m in _read_lines(f):
                        if m.get("message_id") == message_id:
                            msg = m
                            agent_id = m.get("recipient_agent_id")
                            break
                    if msg:
                        break
            if not msg:
                return False, {"ok": False, "error": "unknown message"}
        else:
            msg = None
            for m in _read_lines(_agent_path(agent_id, messages_dir)):
                if m.get("message_id") == message_id:
                    msg = m
                    break
            if not msg:
                return False, {"ok": False, "error": "unknown message"}

        cur = msg.get("status")
        if cur == new_status:
            return True, msg  # idempotent
        allowed = TRANSITIONS.get(cur) or set()
        if new_status not in allowed:
            return False, {"ok": False, "error": f"cannot transition {cur} → {new_status}"}

        updated = deepcopy(msg)
        updated["status"] = new_status
        updated["updated_at"] = _now_iso()
        if patch:
            for k, v in patch.items():
                if k in ("message_id", "schema", "sender_id", "recipient_agent_id", "created_at", "ts"):
                    continue
                updated[k] = v
        rows = _read_lines(_agent_path(agent_id, messages_dir))
        rows = [updated if r.get("message_id") == message_id else r for r in rows]
        try:
            _rewrite_agent_file(agent_id, rows, messages_dir)
        except ValueError as e:
            return False, {"ok": False, "error": str(e)}
        return True, updated


def bump_attempt(message_id, messages_dir=None, index_path=None):
    msg = get_message(message_id, messages_dir, index_path)
    if not msg:
        return False, {"ok": False, "error": "unknown message"}
    attempts = int(msg.get("delivery_attempts") or 0) + 1
    return transition(message_id, msg["status"], {"delivery_attempts": attempts},
                      messages_dir=messages_dir, index_path=index_path)


def can_retry(msg):
    return msg and msg.get("status") == "FAILED" and int(msg.get("delivery_attempts") or 0) < MAX_RETRIES
