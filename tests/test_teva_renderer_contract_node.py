"""Runs the renderer contract unit test."""
import subprocess
import unittest
from pathlib import Path


class RendererContractNodeTest(unittest.TestCase):
    def test_renderer_contract_js(self):
        test = Path(__file__).with_name("test_teva_renderer_contract_node.js")
        result = subprocess.run(["node", str(test)], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
