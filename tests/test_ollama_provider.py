"""Unit tests for scripts/ollama_provider.py."""
import importlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "scripts"))


class FakeResp:
    def __init__(self, data, code=200):
        self._data = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.code = code

    def read(self):
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class OllamaProviderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        os.environ["TEVA_HQ_DIR"] = str(self.tmp)
        os.environ["TEVA_OLLAMA_CONFIG"] = str(self.tmp / "ollama_config.json")
        os.environ.pop("TEVA_OLLAMA_ALLOW_REMOTE", None)
        sys.modules.pop("ollama_provider", None)
        self.op = importlib.import_module("ollama_provider")
        self.op._http_opener = None

    def test_loopback_guard(self):
        ok, _ = self.op.validate_base_url("http://127.0.0.1:11434")
        self.assertTrue(ok)
        ok, err = self.op.validate_base_url("http://evil.example:11434")
        self.assertFalse(ok)
        self.assertIn("loopback", err)

    def test_list_models_and_health(self):
        tags = {"models": [{"name": "qwen2.5-coder:7b"}, {"name": "llama3.2:3b"}]}

        def opener(req, timeout=None):
            if req.full_url.endswith("/api/tags"):
                return FakeResp(tags)
            raise AssertionError(req.full_url)

        self.op._http_opener = opener
        models = self.op.list_models()
        self.assertEqual(len(models), 2)
        h = self.op.health()
        self.assertTrue(h["ok"])
        self.assertEqual(h["model_count"], 2)
        cfg = self.op.load_config()
        self.assertTrue(cfg["defaults"]["code"])

    def test_unreachable(self):
        import urllib.error

        def opener(req, timeout=None):
            raise urllib.error.URLError("connection refused")

        self.op._http_opener = opener
        h = self.op.health()
        self.assertFalse(h["ok"])
        self.assertEqual(h["error_code"], "ollama_unreachable")

    def test_chat_model_missing(self):
        tags = {"models": [{"name": "llama3.2:3b"}]}

        def opener(req, timeout=None):
            if req.full_url.endswith("/api/tags"):
                return FakeResp(tags)
            raise AssertionError("should not chat")

        self.op._http_opener = opener
        with self.assertRaises(self.op.OllamaError) as cm:
            self.op.chat_completions([{"role": "user", "content": "hi"}], model="nope-model")
        self.assertEqual(cm.exception.code, "model_missing")

    def test_config_patch(self):
        ok, pub = self.op.update_config_patch({
            "seat_models": {"le2": {"model": "llama3.2:3b", "role": "code"}},
        })
        self.assertTrue(ok)
        self.assertEqual(pub["seat_models"]["le2"]["model"], "llama3.2:3b")


if __name__ == "__main__":
    unittest.main()
