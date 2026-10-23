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
            "TEVA_AGENTS_REGISTRY": str(cls.tmp / "hq" / "agents_registry.json"),
            "TEVA_EVENTS_DIR": str(cls.tmp / "hq" / "events"),
            "TEVA_HQ_DIR": str(cls.tmp / "hq"),
            "TEVA_MESSAGES_DIR": str(cls.tmp / "hq" / "messages"),
            "TEVA_MESSAGES_INDEX": str(cls.tmp / "hq" / "messages" / "messages_index.jsonl"),
            "TEVA_OLLAMA_CONFIG": str(cls.tmp / "hq" / "ollama_config.json"),
            "TEVA_LOCAL_JOBS_DIR": str(cls.tmp / "hq" / "local_jobs"),
            "TEVA_LOCAL_JOBS_INDEX": str(cls.tmp / "hq" / "local_jobs" / "jobs_index.jsonl"),
            "TEVA_REPO": str(cls.tmp / "workspace"),
            "TEVA_OLLAMA_HEALTH_TTL": "3600",
        })
        (cls.tmp / "workspace").mkdir(parents=True, exist_ok=True)
        sys.path.insert(0, str(ROOT))
        sys.path.insert(0, str(ROOT / "scripts"))
        for m in ("server", "cursor_activity", "agent_registry", "state_aggregator", "event_store",
                  "message_store", "delivery_adapters", "ollama_provider", "local_job_store",
                  "local_job_worker", "local_agent_tools"):
            sys.modules.pop(m, None)
        cls.srv = importlib.import_module("server")
        # Stub Ollama so local-job tests do not need a live daemon
        if cls.srv.ollama_provider:
            def _fake_health(fill_defaults=True):
                return {
                    "ok": True, "reachable": True, "base_url": "http://127.0.0.1:11434",
                    "model_count": 1, "models": [{"name": "mock-model"}],
                    "latency_ms": 1, "enabled": True,
                    "defaults": {"chat": "mock-model", "code": "mock-model"},
                    "seat_models": {"le2": {"model": "mock-model", "role": "code"}},
                    "pilot_seats": ["le2"], "error_code": None, "error_message": None,
                }
            cls.srv.ollama_provider.health = _fake_health
            cls.srv.ollama_provider.model_for_seat = lambda aid, cfg=None: "mock-model"
            cfg = cls.srv.ollama_provider.default_config(workspace=str(cls.tmp / "workspace"))
            cfg["defaults"] = {"chat": "mock-model", "code": "mock-model"}
            cfg["seat_models"] = {"le2": {"model": "mock-model", "role": "code"}}
            cfg["workspace_roots"] = [str(cls.tmp / "workspace")]
            cls.srv.ollama_provider.save_config(cfg)
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

    # ---- Phase 3a reactions (same lock, same inbox file)
    def test_reaction_lock_and_allowlist(self):
        f = self.tmp / "inbox" / "ui-docs.jsonl"
        ok = {"seat": "ui-docs", "kind": "reaction", "emoji": "\U0001F44D"}
        self.assertEqual(self.req("POST", "/api/inbox", ok, token=False)[0], 401)
        self.assertEqual(self.req("POST", "/api/inbox", ok, token="nope" * 10)[0], 401)
        self.assertEqual(self.req("POST", "/api/inbox", ok, origin="https://evil.example")[0], 403)
        self.assertEqual(self.req("POST", "/api/inbox", ok, origin=False)[0], 403)
        for bad in ("\U0001F4A9", "", None, "\U0001F44D\U0001F44D", "<script>", 5):
            self.assertEqual(self.req("POST", "/api/inbox", dict(ok, emoji=bad))[0], 400, bad)
        self.assertEqual(self.req("POST", "/api/inbox", dict(ok, kind="shell"))[0], 400)
        self.assertFalse(f.exists())
        for emo in ("\U0001F44D", "\U0001F389", "\U0001F440", "\u270B"):
            s, out, _ = self.req("POST", "/api/inbox", dict(ok, emoji=emo))
            self.assertEqual(s, 200, out)
            self.assertEqual(json.loads(out)["kind"], "reaction")
        lines = [json.loads(x) for x in f.read_text().splitlines()]
        self.assertEqual(len(lines), 4)  # one line per stored reaction
        self.assertEqual([x["emoji"] for x in lines], ["\U0001F44D", "\U0001F389", "\U0001F440", "\u270B"])
        self.assertTrue(all(x["kind"] == "reaction" and x["from"] == "Steve" and x["seat"] == "ui-docs" for x in lines))
        c = json.loads(self.req("GET", "/api/inbox", token=False, origin=False)[1])["counts"]["ui-docs"]
        self.assertEqual(c["unread"], 4)  # reactions count as unread like notes
        # notes keep working, with or without kind
        self.assertEqual(self.req("POST", "/api/inbox", {"seat": "ui-docs", "text": "n", "kind": "note"})[0], 200)
        self.assertEqual(self.req("POST", "/api/inbox", {"seat": "ui-docs", "kind": "note"})[0], 400)

    def test_config_reports_lock_without_token(self):
        s, out, _ = self.req("GET", "/api/config", token=False, origin=False)
        cfg = json.loads(out)
        self.assertIn(f"http://localhost:{self.port}", cfg["allowed_origins"])
        self.assertNotIn(self.token, out.decode())

    # ---- Phase 1 command-centre: registry map + timeline
    def test_registry_map_requires_token(self):
        body = {"sessionId": "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb", "agentId": "le2"}
        self.assertEqual(self.req("POST", "/api/registry/map", body, token=False)[0], 401)
        self.assertEqual(self.req("POST", "/api/registry/map", body, origin=False)[0], 403)
        s, out, _ = self.req("POST", "/api/registry/map", body)
        self.assertEqual(s, 200, out)
        self.assertTrue(json.loads(out)["ok"])
        s, out, _ = self.req("GET", "/api/registry", token=False, origin=False)
        self.assertEqual(s, 200)
        reg = json.loads(out)
        self.assertEqual(reg["sessionMap"].get(body["sessionId"]), "le2")
        s, out, _ = self.req("GET", "/api/agents/le2/timeline", token=False, origin=False)
        self.assertEqual(s, 200)
        evs = json.loads(out)["events"]
        self.assertTrue(any(e.get("event_type") == "session_mapped" for e in evs))
        s, out, _ = self.req("POST", "/api/registry/map", {"sessionId": "x", "agentId": "nobody"})
        self.assertEqual(s, 400)

    # ---- Phase 2 messaging
    def test_messages_require_token_and_origin(self):
        body = {"recipient_agent_id": "le2", "content": "fix this"}
        self.assertEqual(self.req("POST", "/api/messages", body, token=False)[0], 401)
        self.assertEqual(self.req("POST", "/api/messages", body, origin=False)[0], 403)
        self.assertEqual(self.req("POST", "/api/messages", body, origin="https://evil.example")[0], 403)

    def test_messages_unknown_agent(self):
        s, out, _ = self.req("POST", "/api/messages", {"recipient_agent_id": "nobody", "content": "x"})
        self.assertEqual(s, 400, out)
        s, out, _ = self.req("POST", "/api/messages", {"recipient_agent_id": "needs-steve", "content": "x"})
        self.assertEqual(s, 400, out)

    def test_messages_cursor_lifecycle_and_timeline(self):
        body = {"recipient_agent_id": "le2", "content": "Please ship the fix"}
        s, out, _ = self.req("POST", "/api/messages", body)
        self.assertEqual(s, 200, out)
        data = json.loads(out)
        self.assertTrue(data["ok"])
        msg = data["message"]
        mid = msg["message_id"]
        self.assertEqual(msg["status"], "DELIVERING")
        self.assertEqual(msg["adapter"], "cursor_deeplink")
        self.assertTrue((msg.get("handoff") or {}).get("url", "").startswith("cursor://"))
        self.assertFalse(data["capabilities"]["programmatic_send"])

        s, out, _ = self.req("POST", f"/api/messages/{mid}/handoff-opened", {})
        self.assertEqual(s, 200, out)
        self.assertEqual(json.loads(out)["message"]["status"], "DELIVERED")

        s, out, _ = self.req("POST", f"/api/messages/{mid}/acknowledge", {})
        self.assertEqual(s, 200, out)
        self.assertEqual(json.loads(out)["message"]["status"], "ACKNOWLEDGED")

        s, out, _ = self.req("POST", f"/api/messages/{mid}/respond", {"text": "done on my side"})
        self.assertEqual(s, 200, out)
        self.assertEqual(json.loads(out)["message"]["status"], "RESPONDED")

        s, out, _ = self.req("GET", f"/api/messages/{mid}", token=False, origin=False)
        self.assertEqual(s, 200)
        self.assertEqual(json.loads(out)["message"]["status"], "RESPONDED")

        s, out, _ = self.req("GET", "/api/agents/le2/timeline", token=False, origin=False)
        types = {e.get("event_type") for e in json.loads(out)["events"]}
        for need in ("message_created", "message_queued", "delivery_started", "delivery_confirmed",
                     "message_acknowledged", "message_responded"):
            self.assertIn(need, types, need)

    def test_messages_unsupported_runtime_fails(self):
        s, out, _ = self.req("POST", "/api/messages", {"recipient_agent_id": "grok", "content": "ingest this"})
        self.assertEqual(s, 200, out)
        data = json.loads(out)
        self.assertEqual(data["message"]["status"], "FAILED")
        self.assertEqual(data["message"]["error_code"], "runtime_unsupported")

    def test_messages_retry_and_cancel(self):
        s, out, _ = self.req("POST", "/api/messages", {"recipient_agent_id": "grok", "content": "retry me"})
        mid = json.loads(out)["message"]["message_id"]
        s, out, _ = self.req("POST", f"/api/messages/{mid}/retry", {})
        self.assertEqual(s, 200, out)
        # still unsupported → FAILED again
        self.assertEqual(json.loads(out)["message"]["status"], "FAILED")
        s, out, _ = self.req("POST", f"/api/messages/{mid}/cancel", {})
        self.assertEqual(s, 200, out)
        self.assertEqual(json.loads(out)["message"]["status"], "CANCELLED")

    def _observe_turn(self, chat_id, ended_at, end_status="success"):
        prev = [{
            "id": "le2",
            "cursor": {"count": 1, "latest": {
                "id": chat_id, "state": "active", "toolKind": "write",
                "lastActivity": ended_at - 5000, "endStatus": "", "endedAt": None,
            }},
        }]
        nxt = [{
            "id": "le2",
            "cursor": {"count": 1, "latest": {
                "id": chat_id, "state": "ended", "toolKind": "write",
                "lastActivity": ended_at, "endStatus": end_status, "endedAt": ended_at,
            }},
        }]
        self.srv._observe_cursor_outcomes(prev, nxt)
        return prev, nxt

    def test_messages_observed_outcome_on_cursor_turn_end(self):
        """Queue → handoff DELIVERED → Cursor turn end attaches observed_outcome; status stays DELIVERED."""
        import time as _time
        s, out, _ = self.req("POST", "/api/messages", {"recipient_agent_id": "le2", "content": "observe me"})
        self.assertEqual(s, 200, out)
        mid = json.loads(out)["message"]["message_id"]
        s, out, _ = self.req("POST", f"/api/messages/{mid}/handoff-opened", {})
        self.assertEqual(s, 200, out)
        self.assertEqual(json.loads(out)["message"]["status"], "DELIVERED")

        chat_id = "fixture-chat-observe-001"
        ended_at = int(_time.time() * 1000) + 5_000  # after handoff delivered_at
        prev, nxt = self._observe_turn(chat_id, ended_at)

        s, out, _ = self.req("GET", f"/api/messages/{mid}", token=False, origin=False)
        self.assertEqual(s, 200)
        msg = json.loads(out)["message"]
        self.assertEqual(msg["status"], "DELIVERED")
        self.assertIsNotNone(msg.get("observed_outcome"))
        self.assertEqual(msg["observed_outcome"]["chatId"], chat_id)
        self.assertEqual(msg["observed_outcome"]["endStatus"], "success")
        self.assertEqual(msg["observed_outcome"]["source"], "cursor")
        # Unbound handoff gets sessionId bound for later exact match
        self.assertEqual((msg.get("handoff") or {}).get("sessionId"), chat_id)

        # Idempotent: second observe does not invent RESPONDED
        before_events = len(json.loads(self.req("GET", "/api/agents/le2/timeline", token=False, origin=False)[1])["events"])
        self.srv._observe_cursor_outcomes(prev, nxt)
        s, out, _ = self.req("GET", f"/api/messages/{mid}", token=False, origin=False)
        self.assertEqual(json.loads(out)["message"]["status"], "DELIVERED")
        after_events = json.loads(self.req("GET", "/api/agents/le2/timeline", token=False, origin=False)[1])["events"]
        self.assertEqual(sum(1 for e in after_events if e.get("event_type") == "outcome_observed"), 1)
        self.assertGreaterEqual(len(after_events), before_events)

        s, out, _ = self.req("GET", "/api/agents/le2/timeline", token=False, origin=False)
        types = {e.get("event_type") for e in json.loads(out)["events"]}
        self.assertIn("outcome_observed", types)

        # Record response after observe — advances lifecycle; outcome retained
        s, out, _ = self.req("POST", f"/api/messages/{mid}/respond", {"text": "Steve confirms"})
        self.assertEqual(s, 200, out)
        done = json.loads(out)["message"]
        self.assertEqual(done["status"], "RESPONDED")
        self.assertEqual(done["observed_outcome"]["chatId"], chat_id)

    def test_unrelated_chat_end_does_not_steal_session_bound_handoff(self):
        import time as _time
        s, out, _ = self.req("POST", "/api/messages", {"recipient_agent_id": "le2", "content": "bound handoff"})
        mid = json.loads(out)["message"]["message_id"]
        self.req("POST", f"/api/messages/{mid}/handoff-opened", {})
        # Bind to chat-A explicitly
        self.srv.message_store.update_fields(mid, {
            "handoff": {"url": "cursor://x", "sessionId": "chat-A", "openedAt": "t"},
        })
        ended_at = int(_time.time() * 1000) + 5_000
        self._observe_turn("chat-B", ended_at)  # unrelated
        msg = json.loads(self.req("GET", f"/api/messages/{mid}", token=False, origin=False)[1])["message"]
        self.assertIsNone(msg.get("observed_outcome"))
        self.assertEqual(msg["status"], "DELIVERED")

    def test_agents_annotate_failedOpen(self):
        # agents.json fixture only includes le2 (+ needs-steve); force a FAILED instruction on le2
        s, out, _ = self.req("POST", "/api/messages", {"recipient_agent_id": "le2", "content": "fail annotate"})
        self.assertEqual(s, 200, out)
        mid = json.loads(out)["message"]["message_id"]
        ok, updated = self.srv.message_store.transition(
            mid, "FAILED", {"error_code": "test", "error_message": "forced for annotate"}
        )
        self.assertTrue(ok, updated)
        self.srv.refresh_agents()
        s, out, _ = self.req("GET", "/api/agents", token=False, origin=False)
        body = json.loads(out)
        rows = body["agents"] if isinstance(body, dict) else body
        agents = {a["id"]: a for a in rows}
        self.assertTrue(agents.get("le2", {}).get("messaging", {}).get("failedOpen"))
        # Cancel clears failedOpen on next refresh
        s, out, _ = self.req("POST", f"/api/messages/{mid}/cancel", {})
        self.assertEqual(s, 200, out)
        self.srv.refresh_agents()
        rows = json.loads(self.req("GET", "/api/agents", token=False, origin=False)[1])
        if isinstance(rows, dict):
            rows = rows["agents"]
        agents = {a["id"]: a for a in rows}
        self.assertFalse(agents.get("le2", {}).get("messaging", {}).get("failedOpen"))

    # ---- Local Ollama fallback
    def test_ollama_config_requires_token(self):
        body = {"seat_models": {"le2": {"model": "mock-model"}}}
        self.assertEqual(self.req("POST", "/api/ollama/config", body, token=False)[0], 401)
        self.assertEqual(self.req("POST", "/api/ollama/config", body, origin=False)[0], 403)
        s, out, _ = self.req("POST", "/api/ollama/config", body)
        self.assertEqual(s, 200, out)
        s, out, _ = self.req("GET", "/api/ollama/health", token=False, origin=False)
        self.assertEqual(s, 200)
        self.assertTrue(json.loads(out).get("ok"))

    def test_local_jobs_lock_and_pilot(self):
        body = {"agent_id": "le2", "prompt": "propose a tiny change"}
        self.assertEqual(self.req("POST", "/api/local-jobs", body, token=False)[0], 401)
        self.assertEqual(self.req("POST", "/api/local-jobs", body, origin=False)[0], 403)
        s, out, _ = self.req("POST", "/api/local-jobs", {"agent_id": "sa", "prompt": "nope"})
        self.assertEqual(s, 400, out)
        s, out, _ = self.req("POST", "/api/local-jobs", body)
        self.assertEqual(s, 200, out)
        job = json.loads(out)["job"]
        self.assertEqual(job["status"], "QUEUED")
        jid = job["job_id"]
        # Force awaiting approval for approve/reject coverage without waiting on worker
        ok, updated = self.srv.local_job_store.transition(
            jid, "RUNNING"
        )
        self.assertTrue(ok)
        ws = str(self.tmp / "workspace" / "f.txt")
        ok, updated = self.srv.local_job_store.transition(
            jid, "AWAITING_APPROVAL",
            {"proposed_patch": [{"path": ws, "content": "hello\n"}], "result_summary": "demo"},
        )
        self.assertTrue(ok)
        s, out, _ = self.req("POST", f"/api/local-jobs/{jid}/approve", {})
        self.assertEqual(s, 200, out)
        self.assertEqual(json.loads(out)["job"]["status"], "APPLIED")
        self.assertEqual(Path(ws).read_text(), "hello\n")
        s, out, _ = self.req("GET", "/api/agents/le2/timeline", token=False, origin=False)
        types = {e.get("event_type") for e in json.loads(out)["events"]}
        self.assertIn("local_job_queued", types)
        self.assertIn("local_job_applied", types)


if __name__ == "__main__":
    unittest.main()
