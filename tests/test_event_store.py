"""Unit tests for scripts/event_store.py"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import event_store as es  # noqa: E402


class EventStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_append_and_read_newest_first(self):
        ok, r1 = es.append_event("le2", "message_saved", "hello", events_dir=self.tmp, provenance="user")
        self.assertTrue(ok, r1)
        ok, r2 = es.append_event("le2", "session_mapped", "mapped", events_dir=self.tmp, provenance="user")
        self.assertTrue(ok, r2)
        rows = es.read_timeline("le2", limit=10, events_dir=self.tmp)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["event_type"], "session_mapped")
        self.assertEqual(rows[1]["event_type"], "message_saved")
        self.assertTrue(rows[0]["event_id"].startswith("evt_"))

    def test_reject_bad_agent(self):
        ok, err = es.append_event("../etc", "x", "y", events_dir=self.tmp)
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
