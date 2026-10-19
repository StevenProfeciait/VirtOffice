"""Unit tests for scripts/agent_registry.py"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import agent_registry as ar  # noqa: E402


class AgentRegistryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.reg = self.tmp / "agents_registry.json"
        self.map = self.tmp / "seat_map.json"
        ar._cache = None

    def test_seed_and_map(self):
        data = ar.load(path=self.reg, seat_map_path=self.map, force_reload=True)
        self.assertIn("le2", data["agents"])
        self.assertEqual(data["agents"]["le2"]["runtime"], "cursor")
        ok, payload = ar.map_session("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "le2",
                                     path=self.reg, seat_map_path=self.map)
        self.assertTrue(ok, payload)
        data = ar.load(path=self.reg, seat_map_path=self.map, force_reload=True)
        self.assertEqual(data["sessionMap"]["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"], "le2")
        exported = json.loads(self.map.read_text())
        self.assertEqual(exported["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"], "le2")

    def test_reject_unknown_agent(self):
        ar.load(path=self.reg, seat_map_path=self.map, force_reload=True)
        ok, payload = ar.map_session("sid1", "not-a-seat", path=self.reg, seat_map_path=self.map)
        self.assertFalse(ok)
        self.assertIn("unknown", payload["error"])

    def test_import_seat_map(self):
        self.map.write_text(json.dumps({"sess-1": "sa", "bad": "nope"}))
        data = ar.load(path=self.reg, seat_map_path=self.map, force_reload=True)
        self.assertEqual(data["sessionMap"].get("sess-1"), "sa")
        self.assertNotIn("bad", data["sessionMap"])


if __name__ == "__main__":
    unittest.main()
