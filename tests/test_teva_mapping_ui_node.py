"""Runs tests/test_teva_mapping_ui.js inside unittest discover. Skips without node."""
import shutil, subprocess, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class TevaMappingUiNodeTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_teva_mapping_ui_js(self):
        r = subprocess.run(
            ["node", str(HERE / "test_teva_mapping_ui.js")],
            capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("TESTS PASSED", r.stdout)


if __name__ == "__main__":
    unittest.main()
