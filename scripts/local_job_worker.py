#!/usr/bin/env python3
"""Background worker: claim local jobs, run Ollama ReAct loop, await Steve approval."""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Callable, Optional

log = logging.getLogger("hermes-office.local_job")

MAX_STEPS = int(os.environ.get("TEVA_LOCAL_JOB_MAX_STEPS", "12"))
POLL_S = float(os.environ.get("TEVA_LOCAL_JOB_POLL", "2"))

SYSTEM_PROMPT = """You are a TEVA HQ local coding assistant running on Ollama for seat {agent_id}.
You are NOT Cursor and do not inherit Cursor sessions, tools, or context.
Work only via the provided tools. Propose file edits with propose_edit; never claim files were written.
When done, respond with a short summary of findings and what you proposed (no tool call).
Workspace roots: {roots}
"""


def _truncate(s, n=80):
    s = str(s or "").replace("\n", " ").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def run_job(job, emit_event: Optional[Callable] = None, provider=None, tools_mod=None, job_store=None):
    """Execute one job through ReAct. Mutates job via job_store transitions."""
    import ollama_provider as op
    import local_agent_tools as lat
    import local_job_store as ljs

    provider = provider or op
    tools_mod = tools_mod or lat
    job_store = job_store or ljs

    jid = job["job_id"]
    agent_id = job["agent_id"]
    cfg = provider.load_config()
    roots = cfg.get("workspace_roots") or []
    model = job.get("model") or provider.model_for_seat(agent_id, cfg)
    if not model:
        ok, updated = job_store.transition(
            jid, "FAILED",
            {"error_code": "model_missing", "error_message": "No Ollama model configured for seat"},
        )
        if emit_event:
            emit_event(agent_id, "local_job_failed", "model missing", jid)
        return updated if ok else job

    h = provider.health(fill_defaults=False)
    if not h.get("ok"):
        ok, updated = job_store.transition(
            jid, "FAILED",
            {
                "error_code": h.get("error_code") or "ollama_unreachable",
                "error_message": h.get("error_message") or "Ollama unreachable",
            },
        )
        if emit_event:
            emit_event(agent_id, "local_job_failed", "ollama unreachable", jid)
        return updated if ok else job

    if emit_event:
        emit_event(agent_id, "local_job_started", _truncate(job.get("prompt")), jid)

    ctx = tools_mod.ToolContext(roots, proposed_patch=list(job.get("proposed_patch") or []))
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT.format(agent_id=agent_id, roots=", ".join(roots) or "(none)")},
        {"role": "user", "content": job.get("prompt") or ""},
    ]
    if job.get("context_paths"):
        messages.append({
            "role": "user",
            "content": "Suggested context paths: " + ", ".join(job["context_paths"][:20]),
        })

    summary = None
    try:
        for step in range(MAX_STEPS):
            # cancel check
            cur = job_store.get_job(jid)
            if cur and cur.get("status") == "CANCELLED":
                return cur

            result = provider.chat_completions(
                messages, model=model, tools=tools_mod.TOOL_SPECS,
            )
            msg = result.get("message") or {}
            tool_calls = result.get("tool_calls") or msg.get("tool_calls") or []
            content = msg.get("content")

            if tool_calls:
                messages.append(msg if msg.get("role") else {"role": "assistant", "content": content, "tool_calls": tool_calls})
                for tc in tool_calls:
                    fn = (tc.get("function") or {})
                    name = fn.get("name") or "unknown"
                    raw_args = fn.get("arguments") or "{}"
                    try:
                        args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
                    except ValueError:
                        args = {}
                    out = ctx.run(name, args)
                    job_store.append_tool_trace(jid, {
                        "step": step,
                        "tool": name,
                        "args": {k: (str(v)[:200] if not isinstance(v, (dict, list)) else v) for k, v in (args or {}).items()},
                        "ok": bool(out.get("ok")),
                        "ts": int(time.time() * 1000),
                    })
                    if emit_event:
                        emit_event(agent_id, "local_job_tool", f"{name} ok={out.get('ok')}", jid)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.get("id") or name,
                        "content": json.dumps(out)[:8000],
                    })
                # persist proposed_patch progressively
                job_store.transition(jid, "RUNNING", {"proposed_patch": ctx.proposed_patch, "model": model})
                continue

            summary = (content or "").strip() or "Local agent finished without a summary."
            break
        else:
            summary = summary or "Stopped: max tool steps reached."
    except provider.OllamaError as e:
        ok, updated = job_store.transition(
            jid, "FAILED",
            {"error_code": e.code, "error_message": e.message, "model": model},
        )
        if emit_event:
            emit_event(agent_id, "local_job_failed", _truncate(e.message), jid)
        return updated if ok else job
    except Exception as e:
        log.exception("local job %s failed", jid)
        ok, updated = job_store.transition(
            jid, "FAILED",
            {"error_code": "worker_error", "error_message": str(e)[:500], "model": model},
        )
        if emit_event:
            emit_event(agent_id, "local_job_failed", _truncate(str(e)), jid)
        return updated if ok else job

    patch = ctx.proposed_patch
    if not patch:
        # Still await approval with empty patch so Steve can see the summary — or fail.
        # Plan: empty patch → FAILED with clear message
        ok, updated = job_store.transition(
            jid, "FAILED",
            {
                "error_code": "no_patch",
                "error_message": "Local agent produced no file proposals. Summary: " + _truncate(summary, 200),
                "result_summary": summary,
                "proposed_patch": [],
                "model": model,
            },
        )
        if emit_event:
            emit_event(agent_id, "local_job_failed", "no patch proposed", jid)
        return updated if ok else job

    ok, updated = job_store.transition(
        jid, "AWAITING_APPROVAL",
        {
            "result_summary": summary,
            "proposed_patch": patch,
            "model": model,
            "error_code": None,
            "error_message": None,
        },
    )
    if emit_event:
        emit_event(agent_id, "local_job_awaiting_approval", _truncate(summary), jid)
    return updated if ok else job


def worker_loop(stop_event=None, emit_event=None, poll_s=None):
    """Daemon loop: claim QUEUED jobs and run them."""
    import local_job_store as ljs

    poll_s = POLL_S if poll_s is None else poll_s
    while True:
        if stop_event is not None and stop_event.is_set():
            break
        try:
            job = ljs.claim_next()
            if job:
                run_job(job, emit_event=emit_event)
            else:
                time.sleep(poll_s)
        except Exception:
            log.exception("local job worker iteration failed")
            time.sleep(poll_s)
