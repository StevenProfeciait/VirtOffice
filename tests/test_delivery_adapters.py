"""Unit tests for scripts/delivery_adapters.py (command-centre Phase 2)."""
import importlib
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "scripts"))


class DeliveryAdaptersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.modules.pop("delivery_adapters", None)
        cls.da = importlib.import_module("delivery_adapters")

    def test_cursor_handoff_not_delivered(self):
        adapter = self.da.CursorDeeplinkAdapter()
        msg = {
            "message_id": "msg_abc123def456",
            "recipient_agent_id": "le2",
            "content": "Please fix the bug",
        }
        agent = {"id": "le2", "name": "Laravel Expert 2", "role": "Engineering", "task": "WIP"}
        reg = {"runtime": "cursor", "sessionIds": ["sess-1"]}
        result = adapter.submit(msg, agent=agent, registry_entry=reg)
        self.assertEqual(result.status, "DELIVERING")
        self.assertNotEqual(result.status, "DELIVERED")
        self.assertTrue(result.handoff["url"].startswith("cursor://"))
        self.assertEqual(result.handoff["sessionId"], "sess-1")
        self.assertEqual(result.handoff["mode"], "manual_deeplink")
        self.assertFalse(result.capabilities["programmatic_send"])
        self.assertTrue(result.capabilities["deeplink_handoff"])
        self.assertTrue(result.capabilities["user_confirm_delivered"])

    def test_unsupported_fails_clearly(self):
        adapter = self.da.UnsupportedAdapter()
        msg = {"recipient_agent_id": "grok", "content": "hi", "runtime": "grok"}
        result = adapter.submit(msg, registry_entry={"runtime": "grok"})
        self.assertEqual(result.status, "FAILED")
        self.assertEqual(result.error_code, "runtime_unsupported")
        self.assertIn("Copy for Grok", result.error_message)
        self.assertIsNone(result.handoff)

    def test_pick_adapter(self):
        a, name, runtime = self.da.pick_adapter("le2", {"runtime": "cursor"})
        self.assertEqual(name, "cursor_deeplink")
        self.assertEqual(runtime, "cursor")
        self.assertIsInstance(a, self.da.CursorDeeplinkAdapter)
        a, name, runtime = self.da.pick_adapter("grok", {"runtime": "grok"})
        self.assertEqual(name, "unsupported")
        self.assertEqual(runtime, "grok")

    def test_build_prompt_includes_seat(self):
        text = self.da.build_handoff_prompt(
            {"name": "LE2", "role": "Engineering", "task": "X"}, "hello", for_url=False
        )
        self.assertIn("To LE2", text)
        self.assertIn("hello", text)


if __name__ == "__main__":
    unittest.main()
