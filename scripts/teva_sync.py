#!/usr/bin/env python3
"""Build VirtOffice agents.json from Template 1's TEVA board and docs/.
Read-only on Template 1. Writes only VirtOffice/agents.json (atomic replace).

Phase 1 (R-VO-001): every seat carries provenance for its status:
  signal   - True when the status comes from a real source, False for a default
  source   - {file, path, line, text, at, atText} where the status was read
  research - [{id, status, item, line}] rows from TEVA_RESEARCH_BACKLOG.md section 3
  docs     - up to 10 owned docs, newest first, each with mtime
The needs-steve entry also carries `board` (recent doc activity + research counts)
for the Docs & activity panel.

Phase 3a (R-VO-002), still read-only on Template 1:
  blocked       - True when the backlog has an explicit "**<seat> BLOCKED**" marker, or the
                  backlog line that set the seat's status says BLOCKED / FAIL / waiting on
  blockedSource - {file, path, line, text, ...} for that line, else null
  meeting       - status "meeting" only from an explicit marker line in TEVA_COMPANY_BACKLOG.md:
                    MEETING: PM, BA, LE2 - P2 sequencing
                  (upper-case MEETING at the start of a line; attendees are the seats it names).
                  Remove the line to end the meeting. Prose that mentions a meeting never counts.
  board.items   - [{doc, id, owner, line, title}] per-item owners: "### <id>. ..." headings with an
                  "- **Owner(s):** ..." line in the company backlog (first seat named = owner),
                  plus the research backlog section 3 rows. The office animates a hand-off only
                  when an item's owner changes between two syncs.
  needsSteveItems[].owner - the one seat an item names ("Tell Laravel Expert ..."), else null
"""
import fnmatch, json, os, re, sys, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "agents.json"
try:
    from local_env import load as _load_env  # project-local .env; real env wins
    _load_env(ROOT / ".env")
except Exception:  # pragma: no cover - .env is optional
    pass
# Workspace repo that holds docs/TEVA_COMPANY_BACKLOG.md. Neutral default (this
# repo); set TEVA_REPO in .env to point at your workspace — no personal paths here.
REPO = Path(os.environ.get("TEVA_REPO", "").strip() or ROOT)
DOCS = REPO / "docs"
BACKLOG = DOCS / "TEVA_COMPANY_BACKLOG.md"
RESEARCH = DOCS / "TEVA_RESEARCH_BACKLOG.md"
LIVE_MIN = 15  # a doc edit in the last N minutes counts as "working"
MAX_DOCS = 10
SYNC_INTERVAL = int(os.environ.get("TEVA_SYNC_INTERVAL", "180"))

BOARD = ["TEVA_COMPANY_BACKLOG.md", "TEVA_WORK_PLAN.md", "TEVA_TIMELINE_PRIORITIES.md", "TEVA_HIGHS_PARALLEL_PACK.md"]
# id, name, team, emoji, color, default task, doc patterns
ROSTER = [
    ("supervisor", "Supervisor", "Leadership", "🧭", "#8B5CF6", "Coordinating teams", []),
    ("pm", "Project Manager", "Leadership", "📋", "#A78BFA", "Sequencing the board", ["TEVA_COMPANY_BACKLOG.md", "TEVA_WORK_PLAN.md"]),
    ("ba", "Business Analyst", "Leadership", "📊", "#C4B5FD", "Keeping the board current", ["TEVA_TIMELINE_PRIORITIES.md", "TEVA_HIGHS_PARALLEL_PACK.md"]),
    ("le", "Laravel Expert", "Engineering", "🛠️", "#EF4444", "Idle", ["@eng:LE"]),
    ("le2", "Laravel Expert 2", "Engineering", "🧰", "#F97316", "Idle", ["@eng:LE2"]),
    ("sa", "Security Auditor", "Engineering", "🛡️", "#DC2626", "Ready for security reviews", ["SA_*.md", "SECURITY_AUDIT_BRIEF*", "!*_eng_*"]),
    ("debugger", "Debugger", "Engineering", "🐞", "#FB923C", "On call for bugfixes and DB resets", []),
    ("research-mgr", "Research Manager", "Research", "🗂️", "#3B82F6", "Feeding the research backlog", ["TEVA_RESEARCH_BACKLOG*"]),
    ("ai-research", "AI Research", "Research", "🤖", "#60A5FA", "Agent architecture research", ["AI_*", "TYPED_TOOLS*", "*AGENT*"]),
    ("erp-research", "ERP Research", "Research", "🏭", "#2563EB", "Salon ERP domain research", ["ERP_*"]),
    ("product", "Product Research", "Business", "🎨", "#10B981", "UX and JTBD research", ["PSET_*research*", "*JTBD*", "*_BRIEF.md", "*_SPEC.md"]),
    ("competitor", "Competitor Intel", "Business", "🔭", "#34D399", "Competitor tracking", ["*Competitive*", "*Competitor*", "COMPETITOR_*"]),
    ("ui-docs", "UI Docs", "Business", "📚", "#059669", "Mapping flows and role access", ["UI_*", "ROLE_ACCESS_MATRIX*", "PSET_vs_*", "GDT_*", "LIVEWIRE_AUTHORIZE_INVENTORY*", "Appearance_*_research_*", "Platform_settings_research_*", "System_settings_index_completeness_*"]),
    ("grok", "Grok Bot", "Ingest", "🧠", "#F59E0B", "Board ingest to teva_memories", []),
]
# Which composer action is primary. Engineering seats are worked from Cursor (brief AC5:
# "Message LE2 opens Cursor"); every other TEVA bot runs in Grok Bot. Both buttons are always shown.
CURSOR_SEATS = {"le", "le2", "sa", "debugger"}

# Research backlog "Specialist owner" text -> seat id (earliest keyword in the cell wins)
RESEARCH_OWNER_KEYS = [
    ("Research Manager", "research-mgr"), ("ERP", "erp-research"), ("AI", "ai-research"),
    ("Product", "product"), ("Competit", "competitor"), ("UI Docs", "ui-docs"), ("Grok Bot", "grok"),
]


# Phase 3a: seat names as they appear in board prose. Short codes are case-sensitive and must
# stand alone ("SA" in "SA-DT-1" is an item id, not the seat).
_CODE = r"(?<![\w-])%s(?![\w-])"
SEAT_ALIASES = {
    "supervisor": [r"Supervisor"],
    "pm": [r"Project Manager", _CODE % "PM"],
    "ba": [r"Business Analyst", _CODE % "BA"],
    "le": [r"Laravel Expert(?!\s*2)", _CODE % "LE"],
    "le2": [r"Laravel Expert\s*2", _CODE % "LE2"],
    "sa": [r"Security Auditor", _CODE % "SA"],
    "debugger": [r"Debugger"],
    "research-mgr": [r"Research Manager"],
    "ai-research": [r"AI Research"],
    "erp-research": [r"ERP Research"],
    "product": [r"Product Research"],
    "competitor": [r"Competitor Intel(?:ligence)?"],
    "ui-docs": [r"UI Docs"],
    "grok": [r"Grok Bot"],
}
_SEAT_RX = {sid: re.compile("|".join("(?:%s)" % a for a in alts)) for sid, alts in SEAT_ALIASES.items()}
BLOCK_RX = re.compile(r"\bBLOCKED\b|\bFAIL(?:ED)?\b|(?i:\bwaiting[- ]on\b)")
MEETING_RX = re.compile(r"^[ \t]*(?:[-*][ \t]+)?\**MEETING\**[ \t]*:\**[ \t]*(?P<rest>\S[^\n]*)$", re.M)


def seats_in(text):
    """Seat ids named in text, in order of first appearance."""
    hits = []
    for sid, rx in _SEAT_RX.items():
        m = rx.search(text or "")
        if m:
            hits.append((m.start(), sid))
    return [sid for _, sid in sorted(hits)]


def blocked_markers(text):
    """{seat: (line, snippet)} from explicit '**<seat> BLOCKED**' markers."""
    out = {}
    for m in re.finditer(r"\*\*([^*\n]{2,40}?) BLOCKED\*\*", text):
        who = seats_in(m.group(1))
        if len(who) == 1 and _SEAT_RX[who[0]].fullmatch(m.group(1).strip()):
            out.setdefault(who[0], (line_of(text, m.start()), snippet(text, m.start(), m.end())))
    return out


def meetings(text):
    """{seat: (line, topic)} from explicit 'MEETING: <seats> - topic' lines."""
    out = {}
    for m in MEETING_RX.finditer(text):
        rest = m.group("rest")
        for sid in seats_in(rest):
            out.setdefault(sid, (line_of(text, m.start()), clean(rest, 120)))
    return out


def backlog_items(text):
    """[{doc, id, owner, line, title}] from '### <id>. title' headings that carry an Owner line."""
    items, seen = [], set()
    heads = list(re.finditer(r"^### ([^\n]+)$", text, re.M))
    for i, h in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        nxt = re.search(r"^## ", text[h.end():end], re.M)
        body_end = h.end() + nxt.start() if nxt else end
        body = text[h.end():body_end]
        om = re.search(r"^- \*\*Owners?:\*\*\s*(.+)$", body, re.M)
        if not om:
            continue
        who = seats_in(om.group(1))
        idm = re.match(r"\s*([A-Za-z0-9§][\w§-]*)", clean(h.group(1), 200))
        if not who or not idm or idm.group(1) in seen:
            continue
        seen.add(idm.group(1))
        items.append({"doc": "backlog", "id": idm.group(1), "owner": who[0],
                      "line": line_of(text, h.end() + om.start()), "title": clean(h.group(1), 80)})
    return items


def clean(s, n=90):
    s = re.sub(r"[*`]", "", s or "").strip(" .;:-—+")
    return s[:n]


def line_of(text, pos):
    return text.count("\n", 0, pos) + 1


def snippet(text, start, end, n=160):
    return clean(text[start:end + 100].split("\n")[0], n)


def fmt_time(ts):
    return time.strftime("%Y-%m-%d %H:%M %Z", time.localtime(ts))


def src(path, line, text, ts):
    return {"file": path.name, "path": str(path), "line": line, "text": text,
            "at": int(ts * 1000), "atText": fmt_time(ts)}


def seat(text, who):
    """Return (status, task, line, snippet) from '**LE ENG IN** on ...' / '**LE2 IDLE**'."""
    m = re.search(r"\*\*%s (ENG IN|IDLE)\*\*(?: on ([^+\n.;]+))?" % re.escape(who), text)
    if not m:
        return None
    line, snip = line_of(text, m.start()), snippet(text, m.start(), m.end())
    if m.group(1) == "IDLE":
        return ("idle", "Idle", line, snip)
    return ("working", clean(m.group(2)) or "Engineering pack", line, snip)


def criticals(text):
    return [(clean(m.group(1)), line_of(text, m.start())) for m in
            re.finditer(r"^### ([^\n]*CRITICAL[^\n]*ENG IN[^\n]*)$", text, re.M)]


def done_headings(text):
    return [(clean(m.group(1)), line_of(text, m.start())) for m in
            re.finditer(r"^### ([^\n]*DONE[^\n]*)$", text, re.M)]


def needs_steve(text):
    """Return [(item, line)] from the unchecked boxes under '## NEEDS STEVE'."""
    m = re.search(r"^## NEEDS STEVE\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not m:
        return []
    base = m.start(1)
    return [(clean(x.group(1), 140), line_of(text, base + x.start()))
            for x in re.finditer(r"^- \[ \] (.+)$", m.group(1), re.M)]


def research_status(cell):
    c = clean(cell, 200).lower()
    for key, label in (("wip", "WIP"), ("done", "Done"), ("ready", "Ready"), ("blocked", "Blocked"), ("skipped", "Skipped")):
        if c.startswith(key):
            return label
    for key, label in (("wip", "WIP"), ("blocked", "Blocked"), ("done", "Done"), ("ready", "Ready")):
        if key in c:
            return label
    return "Other"


def research_owner(cell):
    best = None
    for key, sid in RESEARCH_OWNER_KEYS:
        i = cell.find(key)
        if i >= 0 and (best is None or i < best[0]):
            best = (i, sid)
    return best[1] if best else None


def research_rows(text):
    """Parse the section 3 queue table: | ID | Priority | Item | Owner | ... | Status |."""
    m = re.search(r"^## 3\.[^\n]*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not m:
        return []
    base, rows, header = m.start(1), [], None
    for lm in re.finditer(r"^\|.*\|\s*$", m.group(1), re.M):
        cells = [c.strip() for c in lm.group(0).strip().strip("|").split("|")]
        if header is None:
            header = [clean(c).lower() for c in cells]
            continue
        if set(lm.group(0).replace("|", "").strip()) <= set("-: "):
            continue
        row = dict(zip(header, cells))
        rid = clean(row.get("id", ""), 40)
        if not rid:
            continue
        owner_cell = next((v for k, v in row.items() if "owner" in k), "")
        rows.append({
            "id": rid, "item": clean(row.get("item", ""), 120),
            "status": research_status(row.get("status", "")),
            "statusText": clean(row.get("status", ""), 140),
            "owner": research_owner(owner_cell), "ownerText": clean(owner_cell, 80),
            "line": line_of(text, base + lm.start()),
        })
    return rows


def doc_files():
    out = []
    for p in DOCS.glob("*.md"):
        try:
            out.append((p, p.stat().st_mtime))
        except OSError:
            pass
    return sorted(out, key=lambda x: -x[1])


def match(name, pats):
    pos = [p for p in pats if not p.startswith("!")]
    neg = [p[1:] for p in pats if p.startswith("!")]
    return any(fnmatch.fnmatch(name, p) for p in pos) and not any(fnmatch.fnmatch(name, p) for p in neg)


def eng_owner(path, seats):
    try:
        head = path.read_text(encoding="utf-8", errors="ignore")[:3000]
    except OSError:
        return None
    m = re.search(r"(?:Executor|Agent|Owner)\W{0,4}:\W{0,4}(Laravel Expert 2|LE2|Laravel Expert|LE)\b", head)
    if m:
        return "LE2" if m.group(1) in ("LE2", "Laravel Expert 2") else "LE"
    stem = path.name.split("_eng_")[0].upper()
    for who, st in (("LE2", seats.get("le2")), ("LE", seats.get("le"))):
        if st and st[0] == "working":
            tok = re.split(r"\s", st[1])[0].replace("-", "_").replace("§", "").upper()
            if tok and (tok in stem or stem in tok):
                return who
    return None


def ago(ts):
    mins = int((time.time() - ts) / 60)
    if mins < 60:
        return f"{mins}m ago"
    if mins < 1440:
        return f"{mins // 60}h ago"
    return f"{mins // 1440}d ago"


def owned_docs(files, aid, pats, seats):
    mine = []
    for p, mt in files:
        if pats and pats[0].startswith("@eng:"):
            if "_eng_" in p.name and eng_owner(p, seats) == pats[0][5:]:
                mine.append((p, mt))
        elif pats and match(p.name, pats):
            mine.append((p, mt))
    return mine


def build(text, rtext, files, now, bl_mtime, rb_mtime):
    updated = re.search(r"\*\*Last updated:\*\*\s*([^\n]+)", text)
    updated_line = line_of(text, updated.start()) if updated else None
    updated = clean(updated.group(1)) if updated else "unknown"
    seats = {"le": seat(text, "LE"), "le2": seat(text, "LE2")}
    crits = criticals(text)
    done = done_headings(text)
    rrows = research_rows(rtext) if rtext else []
    owner_of = {}
    markers = blocked_markers(text)
    meet = meetings(text)

    agents = []
    for aid, name, team, emoji, color, default_task, pats in ROSTER:
        mine = owned_docs(files, aid, pats, seats)
        for p, _ in mine:
            owner_of.setdefault(p.name, aid)
        owned = bool(mine)
        docs = list(mine)
        if not docs and aid != "grok":
            docs = [(p, mt) for p, mt in files if p.name == "TEVA_COMPANY_BACKLOG.md"]
        research = [r for r in rrows if r["owner"] == aid]
        wip = [r for r in research if r["status"] == "WIP"]

        status, task, signal, source, tasks = "idle", default_task, False, None, []
        if aid in seats and seats[aid]:
            status, task, ln, snip = seats[aid]
            signal, source = True, src(BACKLOG, ln, snip, bl_mtime)
        elif aid == "sa" and crits:
            status, task, signal = "working", "Reviewing: " + clean(crits[0][0], 70), True
            source = src(BACKLOG, crits[0][1], crits[0][0], bl_mtime)
        elif wip:
            r = wip[0]
            status, task, signal = "working", f"{r['id']} WIP: {r['item']}"[:90], True
            source = src(RESEARCH, r["line"], f"{r['id']} | {r['statusText']}", rb_mtime)
        fresh = [x for x in (mine if owned else []) if now - x[1] < LIVE_MIN * 60]
        if fresh:
            if status != "working":
                task = "Writing " + fresh[0][0].name
                source = src(fresh[0][0], None, f"File modified {ago(fresh[0][1])}", fresh[0][1])
            status, signal = "working", True
        if not signal and research:
            # Real signal, but nothing in progress: say so from the research backlog
            last = [r for r in research if r["status"] == "Done"]
            r = last[-1] if last else research[-1]
            task = f"No research WIP. Latest: {r['id']} {r['status']}"
            signal = True
            source = src(RESEARCH, r["line"], f"{r['id']} | {r['statusText']}", rb_mtime)
        blocked, blocked_src = False, None
        if aid in markers:
            blocked, blocked_src = True, src(BACKLOG, markers[aid][0], markers[aid][1], bl_mtime)
        elif source and source.get("file") == BACKLOG.name and BLOCK_RX.search(task or ""):
            # only the seat's own clause (its task text), not the rest of a shared board line
            blocked, blocked_src = True, dict(source)
        if aid in meet:
            # explicit MEETING: marker in the backlog (never inferred from prose)
            ln, topic = meet[aid]
            status, task, signal = "meeting", ("Meeting: " + topic)[:90], True
            source = src(BACKLOG, ln, "MEETING: " + topic, bl_mtime)
        if not signal:
            task = f"No live signal (default: {default_task})"
        tasks.append(task)
        if aid == "pm" and done:
            tasks.append("Latest done: " + clean(done[0][0], 70))
        if aid == "sa" and len(crits) > 1:
            tasks += ["Also open: " + clean(c[0], 70) for c in crits[1:3]]
        if aid == "research-mgr" and rrows:
            counts = {}
            for r in rrows:
                counts[r["status"]] = counts.get(r["status"], 0) + 1
            tasks.append("Queue: " + ", ".join(f"{v} {k}" for k, v in sorted(counts.items())))
        out = [f"{p.name} ({ago(mt)})" for p, mt in docs[:4]] or [f"Board updated {updated}"]
        ts = (source or {}).get("at", 0) / 1000 if source else 0
        # research list: WIP first, then Ready/Blocked, then newest Done (bottom of table = newest)
        order = {"WIP": 0, "Blocked": 1, "Ready": 2}
        rsorted = sorted(research, key=lambda r: (order.get(r["status"], 3), -r["line"]))[:12]
        agents.append({
            "id": aid, "name": name, "role": team, "emoji": emoji, "color": color,
            "home": aid, "status": status, "task": task, "tasks": tasks, "output": out,
            "signal": signal, "source": source, "updatedAt": int(ts * 1000) if ts else None,
            "blocked": blocked, "blockedSource": blocked_src,
            "channel": "cursor" if aid in CURSOR_SEATS else "grok",
            "research": [{k: r[k] for k in ("id", "status", "item", "line", "statusText")} for r in rsorted],
            "docs": [{"name": p.name, "path": str(p), "mtime": int(mt * 1000)} for p, mt in docs[:MAX_DOCS]],
            "docsOwned": owned,
            "stats": {"tasksDone": len(mine) if owned else 0, "active": 1 if status == "working" else 0,
                      "hours": round((now - docs[0][1]) / 3600, 1) if docs else 0},
            "mood": 0.9 if status == "working" else 0.7, "typing": status == "working", "position": None,
        })

    items = needs_steve(text)
    counts = {}
    for r in rrows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    activity = [{"name": p.name, "path": str(p), "mtime": int(mt * 1000), "owner": owner_of.get(p.name)}
                for p, mt in files[:30]]
    ns_source = src(BACKLOG, items[0][1] if items else updated_line, "NEEDS STEVE section", bl_mtime)
    agents.append({
        "id": "needs-steve", "name": f"Needs Steve ({len(items)})", "role": "Waiting on you", "emoji": "🔴",
        "color": "#FF3B30" if items else "#6B7280", "home": "needs-steve",
        "status": "working" if items else "idle", "task": items[0][0] if items else "Nothing waiting on you",
        "tasks": [i[0] for i in items] or ["Nothing waiting on you"],
        "output": [f"From the NEEDS STEVE section, board {updated}"],
        "signal": True, "source": ns_source, "updatedAt": int(bl_mtime * 1000), "channel": "grok",
        "blocked": False, "blockedSource": None,
        "research": [],
        "docs": [{"name": "TEVA_COMPANY_BACKLOG.md", "path": str(BACKLOG), "mtime": int(bl_mtime * 1000)}],
        "docsOwned": True,
        "stats": {"tasksDone": 0, "active": len(items), "hours": 0},
        "mood": 0.5, "typing": False, "position": None,
        "needsSteve": [i[0] for i in items],
        "needsSteveItems": [{"text": t, "line": ln, "path": str(BACKLOG),
                             "owner": (lambda w: w[0] if len(w) == 1 else None)(seats_in(t))} for t, ln in items],
        "board": {
            "updated": updated, "updatedLine": updated_line, "backlogPath": str(BACKLOG),
            "researchPath": str(RESEARCH), "repo": str(REPO), "syncedAt": int(now * 1000),
            "syncIntervalSeconds": SYNC_INTERVAL, "researchCounts": counts,
            "researchWip": [{k: r[k] for k in ("id", "item", "owner", "line")} for r in rrows if r["status"] == "WIP"],
            "items": backlog_items(text) + [{"doc": "research", "id": r["id"], "owner": r["owner"], "line": r["line"],
                                             "title": r["item"][:80]} for r in rrows if r["owner"]],
            "meetingMarkers": [{"seat": k, "line": v[0], "topic": v[1]} for k, v in sorted(meet.items())],
            "activity": activity,
        },
    })
    return agents, updated, len(items)


def stable(agents):
    """Payload minus fields that change every run, used to skip no-op writes."""
    a = json.loads(json.dumps(agents))
    for x in a:
        x.pop("output", None)
        x.get("stats", {}).pop("hours", None)
        if "board" in x:
            x["board"].pop("syncedAt", None)
    return json.dumps(a, ensure_ascii=False, sort_keys=True)


def main():
    try:
        text = BACKLOG.read_text(encoding="utf-8")
        bl_mtime = BACKLOG.stat().st_mtime
    except Exception as e:
        print(f"backlog unreadable: {e}", file=sys.stderr)
        return 1
    try:
        rtext, rb_mtime = RESEARCH.read_text(encoding="utf-8"), RESEARCH.stat().st_mtime
    except Exception as e:
        print(f"research backlog unreadable (continuing): {e}", file=sys.stderr)
        rtext, rb_mtime = "", 0
    agents, updated, n_items = build(text, rtext, doc_files(), time.time(), bl_mtime, rb_mtime)

    payload = json.dumps(agents, ensure_ascii=False, indent=2)
    try:
        if stable(json.loads(OUT.read_text(encoding="utf-8"))) == stable(agents):
            print(f"no change; board {updated}")
            return 0
    except (OSError, ValueError):
        pass
    fd, tmp = tempfile.mkstemp(dir=str(ROOT), prefix=".agents.", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(payload)
    os.chmod(tmp, 0o644)
    os.replace(tmp, OUT)
    print(f"wrote {len(agents)} entries; board {updated}; needs Steve {n_items}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
