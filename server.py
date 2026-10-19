#!/usr/bin/env python3
"""
Hermes 3D Office Dashboard Server

Serves the static 3D office dashboard and provides a live agent-state API.
Three wiring modes are supported out of the box:

1. Demo mode            - Auto-generated sample agents (default).
2. Hermes status API    - Poll HERMES_AGENT_API for live agents.
3. Static JSON drop     - Serve AGENTS_JSON_PATH if it exists.
4. Webhook push         - Receive updates on POST /webhook/agents.

Environment variables (see .env.example):
    PORT                  Server port (default 9502)
    HOST                  Bind address (default 0.0.0.0)
    HERMES_AGENT_API      URL to Hermes GET /api/agents/status endpoint
    AGENTS_JSON_PATH      Path to agents.json file drop
    POLL_INTERVAL_SECONDS Polling interval for HERMES_AGENT_API
    ENABLE_SSE            Enable Server-Sent Events for live browser updates
"""
import hmac
import http.server
import json
import logging
import os
import re
import secrets
import socketserver
import sys
import threading
import time
import urllib.request
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, urlparse

logger = logging.getLogger("hermes-office")

PORT = int(os.environ.get("PORT", "9502"))
HOST = os.environ.get("HOST", "127.0.0.1")
HERMES_AGENT_API = os.environ.get("HERMES_AGENT_API", "").strip()
AGENTS_JSON_PATH = os.environ.get("AGENTS_JSON_PATH", "").strip() or str(Path(__file__).parent / "agents.json")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_SECONDS", "5"))
ENABLE_SSE = os.environ.get("ENABLE_SSE", "true").lower() in ("1", "true", "yes")
# Webhook pushes are kept as per-agent overrides for this long, merged over agents.json
# on every poll, so the 5 s file refresh no longer reverts them (R-VO-001 Phase 1).
WEBHOOK_TTL = int(os.environ.get("WEBHOOK_TTL_SECONDS", "900"))
TEVA_SYNC_INTERVAL = int(os.environ.get("TEVA_SYNC_INTERVAL", "180"))
TEVA_REPO = os.environ.get("TEVA_REPO", "/Users/stevenayensu/Documents/GitHub/template_1")
DEMO_MODE = not (HERMES_AGENT_API or AGENTS_JSON_PATH)

DIRECTORY = Path(__file__).parent / "public"
ROOT = Path(__file__).parent

# ---- R-VO-001 Phase 2: write lock, inbox, Cursor activity ----------------------------
# Every POST needs BOTH an allowed Origin and the per-install token (X-TEVA-Token).
# Every request needs an allowed Host header (blocks DNS rebinding to 127.0.0.1).
TOKEN_FILE = Path(os.environ.get("TEVA_HQ_TOKEN_FILE") or (Path.home() / ".teva_hq" / "token"))
ALLOWED_ORIGINS = {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
INBOX_DIR = Path(os.environ.get("TEVA_INBOX_DIR") or (ROOT / "inbox"))
INBOX_MAX_TEXT = int(os.environ.get("TEVA_INBOX_MAX_TEXT", "4096"))         # bytes of UTF-8 text per message
INBOX_MAX_FILE = int(os.environ.get("TEVA_INBOX_MAX_BYTES", str(1024 * 1024)))  # bytes per inbox/<seat>.jsonl
MAX_BODY = {
    "/webhook/agents": 1024 * 1024,
    "/api/inbox": 16 * 1024,
    "/api/registry/map": 4 * 1024,
    "/api/messages": 16 * 1024,
}
MSG_ID_RE = re.compile(r"^msg_[a-f0-9]{12,32}$")
MSG_ACTION_RE = re.compile(
    r"^/api/messages/(msg_[a-f0-9]{12,32})/(handoff-opened|acknowledge|respond|retry|cancel)$"
)
CURSOR_SCAN_SECONDS = int(os.environ.get("CURSOR_SCAN_SECONDS", "10"))  # Phase 3a: 30 -> 10 s (tail reads only new bytes)
# Phase 3a reactions: stored in the same token-locked inbox as notes, never sent to any chat
REACTION_EMOJI = ("\U0001F44D", "\U0001F389", "\U0001F440", "\u270B")  # thumbs-up, party, eyes, raised hand
INBOX_KINDS = ("note", "reaction")
CURSOR_SNAPSHOT = os.environ.get("CURSOR_ACTIVITY_SNAPSHOT", "").strip()  # tests/box: serve a saved scan
TOKEN_META = '<meta name="teva-token" content="">'

sys.path.insert(0, str(ROOT / "scripts"))
agent_registry = None
state_aggregator = None
event_store = None
message_store = None
delivery_adapters = None
cursor_activity = None
SEAT_IDS = set()
try:
    import teva_sync
    SEAT_IDS = {r[0] for r in teva_sync.ROSTER}
except Exception as _e:
    logging.getLogger("hermes-office").error("teva_sync unavailable: %s", _e)
try:
    import cursor_activity  # read-only transcript tailer
except Exception as _e:
    logging.getLogger("hermes-office").error("cursor_activity unavailable: %s", _e)
try:
    import agent_registry
    import state_aggregator
    import event_store
    import message_store
    import delivery_adapters
except Exception as _e:
    logging.getLogger("hermes-office").error("command-centre modules unavailable: %s", _e)
SEAT_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
inbox_lock = threading.Lock()
cursor_snapshot = None


def load_or_create_token(path=None):
    """Per-install token, created on first start outside the repo (dir 0700, file 0600)."""
    path = Path(path or TOKEN_FILE)
    try:
        tok = path.read_text(encoding="utf-8").strip()
        if len(tok) >= 32:
            if (path.stat().st_mode & 0o077) != 0:
                os.chmod(path, 0o600)
            return tok
    except OSError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    tok = secrets.token_urlsafe(32)
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(tok + "\n")
    os.chmod(path, 0o600)
    return tok


TOKEN = load_or_create_token()


def inbox_counts():
    """{seat: {sent, read, unread, last}}. 'read' comes from inbox/<seat>.read (a line count a seat
    would write once PM/Supervisor agree on the convention); no seat writes it in Phase 2."""
    out = {}
    for sid in sorted(SEAT_IDS):
        f = INBOX_DIR / f"{sid}.jsonl"
        sent, last = 0, None
        try:
            with f.open("r", encoding="utf-8") as fh:
                for line in fh:
                    if line.strip():
                        sent += 1
                        last = line
        except OSError:
            pass
        read = 0
        try:
            read = max(0, int((INBOX_DIR / f"{sid}.read").read_text().strip() or 0))
        except (OSError, ValueError):
            pass
        last_ms = None
        if last:
            try:
                last_ms = json.loads(last).get("ts")
            except ValueError:
                pass
        out[sid] = {"sent": sent, "read": min(read, sent), "unread": max(0, sent - read), "last": last_ms}
    return out


def inbox_messages(seat, limit=5):
    try:
        lines = (INBOX_DIR / f"{seat}.jsonl").read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out = []
    for line in lines[-limit:]:
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out[::-1]


def inbox_append(seat, text, kind=None, emoji=None):
    """Validate and append one message (kind "note", the default) or reaction (kind "reaction" with an
    allowlisted emoji). Returns (status, payload). Nothing is ever forwarded to a chat."""
    if not isinstance(seat, str) or not SEAT_RE.match(seat) or seat not in SEAT_IDS:
        return HTTPStatus.BAD_REQUEST, {"ok": False, "error": "unknown seat"}
    kind = "note" if kind is None else kind
    if kind not in INBOX_KINDS:
        return HTTPStatus.BAD_REQUEST, {"ok": False, "error": "kind must be note or reaction"}
    now = time.time()
    rec = {"time": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(now)), "ts": int(now * 1000),
           "from": "Steve", "seat": seat}
    if kind == "reaction":
        if not isinstance(emoji, str) or emoji not in REACTION_EMOJI:
            return HTTPStatus.BAD_REQUEST, {"ok": False, "error": "unknown reaction emoji"}
        rec.update({"kind": "reaction", "emoji": emoji})
    else:
        if not isinstance(text, str) or not text.strip():
            return HTTPStatus.BAD_REQUEST, {"ok": False, "error": "text is required"}
        text = text.strip()
        if len(text.encode("utf-8")) > INBOX_MAX_TEXT:
            return HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "error": f"text over {INBOX_MAX_TEXT} bytes"}
        rec["text"] = text
    line = (json.dumps(rec, ensure_ascii=False) + "\n").encode("utf-8")
    path = INBOX_DIR / f"{seat}.jsonl"
    with inbox_lock:
        INBOX_DIR.mkdir(parents=True, exist_ok=True)
        size = path.stat().st_size if path.exists() else 0
        if size + len(line) > INBOX_MAX_FILE:
            return HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "error": f"inbox/{seat}.jsonl is full ({INBOX_MAX_FILE} bytes)"}
        fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "ab") as f:
            f.write(line)
    if event_store:
        try:
            event_store.append_event(
                seat, "message_saved",
                f"inbox {kind}" + (f": {emoji}" if kind == "reaction" else ""),
                source="user", provenance="user",
                metadata={"kind": kind, "delivery": "saved_not_delivered"},
            )
        except Exception:
            pass
    c = inbox_counts().get(seat, {})
    return HTTPStatus.OK, {"ok": True, "seat": seat, "kind": kind, "file": f"inbox/{seat}.jsonl", "sent": c.get("sent"), "unread": c.get("unread")}


def _cursor_loop():
    """Light tailer: rescan transcripts every CURSOR_SCAN_SECONDS (reads only new bytes)."""
    global cursor_snapshot
    tailer = cursor_activity.Tailer() if cursor_activity else None
    while True:
        try:
            if CURSOR_SNAPSHOT:
                cursor_snapshot = json.loads(Path(CURSOR_SNAPSHOT).read_text(encoding="utf-8"))
            elif tailer:
                cursor_snapshot = tailer.scan()
        except Exception as e:
            logger.error("Cursor scan failed: %s", e)
        time.sleep(CURSOR_SCAN_SECONDS)

# Demo agents used when no Hermes source is configured
DEMO_AGENTS = [
    {
        "id": "orchestrator",
        "name": "Orchestrator",
        "role": "Supervisor",
        "emoji": "🧠",
        "color": "#8B5CF6",
        "home": "meeting",
        "status": "meeting",
        "task": "Coordinating daily standup",
        "tasks": ["Reviewing pipeline", "Coordinating agents", "Approving handoffs"],
        "output": ["Daily brief issued", "Pipeline updated"],
        "stats": {"tasksDone": 34, "active": 5, "hours": 6.2},
        "mood": 0.9,
        "typing": False,
    },
    {
        "id": "analyst",
        "name": "Analyst",
        "role": "Research",
        "emoji": "📊",
        "color": "#3B82F6",
        "home": "left",
        "status": "working",
        "task": "Market research in progress",
        "tasks": ["Market research", "Data synthesis", "Trend analysis"],
        "output": ["Competitor report v1", "Keyword research"],
        "stats": {"tasksDone": 18, "active": 3, "hours": 4.5},
        "mood": 0.75,
        "typing": True,
    },
    {
        "id": "writer",
        "name": "Writer",
        "role": "Content",
        "emoji": "✍️",
        "color": "#EC4899",
        "home": "center",
        "status": "working",
        "task": "Drafting launch blog post",
        "tasks": ["Drafting article", "Editing copy", "SEO optimization"],
        "output": ["Blog post v2", "Thread draft"],
        "stats": {"tasksDone": 21, "active": 2, "hours": 5.1},
        "mood": 0.8,
        "typing": True,
    },
    {
        "id": "marketer",
        "name": "Marketer",
        "role": "Growth",
        "emoji": "📢",
        "color": "#F59E0B",
        "home": "right",
        "status": "walking",
        "task": "Walking to meeting room",
        "tasks": ["Campaign planning", "Audience targeting", "Post scheduling"],
        "output": ["Launch plan", "Campaign brief"],
        "stats": {"tasksDone": 15, "active": 2, "hours": 3.8},
        "mood": 0.85,
        "typing": False,
    },
    {
        "id": "coder",
        "name": "Coder",
        "role": "Dev",
        "emoji": "💻",
        "color": "#10B981",
        "home": "right2",
        "status": "working",
        "task": "Building API endpoint",
        "tasks": ["Feature build", "Code review", "Deploy checks"],
        "output": ["API endpoint merged", "Bug fix deployed"],
        "stats": {"tasksDone": 29, "active": 4, "hours": 6.7},
        "mood": 0.7,
        "typing": True,
    },
]

# Thread-safe shared state
state_lock = threading.Lock()
latest_agents = list(DEMO_AGENTS)
sse_clients = []
sse_lock = threading.Lock()
last_poll = 0
last_payload = None
webhook_overrides = {}  # id -> (agent dict, expires_at)


def _read_agents_json():
    try:
        path = Path(AGENTS_JSON_PATH)
        if path.exists():
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list) and data:
                    return data
                if isinstance(data, dict) and "agents" in data:
                    return data["agents"]
    except Exception as e:
        logger.error("Failed to read agents.json: %s", e)
    return None


def _fetch_hermes_agents():
    if not HERMES_AGENT_API:
        return None
    try:
        req = urllib.request.Request(
            HERMES_AGENT_API,
            headers={"Accept": "application/json", "User-Agent": "hermes-3d-office/1.0"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, list):
                return data
            if isinstance(data, dict):
                return data.get("agents", data.get("results", []))
    except Exception as e:
        logger.error("Failed to poll Hermes API: %s", e)
    return None


def _normalize_agent(agent):
    """Ensure every agent has the keys the dashboard needs.

    Unknown keys (source, signal, research, board, channel, updatedAt ...) pass through."""
    defaults = dict(agent)
    defaults.update({
        "id": str(agent.get("id", "agent")),
        "name": agent.get("name", "Agent"),
        "role": agent.get("role", "Worker"),
        "emoji": agent.get("emoji", "🤖"),
        "color": agent.get("color", "#8B5CF6"),
        "home": agent.get("home", "center"),
        "status": agent.get("status", "idle"),
        "task": agent.get("task", agent.get("status", "idle")),
        "tasks": agent.get("tasks", []),
        "output": agent.get("output", []),
        "docs": agent.get("docs", []),
        "needsSteve": agent.get("needsSteve", []),
        "stats": agent.get("stats", {"tasksDone": 0, "active": 0, "hours": 0}),
        "mood": agent.get("mood", 0.8),
        "typing": agent.get("typing", False),
        "position": agent.get("position", None),
    })
    return defaults


def _merge_overrides(agents):
    """Overlay unexpired webhook overrides on the file/API roster (by id)."""
    now = time.time()
    with state_lock:
        for k in [k for k, (_, exp) in webhook_overrides.items() if exp <= now]:
            del webhook_overrides[k]
        live = {k: a for k, (a, _) in webhook_overrides.items()}
    if not live:
        return agents
    out, seen = [], set()
    for a in agents:
        o = live.get(a["id"])
        if o:
            merged = dict(a)
            merged.update(o)
            merged["webhook"] = True
            out.append(merged)
            seen.add(a["id"])
        else:
            out.append(a)
    out += [dict(o, webhook=True) for k, o in live.items() if k not in seen]
    return out


def refresh_agents():
    """Refresh latest_agents from API, file, or demo fallback."""
    global latest_agents, last_poll, last_payload

    data = None
    if HERMES_AGENT_API:
        data = _fetch_hermes_agents()
    if data is None:
        data = _read_agents_json()
    if data is None:
        data = list(DEMO_AGENTS)

    normalized = _merge_overrides([_normalize_agent(a) for a in data])
    if cursor_activity and cursor_snapshot:
        normalized = cursor_activity.overlay(normalized, cursor_snapshot)
    if agent_registry:
        try:
            agent_registry.load()  # seed / merge roster + seat_map
            normalized = agent_registry.attach_registry(normalized)
        except Exception as e:
            logger.warning("registry attach failed: %s", e)
    if state_aggregator:
        try:
            normalized = state_aggregator.enrich_agents(normalized)
        except Exception as e:
            logger.warning("state aggregator failed: %s", e)
    payload = json.dumps({"agents": normalized})

    with state_lock:
        prev = list(latest_agents)
        latest_agents = normalized
        last_poll = time.time()
        changed = payload != last_payload
        last_payload = payload

    if changed:
        _emit_agent_edge_events(prev, normalized)
        _broadcast_sse(payload)


def _emit_agent_edge_events(prev, nxt):
    """Best-effort server-side timeline from coarse status/cursor edges (not a full JS deriveEvents)."""
    if not event_store:
        return
    try:
        P = {a["id"]: a for a in (prev or []) if a.get("id")}
        for n in nxt or []:
            aid = n.get("id")
            if not aid or aid == "needs-steve" or aid not in SEAT_IDS:
                continue
            p = P.get(aid) or {}
            act = (n.get("activity") or {}).get("state")
            pact = (p.get("activity") or {}).get("state")
            if act and act != pact:
                event_store.append_event(
                    aid, "state_change",
                    f"{pact or '?'} → {act} ({(n.get('activity') or {}).get('confidence', '?')})",
                    source=(n.get("activity") or {}).get("source") or "server",
                    provenance="server",
                    metadata={"from": pact, "to": act, "activity": n.get("activity")},
                )
            nc = ((n.get("cursor") or {}).get("latest") or {})
            pc = ((p.get("cursor") or {}).get("latest") or {})
            if nc.get("id") and (nc.get("id") != pc.get("id") or nc.get("toolKind") != pc.get("toolKind")) and nc.get("state") == "active":
                event_store.append_event(
                    aid, "tool_activity",
                    nc.get("step") or (nc.get("toolKind") or "tool"),
                    source="cursor", provenance="observed",
                    metadata={"chatId": nc.get("id"), "toolKind": nc.get("toolKind")},
                    correlation_id=nc.get("id"),
                )
    except Exception as e:
        logger.warning("edge events failed: %s", e)


def _broadcast_sse(payload):
    if not ENABLE_SSE:
        return
    dead = []
    with sse_lock:
        for q in sse_clients:
            try:
                q.put_nowait(payload)
            except Exception:
                dead.append(q)
        for q in dead:
            if q in sse_clients:
                sse_clients.remove(q)


def _broadcast_message_update(msg):
    """Push a lightweight message lifecycle update over SSE (does not invent agent state)."""
    if not msg:
        return
    try:
        _broadcast_sse(json.dumps({"type": "message", "message": msg}))
    except Exception:
        pass


def _msg_summary(content, n=80):
    s = str(content or "").replace("\n", " ").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def _emit_msg_event(agent_id, event_type, summary, message_id, extra=None):
    if not event_store or not agent_id:
        return
    try:
        event_store.append_event(
            agent_id, event_type, summary,
            source="user" if event_type.startswith("message_") or "confirm" in event_type else "server",
            provenance="user" if "acknowledged" in event_type or "responded" in event_type or "handoff" in event_type or event_type == "delivery_confirmed" else "server",
            metadata=dict({"message_id": message_id}, **(extra or {})),
            correlation_id=message_id,
        )
    except Exception:
        pass


def _agent_for_message(agent_id):
    with state_lock:
        for a in latest_agents:
            if a.get("id") == agent_id:
                return dict(a)
    return {"id": agent_id, "name": agent_id, "role": "", "task": "", "docs": []}


def _registry_entry(agent_id):
    if not agent_registry:
        return {}
    try:
        return agent_registry.get_agent(agent_id) or {}
    except Exception:
        return {}


def messages_create(content, recipient_agent_id, task_id=None):
    """Queue an instruction and run the delivery adapter. Returns (HTTPStatus, payload)."""
    if not message_store or not delivery_adapters:
        return HTTPStatus.SERVICE_UNAVAILABLE, {"ok": False, "error": "messaging unavailable"}
    adapter, adapter_name, runtime = delivery_adapters.pick_adapter(
        recipient_agent_id, _registry_entry(recipient_agent_id)
    )
    ok, msg = message_store.create_message(
        recipient_agent_id, content, runtime=runtime, adapter=adapter_name,
        task_id=task_id, seat_ids=SEAT_IDS,
    )
    if not ok:
        return HTTPStatus.BAD_REQUEST, msg
    _emit_msg_event(recipient_agent_id, "message_created", _msg_summary(content), msg["message_id"])
    _emit_msg_event(recipient_agent_id, "message_queued", "queued for " + adapter_name, msg["message_id"])

    agent = _agent_for_message(recipient_agent_id)
    result = adapter.submit(msg, agent=agent, registry_entry=_registry_entry(recipient_agent_id))
    caps = result.capabilities or adapter.capabilities()

    if result.status == "DELIVERING":
        ok2, msg2 = message_store.transition(
            msg["message_id"], "DELIVERING",
            {"handoff": result.handoff, "delivery_attempts": 1, "adapter": adapter_name, "runtime": runtime},
        )
        if ok2:
            msg = msg2
            _emit_msg_event(recipient_agent_id, "delivery_started", "manual Cursor handoff ready", msg["message_id"])
    else:
        ok2, msg2 = message_store.transition(
            msg["message_id"], "FAILED",
            {
                "error_code": result.error_code,
                "error_message": result.error_message,
                "delivery_attempts": 1,
                "adapter": adapter_name,
                "runtime": runtime,
            },
        )
        if ok2:
            msg = msg2
            _emit_msg_event(
                recipient_agent_id, "delivery_failed",
                result.error_message or result.error_code or "failed",
                msg["message_id"],
                {"error_code": result.error_code},
            )

    _broadcast_message_update(msg)
    return HTTPStatus.OK, {"ok": True, "message": msg, "capabilities": caps}


def messages_action(message_id, action, body=None):
    """handoff-opened | acknowledge | respond | retry | cancel."""
    if not message_store:
        return HTTPStatus.SERVICE_UNAVAILABLE, {"ok": False, "error": "messaging unavailable"}
    body = body or {}
    msg = message_store.get_message(message_id)
    if not msg:
        return HTTPStatus.NOT_FOUND, {"ok": False, "error": "unknown message"}
    aid = msg["recipient_agent_id"]

    if action == "handoff-opened":
        if msg.get("adapter") != "cursor_deeplink":
            return HTTPStatus.BAD_REQUEST, {"ok": False, "error": "handoff only for cursor_deeplink"}
        if msg.get("status") != "DELIVERING":
            if msg.get("status") == "DELIVERED":
                return HTTPStatus.OK, {"ok": True, "message": msg}
            return HTTPStatus.BAD_REQUEST, {"ok": False, "error": f"cannot confirm handoff from {msg.get('status')}"}
        handoff = dict(msg.get("handoff") or {})
        handoff["openedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        ok, updated = message_store.transition(
            message_id, "DELIVERED",
            {"handoff": handoff, "delivered_at": handoff["openedAt"]},
        )
        if not ok:
            return HTTPStatus.BAD_REQUEST, updated
        _emit_msg_event(aid, "delivery_confirmed", "user opened Cursor handoff", message_id)
        _broadcast_message_update(updated)
        return HTTPStatus.OK, {"ok": True, "message": updated}

    if action == "acknowledge":
        if msg.get("status") not in ("DELIVERED", "ACKNOWLEDGED"):
            return HTTPStatus.BAD_REQUEST, {"ok": False, "error": f"cannot acknowledge from {msg.get('status')}"}
        if msg.get("status") == "ACKNOWLEDGED":
            return HTTPStatus.OK, {"ok": True, "message": msg}
        iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        ok, updated = message_store.transition(message_id, "ACKNOWLEDGED", {"acknowledged_at": iso})
        if not ok:
            return HTTPStatus.BAD_REQUEST, updated
        _emit_msg_event(aid, "message_acknowledged", "Steve marked acknowledged", message_id)
        _broadcast_message_update(updated)
        return HTTPStatus.OK, {"ok": True, "message": updated}

    if action == "respond":
        text = body.get("text") or body.get("response")
        if not isinstance(text, str) or not text.strip():
            return HTTPStatus.BAD_REQUEST, {"ok": False, "error": "text required"}
        if msg.get("status") not in ("DELIVERED", "ACKNOWLEDGED", "RESPONDED"):
            return HTTPStatus.BAD_REQUEST, {"ok": False, "error": f"cannot respond from {msg.get('status')}"}
        if msg.get("status") == "RESPONDED":
            return HTTPStatus.OK, {"ok": True, "message": msg}
        iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        patch = {"responded_at": iso, "response_text": text.strip()[:2000]}
        if msg.get("status") == "DELIVERED":
            # allow DELIVERED → RESPONDED per TRANSITIONS
            pass
        ok, updated = message_store.transition(message_id, "RESPONDED", patch)
        if not ok:
            return HTTPStatus.BAD_REQUEST, updated
        _emit_msg_event(aid, "message_responded", _msg_summary(text), message_id)
        _broadcast_message_update(updated)
        return HTTPStatus.OK, {"ok": True, "message": updated}

    if action == "retry":
        if not message_store.can_retry(msg):
            return HTTPStatus.BAD_REQUEST, {"ok": False, "error": "retry not allowed"}
        ok, queued = message_store.transition(message_id, "QUEUED", {"error_code": None, "error_message": None})
        if not ok:
            return HTTPStatus.BAD_REQUEST, queued
        _emit_msg_event(aid, "message_retry", "retry requested", message_id)
        if not delivery_adapters:
            return HTTPStatus.OK, {"ok": True, "message": queued}
        adapter, adapter_name, runtime = delivery_adapters.pick_adapter(aid, _registry_entry(aid))
        result = adapter.submit(queued, agent=_agent_for_message(aid), registry_entry=_registry_entry(aid))
        attempts = int(queued.get("delivery_attempts") or 0) + 1
        if result.status == "DELIVERING":
            ok2, updated = message_store.transition(
                message_id, "DELIVERING",
                {"handoff": result.handoff, "delivery_attempts": attempts, "adapter": adapter_name},
            )
            if ok2:
                _emit_msg_event(aid, "delivery_started", "retry handoff ready", message_id)
                _broadcast_message_update(updated)
                return HTTPStatus.OK, {"ok": True, "message": updated, "capabilities": result.capabilities}
        else:
            ok2, updated = message_store.transition(
                message_id, "FAILED",
                {
                    "error_code": result.error_code,
                    "error_message": result.error_message,
                    "delivery_attempts": attempts,
                },
            )
            if ok2:
                _emit_msg_event(aid, "delivery_failed", result.error_message or "failed", message_id)
                _broadcast_message_update(updated)
                return HTTPStatus.OK, {"ok": True, "message": updated, "capabilities": result.capabilities}
        return HTTPStatus.OK, {"ok": True, "message": queued}

    if action == "cancel":
        if msg.get("status") in ("CANCELLED", "RESPONDED", "EXPIRED"):
            return HTTPStatus.BAD_REQUEST, {"ok": False, "error": f"cannot cancel from {msg.get('status')}"}
        ok, updated = message_store.transition(message_id, "CANCELLED")
        if not ok:
            return HTTPStatus.BAD_REQUEST, updated
        _emit_msg_event(aid, "message_cancelled", "cancelled by Steve", message_id)
        _broadcast_message_update(updated)
        return HTTPStatus.OK, {"ok": True, "message": updated}

    return HTTPStatus.NOT_FOUND, {"ok": False, "error": "unknown action"}


def _polling_loop():
    while True:
        refresh_agents()
        time.sleep(POLL_INTERVAL)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORY), **kwargs)

    def log_message(self, format, *args):
        # Quiet logs; remove if you want access logging
        pass

    def _send_json(self, data, status=HTTPStatus.OK):
        body = json.dumps(data).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _read_json_body(self, limit=1024 * 1024):
        length = int(self.headers.get("Content-Length", "0"))
        if length > limit:
            raise ValueError(f"body over {limit} bytes")
        if length:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        return {}

    def _host_ok(self):
        return (self.headers.get("Host") or "").lower() in ALLOWED_HOSTS

    def _write_allowed(self):
        """Origin + token gate for every POST. Sends the 401/403 itself; returns True when allowed."""
        origin = self.headers.get("Origin")
        if not self._host_ok() or origin not in ALLOWED_ORIGINS:
            self._send_json({"ok": False, "error": "origin not allowed"}, HTTPStatus.FORBIDDEN)
            return False
        tok = self.headers.get("X-TEVA-Token") or ""
        if not tok or not hmac.compare_digest(tok.encode("utf-8"), TOKEN.encode("utf-8")):
            self._send_json({"ok": False, "error": "missing or invalid X-TEVA-Token"}, HTTPStatus.UNAUTHORIZED)
            return False
        return True

    def _serve_office(self):
        """office.html with the per-install token injected (same-origin only: Host is checked)."""
        try:
            html = (DIRECTORY / "office.html").read_text(encoding="utf-8")
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = html.replace(TOKEN_META, f'<meta name="teva-token" content="{TOKEN}">', 1).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if not self._host_ok():
            self._send_json({"ok": False, "error": "host not allowed"}, HTTPStatus.FORBIDDEN)
            return

        if path == "/office.html":
            self._serve_office()
            return

        if path == "/api/inbox":
            q = parse_qs(parsed.query)
            seat = (q.get("seat") or [""])[0]
            if seat:
                if seat not in SEAT_IDS:
                    self._send_json({"ok": False, "error": "unknown seat"}, HTTPStatus.BAD_REQUEST)
                    return
                msg_summary = {}
                if message_store:
                    try:
                        for m in message_store.list_messages(agent_id=seat, limit=200):
                            st = m.get("status") or "?"
                            msg_summary[st] = msg_summary.get(st, 0) + 1
                    except Exception:
                        pass
                self._send_json({
                    "seat": seat,
                    "counts": inbox_counts().get(seat),
                    "messages": inbox_messages(seat),
                    "instructions": msg_summary,
                })
                return
            self._send_json({"counts": inbox_counts(), "maxText": INBOX_MAX_TEXT, "maxFile": INBOX_MAX_FILE})
            return

        if path == "/api/cursor":
            snap = cursor_snapshot or {}
            self._send_json(dict(snap, chats=(snap.get("chats") or [])[:60]))
            return

        if path == "/api/agents":
            with state_lock:
                agents = list(latest_agents)
            self._send_json(agents)
            return

        # GET /api/agents/<id>/timeline
        m_tl = re.match(r"^/api/agents/([a-z0-9][a-z0-9-]{0,31})/timeline$", path)
        if m_tl:
            aid = m_tl.group(1)
            if aid not in SEAT_IDS:
                self._send_json({"ok": False, "error": "unknown agent"}, HTTPStatus.BAD_REQUEST)
                return
            q = parse_qs(parsed.query)
            try:
                limit = int((q.get("limit") or ["50"])[0])
            except ValueError:
                limit = 50
            rows = event_store.read_timeline(aid, limit) if event_store else []
            self._send_json({"agentId": aid, "events": rows})
            return

        if path == "/api/registry":
            if not agent_registry:
                self._send_json({"ok": False, "error": "registry unavailable"}, HTTPStatus.SERVICE_UNAVAILABLE)
                return
            self._send_json(agent_registry.public_view())
            return

        if path == "/api/messages":
            if not message_store:
                self._send_json({"ok": False, "error": "messaging unavailable"}, HTTPStatus.SERVICE_UNAVAILABLE)
                return
            q = parse_qs(parsed.query)
            agent = (q.get("agent") or q.get("seat") or [None])[0]
            status = (q.get("status") or [None])[0]
            try:
                limit = int((q.get("limit") or ["50"])[0])
            except ValueError:
                limit = 50
            rows = message_store.list_messages(agent_id=agent, status=status, limit=limit)
            self._send_json({"messages": rows})
            return

        m_one = re.match(r"^/api/messages/(msg_[a-f0-9]{12,32})$", path)
        if m_one:
            if not message_store:
                self._send_json({"ok": False, "error": "messaging unavailable"}, HTTPStatus.SERVICE_UNAVAILABLE)
                return
            msg = message_store.get_message(m_one.group(1))
            if not msg:
                self._send_json({"ok": False, "error": "unknown message"}, HTTPStatus.NOT_FOUND)
                return
            self._send_json({"message": msg})
            return

        if path == "/api/config":
            self._send_json({
                "mode": "hermes_api" if HERMES_AGENT_API else ("json_file" if Path(AGENTS_JSON_PATH).exists() else "demo"),
                "poll_interval_seconds": POLL_INTERVAL,
                "enable_sse": ENABLE_SSE,
                "hermes_agent_api": "[REDACTED]" if HERMES_AGENT_API else None,
                "host": HOST,
                "webhook_ttl_seconds": WEBHOOK_TTL,
                "teva_sync_interval_seconds": TEVA_SYNC_INTERVAL,
                "teva_repo": TEVA_REPO,
                "office_root": str(ROOT),
                "write_auth": "X-TEVA-Token header + Origin allowlist",
                "allowed_origins": sorted(ALLOWED_ORIGINS),
                "token_file": str(TOKEN_FILE),
                "inbox_dir": str(INBOX_DIR),
                "inbox_max_text": INBOX_MAX_TEXT,
                "inbox_max_file": INBOX_MAX_FILE,
                "cursor_scan_seconds": CURSOR_SCAN_SECONDS,
                "reaction_emoji": list(REACTION_EMOJI),
                "cursor_source": CURSOR_SNAPSHOT and "snapshot" or "live transcripts",
                "command_centre_phase": 2,
            })
            return

        if path == "/events":
            self._handle_sse()
            return

        if path in ("", "/"):
            self.path = "/index.html"
            return super().do_GET()

        try:
            return super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            return

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        action_m = MSG_ACTION_RE.match(path)
        limit = MAX_BODY.get(path)
        if limit is None and action_m:
            limit = 16 * 1024
        if limit is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not self._write_allowed():
            return
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            self._send_json({"ok": False, "error": "Content-Type must be application/json"}, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
            return
        try:
            if int(self.headers.get("Content-Length", "0")) > limit:
                self._send_json({"ok": False, "error": "body too large"}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
                return
        except ValueError:
            self._send_json({"ok": False, "error": "bad Content-Length"}, HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/messages":
            try:
                body = self._read_json_body(limit)
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
                return
            if not isinstance(body, dict):
                self._send_json({"ok": False, "error": "JSON object expected"}, HTTPStatus.BAD_REQUEST)
                return
            rid = body.get("recipient_agent_id") or body.get("agentId") or body.get("seat")
            status, payload = messages_create(body.get("content") or body.get("text"), rid, body.get("task_id"))
            self._send_json(payload, status)
            return
        if action_m:
            mid, action = action_m.group(1), action_m.group(2)
            try:
                body = self._read_json_body(limit) if int(self.headers.get("Content-Length", "0") or 0) else {}
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
                return
            if body is None:
                body = {}
            if not isinstance(body, dict):
                self._send_json({"ok": False, "error": "JSON object expected"}, HTTPStatus.BAD_REQUEST)
                return
            status, payload = messages_action(mid, action, body)
            self._send_json(payload, status)
            return
        if parsed.path == "/api/inbox":
            try:
                body = self._read_json_body(MAX_BODY["/api/inbox"])
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
                return
            if not isinstance(body, dict):
                self._send_json({"ok": False, "error": "JSON object expected"}, HTTPStatus.BAD_REQUEST)
                return
            status, payload = inbox_append(body.get("seat"), body.get("text"), body.get("kind"), body.get("emoji"))
            self._send_json(payload, status)
            return
        if parsed.path == "/api/registry/map":
            if not agent_registry:
                self._send_json({"ok": False, "error": "registry unavailable"}, HTTPStatus.SERVICE_UNAVAILABLE)
                return
            try:
                body = self._read_json_body(MAX_BODY["/api/registry/map"])
            except ValueError as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
                return
            if not isinstance(body, dict):
                self._send_json({"ok": False, "error": "JSON object expected"}, HTTPStatus.BAD_REQUEST)
                return
            ok, payload = agent_registry.map_session(body.get("sessionId") or body.get("session_id"),
                                                      body.get("agentId") or body.get("agent_id") or body.get("seat"))
            if ok and event_store:
                try:
                    event_store.append_event(
                        payload["agentId"], "session_mapped",
                        f"mapped session {payload['sessionId'][:8]}…",
                        source="user", provenance="user",
                        metadata={"sessionId": payload["sessionId"], "previousAgentId": payload.get("previousAgentId")},
                        correlation_id=payload["sessionId"],
                    )
                except Exception:
                    pass
            # Rescan overlay so mapping applies immediately
            try:
                refresh_agents()
            except Exception:
                pass
            self._send_json(payload, HTTPStatus.OK if ok else HTTPStatus.BAD_REQUEST)
            return
        if parsed.path == "/webhook/agents":
            try:
                body = self._read_json_body(MAX_BODY["/webhook/agents"])
                agents = body.get("agents", body if isinstance(body, list) else [])
                normalized = [_normalize_agent(a) for a in agents]
                expires = time.time() + WEBHOOK_TTL
                with state_lock:
                    for a in normalized:
                        webhook_overrides[a["id"]] = (a, expires)
                # Re-merge now so the push is visible immediately and survives the next poll
                refresh_agents()
                self._send_json({"ok": True, "count": len(normalized), "ttl_seconds": WEBHOOK_TTL})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_HEAD(self):
        if not self._host_ok():
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        return super().do_HEAD()

    def do_OPTIONS(self):
        # Preflight: only the two office origins get CORS headers; everyone else gets none.
        origin = self.headers.get("Origin")
        self.send_response(HTTPStatus.NO_CONTENT)
        if self._host_ok() and origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-TEVA-Token")
        self.end_headers()

    def _handle_sse(self):
        import queue
        q = queue.Queue()
        with sse_lock:
            sse_clients.append(q)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            # Send current state immediately
            with state_lock:
                snapshot = json.dumps({"agents": list(latest_agents)})
            self.wfile.write(f"data: {snapshot}\n\n".encode("utf-8"))
            self.wfile.flush()
            while True:
                try:
                    payload = q.get(timeout=30)
                    self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                    self.wfile.flush()
                except queue.Empty:
                    self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with sse_lock:
                if q in sse_clients:
                    sse_clients.remove(q)

    def end_headers(self):
        # Phase 2: no wildcard CORS. Same-origin pages need none; other sites can no longer read the API.
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def make_server(host=None, port=None):
    """Start the background threads and return a bound (not yet serving) server."""
    threading.Thread(target=_cursor_loop, daemon=True).start()
    refresh_agents()
    threading.Thread(target=_polling_loop, daemon=True).start()
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.daemon_threads = True
    return socketserver.ThreadingTCPServer((host or HOST, port or PORT), Handler)


def main():
    if HOST not in ("127.0.0.1", "localhost", "::1"):
        print(f"Refusing to bind {HOST}: TEVA HQ is local-only (R-VO-001 fence).", flush=True)
        sys.exit(2)
    with make_server() as httpd:
        mode = "DEMO" if DEMO_MODE else ("Hermes API" if HERMES_AGENT_API else "agents.json file")
        print(f"Hermes 3D Office running at http://{HOST}:{PORT}", flush=True)
        print(f"Mode: {mode}", flush=True)
        print(f"Agent API: http://{HOST}:{PORT}/api/agents", flush=True)
        print(f"Webhook: POST http://{HOST}:{PORT}/webhook/agents (needs X-TEVA-Token + Origin)", flush=True)
        print(f"Token file: {TOKEN_FILE} (0600, outside git)", flush=True)
        print(f"Config: http://{HOST}:{PORT}/api/config", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
