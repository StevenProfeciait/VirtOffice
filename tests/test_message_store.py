"""Unit tests for scripts/message_store.py (command-centre Phase 2)."""
import importlib
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "scripts"))


class MessageStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.msg_dir = self.tmp / "messages"
        self.index = self.msg_dir / "messages_index.jsonl"
        os.environ["TEVA_MESSAGES_DIR"] = str(self.msg_dir)
        os.environ["TEVA_MESSAGES_INDEX"] = str(self.index)
        sys.modules.pop("message_store", None)
        self.ms = importlib.import_module("message_store")

    def _create(self, seat="le2", content="do the thing"):
        return self.ms.create_message(
            seat, content, runtime="cursor", adapter="cursor_deeplink",
            seat_ids={"le2", "grok", "sa"},
            messages_dir=self.msg_dir, index_path=self.index,
        )

    def test_create_queued(self):
        ok, msg = self._create()
        self.assertTrue(ok, msg)
        self.assertEqual(msg["status"], "QUEUED")
        self.assertEqual(msg["sender_id"], "Steve")
        self.assertEqual(msg["schema"], 2)
        self.assertTrue(msg["message_id"].startswith("msg_"))
        self.assertEqual(msg["correlation_id"], msg["message_id"])
        got = self.ms.get_message(msg["message_id"], self.msg_dir, self.index)
        self.assertEqual(got["content"], "do the thing")

    def test_reject_bad_recipient(self):
        ok, err = self.ms.create_message(
            "needs-steve", "x", seat_ids={"le2"}, messages_dir=self.msg_dir, index_path=self.index
        )
        self.assertFalse(ok)
        ok, err = self.ms.create_message(
            "nobody", "x", seat_ids={"le2"}, messages_dir=self.msg_dir, index_path=self.index
        )
        self.assertFalse(ok)
        ok, err = self.ms.create_message(
            "le2", "   ", seat_ids={"le2"}, messages_dir=self.msg_dir, index_path=self.index
        )
        self.assertFalse(ok)

    def test_legal_and_illegal_transitions(self):
        ok, msg = self._create()
        mid = msg["message_id"]
        ok, msg = self.ms.transition(mid, "DELIVERING", {"handoff": {"url": "cursor://x"}},
                                     messages_dir=self.msg_dir, index_path=self.index)
        self.assertTrue(ok)
        self.assertEqual(msg["status"], "DELIVERING")
        ok, err = self.ms.transition(mid, "ACKNOWLEDGED",
                                     messages_dir=self.msg_dir, index_path=self.index)
        self.assertFalse(ok)
        ok, msg = self.ms.transition(mid, "DELIVERED", {"delivered_at": "t"},
                                     messages_dir=self.msg_dir, index_path=self.index)
        self.assertTrue(ok)
        ok, msg = self.ms.transition(mid, "ACKNOWLEDGED",
                                     messages_dir=self.msg_dir, index_path=self.index)
        self.assertTrue(ok)
        ok, msg = self.ms.transition(mid, "RESPONDED", {"response_text": "done"},
                                     messages_dir=self.msg_dir, index_path=self.index)
        self.assertTrue(ok)
        # terminal
        ok, err = self.ms.transition(mid, "CANCELLED",
                                     messages_dir=self.msg_dir, index_path=self.index)
        self.assertFalse(ok)
        # idempotent
        ok, msg2 = self.ms.transition(mid, "RESPONDED",
                                      messages_dir=self.msg_dir, index_path=self.index)
        self.assertTrue(ok)
        self.assertEqual(msg2["status"], "RESPONDED")

    def test_retry_limit_and_cancel(self):
        ok, msg = self._create()
        mid = msg["message_id"]
        self.ms.transition(mid, "FAILED", {"delivery_attempts": 1, "error_code": "x"},
                           messages_dir=self.msg_dir, index_path=self.index)
        msg = self.ms.get_message(mid, self.msg_dir, self.index)
        self.assertTrue(self.ms.can_retry(msg))
        self.ms.transition(mid, "QUEUED", messages_dir=self.msg_dir, index_path=self.index)
        self.ms.transition(mid, "FAILED", {"delivery_attempts": 3},
                           messages_dir=self.msg_dir, index_path=self.index)
        msg = self.ms.get_message(mid, self.msg_dir, self.index)
        self.assertFalse(self.ms.can_retry(msg))
        ok, msg = self.ms.transition(mid, "CANCELLED",
                                     messages_dir=self.msg_dir, index_path=self.index)
        self.assertTrue(ok)
        self.assertEqual(msg["status"], "CANCELLED")

    def test_list_newest_first(self):
        self._create(content="a")
        time.sleep(0.01)
        self._create(content="b")
        rows = self.ms.list_messages(agent_id="le2", limit=10, messages_dir=self.msg_dir)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["content"], "b")

    def test_malformed_lines_skipped(self):
        ok, msg = self._create()
        path = self.msg_dir / "le2.jsonl"
        with path.open("a") as f:
            f.write("not-json\n")
        rows = self.ms.list_messages(agent_id="le2", messages_dir=self.msg_dir)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["message_id"], msg["message_id"])

    def test_observed_outcome_does_not_change_status(self):
        ok, msg = self._create()
        mid = msg["message_id"]
        self.ms.transition(mid, "DELIVERING", {"handoff": {"url": "cursor://x"}},
                           messages_dir=self.msg_dir, index_path=self.index)
        self.ms.transition(mid, "DELIVERED", {"delivered_at": "t", "handoff": {"url": "cursor://x"}},
                           messages_dir=self.msg_dir, index_path=self.index)
        ok, updated = self.ms.attach_observed_outcome(
            mid, "chat-abc", "success", 1700000001000,
            messages_dir=self.msg_dir, index_path=self.index,
        )
        self.assertTrue(ok, updated)
        self.assertEqual(updated["status"], "DELIVERED")
        self.assertEqual(updated["observed_outcome"]["chatId"], "chat-abc")
        self.assertEqual(updated["observed_outcome"]["endStatus"], "success")
        self.assertEqual(updated["observed_outcome"]["source"], "cursor")
        # idempotent
        ok, again = self.ms.attach_observed_outcome(
            mid, "chat-abc", "success", 1700000001000,
            messages_dir=self.msg_dir, index_path=self.index,
        )
        self.assertTrue(ok)
        self.assertEqual(again["updated_at"], updated["updated_at"])
        # cannot attach while QUEUED
        ok2, msg2 = self._create(content="other")
        ok, err = self.ms.attach_observed_outcome(
            msg2["message_id"], "c", "success", 1,
            messages_dir=self.msg_dir, index_path=self.index,
        )
        self.assertFalse(ok)

    def _deliver(self, mid, handoff, delivered_at=None):
        self.ms.transition(mid, "DELIVERING", {"handoff": handoff},
                           messages_dir=self.msg_dir, index_path=self.index)
        patch = {"handoff": handoff}
        if delivered_at is not None:
            patch["delivered_at"] = delivered_at
        self.ms.transition(mid, "DELIVERED", patch,
                           messages_dir=self.msg_dir, index_path=self.index)

    def test_find_open_for_outcome_match_rules(self):
        ok, a = self._create(content="bound other")
        mid_a = a["message_id"]
        self._deliver(mid_a, {"url": "u", "sessionId": "sess-other"}, delivered_at=1_700_000_000_000)
        ok, b = self._create(content="unbound")
        mid_b = b["message_id"]
        self._deliver(mid_b, {"url": "u2"}, delivered_at=1_700_000_100_000)
        # Exact match on other session only
        hit = self.ms.find_open_for_outcome("le2", "sess-other", messages_dir=self.msg_dir)
        self.assertEqual(hit["message_id"], mid_a)
        # Unbound newest for a new chat id (message bound to sess-other is skipped)
        hit2 = self.ms.find_open_for_outcome(
            "le2", "brand-new-chat", messages_dir=self.msg_dir, ended_at=1_700_000_200_000,
        )
        self.assertEqual(hit2["message_id"], mid_b)
        # Registry match only applies to unbound — sid mismatch skips mid_a
        hit3 = self.ms.find_open_for_outcome(
            "le2", "chat-z", registry_session_ids=["chat-z"], messages_dir=self.msg_dir,
            ended_at=1_700_000_200_000,
        )
        self.assertEqual(hit3["message_id"], mid_b)

    def test_unbound_rejects_turn_ended_before_handoff(self):
        ok, msg = self._create()
        mid = msg["message_id"]
        self._deliver(mid, {"url": "u"}, delivered_at=1_700_000_500_000)
        # Turn ended before this handoff was delivered → must not attach
        hit = self.ms.find_open_for_outcome(
            "le2", "old-chat", messages_dir=self.msg_dir, ended_at=1_700_000_100_000,
        )
        self.assertIsNone(hit)

    def test_exact_session_wins_over_newer_unbound(self):
        ok, a = self._create(content="older exact")
        mid_a = a["message_id"]
        self._deliver(mid_a, {"url": "u", "sessionId": "chat-exact"}, delivered_at=1_700_000_000_000)
        time.sleep(0.01)
        ok, b = self._create(content="newer unbound")
        mid_b = b["message_id"]
        self._deliver(mid_b, {"url": "u2"}, delivered_at=1_700_000_200_000)
        hit = self.ms.find_open_for_outcome(
            "le2", "chat-exact", messages_dir=self.msg_dir, ended_at=1_700_000_300_000,
        )
        self.assertEqual(hit["message_id"], mid_a)

    def test_skips_message_already_observed_for_other_chat(self):
        ok, a = self._create(content="first")
        mid_a = a["message_id"]
        self._deliver(mid_a, {"url": "u"}, delivered_at=1_700_000_100_000)
        self.ms.attach_observed_outcome(
            mid_a, "chat-a", "success", 1_700_000_150_000,
            messages_dir=self.msg_dir, index_path=self.index,
        )
        ok, b = self._create(content="second")
        mid_b = b["message_id"]
        self._deliver(mid_b, {"url": "u2"}, delivered_at=1_700_000_200_000)
        hit = self.ms.find_open_for_outcome(
            "le2", "chat-b", messages_dir=self.msg_dir, ended_at=1_700_000_300_000,
        )
        self.assertEqual(hit["message_id"], mid_b)

    def test_respond_after_observe_keeps_outcome(self):
        ok, msg = self._create()
        mid = msg["message_id"]
        self._deliver(mid, {"url": "u"}, delivered_at=1_700_000_100_000)
        ok, updated = self.ms.attach_observed_outcome(
            mid, "chat-x", "success", 1_700_000_200_000,
            messages_dir=self.msg_dir, index_path=self.index,
        )
        self.assertEqual(updated["status"], "DELIVERED")
        ok, responded = self.ms.transition(
            mid, "RESPONDED", {"response_text": "looks good"},
            messages_dir=self.msg_dir, index_path=self.index,
        )
        self.assertTrue(ok)
        self.assertEqual(responded["status"], "RESPONDED")
        self.assertEqual(responded["observed_outcome"]["chatId"], "chat-x")
        self.assertNotEqual(responded["status"], "EXECUTED")

    def test_seats_with_failed_open(self):
        ok, msg = self._create()
        self.ms.transition(msg["message_id"], "FAILED", {"delivery_attempts": 1},
                           messages_dir=self.msg_dir, index_path=self.index)
        seats = self.ms.seats_with_failed_open(messages_dir=self.msg_dir)
        self.assertIn("le2", seats)


if __name__ == "__main__":
    unittest.main()
