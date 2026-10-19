#!/usr/bin/env python3
"""TEVA HQ agent registry (command-centre Phase 1).

Authoritative agent identity + explicit session mappings. File-backed JSON under
~/.teva_hq/agents_registry.json (override with TEVA_AGENTS_REGISTRY).

seat_map.json remains a compatibility export for cursor_activity (registry wins).
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from copy import deepcopy
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

try:
    import teva_sync as ts
except ImportError:  # pragma: no cover
    import sys
    sys.path.insert(0, str(HERE))
    import teva_sync as ts

HOME_HQ = Path(os.environ.get("TEVA_HQ_DIR") or (Path.home() / ".teva_hq"))
REGISTRY_PATH = Path(os.environ.get("TEVA_AGENTS_REGISTRY") or (HOME_HQ / "agents_registry.json"))
SEAT_MAP_PATH = Path(os.environ.get("TEVA_SEAT_MAP") or (ROOT / "seat_map.json"))
WORKSPACE_DEFAULT = os.environ.get("TEVA_REPO", "/Users/stevenayensu/Documents/GitHub/template_1")

_lock = threading.Lock()
_cache = None  # type: ignore


def _now_ms():
    return int(time.time() * 1000)


def _runtime_for(seat_id):
    if seat_id in getattr(ts, "CURSOR_SEATS", set()):
        return "cursor"
    if seat_id == "grok":
        return "grok"
    return "none"


def _seed_entry(row, now=None):
    aid, name, team, emoji, color, default_task, pats = row
    now = now or _now_ms()
    return {
        "id": aid,
        "name": name,
        "role": team,
        "description": default_task,
        "emoji": emoji,
        "color": color,
        "runtime": _runtime_for(aid),
        "workspace": WORKSPACE_DEFAULT,
        "seatId": aid,
        "capabilities": list(pats) if pats else [],
        "sessionIds": [],
        "permissions": ["inbox", "timeline", "map_session"],
        "createdAt": now,
        "updatedAt": now,
    }


def seed_from_roster(now=None):
    now = now or _now_ms()
    agents = {r[0]: _seed_entry(r, now) for r in ts.ROSTER}
    return {
        "version": 1,
        "updatedAt": now,
        "agents": agents,
        "sessionMap": {},  # sessionId -> agentId (explicit)
    }


def _import_seat_map(data, seat_map_path=None):
    """Merge seat_map.json into sessionMap / sessionIds (explicit evidence)."""
    path = Path(seat_map_path or SEAT_MAP_PATH)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return data
    if not isinstance(raw, dict):
        return data
    now = _now_ms()
    valid = set(data["agents"])
    for sid, aid in raw.items():
        if not isinstance(sid, str) or not isinstance(aid, str):
            continue
        if aid not in valid:
            continue
        data["sessionMap"][sid] = aid
        sessions = data["agents"][aid].setdefault("sessionIds", [])
        if sid not in sessions:
            sessions.append(sid)
        data["agents"][aid]["updatedAt"] = now
    data["updatedAt"] = now
    return data


def _merge_roster(data, now=None):
    """Ensure every ROSTER seat exists; do not wipe sessions."""
    now = now or _now_ms()
    for row in ts.ROSTER:
        aid = row[0]
        if aid not in data["agents"]:
            data["agents"][aid] = _seed_entry(row, now)
        else:
            # Keep identity fields fresh from roster; preserve sessions
            seeded = _seed_entry(row, now)
            cur = data["agents"][aid]
            for k in ("name", "role", "description", "emoji", "color", "runtime", "workspace", "seatId", "capabilities"):
                cur[k] = seeded[k]
            cur.setdefault("sessionIds", [])
            cur.setdefault("permissions", seeded["permissions"])
    # Drop unknown agents that are not in roster (except we never invent extras)
    keep = {r[0] for r in ts.ROSTER}
    data["agents"] = {k: v for k, v in data["agents"].items() if k in keep}
    data["sessionMap"] = {s: a for s, a in data.get("sessionMap", {}).items() if a in keep}
    data["updatedAt"] = now
    return data


def load(path=None, seat_map_path=None, force_reload=False):
    global _cache
    path = Path(path or REGISTRY_PATH)
    with _lock:
        if _cache is not None and not force_reload and path == REGISTRY_PATH:
            return deepcopy(_cache)
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(data, dict) or "agents" not in data:
                    data = seed_from_roster()
            except (OSError, ValueError):
                data = seed_from_roster()
        else:
            data = seed_from_roster()
        data.setdefault("sessionMap", {})
        data.setdefault("version", 1)
        data = _merge_roster(data)
        data = _import_seat_map(data, seat_map_path)
        _cache = deepcopy(data)
        return deepcopy(data)


def save(data, path=None, export_seat_map=True, seat_map_path=None):
    global _cache
    path = Path(path or REGISTRY_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    data = deepcopy(data)
    data["updatedAt"] = _now_ms()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    if export_seat_map:
        _export_seat_map(data, seat_map_path)
    with _lock:
        _cache = deepcopy(data)
    return data


def _export_seat_map(data, seat_map_path=None):
    """Write compatibility seat_map.json for cursor_activity Tailer."""
    path = Path(seat_map_path or SEAT_MAP_PATH)
    mapping = dict(data.get("sessionMap") or {})
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass


def session_map(data=None):
    data = data or load()
    return dict(data.get("sessionMap") or {})


def list_agents(data=None):
    data = data or load()
    return [data["agents"][k] for k in sorted(data["agents"])]


def get_agent(agent_id, data=None):
    data = data or load()
    return data["agents"].get(agent_id)


def map_session(session_id, agent_id, path=None, seat_map_path=None):
    """Explicit session→agent mapping. Returns (ok, payload)."""
    if not isinstance(session_id, str) or not session_id.strip():
        return False, {"ok": False, "error": "sessionId required"}
    session_id = session_id.strip()
    if len(session_id) > 128 or not all(c.isalnum() or c in "-_" for c in session_id):
        return False, {"ok": False, "error": "invalid sessionId"}
    data = load(path=path, seat_map_path=seat_map_path, force_reload=True)
    if agent_id not in data["agents"]:
        return False, {"ok": False, "error": "unknown agent"}
    # Remove session from previous agent
    prev = data["sessionMap"].get(session_id)
    if prev and prev in data["agents"]:
        ids = data["agents"][prev].get("sessionIds") or []
        data["agents"][prev]["sessionIds"] = [s for s in ids if s != session_id]
        data["agents"][prev]["updatedAt"] = _now_ms()
    data["sessionMap"][session_id] = agent_id
    sessions = data["agents"][agent_id].setdefault("sessionIds", [])
    if session_id not in sessions:
        sessions.append(session_id)
    data["agents"][agent_id]["updatedAt"] = _now_ms()
    save(data, path=path, seat_map_path=seat_map_path)
    return True, {
        "ok": True,
        "sessionId": session_id,
        "agentId": agent_id,
        "previousAgentId": prev,
        "event_id": "evt_" + uuid.uuid4().hex[:12],
    }


def unmap_session(session_id, path=None, seat_map_path=None):
    data = load(path=path, seat_map_path=seat_map_path, force_reload=True)
    prev = data["sessionMap"].pop(session_id, None)
    if prev and prev in data["agents"]:
        ids = data["agents"][prev].get("sessionIds") or []
        data["agents"][prev]["sessionIds"] = [s for s in ids if s != session_id]
        data["agents"][prev]["updatedAt"] = _now_ms()
    save(data, path=path, seat_map_path=seat_map_path)
    return True, {"ok": True, "sessionId": session_id, "previousAgentId": prev}


def attach_registry(agents, data=None):
    """Attach registry slice onto each agent in the /api/agents payload."""
    data = data or load()
    out = []
    for a in agents:
        a = dict(a)
        aid = a.get("id")
        if aid in data["agents"]:
            reg = data["agents"][aid]
            a["registry"] = {
                "runtime": reg.get("runtime"),
                "workspace": reg.get("workspace"),
                "capabilities": reg.get("capabilities") or [],
                "sessionIds": reg.get("sessionIds") or [],
                "permissions": reg.get("permissions") or [],
            }
        out.append(a)
    return out


def public_view(data=None):
    data = data or load()
    return {
        "version": data.get("version", 1),
        "updatedAt": data.get("updatedAt"),
        "agents": list_agents(data),
        "sessionMap": session_map(data),
    }
