"""Bind-policy tests for server.py — the loopback/container distinction (R-VO-001 fence).

Unit:        server.bind_allowed() accepts loopback always, wildcard addresses only with
             the explicit TEVA_ALLOW_NON_LOOPBACK flag, and never an arbitrary LAN address.
Integration: real `python3 server.py` subprocess — HOST=0.0.0.0 exits 2 without the flag,
             and serves over 127.0.0.1 when the flag is set (container mode).

Run: python3 -m unittest discover -s tests
"""
import importlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "scripts"))


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def isolated_env(tmp, host, port, flag=None):
    env = dict(os.environ)
    env.pop("TEVA_ALLOW_NON_LOOPBACK", None)
    env.update({
        "HOST": host,
        "PORT": str(port),
        "TEVA_HQ_TOKEN_FILE": str(tmp / "hq" / "token"),
        "TEVA_INBOX_DIR": str(tmp / "inbox"),
        "TEVA_HQ_DIR": str(tmp / "hq"),
        "TEVA_EVENTS_DIR": str(tmp / "hq" / "events"),
        "TEVA_AGENTS_REGISTRY": str(tmp / "hq" / "agents_registry.json"),
        "TEVA_MESSAGES_DIR": str(tmp / "hq" / "messages"),
        "TEVA_MESSAGES_INDEX": str(tmp / "hq" / "messages" / "messages_index.jsonl"),
        "TEVA_SEAT_MAP": str(tmp / "no-map.json"),
        "CURSOR_TRANSCRIPTS": str(tmp / "no-transcripts"),
        "CURSOR_GLOBAL_DB": str(tmp / "no.vscdb"),
        "AGENTS_JSON_PATH": str(tmp / "agents.json"),
        "ENABLE_SSE": "false",
    })
    if flag:
        env["TEVA_ALLOW_NON_LOOPBACK"] = flag
    return env


class BindAllowedUnitTest(unittest.TestCase):
    """server.bind_allowed() semantics (imported with a neutral environment)."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        os.environ.update({
            "HOST": "127.0.0.1",
            "PORT": str(free_port()),
            "TEVA_ALLOW_NON_LOOPBACK": "",
            "ENABLE_SSE": "false",
            "AGENTS_JSON_PATH": str(cls.tmp / "agents.json"),
        })
        env = isolated_env(cls.tmp, "127.0.0.1", free_port())
        for k, v in env.items():
            os.environ[k] = v
        os.environ["TEVA_ALLOW_NON_LOOPBACK"] = ""
        sys.path.insert(0, str(ROOT))
        sys.path.insert(0, str(ROOT / "scripts"))
        for m in ("server", "cursor_activity", "agent_registry", "state_aggregator",
                  "event_store", "message_store", "delivery_adapters", "teva_sync"):
            sys.modules.pop(m, None)
        cls.srv = importlib.import_module("server")

    def test_loopback_allowed_without_flag(self):
        for host in ("127.0.0.1", "localhost", "::1"):
            self.assertTrue(self.srv.bind_allowed(host, False), host)
            self.assertTrue(self.srv.bind_allowed(host, True), host)

    def test_wildcard_refused_without_flag(self):
        for host in ("0.0.0.0", "::"):
            self.assertFalse(self.srv.bind_allowed(host, False), host)

    def test_wildcard_allowed_only_with_flag(self):
        self.assertTrue(self.srv.bind_allowed("0.0.0.0", True))
        self.assertTrue(self.srv.bind_allowed("::", True))

    def test_arbitrary_address_never_allowed(self):
        for host in ("192.168.1.10", "10.0.0.5", "example.internal", "0.0.0.1"):
            self.assertFalse(self.srv.bind_allowed(host, False), host)
            self.assertFalse(self.srv.bind_allowed(host, True), host)

    def test_flag_constant_follows_env(self):
        # Cleared above before import: the default must be off.
        self.assertFalse(self.srv.ALLOW_NON_LOOPBACK)


class ServerProcessFenceTest(unittest.TestCase):
    """End-to-end: behaviour of a real `python3 server.py` process."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def _wait_http(self, port, timeout=8.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/config", timeout=1) as r:
                    return r.status, r.read()
            except Exception:
                time.sleep(0.15)
        return None, b""

    def test_wildcard_without_flag_exits_2(self):
        port = free_port()
        env = isolated_env(self.tmp, "0.0.0.0", port)
        proc = subprocess.run([sys.executable, str(ROOT / "server.py")], cwd=str(ROOT),
                              env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)
        self.assertIn("Refusing to bind 0.0.0.0", proc.stdout)
        self.assertIn("TEVA_ALLOW_NON_LOOPBACK", proc.stdout)

    def test_flag_binds_and_serves_over_loopback(self):
        port = free_port()
        env = isolated_env(self.tmp, "0.0.0.0", port, flag="1")
        proc = subprocess.Popen([sys.executable, str(ROOT / "server.py")], cwd=str(ROOT),
                                env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            status, body = self._wait_http(port)
            self.assertEqual(status, 200, f"server did not answer: {status}")
            cfg = json.loads(body)
            self.assertTrue(cfg["allow_non_loopback"])
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
            proc.stdout.close()
            proc.stderr.close()

    def test_default_loopback_starts(self):
        port = free_port()
        env = isolated_env(self.tmp, "127.0.0.1", port)
        proc = subprocess.Popen([sys.executable, str(ROOT / "server.py")], cwd=str(ROOT),
                                env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            status, body = self._wait_http(port)
            self.assertEqual(status, 200, f"server did not answer: {status}")
            cfg = json.loads(body)
            self.assertFalse(cfg["allow_non_loopback"])
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
            proc.stdout.close()
            proc.stderr.close()


class DotenvLoaderTest(unittest.TestCase):
    """scripts/local_env.py: file values apply, real env vars win."""

    def test_file_sets_missing_keys_and_preserves_existing(self):
        import local_env
        tmp = Path(tempfile.mkdtemp())
        env_file = tmp / ".env"
        env_file.write_text(
            "# comment\n"
            "TEVA_TEST_FROM_FILE=hello\n"
            "TEVA_TEST_QUOTED=\"quoted value\"\n"
            "TEVA_TEST_EXISTS=from-file\n"
            "\n"
            "BROKEN LINE WITHOUT EQUALS\n"
        )
        os.environ["TEVA_TEST_EXISTS"] = "from-environ"
        os.environ.pop("TEVA_TEST_FROM_FILE", None)
        os.environ.pop("TEVA_TEST_QUOTED", None)
        try:
            loaded = local_env.load(env_file)
            self.assertEqual(loaded, env_file)
            self.assertEqual(os.environ["TEVA_TEST_FROM_FILE"], "hello")
            self.assertEqual(os.environ["TEVA_TEST_QUOTED"], "quoted value")
            self.assertEqual(os.environ["TEVA_TEST_EXISTS"], "from-environ")  # real env wins
        finally:
            for k in ("TEVA_TEST_FROM_FILE", "TEVA_TEST_QUOTED", "TEVA_TEST_EXISTS"):
                os.environ.pop(k, None)

    def test_missing_file_returns_none(self):
        import local_env
        self.assertIsNone(local_env.load(Path(tempfile.mkdtemp()) / "nope.env"))


if __name__ == "__main__":
    unittest.main()
