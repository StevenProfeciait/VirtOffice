#!/usr/bin/env python3
"""Reconcile board + Cursor observation into activity {state, confidence, lastSeenAt, ...}.

Presentation states align with vo_events.js. AT_DESK is kept as an alias for board WIP
without live tools (desk-work presentation). Stale Cursor never claims high-confidence RUNNING.
"""
from __future__ import annotations

KIND_STATE = {
    "write": "TYPING", "edit": "TYPING", "reply": "TYPING",
    "read": "READING", "search": "READING", "fetch": "READING",
    "shell": "RUNNING", "task": "DELEGATING",
}

YOUR_TURN_MS = 30 * 60 * 1000
FAILED_MS = 15 * 60 * 1000
THINK_MAX_MS = 60 * 60 * 1000
ACTIVE_MS = 120_000  # must match cursor_activity.ACTIVE_MS


def _latest(agent):
    return (agent.get("cursor") or {}).get("latest")


def _end_ok(c):
    return bool(c) and c.get("endStatus") == "success"


def _end_failed(c):
    return bool(c) and bool(c.get("endStatus")) and c.get("endStatus") != "success"


def aggregate(agent, now_ms, seen_at=None):
    """Return activity dict for one agent. Pure; does not mutate agent."""
    if not agent:
        return _act("IDLE", "low", "inferred", now_ms, None, None)
    if agent.get("id") == "needs-steve":
        return _act("IDLE", "high", "board", now_ms, None, agent.get("status"))

    c = _latest(agent)
    has_chat = bool((agent.get("cursor") or {}).get("count"))
    board_status = agent.get("status") or "idle"
    last_seen = None
    observed = None

    if c and c.get("lastActivity"):
        last_seen = int(c["lastActivity"])
    elif agent.get("updatedAt"):
        last_seen = int(agent["updatedAt"])

    # Connectivity
    if agent.get("signal") is False and not has_chat:
        return _act("OFFLINE", "high", "board", last_seen or now_ms, None, board_status)

    if agent.get("blocked"):
        return _act("BLOCKED", "high", "board", last_seen or now_ms, None, board_status)

    ended_at = (c and c.get("endedAt")) or 0
    if c and c.get("state") == "ended" and _end_failed(c) and ended_at and now_ms - ended_at < FAILED_MS:
        return _act("ERROR", "high", "cursor", ended_at, "ERROR", board_status,
                    presentation_alias="BLOCKED")

    if board_status == "meeting":
        return _act("MEETING", "high", "board", last_seen or now_ms, None, board_status)

    # Observed live tools — only if transcript is truly active within ACTIVE_MS
    if c and c.get("state") == "active":
        age = now_ms - (c.get("lastActivity") or 0)
        if age <= ACTIVE_MS:
            k = KIND_STATE.get(c.get("toolKind"))
            if k and k != "DELEGATING":
                observed = k
                return _act(k, "high", "cursor", c.get("lastActivity"), observed, board_status)
            if k == "DELEGATING" or (c.get("subagents") or 0) > 0:
                observed = "DELEGATING"
                return _act("DELEGATING", "high", "cursor", c.get("lastActivity"), observed, board_status)
            observed = "AT_DESK"
            return _act("AT_DESK", "medium", "cursor", c.get("lastActivity"), observed, board_status,
                        board_working=board_status == "working")
        # Claimed active but stale by wall clock — do not keep RUNNING/TYPING
        observed = "STALE_ACTIVE"
        if board_status == "working":
            return _act("AT_DESK", "low", "inferred", c.get("lastActivity"), observed, board_status,
                        board_working=True)
        if c.get("lastActivity") and now_ms - c["lastActivity"] < THINK_MAX_MS:
            return _act("THINKING", "low", "inferred", c.get("lastActivity"), observed, board_status)
        return _act("IDLE", "low", "inferred", c.get("lastActivity"), observed, board_status)

    if c and c.get("state") == "ended" and _end_ok(c) and ended_at and now_ms - ended_at < YOUR_TURN_MS:
        if not (seen_at and seen_at >= ended_at):
            return _act("YOUR_TURN", "high", "cursor", ended_at, "YOUR_TURN", board_status)

    if board_status == "working":
        return _act("AT_DESK", "medium", "board", last_seen or now_ms, None, board_status,
                    board_working=True)

    if c and c.get("state") == "stale" and c.get("lastActivity") and now_ms - c["lastActivity"] < THINK_MAX_MS:
        return _act("THINKING", "medium", "cursor", c.get("lastActivity"), "THINKING", board_status)

    return _act("IDLE", "medium" if has_chat or agent.get("signal") else "low",
                "board" if agent.get("signal") else "inferred", last_seen or now_ms, None, board_status)


def _act(state, confidence, source, last_seen, observed, board_status,
         board_working=False, presentation_alias=None):
    return {
        "state": state,
        "presentationState": presentation_alias or state,
        "confidence": confidence,
        "source": source,
        "lastSeenAt": last_seen,
        "observedState": observed,
        "boardStatus": board_status,
        "boardWorking": bool(board_working or state == "AT_DESK"),
    }


def enrich_agents(agents, now_ms=None, seen=None):
    """Attach activity to each agent; set status-compatible fields. Pure copy."""
    import time
    now_ms = int(now_ms if now_ms is not None else time.time() * 1000)
    seen = seen or {}
    out = []
    for a in agents:
        a = dict(a)
        act = aggregate(a, now_ms, seen.get(a.get("id")))
        a["activity"] = act
        # Animation uses presentationState (BLOCKED alias for ERROR)
        a["activityState"] = act["presentationState"]
        out.append(a)
    return out
