#!/usr/bin/env python3
"""Append-only per-agent event JSONL store (command-centre Phase 1)."""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from pathlib import Path

HOME_HQ = Path(os.environ.get("TEVA_HQ_DIR") or (Path.home() / ".teva_hq"))
EVENTS_DIR = Path(os.environ.get("TEVA_EVENTS_DIR") or (HOME_HQ / "events"))
AGENT_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
PROVENANCE = frozenset({"observed", "agent_reported", "server", "user", "inferred"})
_lock = threading.Lock()
MAX_LINE = 16 * 1024
MAX_FILE = int(os.environ.get("TEVA_EVENTS_MAX_BYTES", str(2 * 1024 * 1024)))


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime())


def _now_ms():
    return int(time.time() * 1000)


def event_id():
    return "evt_" + uuid.uuid4().hex[:16]


def append_event(
    agent_id,
    event_type,
    summary,
    source="server",
    provenance="server",
    task_id=None,
    metadata=None,
    correlation_id=None,
    timestamp=None,
    events_dir=None,
):
    """Append one event. Returns (ok, record_or_error)."""
    if not isinstance(agent_id, str) or not AGENT_RE.match(agent_id):
        return False, {"ok": False, "error": "invalid agent_id"}
    if provenance not in PROVENANCE:
        provenance = "server"
    if not isinstance(event_type, str) or not event_type.strip() or len(event_type) > 64:
        return False, {"ok": False, "error": "invalid event_type"}
    summary = str(summary or "")[:500]
    rec = {
        "event_id": event_id(),
        "agent_id": agent_id,
        "task_id": task_id,
        "event_type": event_type.strip(),
        "source": str(source or "server")[:64],
        "timestamp": timestamp or _now_iso(),
        "ts": _now_ms(),
        "summary": summary,
        "metadata": metadata if isinstance(metadata, dict) else {},
        "correlation_id": correlation_id or task_id,
        "provenance": provenance,
    }
    line = (json.dumps(rec, ensure_ascii=False) + "\n").encode("utf-8")
    if len(line) > MAX_LINE:
        return False, {"ok": False, "error": "event too large"}
    directory = Path(events_dir or EVENTS_DIR)
    path = directory / f"{agent_id}.jsonl"
    with _lock:
        directory.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(directory, 0o700)
        except OSError:
            pass
        size = path.stat().st_size if path.exists() else 0
        if size + len(line) > MAX_FILE:
            return False, {"ok": False, "error": "event log full"}
        fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "ab") as f:
            f.write(line)
    return True, rec


def read_timeline(agent_id, limit=50, events_dir=None):
    """Newest-first timeline for an agent."""
    if not isinstance(agent_id, str) or not AGENT_RE.match(agent_id):
        return []
    limit = max(1, min(int(limit or 50), 200))
    path = Path(events_dir or EVENTS_DIR) / f"{agent_id}.jsonl"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out = []
    for line in lines[-limit:]:
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    out.reverse()
    return out


def emit_from_vo_events(events, events_dir=None):
    """Mirror client-style deriveEvents into the store (server-side optional)."""
    written = []
    for e in events or []:
        seat = e.get("seat")
        if not seat or seat == "needs-steve":
            continue
        ok, rec = append_event(
            seat,
            e.get("type") or "unknown",
            e.get("source") or e.get("type") or "",
            source="server",
            provenance="server",
            metadata={"detail": e.get("detail") or {}},
            correlation_id=(e.get("detail") or {}).get("chatId"),
            events_dir=events_dir,
        )
        if ok:
            written.append(rec)
    return written
