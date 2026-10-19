"""Runs tests/test_teva_assets_node.js when node is available."""
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class TevaAssetsNodeTest(unittest.TestCase):
    def test_teva_assets_js(self):
        r = subprocess.run(["node", str(HERE / "test_teva_assets_node.js")], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, msg=r.stdout + r.stderr)
