"""Unit tests for scripts/local_agent_tools.py."""
import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "scripts"))


class LocalAgentToolsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "src").mkdir()
        (self.tmp / "src" / "hello.py").write_text("print('hi')\n", encoding="utf-8")
        sys.modules.pop("local_agent_tools", None)
        self.lat = importlib.import_module("local_agent_tools")
        self.ctx = self.lat.ToolContext([str(self.tmp)])

    def test_path_escape_rejected(self):
        out = self.ctx.run("read_file", {"path": "../../../etc/passwd"})
        self.assertFalse(out["ok"])

    def test_read_and_list(self):
        out = self.ctx.run("list_dir", {"path": "src"})
        self.assertTrue(out["ok"])
        self.assertTrue(any(e["name"] == "hello.py" for e in out["entries"]))
        out = self.ctx.run("read_file", {"path": "src/hello.py"})
        self.assertTrue(out["ok"])
        self.assertIn("hi", out["content"])

    def test_propose_edit_no_write(self):
        target = self.tmp / "src" / "hello.py"
        before = target.read_text()
        out = self.ctx.run("propose_edit", {"path": "src/hello.py", "content": "print('bye')\n"})
        self.assertTrue(out["ok"])
        self.assertEqual(target.read_text(), before)
        self.assertEqual(len(self.ctx.proposed_patch), 1)

    def test_apply_writes(self):
        self.ctx.run("propose_edit", {"path": "src/hello.py", "content": "print('ok')\n"})
        ok, result = self.lat.apply_proposed_patch(self.ctx.proposed_patch, [str(self.tmp)])
        self.assertTrue(ok, result)
        self.assertEqual((self.tmp / "src" / "hello.py").read_text(), "print('ok')\n")

    def test_run_tests_disabled(self):
        os.environ.pop("TEVA_LOCAL_ALLOW_TESTS", None)
        sys.modules.pop("local_agent_tools", None)
        lat = importlib.import_module("local_agent_tools")
        ctx = lat.ToolContext([str(self.tmp)])
        out = ctx.run("run_tests", {})
        self.assertEqual(out.get("error"), "tool_disabled")


if __name__ == "__main__":
    unittest.main()
