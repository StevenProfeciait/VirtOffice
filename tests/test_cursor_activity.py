"""Transcript -> seat mapping and tailer tests for scripts/cursor_activity.py (R-VO-001 Phase 2).
Run: python3 -m unittest discover -s tests"""
import json, os, shutil, sys, tempfile, time, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))
import cursor_activity as ca  # noqa: E402

FIX = HERE / "fixtures"


class CursorMappingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.tr = self.tmp / "transcripts"
        shutil.copytree(FIX / "transcripts", self.tr)
        docs = str(FIX / "t1" / "docs")
        for f in self.tr.rglob("*.jsonl"):
            f.write_text(f.read_text().replace("@@DOCS@@", docs))
        self.titles = json.loads((FIX / "cursor_titles.json").read_text())
        self.tailer = ca.Tailer(transcripts=self.tr, docs_dir=docs, seat_map=self.tmp / "none.json", titles=self.titles)
        self.snap = self.tailer.scan()
        self.by = {c["id"][-1]: c for c in self.snap["chats"]}

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_counts(self):
        self.assertEqual(self.snap["found"], 8)
        self.assertEqual(self.snap["mapped"], {"le2": 2, "sa": 1, "le": 1})
        self.assertEqual(self.snap["unassignedCount"], 4)

    def test_prompt_from_office_composer_maps(self):
        c = self.by["1"]
        self.assertEqual(c["seat"], "le2")
        self.assertIn("first prompt names Laravel Expert 2", c["evidence"])
        self.assertEqual(c["step"], "Editing LeaveService.php")
        self.assertEqual(c["subagents"], 1)

    def test_title_maps(self):
        self.assertEqual(self.by["2"]["seat"], "le2")
        self.assertIn("title", self.by["2"]["evidence"])
        self.assertEqual(self.by["2"]["state"], "ended")
        self.assertTrue(self.by["2"]["step"].startswith("Turn ended (success)"))

    def test_doc_pattern_maps(self):
        self.assertEqual(self.by["3"]["seat"], "sa")
        self.assertEqual(self.by["3"]["evidence"], "writes docs/SA_HR1_review.md")
        self.assertEqual(self.by["4"]["seat"], "le")  # _eng_ doc with "Executor: LE" header
        self.assertIn("HR1_eng_leave_pack.md", self.by["4"]["evidence"])

    def test_no_evidence_is_unassigned(self):
        self.assertIsNone(self.by["5"]["seat"])
        self.assertIn("no seat named", self.by["5"]["evidence"])

    def test_conflict_is_unassigned(self):
        # title says Laravel Expert, first prompt says Debugger -> never pick one
        self.assertIsNone(self.by["6"]["seat"])
        self.assertTrue(self.by["6"]["evidence"].startswith("ambiguous"))
        self.assertTrue(self.by["6"]["conflict"])
        self.assertGreaterEqual(len(self.by["6"]["candidates"]), 2)

    def test_board_doc_is_not_evidence(self):
        self.assertIsNone(self.by["7"]["seat"])

    def test_passing_mention_is_not_evidence(self):
        self.assertIsNone(self.by["8"]["seat"])

    def test_candidates_on_mapped_and_unassigned(self):
        # Unique map still has candidates listing that seat; empty evidence → []
        self.assertEqual(self.by["1"]["candidates"], ["le2"])
        self.assertFalse(self.by["1"]["conflict"])
        self.assertEqual(self.by["5"]["candidates"], [])
        self.assertFalse(self.by["5"]["conflict"])
        # Unassigned list in overlay carries candidates for the mapping queue
        agents = [{"id": "le2"}, {"id": "needs-steve", "board": {}}]
        out = ca.overlay(agents, self.snap)
        ns = next(a for a in out if a["id"] == "needs-steve")
        un = ns["board"]["cursor"]["unassigned"]
        amb = next(c for c in un if c["id"].endswith("6"))
        self.assertTrue(amb["conflict"])
        self.assertGreaterEqual(len(amb["candidates"]), 2)

    def test_shell_redaction(self):
        self.assertNotIn("abc123secret", json.dumps(self.snap))
        self.assertIn("TOKEN=*", self.by["4"]["step"])
        self.assertEqual(ca.redact("x password=hunter2 y"), "x password=*** y")

    def test_seat_map_override(self):
        (self.tmp / "map.json").write_text(json.dumps({"aaaaaaaa-0005-4000-8000-000000000005": "debugger",
                                                       "aaaaaaaa-0008-4000-8000-000000000008": "../../etc"}))
        t = ca.Tailer(transcripts=self.tr, docs_dir=FIX / "t1" / "docs", seat_map=self.tmp / "map.json", titles=self.titles)
        by = {c["id"][-1]: c for c in t.scan()["chats"]}
        self.assertEqual(by["5"]["seat"], "debugger")
        self.assertEqual(by["5"]["evidence"], "seat_map.json")
        self.assertIsNone(by["8"]["seat"])  # invalid seat ids in seat_map.json are ignored

    def test_incremental_tail_reads_only_new_bytes(self):
        again = self.tailer.scan()
        self.assertEqual(again["bytesRead"], 0)
        f = self.tr / "aaaaaaaa-0005-4000-8000-000000000005" / "aaaaaaaa-0005-4000-8000-000000000005.jsonl"
        line = json.dumps({"role": "assistant", "message": {"content": [{"type": "tool_use", "name": "Read", "input": {"path": "/x/new.php"}}]}}) + "\n"
        with f.open("a") as fh:
            fh.write(line)
        snap = self.tailer.scan()
        self.assertEqual(snap["bytesRead"], len(line.encode()))
        c = next(c for c in snap["chats"] if c["id"].endswith("5"))
        self.assertEqual(c["step"], "Reading new.php")
        self.assertEqual(c["state"], "active")

    def test_partial_line_waits(self):
        f = self.tr / "aaaaaaaa-0007-4000-8000-000000000007" / "aaaaaaaa-0007-4000-8000-000000000007.jsonl"
        rec = json.dumps({"role": "user", "message": {"content": [{"type": "text", "text": "next"}]}})
        with f.open("a") as fh:
            fh.write(rec[:20])
        c = next(c for c in self.tailer.scan()["chats"] if c["id"].endswith("7"))
        self.assertEqual(c["state"], "ended")
        with f.open("a") as fh:
            fh.write(rec[20:] + "\n")
        c = next(c for c in self.tailer.scan()["chats"] if c["id"].endswith("7"))
        self.assertEqual(c["step"], "New prompt from Steve")

    def test_stale_after_threshold(self):
        snap = self.tailer.scan(now=time.time() + 3600)
        self.assertEqual(next(c for c in snap["chats"] if c["id"].endswith("1"))["state"], "stale")

    def test_overlay(self):
        agents = [{"id": "le2", "status": "idle", "task": "Idle"}, {"id": "needs-steve", "board": {"updated": "x"}}]
        out = ca.overlay(agents, self.snap)
        self.assertEqual(out[0]["cursor"]["count"], 2)
        self.assertEqual(out[0]["status"], "idle")  # overlay never rewrites board status
        self.assertEqual(out[1]["board"]["cursor"]["unassignedCount"], 4)
        self.assertEqual(len(out[1]["board"]["cursor"]["unassigned"]), 4)
        self.assertNotIn("cursor", agents[0])

    def test_missing_dirs_are_safe(self):
        snap = ca.Tailer(transcripts=self.tmp / "nope", docs_dir=self.tmp, titles={}).scan()
        self.assertEqual(snap["found"], 0)
        self.assertEqual(ca.load_titles(["x"], self.tmp / "no.vscdb"), {})

    def test_format_tool_status_port(self):
        self.assertEqual(ca.format_tool_status("Glob", {}), "Searching files")
        self.assertEqual(ca.format_tool_status("Task", {"description": "x" * 50}), "Subtask: " + "x" * 40 + "\u2026")
        self.assertEqual(ca.format_tool_status("CallMcpTool", {"toolName": "slack"}), "MCP: slack")
        self.assertEqual(ca.format_tool_status("Weird", {}), "Using Weird")


if __name__ == "__main__":
    unittest.main()
