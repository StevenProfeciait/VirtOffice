"""Phase 3a (R-VO-002) data upgrades: toolKind/endStatus/endedAt in cursor_activity.py,
blocked / per-item owners / explicit meeting marker in teva_sync.py.
Run: python3 -m unittest discover -s tests"""
import json, shutil, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))
import cursor_activity as ca  # noqa: E402
import teva_sync as ts  # noqa: E402


def line(role=None, tools=(), text=None, **extra):
    if role is None:
        return json.dumps(extra)
    content = ([{"type": "text", "text": text}] if text else []) + [
        {"type": "tool_use", "name": n, "input": {"path": "/x/" + n + ".md", "command": "ls"}} for n in tools]
    return json.dumps({"role": role, "message": {"content": content}})


class ToolKindTest(unittest.TestCase):
    def test_mapping(self):
        want = {"Write": "write", "StrReplace": "edit", "EditNotebook": "edit", "Delete": "edit",
                "Read": "read", "Grep": "search", "Glob": "search", "SemanticSearch": "search",
                "WebFetch": "fetch", "WebSearch": "fetch", "Shell": "shell", "Await": "shell",
                "Task": "task", "TodoWrite": "other", "CallMcpTool": "other", "": None, None: None}
        for name, kind in want.items():
            self.assertEqual(ca.tool_kind(name), kind, name)


class TailFieldsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.cid = "bbbbbbbb-0001-4000-8000-000000000001"
        (self.tmp / self.cid).mkdir()
        self.f = self.tmp / self.cid / (self.cid + ".jsonl")
        self.f.write_text("")
        self.t = ca.Tailer(transcripts=self.tmp, docs_dir=self.tmp / "docs", seat_map=self.tmp / "no.json", titles={})

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def add(self, *lines):
        with self.f.open("a") as fh:
            for ln in lines:
                fh.write(ln + "\n")
        return self.t.scan()["chats"][0]

    def test_kinds_follow_last_tool_and_reply(self):
        c = self.add(line("user", text="hi"))
        self.assertEqual((c["tool"], c["toolKind"], c["state"]), (None, None, "active"))
        c = self.add(line("assistant", tools=["Read", "Write"]))
        self.assertEqual((c["tool"], c["toolKind"]), ("Write", "write"))
        c = self.add(line("assistant", tools=["Grep"]))
        self.assertEqual(c["toolKind"], "search")
        c = self.add(line("assistant", tools=["Shell"]))
        self.assertEqual(c["toolKind"], "shell")
        c = self.add(line("assistant", text="done thinking"))
        self.assertEqual((c["tool"], c["toolKind"]), (None, "reply"))
        self.assertEqual((c["endStatus"], c["endedAt"]), ("", None))

    def test_turn_end_status_and_time(self):
        self.add(line("user", text="hi"), line("assistant", tools=["Write"]))
        c = self.add(line(type="turn_ended", status="success"))
        self.assertEqual((c["state"], c["endStatus"]), ("ended", "success"))
        self.assertEqual(c["endedAt"], c["lastActivity"])  # no record timestamp -> transcript mtime
        # a later scan with no new bytes keeps the first endedAt
        self.assertEqual(self.t.scan()["chats"][0]["endedAt"], c["endedAt"])
        # new prompt clears the end; an error end with its own timestamp uses that timestamp
        c = self.add(line("user", text="again"))
        self.assertEqual((c["state"], c["endStatus"], c["endedAt"]), ("active", "", None))
        c = self.add(line(type="turn_ended", status="error", timestamp=1792263000))
        self.assertEqual((c["endStatus"], c["endedAt"]), ("error", 1792263000000))

    def test_scan_default_is_10s(self):
        src = (HERE.parent / "server.py").read_text()
        self.assertIn('os.environ.get("CURSOR_SCAN_SECONDS", "10")', src)


BL = """# TEVA Company Backlog
**Last updated:** 2026-10-17 21:00 SAST

- **Next action:** **LE ENG IN** on P2 restock + **LE2 ENG IN** on R-ERD-001 FAIL rerun.
- Debugger note: **Debugger BLOCKED** on migrate access.

### SA-DT-1. Base DataTable — CRITICAL — DONE
- **Owners:** **LE2** Eng (done); Security Auditor PASS
### 5b. Owner branch UX
- **Owner:** Laravel Expert → Security Auditor
### 9. No owner line here
- **Status:** x

MEETING: PM, BA, Laravel Expert 2 - P2 sequencing
We had a meeting with the Supervisor yesterday (prose, not a marker).
- meeting: lower-case is not a marker, Supervisor

## NEEDS STEVE
- [ ] Tell Laravel Expert in its chat: go on P2
- [ ] Decide pricing tiers
"""


class BoardSignalsTest(unittest.TestCase):
    def setUp(self):
        agents, _, _ = ts.build(BL, "", [], 1e9, 1e9, 1e9)
        self.by = {a["id"]: a for a in agents}

    def test_blocked_from_marker_and_status_line(self):
        self.assertTrue(self.by["debugger"]["blocked"])
        self.assertEqual(self.by["debugger"]["blockedSource"]["line"], 5)
        self.assertTrue(self.by["le2"]["blocked"])           # its status line says FAIL
        self.assertFalse(self.by["le"]["blocked"])
        self.assertFalse(self.by["sa"]["blocked"])           # "SA-DT-1" is an id, not the SA seat
        self.assertFalse(self.by["needs-steve"]["blocked"])

    def test_explicit_meeting_marker_only(self):
        for sid in ("pm", "ba", "le2"):
            self.assertEqual(self.by[sid]["status"], "meeting", sid)
            self.assertEqual(self.by[sid]["source"]["line"], 14)
        self.assertNotEqual(self.by["supervisor"]["status"], "meeting")  # prose + lower-case ignored
        self.assertEqual(ts.meetings("we had a meeting with PM and BA"), {})

    def test_per_item_owners(self):
        items = self.by["needs-steve"]["board"]["items"]
        got = {(i["doc"], i["id"]): i["owner"] for i in items}
        self.assertEqual(got, {("backlog", "SA-DT-1"): "le2", ("backlog", "5b"): "le"})
        self.assertEqual([i["line"] for i in items], [8, 10])

    def test_needs_steve_owner(self):
        it = self.by["needs-steve"]["needsSteveItems"]
        self.assertEqual([i["owner"] for i in it], ["le", None])

    def test_seat_codes_stand_alone(self):
        self.assertEqual(ts.seats_in("SA-DT-1 by LE2 then SA"), ["le2", "sa"])
        self.assertEqual(ts.seats_in("Laravel Expert 2 and Laravel Expert"), ["le2", "le"])


if __name__ == "__main__":
    unittest.main()
