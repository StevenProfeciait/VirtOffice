"""Runs tests/test_camera_nav.js when node is available."""
import shutil, subprocess, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class CameraNavNodeTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_camera_nav_js(self):
        r = subprocess.run(["node", str(HERE / "test_camera_nav.js")], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("TESTS PASSED", r.stdout)


if __name__ == "__main__":
    unittest.main()
