"""Write-lock and inbox tests for server.py (R-VO-001 Phase 2). Starts a real server on a free port.
Run: python3 -m unittest discover -s tests"""
import http.client, importlib, json, os, socket, stat, sys, tempfile, threading, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class ServerSecurityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.port = free_port()
        agents = [{"id": "le2", "name": "Laravel Expert 2"}, {"id": "needs-steve", "name": "Needs Steve", "board": {}}]
        (cls.tmp / "agents.json").write_text(json.dumps(agents))
        os.environ.update({
            "PORT": str(cls.port), "HOST": "127.0.0.1",
            "TEVA_HQ_TOKEN_FILE": str(cls.tmp / "hq" / "token"),
            "TEVA_INBOX_DIR": str(cls.tmp / "inbox"),
            "TEVA_INBOX_MAX_BYTES": "1500",
            "AGENTS_JSON_PATH": str(cls.tmp / "agents.json"),
            "CURSOR_TRANSCRIPTS": str(cls.tmp / "no-transcripts"),
            "CURSOR_GLOBAL_DB": str(cls.tmp / "no.vscdb"),
            "TEVA_SEAT_MAP": str(cls.tmp / "no-map.json"),
        })
        sys.path.insert(0, str(ROOT))
        sys.path.insert(0, str(ROOT / "scripts"))
        for m in ("server", "cursor_activity"):
            sys.modules.pop(m, None)
        cls.srv = importlib.import_module("server")
        cls.httpd = cls.srv.make_server("127.0.0.1", cls.port)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.token = (cls.tmp / "hq" / "token").read_text().strip()
        cls.origin = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def req(self, method, path, body=None, token=True, origin=True, host=None, ctype="application/json", raw=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        h = {"Host": host or f"127.0.0.1:{self.port}"}
        if ctype:
            h["Content-Type"] = ctype
        if token:
            h["X-TEVA-Token"] = self.token if token is True else token
        if origin:
            h["Origin"] = self.origin if origin is True else origin
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        out = r.read()
        c.close()
        return r.status, out, dict(r.getheaders())

    # ---- token
    def test_token_file_created_private(self):
        f = self.tmp / "hq" / "token"
        self.assertGreaterEqual(len(self.token), 32)
        self.assertEqual(stat.S_IMODE(f.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(f.parent.stat().st_mode), 0o700)
        self.assertEqual(self.srv.load_or_create_token(f), self.token)  # stable across restarts

    def test_office_html_gets_token_same_origin(self):
        s, body, _ = self.req("GET", "/office.html", token=False, origin=False)
        self.assertEqual(s, 200)
        self.assertIn(f'<meta name="teva-token" content="{self.token}">'.encode(), body)
        s, body, _ = self.req("GET", "/office.html", token=False, origin=False, host=f"localhost:{self.port}")
        self.assertEqual(s, 200)

    def test_bad_host_rejected_everywhere(self):
        for path in ("/office.html", "/api/agents", "/api/inbox"):
            s, body, _ = self.req("GET", path, token=False, origin=False, host="evil.example:80")
            self.assertEqual(s, 403, path)
            self.assertNotIn(self.token.encode(), body)
        s, _, _ = self.req("POST", "/api/inbox", {"seat": "le2", "text": "x"}, host=f"evil.example:{self.port}")
        self.assertEqual(s, 403)

    def test_no_wildcard_cors(self):
        for path in ("/api/agents", "/office.html", "/api/config"):
            _, _, h = self.req("GET", path, token=False, origin="https://evil.example")
            self.assertNotIn("Access-Control-Allow-Origin", h, path)
        _, _, h = self.req("OPTIONS", "/api/inbox", token=False, origin="https://evil.example")
        self.assertNotIn("Access-Control-Allow-Origin", h)
        _, _, h = self.req("OPTIONS", "/api/inbox", token=False)
        self.assertEqual(h.get("Access-Control-Allow-Origin"), self.origin)

    # ---- webhook
    def test_webhook_requires_token_and_origin(self):
        body = {"agents": [{"id": "le2", "task": "pushed"}]}
        self.assertEqual(self.req("POST", "/webhook/agents", body, token=False)[0], 401)
        self.assertEqual(self.req("POST", "/webhook/agents", body, token="wrong" * 10)[0], 401)
        self.assertEqual(self.req("POST", "/webhook/agents", body, origin=False)[0], 403)
        self.assertEqual(self.req("POST", "/webhook/agents", body, origin="https://evil.example")[0], 403)
        self.assertEqual(self.req("POST", "/webhook/agents", body, origin="http://localhost:1")[0], 403)
        self.assertEqual(self.req("POST", "/webhook/agents", body, ctype="text/plain")[0], 415)
        s, out, _ = self.req("POST", "/webhook/agents", body)
        self.assertEqual(s, 200, out)
        self.assertEqual(json.loads(out)["count"], 1)
        s, out, _ = self.req("POST", "/webhook/agents", body, origin=f"http://localhost:{self.port}", host=f"localhost:{self.port}")
        self.assertEqual(s, 200)

    def test_unknown_post_404(self):
        self.assertEqual(self.req("POST", "/api/shell", {"cmd": "ls"})[0], 404)

    # ---- inbox
    def test_inbox_requires_token_and_origin(self):
        body = {"seat": "le2", "text": "hello"}
        self.assertEqual(self.req("POST", "/api/inbox", body, token=False)[0], 401)
        self.assertEqual(self.req("POST", "/api/inbox", body, origin=False)[0], 403)
        self.assertFalse((self.tmp / "inbox" / "le2.jsonl").exists() and "hello" in (self.tmp / "inbox" / "le2.jsonl").read_text())

    def test_inbox_bad_seats(self):
        for seat in ("../agents", "le2/../../x", "LE2", "nobody", "needs-steve", "", None, 5, "a" * 40):
            s, out, _ = self.req("POST", "/api/inbox", {"seat": seat, "text": "x"})
            self.assertEqual(s, 400, seat)
        self.assertEqual(self.req("GET", "/api/inbox?seat=../x", token=False, origin=False)[0], 400)
        self.assertFalse((self.tmp / "agents.jsonl").exists())

    def test_inbox_text_limits(self):
        self.assertEqual(self.req("POST", "/api/inbox", {"seat": "sa", "text": "   "})[0], 400)
        self.assertEqual(self.req("POST", "/api/inbox", {"seat": "sa", "text": "é" * 2049})[0], 413)  # 4098 bytes
        self.assertEqual(self.req("POST", "/api/inbox", {"seat": "sa"})[0], 400)
        self.assertEqual(self.req("POST", "/api/inbox", raw=b"x" * (17 * 1024))[0], 413)
        self.assertEqual(self.req("POST", "/api/inbox", raw=b"[1,2]")[0], 400)
        self.assertEqual(self.req("POST", "/api/inbox", raw=b"{nope")[0], 400)

    def test_inbox_append_counts_and_file_cap(self):
        s, out, _ = self.req("POST", "/api/inbox", {"seat": "debugger", "text": "first note"})
        self.assertEqual(s, 200, out)
        d = json.loads(out)
        self.assertEqual((d["sent"], d["unread"], d["file"]), (1, 1, "inbox/debugger.jsonl"))
        f = self.tmp / "inbox" / "debugger.jsonl"
        rec = json.loads(f.read_text().splitlines()[0])
        self.assertEqual((rec["from"], rec["seat"], rec["text"]), ("Steve", "debugger", "first note"))
        self.assertIn("time", rec)
        self.assertEqual(stat.S_IMODE(f.stat().st_mode), 0o600)
        # file cap is 1500 bytes in this test: keep appending ~600-byte notes until 413
        codes = [self.req("POST", "/api/inbox", {"seat": "debugger", "text": "y" * 500})[0] for _ in range(4)]
        self.assertEqual(codes[:2], [200, 200])
        self.assertIn(413, codes)
        self.assertLessEqual(f.stat().st_size, 1500)
        s, out, _ = self.req("GET", "/api/inbox", token=False, origin=False)
        c = json.loads(out)["counts"]["debugger"]
        self.assertEqual((c["sent"], c["unread"]), (3, 3))
        (self.tmp / "inbox" / "debugger.read").write_text("2")
        c = json.loads(self.req("GET", "/api/inbox", token=False, origin=False)[1])["counts"]["debugger"]
        self.assertEqual(c["unread"], 1)
        s, out, _ = self.req("GET", "/api/inbox?seat=debugger", token=False, origin=False)
        self.assertEqual(json.loads(out)["messages"][-1]["text"], "first note")

    def test_config_reports_lock_without_token(self):
        s, out, _ = self.req("GET", "/api/config", token=False, origin=False)
        cfg = json.loads(out)
        self.assertIn(f"http://localhost:{self.port}", cfg["allowed_origins"])
        self.assertNotIn(self.token, out.decode())


if __name__ == "__main__":
    unittest.main()
