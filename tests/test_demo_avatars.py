"""Stage 2: demo agents and normalizeAvatar include avatar config."""
import importlib
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

os.environ.update({
    "HOST": "127.0.0.1",
    "PORT": "9502",
    "TEVA_ALLOW_NON_LOOPBACK": "",
    "ENABLE_SSE": "false",
    "AGENTS_JSON_PATH": str(ROOT / "tests" / "fixtures" / "agents.json"),
})
for m in ("server", "agent_registry", "state_aggregator", "event_store",
          "message_store", "delivery_adapters", "teva_sync", "cursor_activity"):
    sys.modules.pop(m, None)
server = importlib.import_module("server")


class DemoAvatarTest(unittest.TestCase):
    def test_demo_agents_have_avatar(self):
        for a in server.DEMO_AGENTS:
            self.assertIsInstance(a.get("avatar"), dict)
            self.assertIn("fallback", a["avatar"])

    def test_normalize_keeps_and_defaults_avatar(self):
        norm = server._normalize_agent({"id": "x", "role": "R"})
        self.assertEqual(norm["id"], "x")
        self.assertIsInstance(norm["avatar"], dict)
        self.assertIsNone(norm["avatar"]["model"])
        self.assertEqual(norm["avatar"]["fallback"]["color"], "#8B5CF6")
        self.assertEqual(norm["workstation"], "center")
        self.assertIsNone(norm["zone"])
