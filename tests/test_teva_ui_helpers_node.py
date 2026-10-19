"""Runs the UI helper JavaScript test when Node is available."""
import shutil
import subprocess
import unittest
from pathlib import Path


class TevaUIHelpersNodeTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_ui_helpers(self):
        test = Path(__file__).with_name("test_teva_ui_helpers_node.js")
        result = subprocess.run(["node", str(test)], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("ok", result.stdout)
