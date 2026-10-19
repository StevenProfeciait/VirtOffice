"""Runs tests/test_teva_data_bridge_node.js when node is available."""
import shutil, subprocess, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

class TevaDataBridgeNodeTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_teva_data_bridge_js(self):
        r = subprocess.run(["node", str(HERE / "test_teva_data_bridge_node.js")], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("ok", r.stdout)

if __name__ == "__main__":
    unittest.main()
