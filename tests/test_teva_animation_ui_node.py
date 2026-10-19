import shutil
import subprocess
import unittest
from pathlib import Path


class TevaAnimationUINodeTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_animation_ui_modules(self):
        result = subprocess.run(["node", str(Path(__file__).with_name("test_teva_animation_ui_node.js"))], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("ok", result.stdout)
