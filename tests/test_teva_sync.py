"""Parser tests for scripts/teva_sync.py (R-VO-001 Phase 1). Run: python3 -m unittest discover -s tests"""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import teva_sync as ts  # noqa: E402

BACKLOG = """# TEVA Company Backlog
**Last updated:** 2026-10-17 19:48 SAST

- **Next action:** stuff. **LE ENG IN** on §8u-P1 post-visit feedback + **LE2 IDLE** after PASS.

### SA-X-1. Something — CRITICAL — ENG IN (2026-10-17)
### SA-DT-1. Other — CRITICAL — DONE / SA PASS (2026-10-17)

## NEEDS STEVE
- [ ] Decide on commit 0b4142f9
- [x] Already done
- [ ] Commit the leftovers

## Next section
- [ ] not a needs-steve item
"""

RESEARCH = """# TEVA Research Backlog
## 2. Pipeline
| Status | Meaning |
|---|---|
| **WIP** | x |

## 3. Prioritized research queue

| ID | Priority | Item | Specialist owner | Evidence sources | Acceptance criteria | Ingest path | Status |
|----|----------|------|------------------|------------------|---------------------|-------------|--------|
| **R-FD-001** | **P0** | Money path | **ERP Research** (`abc`) | e | a | p | **Done (ingest landed)** 2026-09-23 |
| **R-AI-006** | P2 | Injection surfaces | AI Research (PM GO) | e | a | p | **WIP** since today |
| **R-MED-001** | P2 | Medspa gate | Product Research via PM | e | a | p | **Ready** (PM-gated) |
| **R-VO-001** | P1 | Virtual office | Grok Bot (research executor) | e | a | p | **Done** 2026-10-17 |

## 4. Next
| ID | x |
|---|---|
| **INV-R1** | not a queue row |
"""


class SeatTests(unittest.TestCase):
    def test_eng_in_with_line(self):
        st = ts.seat(BACKLOG, "LE")
        self.assertEqual(st[0], "working")
        self.assertEqual(st[1], "§8u-P1 post-visit feedback")
        self.assertEqual(st[2], 4)

    def test_le_does_not_match_le2(self):
        self.assertEqual(ts.seat(BACKLOG, "LE2")[0], "idle")
        self.assertIsNone(ts.seat("**LE2 ENG IN** on x", "LE"))

    def test_criticals_only_eng_in(self):
        c = ts.criticals(BACKLOG)
        self.assertEqual(len(c), 1)
        self.assertEqual(c[0][1], 6)


class NeedsSteveTests(unittest.TestCase):
    def test_unchecked_items_in_section_only(self):
        items = ts.needs_steve(BACKLOG)
        self.assertEqual([i[0] for i in items], ["Decide on commit 0b4142f9", "Commit the leftovers"])
        self.assertEqual([i[1] for i in items], [10, 12])

    def test_missing_section(self):
        self.assertEqual(ts.needs_steve("# nothing"), [])


class ResearchTests(unittest.TestCase):
    def setUp(self):
        self.rows = ts.research_rows(RESEARCH)

    def test_only_section_3_rows(self):
        self.assertEqual([r["id"] for r in self.rows], ["R-FD-001", "R-AI-006", "R-MED-001", "R-VO-001"])

    def test_status_and_owner(self):
        got = {r["id"]: (r["status"], r["owner"]) for r in self.rows}
        self.assertEqual(got["R-FD-001"], ("Done", "erp-research"))
        self.assertEqual(got["R-AI-006"], ("WIP", "ai-research"))
        self.assertEqual(got["R-MED-001"], ("Ready", "product"))
        self.assertEqual(got["R-VO-001"], ("Done", "grok"))

    def test_line_numbers(self):
        lines = RESEARCH.split("\n")
        for r in self.rows:
            self.assertIn(r["id"], lines[r["line"] - 1])


class BuildTests(unittest.TestCase):
    def test_same_15_ids_and_provenance(self):
        agents, _, n = ts.build(BACKLOG, RESEARCH, [], 1e9, 1e9, 1e9)
        self.assertEqual(len(agents), 15)
        self.assertEqual(agents[-1]["id"], "needs-steve")
        self.assertEqual(n, 2)
        by = {a["id"]: a for a in agents}
        self.assertEqual(by["le"]["source"]["line"], 4)
        self.assertEqual(by["ai-research"]["status"], "working")
        self.assertTrue(by["ai-research"]["task"].startswith("R-AI-006 WIP"))
        self.assertFalse(by["debugger"]["signal"])
        self.assertIn("No live signal", by["debugger"]["task"])
        self.assertEqual(by["sa"]["source"]["line"], 6)
        self.assertEqual(by["needs-steve"]["needsSteveItems"][0]["line"], 10)


if __name__ == "__main__":
    unittest.main()
