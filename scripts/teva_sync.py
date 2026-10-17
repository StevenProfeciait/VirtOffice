#!/usr/bin/env python3
"""Build VirtOffice agents.json from Template 1's TEVA board and docs/.
Read-only on Template 1. Writes only VirtOffice/agents.json (atomic replace)."""
import fnmatch, json, os, re, sys, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "agents.json"
REPO = Path(os.environ.get("TEVA_REPO", "/Users/stevenayensu/Documents/GitHub/template_1"))
DOCS = REPO / "docs"
BACKLOG = DOCS / "TEVA_COMPANY_BACKLOG.md"
LIVE_MIN = 15  # a doc edit in the last N minutes counts as "working"

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

def clean(s, n=90):
    s = re.sub(r"[*`]", "", s or "").strip(" .;:-—+")
    return s[:n]

def seat(text, who):
    m = re.search(r"\*\*%s (ENG IN|IDLE)\*\*(?: on ([^+\n.;]+))?" % re.escape(who), text)
    if not m:
        return None
    return ("idle", "Idle") if m.group(1) == "IDLE" else ("working", clean(m.group(2)) or "Engineering pack")

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

def needs_steve(text):
    m = re.search(r"^## NEEDS STEVE\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not m:
        return []
    return [clean(x, 140) for x in re.findall(r"^- \[ \] (.+)$", m.group(1), re.M)]

def ago(ts):
    mins = int((time.time() - ts) / 60)
    if mins < 60:
        return f"{mins}m ago"
    if mins < 1440:
        return f"{mins // 60}h ago"
    return f"{mins // 1440}d ago"

def main():
    try:
        text = BACKLOG.read_text(encoding="utf-8")
    except Exception as e:
        print(f"backlog unreadable: {e}", file=sys.stderr)
        return 1
    updated = re.search(r"\*\*Last updated:\*\*\s*([^\n]+)", text)
    updated = clean(updated.group(1)) if updated else "unknown"
    seats = {"le": seat(text, "LE"), "le2": seat(text, "LE2")}
    criticals = [clean(h) for h in re.findall(r"^### ([^\n]*CRITICAL[^\n]*ENG IN[^\n]*)$", text, re.M)]
    done = [clean(h) for h in re.findall(r"^### ([^\n]*DONE[^\n]*)$", text, re.M)]
    files = doc_files()
    now = time.time()

    agents = []
    for aid, name, team, emoji, color, task, pats in ROSTER:
        mine = []
        for p, mt in files:
            if pats and pats[0].startswith("@eng:"):
                if "_eng_" in p.name and eng_owner(p, seats) == pats[0][5:]:
                    mine.append((p, mt))
            elif pats and match(p.name, pats):
                mine.append((p, mt))
        owned = bool(mine)
        if not mine and aid != "grok":
            mine = [(p, mt) for p, mt in files if p.name == "TEVA_COMPANY_BACKLOG.md"]
        status, tasks, out = "idle", [], []
        if aid in seats and seats[aid]:
            status, task = seats[aid]
        elif aid == "sa" and criticals:
            status, task = "working", "Reviewing: " + clean(criticals[0], 70)
        elif team == "Leadership":
            status = "meeting"
        fresh = [x for x in (mine if owned else []) if now - x[1] < LIVE_MIN * 60]
        if fresh:
            if status != "working":
                task = "Writing " + fresh[0][0].name
            status = "working"
        tasks.append(task)
        if aid == "pm" and done:
            tasks.append("Latest done: " + clean(done[0], 70))
        if aid == "sa" and len(criticals) > 1:
            tasks += ["Also open: " + clean(c, 70) for c in criticals[1:3]]
        out = [f"{p.name} ({ago(mt)})" for p, mt in mine[:4]] or [f"Board updated {updated}"]
        agents.append({
            "id": aid, "name": name, "role": team, "emoji": emoji, "color": color,
            "home": aid, "status": status, "task": task, "tasks": tasks, "output": out,
            "docs": [{"name": p.name, "path": str(p)} for p, _ in mine[:6]],
            "stats": {"tasksDone": len(mine) if owned else 0, "active": 1 if status == "working" else 0,
                      "hours": round((now - mine[0][1]) / 3600, 1) if mine else 0},
            "mood": 0.9 if status == "working" else 0.7, "typing": status == "working", "position": None,
        })

    items = needs_steve(text)
    agents.append({
        "id": "needs-steve", "name": f"Needs Steve ({len(items)})", "role": "Waiting on you", "emoji": "🔴",
        "color": "#FF3B30" if items else "#6B7280", "home": "needs-steve",
        "status": "working" if items else "idle", "task": items[0] if items else "Nothing waiting on you",
        "tasks": items or ["Nothing waiting on you"], "output": [f"From the NEEDS STEVE section, board {updated}"],
        "docs": [{"name": "TEVA_COMPANY_BACKLOG.md", "path": str(BACKLOG)}],
        "stats": {"tasksDone": 0, "active": len(items), "hours": 0},
        "mood": 0.5, "typing": False, "position": None, "needsSteve": items,
    })

    payload = json.dumps(agents, ensure_ascii=False, indent=2)
    try:
        if OUT.read_text(encoding="utf-8") == payload:
            print(f"no change; board {updated}")
            return 0
    except OSError:
        pass
    fd, tmp = tempfile.mkstemp(dir=str(ROOT), prefix=".agents.", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(payload)
    os.replace(tmp, OUT)
    print(f"wrote {len(agents)} entries; board {updated}; needs Steve {len(items)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
