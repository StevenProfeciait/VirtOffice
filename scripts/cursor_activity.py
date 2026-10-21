#!/usr/bin/env python3
"""Read-only Cursor IDE transcript tailer for TEVA HQ (R-VO-001 Phase 2, R-VO-002 Phase 3a).

Ported from template_1/pixel-agents-cursor (src/fileWatcher.ts session discovery,
src/transcriptParser.ts formatToolStatus/processTranscriptLine). It never writes to
the transcripts or to Cursor's database, and it never sends anything into a chat.

Transcripts: ~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl
  {"role":"user"|"assistant","message":{"content":[{"type":"text"|"tool_use",...}]}}
  {"type":"turn_ended","status":"success"|...}
Titles:      Cursor globalStorage state.vscdb, cursorDiskKV 'composerData:<uuid>' -> name
             (opened read-only; missing DB just means no titles).

A chat is mapped to a TEVA seat only on evidence, in this order:
  1. seat_map.json in VirtOffice (hand-edited {"<uuid>": "<seat id>"}), if present
  2. the chat title names exactly one seat (full seat name, or LE / LE2)
  3. the first prompt names exactly one seat in a role form
     ("To <seat> (TEVA ... seat)" from the office composer, "You are the <seat>",
      "acting as <seat>", "<seat>:" at the start)
  4. the docs/*.md files the chat writes match exactly one seat's ROSTER doc patterns
     (shared board docs such as TEVA_COMPANY_BACKLOG.md are not evidence)
Two different seats from 2+3, or from 4, means "ambiguous" and the chat stays
"Unassigned Cursor chat". Nothing is guessed.

Phase 3a adds structured fields per chat (read-only, same tail):
  tool      - last tool name ("Write", "Shell", ...) or null
  toolKind  - write | edit | read | search | fetch | shell | task | reply | other | null
              (same buckets as pixel-agents' TYPE/READ split; "reply" = assistant text with no tool)
  endStatus - status of the last turn_ended record ("success", "error", ...) or "" while running
  endedAt   - ms timestamp of that turn end (the record's own timestamp if it has one,
              else the transcript mtime when the end was first seen), or null

CLI: python3 scripts/cursor_activity.py [--json]   (prints the summary or full snapshot)
"""
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import teva_sync as ts  # noqa: E402  (ROSTER, match, eng_owner, BOARD)

HOME = Path.home()
REPO = Path(os.environ.get("TEVA_REPO", "").strip() or ROOT)
# Cursor project slug: the absolute repo path sanitised to [A-Za-z0-9] -> '-'.
# Override with CURSOR_TRANSCRIPTS when the transcript folder lives elsewhere.
PROJECT_SLUG = re.sub(r"[^A-Za-z0-9]", "-", str(REPO)).lstrip("-")
TRANSCRIPTS = Path(os.environ.get("CURSOR_TRANSCRIPTS") or (
    HOME / ".cursor/projects" / PROJECT_SLUG / "agent-transcripts"))
CURSOR_DB = Path(os.environ.get("CURSOR_GLOBAL_DB") or (
    HOME / "Library/Application Support/Cursor/User/globalStorage/state.vscdb"))
SEAT_MAP = Path(os.environ.get("TEVA_SEAT_MAP") or (ROOT / "seat_map.json"))

ACTIVE_MS = 120_000          # pixel-agents EXTERNAL_ACTIVE_THRESHOLD_MS
SHELL_MAX = 40               # pixel-agents SHELL_COMMAND_DISPLAY_MAX_LENGTH is 30
TASK_MAX = 40
PROMPT_SCAN_CHARS = 1500
WRITE_TOOLS = {"Write", "StrReplace", "EditNotebook"}
# Phase 3a: tool name -> animation bucket (R-VO-002 brief section 3.6)
TOOL_KIND = {
    "Write": "write", "GenerateImage": "write",
    "StrReplace": "edit", "EditNotebook": "edit", "Delete": "edit", "MultiEdit": "edit", "Edit": "edit",
    "Read": "read", "ReadLints": "read",
    "Glob": "search", "Grep": "search", "SemanticSearch": "search", "LS": "search",
    "WebFetch": "fetch", "WebSearch": "fetch", "FetchMcpResource": "fetch",
    "Shell": "shell", "Await": "shell", "Bash": "shell",
    "Task": "task",
}


def tool_kind(name):
    """Animation bucket for a tool name; unknown tools are "other" (never guessed into write/read)."""
    if not name:
        return None
    return TOOL_KIND.get(name, "other")


def _rec_ts(rec):
    """Optional per-record timestamp (ms) if the transcript line carries one."""
    for k in ("timestamp", "ts", "time", "createdAt"):
        v = rec.get(k)
        if isinstance(v, (int, float)) and v > 0:
            return int(v if v > 1e11 else v * 1000)
    return None
SEAT_IDS = [r[0] for r in ts.ROSTER]
SEAT_NAMES = {r[0]: r[1] for r in ts.ROSTER}

# ---------------------------------------------------------------- tool status (port)
_SECRET = re.compile(r"(?i)((?:token|password|passwd|secret|api[_-]?key|key|pwd)\s*[=:]\s*)\S+")


def _base(p):
    return os.path.basename(p) if isinstance(p, str) else ""


def redact(cmd):
    return _SECRET.sub(r"\1***", cmd or "")


def format_tool_status(name, inp):
    inp = inp if isinstance(inp, dict) else {}
    if name == "Read":
        return f"Reading {_base(inp.get('path'))}"
    if name == "Write":
        return f"Writing {_base(inp.get('path'))}"
    if name == "StrReplace":
        return f"Editing {_base(inp.get('path'))}"
    if name == "EditNotebook":
        return "Editing notebook"
    if name == "Shell":
        cmd = redact(str(inp.get("command") or "")).replace("\n", " ")
        return "Running: " + (cmd[:SHELL_MAX] + "\u2026" if len(cmd) > SHELL_MAX else cmd)
    simple = {"Glob": "Searching files", "Grep": "Searching code", "SemanticSearch": "Semantic search",
              "WebFetch": "Fetching web content", "WebSearch": "Searching the web",
              "AskQuestion": "Waiting for your answer", "SwitchMode": "Switching mode",
              "TodoWrite": "Updating tasks", "ReadLints": "Checking lints",
              "FetchMcpResource": "Fetching MCP resource", "GenerateImage": "Generating image",
              "Await": "Awaiting process"}
    if name in simple:
        return simple[name]
    if name == "Task":
        d = inp.get("description") if isinstance(inp.get("description"), str) else ""
        return ("Subtask: " + (d[:TASK_MAX] + "\u2026" if len(d) > TASK_MAX else d)) if d else "Running subtask"
    if name == "Delete":
        return f"Deleting {_base(inp.get('path'))}"
    if name == "CallMcpTool":
        return f"MCP: {inp.get('toolName') or 'tool'}"
    return f"Using {name or 'tool'}"


# ---------------------------------------------------------------- seat naming
def _rx(alts, ci=True, not_followed=None):
    tail = r"(?![\w])" + (not_followed or "")
    return re.compile(r"(?<![\w])(?:" + "|".join(alts) + r")" + tail, re.I if ci else 0)


# Full names are matched case-insensitively. Short codes only where they are unambiguous
# in this repo (LE, LE2), case-sensitive. "Laravel Expert" must not be followed by "2".
SEAT_RX = {
    "supervisor": [_rx(["Supervisor"])],
    "pm": [_rx(["Project Manager"])],
    "ba": [_rx(["Business Analyst"])],
    "le": [_rx(["Laravel Expert"], not_followed=r"(?!\s*2)"), _rx(["LE"], ci=False, not_followed=r"(?!\s*2)")],
    "le2": [_rx([r"Laravel Expert\s*2"]), _rx(["LE2", r"LE 2"], ci=False)],
    "sa": [_rx(["Security Auditor"])],
    "debugger": [_rx(["Debugger"])],
    "research-mgr": [_rx(["Research Manager"])],
    "ai-research": [_rx(["AI Research"])],
    "erp-research": [_rx(["ERP Research"])],
    "product": [_rx(["Product Research"])],
    "competitor": [_rx(["Competitor Intel(?:ligence)?"])],
    "ui-docs": [_rx(["UI Docs"])],
    "grok": [_rx(["Grok Bot"])],
}
_NAME_ALT = r"(?P<name>.{2,40}?)"


def seats_named(text):
    """Every seat whose name appears anywhere in text (used for titles)."""
    return {sid for sid, rxs in SEAT_RX.items() if any(r.search(text or "") for r in rxs)}


ROLE_FORMS = [
    re.compile(r"^\s*To\s+(?P<who>[^\n(,]{2,40}?)\s*\(TEVA\b", re.I),           # office composer header
    re.compile(r"\byou\s+are\s+(?:now\s+)?(?:the\s+|a\s+|an\s+|TEVA'?s?\s+)?(?P<who>[^\n.,;]{2,40})", re.I),
    re.compile(r"\bact(?:ing)?\s+as\s+(?:the\s+)?(?P<who>[^\n.,;]{2,40})", re.I),
    re.compile(r"^\s*@?(?P<who>[A-Z][\w ]{1,30}?)\s*[:\u2014-]\s", re.M),          # "LE2: ..." at line start
    re.compile(r"\b(?:seat|role)\s*[:=]\s*(?P<who>[^\n.,;]{2,40})", re.I),
]


def seats_in_prompt(prompt):
    """Seats named in a role form within the first prompt. A passing mention ("ask LE to...") is not evidence."""
    text = (prompt or "")[:PROMPT_SCAN_CHARS]
    found = set()
    for rx in ROLE_FORMS:
        for m in rx.finditer(text):
            who = m.group("who")
            for sid, rxs in SEAT_RX.items():
                if any(r.match(who.strip()) for r in rxs):
                    found.add(sid)
    return found


def first_prompt_text(record):
    blocks = (record.get("message") or {}).get("content") or []
    text = "\n".join(b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text")
    m = re.search(r"<user_query>\s*(.*?)\s*(?:</user_query>|\Z)", text, re.S)
    return (m.group(1) if m else re.sub(r"<timestamp>.*?</timestamp>", "", text, flags=re.S)).strip()


def doc_seats(paths, docs_dir):
    """Seat ids whose ROSTER doc patterns own the written docs/*.md files (board docs excluded)."""
    out, hits = set(), []
    docs_dir = Path(docs_dir)
    for p in sorted(paths):
        pp = Path(p)
        if pp.parent != docs_dir or pp.suffix != ".md" or pp.name in ts.BOARD:
            continue
        for sid, _n, _t, _e, _c, _d, pats in ts.ROSTER:
            if not pats:
                continue
            if pats[0].startswith("@eng:"):
                if "_eng_" in pp.name and pp.exists() and ts.eng_owner(pp, {}) == pats[0][5:]:
                    out.add(sid)
                    hits.append((sid, pp.name))
            elif ts.match(pp.name, pats):
                out.add(sid)
                hits.append((sid, pp.name))
    return out, hits


# ---------------------------------------------------------------- titles (read-only)
def load_titles(ids, db=None):
    db = Path(db or CURSOR_DB)
    if not ids or not db.exists():
        return {}
    out = {}
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        try:
            for i in ids:
                row = con.execute("SELECT value FROM cursorDiskKV WHERE key=?", ("composerData:" + i,)).fetchone()
                if row and row[0]:
                    try:
                        name = json.loads(row[0]).get("name")
                    except (ValueError, AttributeError):
                        name = None
                    if name:
                        out[i] = str(name)[:120]
        finally:
            con.close()
    except sqlite3.Error:
        return out
    return out


# ---------------------------------------------------------------- incremental tailer
class Tailer:
    """Keeps per-chat parse state and byte offsets so each scan reads only new lines."""

    def __init__(self, transcripts=None, docs_dir=None, cursor_db=None, seat_map=None, titles=None):
        self.dir = Path(transcripts or TRANSCRIPTS)
        self.docs_dir = Path(docs_dir or (REPO / "docs"))
        self.cursor_db = cursor_db or CURSOR_DB
        self.seat_map_path = Path(seat_map or SEAT_MAP)
        self.fixed_titles = titles  # tests pass a dict instead of a DB
        self.chats = {}
        self.titles = {}
        self.bytes_read = 0

    def _sessions(self):
        if not self.dir.is_dir():
            return []
        out = []
        for d in self.dir.iterdir():
            f = d / f"{d.name}.jsonl"
            if d.is_dir() and f.is_file():
                subs = list((d / "subagents").glob("*.jsonl")) if (d / "subagents").is_dir() else []
                out.append((d.name, f, subs))
        return out

    def _feed(self, st, line):
        try:
            rec = json.loads(line)
        except ValueError:
            return
        if not isinstance(rec, dict):
            return
        if rec.get("type") == "turn_ended":
            st["ended"], st["endStatus"] = True, str(rec.get("status") or "")
            st["endedAt"] = _rec_ts(rec)  # None -> filled from the file mtime in scan()
            return
        role, content = rec.get("role"), (rec.get("message") or {}).get("content")
        if not role or not isinstance(content, list):
            return
        if role == "user":
            if st["prompt"] is None:
                st["prompt"] = first_prompt_text(rec)
            st["turns"] += 1
            st["ended"], st["step"] = False, "New prompt from Steve"
            st["tool"], st["toolKind"], st["endStatus"], st["endedAt"] = None, None, "", None
        elif role == "assistant":
            tools = [b for b in content if isinstance(b, dict) and b.get("type") == "tool_use"]
            if tools:
                st["ended"], st["endStatus"], st["endedAt"] = False, "", None
                st["step"] = format_tool_status(tools[-1].get("name") or "", tools[-1].get("input") or {})
                st["tool"] = str(tools[-1].get("name") or "") or None
                st["toolKind"] = tool_kind(st["tool"])
                for b in tools:
                    inp = b.get("input") or {}
                    if b.get("name") in WRITE_TOOLS and isinstance(inp.get("path"), str):
                        st["writes"].add(inp["path"])
            elif any(isinstance(b, dict) and b.get("type") == "text" for b in content):
                st["step"] = "Replying"
                st["tool"], st["toolKind"] = None, "reply"

    def _read_new(self, cid, f):
        st = self.chats.get(cid)
        size = f.stat().st_size
        if st is None or size < st["offset"]:
            st = {"offset": 0, "prompt": None, "step": None, "ended": False, "endStatus": "",
                  "writes": set(), "turns": 0, "partial": b"", "tool": None, "toolKind": None, "endedAt": None}
            self.chats[cid] = st
        if size == st["offset"]:
            return st
        with f.open("rb") as fh:
            fh.seek(st["offset"])
            data = fh.read(size - st["offset"])
        self.bytes_read += len(data)
        st["offset"] = size
        data = st["partial"] + data
        lines = data.split(b"\n")
        st["partial"] = lines.pop()  # incomplete last line waits for the next scan
        for ln in lines:
            if ln.strip():
                self._feed(st, ln.decode("utf-8", "replace"))
        return st

    def _seat_map(self):
        try:
            data = json.loads(self.seat_map_path.read_text(encoding="utf-8"))
            return {k: v for k, v in data.items() if v in SEAT_IDS} if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def scan(self, now=None):
        now_ms = int((now if now is not None else time.time()) * 1000)
        self.bytes_read = 0
        sessions = self._sessions()
        ids = [s[0] for s in sessions]
        if self.fixed_titles is not None:
            self.titles = dict(self.fixed_titles)
        else:
            missing = [i for i in ids if i not in self.titles]
            # refresh titles for new chats, and every scan for the 10 most recent (Cursor renames late)
            recent = sorted(sessions, key=lambda s: -s[1].stat().st_mtime)[:10]
            self.titles.update(load_titles(sorted(set(missing) | {s[0] for s in recent}), self.cursor_db))
        manual = self._seat_map()
        # Registry explicit mappings win over seat_map.json (evidence labels stay distinct).
        reg = {}
        try:
            import agent_registry as _ar
            reg = {sid: aid for sid, aid in (_ar.session_map() or {}).items() if aid in SEAT_IDS}
        except Exception:
            pass
        chats = []
        for cid, f, subs in sessions:
            try:
                st = self._read_new(cid, f)
                mtime = max([f.stat().st_mtime] + [s.stat().st_mtime for s in subs])
            except OSError:
                continue
            title = self.titles.get(cid, "")
            seat, evidence = None, ""
            if cid in reg:
                seat, evidence = reg[cid], "agent_registry"
            elif cid in manual:
                seat, evidence = manual[cid], "seat_map.json"
            else:
                by_title, by_prompt = seats_named(title), seats_in_prompt(st["prompt"])
                strong = by_title | by_prompt
                if len(strong) == 1:
                    seat = next(iter(strong))
                    evidence = (f"title names {SEAT_NAMES[seat]}" if by_title else f"first prompt names {SEAT_NAMES[seat]}")
                elif len(strong) > 1:
                    evidence = "ambiguous: names " + ", ".join(SEAT_NAMES[s] for s in sorted(strong))
                else:
                    ds, hits = doc_seats(st["writes"], self.docs_dir)
                    if len(ds) == 1:
                        seat = next(iter(ds))
                        evidence = "writes docs/" + next(n for s, n in hits if s == seat)
                    elif len(ds) > 1:
                        evidence = "ambiguous: writes docs owned by " + ", ".join(SEAT_NAMES[s] for s in sorted(ds))
                    else:
                        evidence = "no seat named in title or first prompt, no owned doc written"
            last = int(mtime * 1000)
            state = "ended" if st["ended"] else ("active" if now_ms - last < ACTIVE_MS else "stale")
            if st["ended"] and not st.get("endedAt"):
                st["endedAt"] = last  # first scan that saw the end: the transcript's last write
            step = st["step"] or "No activity yet"
            if st["ended"]:
                step = f"Turn ended ({st['endStatus'] or 'done'}) · last step: {step}"
            chats.append({
                "id": cid, "title": title or "Untitled Cursor chat", "seat": seat, "evidence": evidence,
                "lastActivity": last, "step": step[:140], "state": state, "turns": st["turns"],
                "subagents": len(subs),
                "tool": st.get("tool"), "toolKind": st.get("toolKind"),
                "endStatus": st["endStatus"] if st["ended"] else "",
                "endedAt": st.get("endedAt") if st["ended"] else None,
            })
        chats.sort(key=lambda c: -c["lastActivity"])
        mapped = {}
        for c in chats:
            if c["seat"]:
                mapped[c["seat"]] = mapped.get(c["seat"], 0) + 1
        return {
            "scannedAt": now_ms, "transcriptsDir": str(self.dir), "titlesFrom": "fixture" if self.fixed_titles is not None else str(self.cursor_db),
            "found": len(chats), "mapped": mapped, "mappedCount": sum(mapped.values()),
            "unassignedCount": sum(1 for c in chats if not c["seat"]), "bytesRead": self.bytes_read,
            "chats": chats,
        }


def overlay(agents, snap, per_seat=5, unassigned=10):
    """Attach `cursor` to each seat and a summary to needs-steve.board.cursor. Does not touch status/task."""
    if not snap:
        return agents
    by_seat = {}
    for c in snap.get("chats", []):
        if c.get("seat"):
            by_seat.setdefault(c["seat"], []).append(c)
    out = []
    for a in agents:
        a = dict(a)
        mine = by_seat.get(a.get("id"), [])
        if a.get("id") in SEAT_NAMES:
            a["cursor"] = {"count": len(mine), "latest": mine[0] if mine else None, "chats": mine[:per_seat]}
        if a.get("id") == "needs-steve":
            b = dict(a.get("board") or {})
            b["cursor"] = {k: snap.get(k) for k in ("scannedAt", "found", "mapped", "mappedCount", "unassignedCount", "transcriptsDir")}
            b["cursor"]["unassigned"] = [c for c in snap.get("chats", []) if not c.get("seat")][:unassigned]
            a["board"] = b
        out.append(a)
    return out


if __name__ == "__main__":
    snap = Tailer().scan()
    if "--json" in sys.argv:
        print(json.dumps(snap, ensure_ascii=False, indent=1))
    else:
        print(json.dumps({k: v for k, v in snap.items() if k != "chats"}, indent=1))
        for c in snap["chats"][:15]:
            print(f"{time.strftime('%m-%d %H:%M', time.localtime(c['lastActivity'] / 1000))}  {c['state']:6} {str(c['seat'] or '-'):12} {c['title'][:40]:40}  {c['evidence'][:60]}")
