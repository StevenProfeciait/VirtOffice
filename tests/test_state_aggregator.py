"""Unit tests for scripts/state_aggregator.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import state_aggregator as sa  # noqa: E402

NOW = 1_700_000_000_000


def agent(**kw):
    base = {
        "id": "le2", "status": "idle", "signal": True, "blocked": False,
        "cursor": {"count": 0, "latest": None},
    }
    base.update(kw)
    return base


def chat(**kw):
    c = {
        "id": "aaaaaaaa", "state": "active", "toolKind": "write",
        "lastActivity": NOW - 1000, "subagents": 0, "endStatus": "", "endedAt": None,
        "step": "Writing",
    }
    c.update(kw)
    return c


class StateAggregatorTest(unittest.TestCase):
    def test_observed_typing_high(self):
        a = agent(cursor={"count": 1, "latest": chat()})
        act = sa.aggregate(a, NOW)
        self.assertEqual(act["state"], "TYPING")
        self.assertEqual(act["confidence"], "high")
        self.assertEqual(act["source"], "cursor")

    def test_stale_active_downgrades(self):
        # Claimed active but lastActivity older than ACTIVE_MS
        a = agent(cursor={"count": 1, "latest": chat(lastActivity=NOW - 180_000)})
        act = sa.aggregate(a, NOW)
        self.assertNotEqual(act["state"], "TYPING")
        self.assertEqual(act["confidence"], "low")

    def test_board_working_at_desk(self):
        a = agent(status="working")
        act = sa.aggregate(a, NOW)
        self.assertEqual(act["state"], "AT_DESK")
        self.assertTrue(act["boardWorking"])

    def test_working_beats_stale_thinking(self):
        a = agent(status="working", cursor={"count": 1, "latest": chat(state="stale", lastActivity=NOW - 5 * 60_000)})
        act = sa.aggregate(a, NOW)
        self.assertEqual(act["state"], "AT_DESK")

    def test_failed_turn_is_error_presented_blocked(self):
        a = agent(cursor={"count": 1, "latest": chat(
            state="ended", endStatus="error", endedAt=NOW - 1000, lastActivity=NOW - 1000
        )})
        act = sa.aggregate(a, NOW)
        self.assertEqual(act["state"], "ERROR")
        self.assertEqual(act["presentationState"], "BLOCKED")

    def test_enrich_attaches_activity(self):
        out = sa.enrich_agents([agent(status="working")], now_ms=NOW)
        self.assertIn("activity", out[0])
        self.assertEqual(out[0]["activityState"], "AT_DESK")

    def test_offline_with_board_blocked_keeps_boardBlocked(self):
        a = agent(signal=False, blocked=True, cursor={"count": 0, "latest": None})
        act = sa.aggregate(a, NOW)
        self.assertEqual(act["state"], "OFFLINE")
        self.assertEqual(act["presentationState"], "OFFLINE")
        self.assertTrue(act["boardBlocked"])

    def test_blocked_online_is_BLOCKED_with_boardBlocked(self):
        a = agent(signal=True, blocked=True)
        act = sa.aggregate(a, NOW)
        self.assertEqual(act["state"], "BLOCKED")
        self.assertTrue(act["boardBlocked"])


if __name__ == "__main__":
    unittest.main()
