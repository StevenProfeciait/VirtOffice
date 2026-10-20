"""Runs tests/test_meeting_spaces.js when node is available."""
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class MeetingSpacesNodeTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_meeting_spaces_js(self):
        r = subprocess.run(
            ["node", str(HERE / "test_meeting_spaces.js")],
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("ok", r.stdout)


if __name__ == "__main__":
    unittest.main()
