#!/usr/bin/env python3
"""TEVA HQ Phase 2: delivery adapter interface + Cursor deeplink / unsupported adapters.

No fabricated Cursor send API. Cursor path returns DELIVERING + handoff URL only;
DELIVERED requires client handoff-opened confirmation.
"""
from __future__ import annotations

import urllib.parse
from dataclasses import dataclass, field
from typing import Optional

try:
    import teva_sync as ts
except ImportError:
    ts = None

CURSOR_PROMPT_MAX = 8000
CURSOR_DEEPLINK_PREFIX = "cursor://anysphere.cursor-deeplink/prompt?text="


@dataclass
class AdapterResult:
    status: str  # DELIVERING | FAILED
    handoff: Optional[dict] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    capabilities: dict = field(default_factory=dict)


class DeliveryAdapter:
    name = "base"

    def capabilities(self) -> dict:
        return {
            "programmatic_send": False,
            "deeplink_handoff": False,
            "ack": False,
            "respond": False,
            "user_confirm_delivered": False,
        }

    def validate_recipient(self, agent_id, registry_entry=None):
        return True, None

    def submit(self, message, agent=None, registry_entry=None) -> AdapterResult:
        raise NotImplementedError


def build_handoff_prompt(agent, content, for_url=True):
    """Mirror office.html buildPrompt (server-side)."""
    agent = agent or {}
    name = agent.get("name") or agent.get("id") or "agent"
    role = agent.get("role") or ""
    task = agent.get("task") or "current item"
    s = agent.get("source") or {}
    head = [
        f"To {name} (TEVA {role} seat), from Steve via TEVA HQ.",
        f"Re: {task}",
    ]
    if s.get("path"):
        line = f":{s['line']}" if s.get("line") else ""
        head.append(f"Status source: {s['path']}{line}")
    else:
        head.append("Status source: none (no live signal)")
    body = (content or "").strip() or "(write your message here)"
    docs = [d.get("path") for d in (agent.get("docs") or [])[:10] if d.get("path")]

    def make():
        return "\n".join(head) + "\n\n" + body + (
            ("\n\nContext docs:\n" + "\n".join("- " + p for p in docs)) if docs else ""
        )

    text = make()
    if for_url:
        while docs and len(CURSOR_DEEPLINK_PREFIX + urllib.parse.quote(text)) > CURSOR_PROMPT_MAX:
            docs.pop()
            text = make()
        while len(CURSOR_DEEPLINK_PREFIX + urllib.parse.quote(text)) > CURSOR_PROMPT_MAX:
            text = text[: max(100, int(len(text) * 0.9))] + "…"
    return text


def cursor_prompt_url(text):
    return CURSOR_DEEPLINK_PREFIX + urllib.parse.quote(text)


class CursorDeeplinkAdapter(DeliveryAdapter):
    name = "cursor_deeplink"

    def capabilities(self) -> dict:
        return {
            "programmatic_send": False,
            "deeplink_handoff": True,
            "ack": True,  # Steve-authorised mark only
            "respond": True,  # Steve-authorised record only
            "user_confirm_delivered": True,
        }

    def validate_recipient(self, agent_id, registry_entry=None):
        runtime = (registry_entry or {}).get("runtime")
        cursor_seats = getattr(ts, "CURSOR_SEATS", set()) if ts else set()
        if runtime == "cursor" or agent_id in cursor_seats:
            return True, None
        return False, "not a Cursor runtime seat"

    def submit(self, message, agent=None, registry_entry=None) -> AdapterResult:
        ok, err = self.validate_recipient(message.get("recipient_agent_id"), registry_entry)
        if not ok:
            return AdapterResult(
                status="FAILED",
                error_code="runtime_mismatch",
                error_message=err,
                capabilities=self.capabilities(),
            )
        prompt = build_handoff_prompt(agent or {}, message.get("content") or "", for_url=True)
        url = cursor_prompt_url(prompt)
        sessions = (registry_entry or {}).get("sessionIds") or []
        session_id = sessions[0] if sessions else None
        return AdapterResult(
            status="DELIVERING",
            handoff={
                "url": url,
                "promptPreview": prompt[:200],
                "sessionId": session_id,
                "mode": "manual_deeplink",
                "note": "DELIVERED only after Open handoff is confirmed in the office",
            },
            capabilities=self.capabilities(),
        )


class UnsupportedAdapter(DeliveryAdapter):
    name = "unsupported"

    def capabilities(self) -> dict:
        return {
            "programmatic_send": False,
            "deeplink_handoff": False,
            "ack": False,
            "respond": False,
            "user_confirm_delivered": False,
        }

    def submit(self, message, agent=None, registry_entry=None) -> AdapterResult:
        runtime = (registry_entry or {}).get("runtime") or message.get("runtime") or "none"
        return AdapterResult(
            status="FAILED",
            error_code="runtime_unsupported",
            error_message=(
                f"Programmatic delivery unavailable for runtime '{runtime}'. "
                "Use Copy for Grok Bot or Save to inbox (saved-only). "
                "No delivery was attempted."
            ),
            capabilities=self.capabilities(),
        )


def pick_adapter(agent_id, registry_entry=None):
    """Return (adapter_instance, adapter_name, runtime)."""
    reg = registry_entry or {}
    runtime = reg.get("runtime")
    if not runtime and ts:
        runtime = "cursor" if agent_id in getattr(ts, "CURSOR_SEATS", set()) else (
            "grok" if agent_id == "grok" else "none"
        )
    runtime = runtime or "none"
    if runtime == "cursor" or (ts and agent_id in getattr(ts, "CURSOR_SEATS", set())):
        return CursorDeeplinkAdapter(), "cursor_deeplink", "cursor"
    return UnsupportedAdapter(), "unsupported", runtime
