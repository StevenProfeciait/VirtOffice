"""Steve case 6 (nav recovery, 2026-10-23): a zone transition with a new assignment moves
validly (both looks, via `node tests/test_teva_nav_recovery.js --zone-json`) while the
cursor-chat handoff correlation records the correct observed outcome for that assignment
(session-bound match, ready <= endedAt gate, idempotent chatId+endedAt) — and nothing else."""
import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "scripts"))


class NavZoneCorrelationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.msg_dir = self.tmp / "messages"
        self.index = self.msg_dir / "messages_index.jsonl"
        self._env = {k: os.environ.get(k) for k in ("TEVA_MESSAGES_DIR", "TEVA_MESSAGES_INDEX")}
        os.environ["TEVA_MESSAGES_DIR"] = str(self.msg_dir)
        os.environ["TEVA_MESSAGES_INDEX"] = str(self.index)
        sys.modules.pop("message_store", None)
        self.ms = importlib.import_module("message_store")

    def tearDown(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _kw(self):
        return {"messages_dir": self.msg_dir, "index_path": self.index}

    def _send(self, seat, content, handoff, delivered_at):
        ok, msg = self.ms.create_message(seat, content, runtime="cursor", adapter="cursor_deeplink",
                                         seat_ids={"pm", "ba", "le2"}, **self._kw())
        self.assertTrue(ok, msg)
        mid = msg["message_id"]
        self.ms.transition(mid, "DELIVERING", {"handoff": handoff}, **self._kw())
        self.ms.transition(mid, "DELIVERED", {"handoff": handoff, "delivered_at": delivered_at}, **self._kw())
        return mid

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_zone_transition_moves_validly_and_outcome_correlates(self):
        r = subprocess.run(["node", str(HERE / "test_teva_nav_recovery.js"), "--zone-json"],
                           capture_output=True, text=True, timeout=300)
        self.assertEqual(r.returncode, 0, r.stderr)
        nav = json.loads(r.stdout.strip().splitlines()[-1])
        for look in ("classic", "cyber"):
            res = nav[look]
            self.assertTrue(res["session"], look)
            for leg, v in res["legs"].items():
                self.assertTrue(v["ok"], f"{look} {leg} has a valid route")
                self.assertEqual(v["bad"], 0, f"{look} {leg} never crosses a solid")
            self.assertTrue(res["legs"]["pmBack"]["changed"], f"{look}: pm's new assignment took it out of the zone")
            self.assertTrue(res["baStill"], f"{look}: the other attendee keeps its seat")

        # The same transition as messages: pm's new assignment is a cursor handoff bound to its chat.
        t0 = 1_700_000_000_000
        older = self._send("pm", "old unbound task", {"url": "u0"}, t0 + 50_000)
        other = self._send("pm", "other chat task", {"url": "u1", "sessionId": "chat-other"}, t0 + 60_000)
        new = self._send("pm", "new assignment (boardroom -> desk)", {"url": "u2", "sessionId": "chat-pm"}, t0 + 100_000)

        # Turn in chat-pm ends after the handoff: exact session match wins over the newer/older unbound.
        hit = self.ms.find_open_for_outcome("pm", "chat-pm", messages_dir=self.msg_dir, ended_at=t0 + 200_000)
        self.assertEqual(hit["message_id"], new)
        ok, upd = self.ms.attach_observed_outcome(new, "chat-pm", "success", t0 + 200_000, **self._kw())
        self.assertTrue(ok, upd)
        self.assertEqual(upd["observed_outcome"]["chatId"], "chat-pm")
        self.assertEqual(upd["observed_outcome"]["endStatus"], "success")
        self.assertEqual(upd["status"], "DELIVERED", "an observed outcome is not a status change")
        # Idempotent for the same chatId + endedAt.
        ok, again = self.ms.attach_observed_outcome(new, "chat-pm", "success", t0 + 200_000, **self._kw())
        self.assertTrue(ok)
        self.assertEqual(again["updated_at"], upd["updated_at"])
        self.assertEqual(again["observed_outcome"], upd["observed_outcome"])

        # A different chat never lands on the bound message for chat-other or on chat-pm's.
        self.assertEqual(self.ms.find_open_for_outcome("pm", "chat-other", messages_dir=self.msg_dir,
                                                       ended_at=t0 + 210_000)["message_id"], other)
        # An unknown chat whose turn ended before the unbound handoff was ready: no match.
        self.assertIsNone(self.ms.find_open_for_outcome("pm", "chat-stale", messages_dir=self.msg_dir,
                                                        ended_at=t0 + 10_000))
        # The untouched messages carry no outcome.
        for mid in (older, other):
            self.assertFalse(self.ms.get_message(mid, self.msg_dir, self.index).get("observed_outcome"))


if __name__ == "__main__":
    unittest.main()
