#!/usr/bin/env python3
"""Playwright acceptance test for TEVA HQ Phase 3a (R-VO-002). Not part of unittest discovery.
Usage: python3 tests/e2e_phase3a.py OUT_DIR [--quick] [--soak-min N]
Starts its own server.py on a free port with temp copies of agents.json / a Cursor snapshot, a temp
token file and a temp inbox (never touches ~/.teva_hq). Exit 1 on any failed check or page error."""
import json, os, shutil, socket, subprocess, sys, tempfile, time, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "/tmp/vo_phase3a_e2e")
QUICK = "--quick" in sys.argv
SOAK_MIN = float(sys.argv[sys.argv.index("--soak-min") + 1]) if "--soak-min" in sys.argv else 0
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
OUT.mkdir(parents=True, exist_ok=True)
res, fails = {}, []


def check(name, cond, info=None):
    res[name] = bool(cond) if info is None else {"ok": bool(cond), "info": info}
    if not cond:
        fails.append(name)
    print(("PASS " if cond else "FAIL ") + name + ("" if info is None else "  " + json.dumps(info)[:300]), flush=True)


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


tmp = Path(tempfile.mkdtemp(prefix="vo3a_"))
agents_path = tmp / "agents.json"
shutil.copy(ROOT / "agents.json", agents_path)
snap = tmp / "cursor.json"
snap_src = os.environ.get("CURSOR_SNAPSHOT_SRC")
if snap_src and Path(snap_src).exists():
    shutil.copy(snap_src, snap)
else:
    snap.write_text(json.dumps({"chats": [], "seats": {}, "scannedAt": int(time.time() * 1000)}))
inbox = tmp / "inbox"
PORT = free_port()
env = dict(os.environ, PORT=str(PORT), AGENTS_JSON_PATH=str(agents_path), CURSOR_ACTIVITY_SNAPSHOT=str(snap),
           TEVA_HQ_TOKEN_FILE=str(tmp / "tok" / "token"), TEVA_INBOX_DIR=str(inbox), POLL_INTERVAL_SECONDS="1",
           CURSOR_SCAN_SECONDS="1", TEVA_REPO=str(tmp / "no_repo"))
srv = subprocess.Popen([sys.executable, str(ROOT / "server.py")], cwd=str(ROOT), env=env,
                       stdout=open(tmp / "server.log", "w"), stderr=subprocess.STDOUT)
BASE = f"http://127.0.0.1:{PORT}"
for _ in range(60):
    try:
        urllib.request.urlopen(BASE + "/api/config", timeout=1); break
    except Exception:
        time.sleep(0.25)


def post(body, token=None, origin=None):
    h = {"Content-Type": "application/json"}
    if token is not None: h["X-TEVA-Token"] = token
    if origin is not None: h["Origin"] = origin
    req = urllib.request.Request(BASE + "/api/inbox", data=json.dumps(body).encode(), headers=h, method="POST")
    try:
        return urllib.request.urlopen(req, timeout=3).status
    except urllib.error.HTTPError as e:
        return e.code


def inbox_lines(seat):
    f = inbox / f"{seat}.jsonl"
    return [json.loads(l) for l in f.read_text().splitlines() if l.strip()] if f.exists() else []


LAUNCH = dict(executable_path=CHROME, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
JS_CLONE = "JSON.parse(JSON.stringify(prevPayload))"
errs = []


def open_page(b, **ctx):
    c = b.new_context(viewport={"width": 1600, "height": 900}, **ctx)
    pg = c.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)
    pg.goto(BASE + "/office.html")
    pg.wait_for_function("window.__vo && __vo.firstSyncAt > 0", timeout=30000)
    pg.wait_for_timeout(2500)
    return c, pg


def seats(pg):
    return pg.evaluate("VO.seats()")


def moved(a, b, tol=0.02):
    return sorted(k for k in a if k in b and (abs(a[k]["x"] - b[k]["x"]) > tol or abs(a[k]["z"] - b[k]["z"]) > tol))


try:
    with sync_playwright() as p:
        b = p.chromium.launch(**LAUNCH)
        c, pg = open_page(b)
        check("defaults_honest", pg.evaluate("!SETTINGS.chatter && !SETTINGS.wander && !SETTINGS.sound"),
              pg.evaluate("({chatter:SETTINGS.chatter, wander:SETTINGS.wander, sound:SETTINGS.sound, motion:SETTINGS.motion})"))
        check("first_payload_silent", pg.evaluate("VO.events.length === 0 && VO.overlays.length === 0 && FEED.length === 0"))

        # ---- AC1 honesty: payload unchanged for 60 s -> nothing moves, no bubble, no overlay
        hold = 15 if QUICK else 60
        s0 = seats(pg); o0 = pg.evaluate("VO.overlays.length"); bub0 = pg.evaluate("bubbles.length")
        f0 = pg.evaluate("VO.fetches")
        pg.screenshot(path=str(OUT / "p3a_01_idle_honest.png"))
        pg.wait_for_timeout(hold * 1000)
        s1 = seats(pg)
        check("AC1_no_position_change_%ds" % hold, not moved(s0, s1), moved(s0, s1))
        check("AC1_no_overlay_or_bubble", pg.evaluate("VO.overlays.length") == o0 and pg.evaluate("bubbles.length") == bub0 == 0
              and pg.evaluate("agents.every(o => !o.overlay)"))
        check("AC1_no_events_while_polling", pg.evaluate("VO.events.length") == 0 and pg.evaluate("VO.fetches") > f0,
              {"fetches_during_hold": pg.evaluate("VO.fetches") - f0})

        # ---- AC4 OFFLINE seats
        off = pg.evaluate("agents.filter(o => o.agent.signal === false && o.agent.id !== 'needs-steve' && !(o.agent.cursor && o.agent.cursor.latest)).map(o => [o.agent.id, o.base])")
        check("AC4_signal_false_is_OFFLINE", off and all(bs == "OFFLINE" for _, bs in off), off)
        check("AC4_offline_static", not [k for k in moved(s0, s1) if k in dict(off)])
        check("AC4_offline_desaturated", pg.evaluate("""(() => { const o = agents.find(x => x.base === 'OFFLINE'); if (!o) return false;
              const c = partColor(o, 'agent', new THREE.Color()); const r = new THREE.Color(o.agent.color || '#8B5CF6'); const h1 = {}, h0 = {}; c.getHSL(h1); r.getHSL(h0); return h1.s < h0.s * 0.75; })()"""))

        # ---- AC2 injected payload pairs (live polling stopped so the server can't overwrite the injection)
        pg.evaluate("liveStop(); 0")
        now = "Date.now()"
        # (a) active + toolKind=write -> TYPING
        pg.evaluate(f"""(() => {{ const P = {JS_CLONE}; const a = P.find(x => x.id === 'pm');
            a.cursor = {{count: 1, chats: [], latest: {{id: 'e2e-chat-pm-0001', title: 'e2e', state: 'active', tool: 'Write', toolKind: 'write', step: 'Write docs/E2E.md', lastActivity: {now}, subagents: 0}}}};
            VO.inject(P); }})()""")
        pg.wait_for_timeout(600)
        st = seats(pg)["pm"]
        ev = pg.evaluate("VO.events.slice(-1)[0]")
        check("AC2a_write_is_TYPING", st["base"] == "TYPING" and ev["type"] == "toolStart", {"base": st["base"], "ev": ev["type"]})
        pg.screenshot(path=str(OUT / "p3a_02_typing_monitor.png"))
        pg.wait_for_timeout(4200)  # per-seat throttle is 4 s
        # (b) ended/success -> celebrate then YOUR_TURN
        pg.evaluate(f"""(() => {{ const P = {JS_CLONE}; const a = P.find(x => x.id === 'pm');
            Object.assign(a.cursor.latest, {{state: 'ended', toolKind: 'reply', endStatus: 'success', endedAt: {now}}}); VO.inject(P); }})()""")
        pg.wait_for_timeout(250)
        st = seats(pg)["pm"]
        check("AC2b_success_celebrates", st["overlay"] == "celebrate", st)
        pg.screenshot(path=str(OUT / "p3a_03_turn_done_celebrate.png"))
        pg.wait_for_timeout(2500)
        st = seats(pg)["pm"]
        check("AC2b_then_YOUR_TURN", st["base"] == "YOUR_TURN" and not st["overlay"], st)
        check("AC2b_tab_title_count", pg.title().startswith("("), pg.title())
        # (c) ended/error -> head-scratch + warning
        pg.evaluate(f"""(() => {{ const P = {JS_CLONE}; const a = P.find(x => x.id === 'ba');
            a.cursor = {{count: 1, chats: [], latest: {{id: 'e2e-chat-ba-0002', state: 'active', tool: 'Shell', toolKind: 'shell', step: 'npm test', lastActivity: {now} - 5000}}}};
            VO.inject(P); }})()""")
        pg.wait_for_timeout(4300)
        pg.evaluate(f"""(() => {{ const P = {JS_CLONE}; const a = P.find(x => x.id === 'ba');
            Object.assign(a.cursor.latest, {{state: 'ended', endStatus: 'error', endedAt: {now}}}); VO.inject(P); }})()""")
        pg.wait_for_timeout(300)
        st = seats(pg)["ba"]
        badge = pg.evaluate("(() => { const b = seatObj('ba').badges.warn; return b && b.visible ? (b.material.map === badgeTex('fail', '') ? 'fail' : 'other') : null; })()")
        check("AC2c_error_headscratch_warn", st["overlay"] == "headScratch" and st["base"] == "BLOCKED" and badge == "fail", {"st": st, "badge": badge})
        pg.screenshot(path=str(OUT / "p3a_04_error_headscratch.png"))
        # (d) doc mtime bump -> doc pop (seat with owned docs)
        pg.evaluate(f"""(() => {{ const P = {JS_CLONE}; const a = P.find(x => x.id === 'ui-docs');
            a.docsOwned = true; a.docs = [{{name: 'E2E_DOC.md', path: '/x/E2E_DOC.md', mtime: 1000}}]; VO.inject(P);
            const Q = {JS_CLONE}; Q.find(x => x.id === 'ui-docs').docs[0].mtime = 2000; VO.inject(Q); }})()""")
        pg.wait_for_timeout(250)
        st = seats(pg)["ui-docs"]
        check("AC2d_doc_mtime_docpop", st["overlay"] == "docPop", st)
        # (e) new Needs Steve item -> beacon (+ owner raises hand)
        pg.evaluate("""(() => { const P = JSON.parse(JSON.stringify(prevPayload)); const n = P.find(x => x.id === 'needs-steve');
            n.needsSteveItems = (n.needsSteveItems || []).concat([{text: 'E2E: approve test item', path: '/x/TEVA_COMPANY_BACKLOG.md', line: 42, owner: 'erp-research'}]);
            VO.inject(P); })()""")
        pg.wait_for_timeout(250)
        bc = pg.evaluate("({burst: BEACON.burstUntil > Date.now(), visible: BEACON.group.visible, ov: (seatObj('erp-research').overlay||{}).name})")
        check("AC2e_needs_steve_beacon", bc["burst"] and bc["visible"] and bc["ov"] == "raiseHand", bc)
        pg.screenshot(path=str(OUT / "p3a_05_needs_steve_beacon.png"))
        # (f) owner change -> hand-off walk A -> B -> A
        A, B = "le", "debugger"
        home = seats(pg)[A]
        pg.evaluate(f"""(() => {{ const P = {JS_CLONE}; const n = P.find(x => x.id === 'needs-steve'); n.board = n.board || {{}};
            n.board.items = (n.board.items || []).filter(i => i.id !== 'E2E-1').concat([{{doc: 'company', id: 'E2E-1', title: 'e2e', line: 7, owner: '{A}'}}]); VO.inject(P);
            const Q = {JS_CLONE}; Q.find(x => x.id === 'needs-steve').board.items.find(i => i.id === 'E2E-1').owner = '{B}'; VO.inject(Q); }})()""")
        far, phases, gave, tb = 0.0, set(), False, None
        bpos = seats(pg)[B]
        t0 = time.time()
        while time.time() - t0 < 45:
            s = seats(pg); a = s[A]
            phases.add(a["phase"])
            d = ((a["x"] - home["x"]) ** 2 + (a["z"] - home["z"]) ** 2) ** 0.5
            far = max(far, d)
            if a["phase"] == "give" and not gave:
                gave = True; pg.screenshot(path=str(OUT / "p3a_06_handoff_give.png"))
                tb = ((a["x"] - bpos["x"]) ** 2 + (a["z"] - bpos["z"]) ** 2) ** 0.5
            if gave and not a["overlay"]:
                break
            pg.wait_for_timeout(250)
        back = seats(pg)[A]
        dback = ((back["x"] - home["x"]) ** 2 + (back["z"] - home["z"]) ** 2) ** 0.5
        check("AC2f_handoff_A_B_A", {"go", "give", "back"} <= phases and tb is not None and tb < 1.6 and far > 2 and dback < 0.15,
              {"phases": sorted(x for x in phases if x), "dist_to_B_at_give": tb, "max_from_home": round(far, 2), "back_from_home": round(dback, 3), "secs": round(time.time() - t0, 1)})

        # ---- AC3 every overlay names its source in the feed
        feed = pg.evaluate("FEED.map(f => ({type: f.type, src: f.source, anim: f.anim}))")
        ovs = pg.evaluate("VO.overlays.map(o => o.source)")
        bad = [f for f in feed if not f["src"]]
        import re
        srcok = all(re.search(r"[\w.-]+\.(md|jsonl):\d+|chat [0-9a-f-]{6,}|e2e-chat|docs/|^you\b|\.jsonl|repeat of", str(s)) for s in ovs)
        check("AC3_feed_line_per_event_with_source", len(feed) >= 7 and not bad and srcok,
              {"feed_lines": len(feed), "overlays": len(ovs), "sample": [f["src"] for f in feed[:6]]})
        pg.click('.sidebar-icon[data-view=metrics]'); pg.wait_for_timeout(700)
        check("AC3_feed_view_lists_lines", pg.locator("#feedList .feed-row").count() >= 7)
        pg.screenshot(path=str(OUT / "p3a_07_activity_feed.png"))
        pg.click('.sidebar-icon[data-view=metrics]'); pg.wait_for_timeout(300)
        pg.evaluate("openView('office')"); pg.wait_for_timeout(500)

        # ---- AC2 reload never replays one-shots
        pg.reload(); pg.wait_for_function("window.__vo && __vo.firstSyncAt > 0", timeout=30000); pg.wait_for_timeout(3000)
        check("AC2_reload_no_replay", pg.evaluate("VO.events.length === 0 && VO.overlays.length === 0 && FEED.length === 0"))

        # ---- server-driven pair: edit agents.json on disk, page polls it
        data = json.loads(agents_path.read_text())
        lst = data["agents"] if isinstance(data, dict) else data
        tgt = next(a for a in lst if a.get("id") == "grok")
        tgt["task"] = "E2E server-driven task change"
        agents_path.write_text(json.dumps(data, indent=2))
        pg.wait_for_function("FEED.some(f => f.seat === 'grok')", timeout=20000)
        fl = pg.evaluate("FEED.find(f => f.seat === 'grok')")
        check("server_driven_event_sourced", fl["type"] in ("taskChange", "statusChange") and bool(fl["source"]), fl)
        shutil.copy(ROOT / "agents.json", agents_path)
        pg.wait_for_timeout(6000)

        # ---- AC5 reactions
        pg.evaluate("selectAgent('product'); 0"); pg.wait_for_timeout(800)
        before = len(inbox_lines("product"))
        for k in "1", "5":
            pg.keyboard.press(k); pg.wait_for_timeout(1200)
        check("AC5_wave_poke_write_nothing", len(inbox_lines("product")) == before)
        for k in "2", "3", "4", "6":
            pg.keyboard.press(k); pg.wait_for_timeout(1300)
        lines = inbox_lines("product")[before:]
        check("AC5_four_reaction_lines", [l.get("emoji") for l in lines] == ["👍", "🎉", "👀", "✋"] and all(l.get("kind") == "reaction" and l.get("from") == "Steve" for l in lines),
              [(l.get("kind"), l.get("emoji")) for l in lines])
        pg.screenshot(path=str(OUT / "p3a_08_reaction_panel.png"))
        tok = pg.evaluate("TEVA_TOKEN")
        origin = BASE
        check("AC5_no_token_401", post({"seat": "product", "kind": "reaction", "emoji": "👍"}, None, origin) == 401)
        check("AC5_bad_origin_403", post({"seat": "product", "kind": "reaction", "emoji": "👍"}, tok, "http://evil.example") == 403)
        check("AC5_unknown_emoji_400", post({"seat": "product", "kind": "reaction", "emoji": "💣"}, tok, origin) == 400)
        check("AC5_rejects_wrote_nothing", len(inbox_lines("product")) == before + 4)
        # 👀 clears your-turn: rebuild a YOUR_TURN seat, press 4
        pg.evaluate("""(() => { liveStop(); const P = JSON.parse(JSON.stringify(prevPayload)); const a = P.find(x => x.id === 'sa');
            a.signal = true; a.cursor = {count: 1, chats: [], latest: {id: 'e2e-chat-sa-0003', state: 'ended', endStatus: 'success', endedAt: Date.now(), toolKind: 'reply'}}; VO.inject(P); refreshBases(); })()""")
        b4 = pg.evaluate("seatObj('sa').base")
        pg.evaluate("selectAgent('sa'); 0"); pg.wait_for_timeout(600)
        pg.keyboard.press("4"); pg.wait_for_timeout(900)
        check("AC5_eyes_clears_your_turn", b4 == "YOUR_TURN" and pg.evaluate("seatObj('sa').base") != "YOUR_TURN", {"before": b4, "after": pg.evaluate("seatObj('sa').base")})
        # N jumps to the next seat needing attention
        pg.evaluate("closeDetail(); 0"); pg.keyboard.press("n"); pg.wait_for_timeout(900)
        check("N_selects_attention_seat", pg.evaluate("!!selectedAgent && ATTN.some(x => x.seat === selectedAgent.id)"), pg.evaluate("selectedAgent && selectedAgent.id"))
        check("AC5_no_chat_send_path", "deeplink" not in json.dumps(pg.evaluate("VO.events.map(e=>e.type)")))
        c.close()

        # ---- AC6 reduced motion
        c, pg = open_page(b, reduced_motion="reduce")
        check("AC6_motion_reduced", pg.evaluate("motionMode()") == "reduced")
        pg.evaluate("liveStop(); 0")
        home = seats(pg)["le"]
        pg.evaluate("""(() => { const P = JSON.parse(JSON.stringify(prevPayload)); const n = P.find(x => x.id === 'needs-steve'); n.board = n.board || {};
            n.board.items = (n.board.items || []).concat([{doc: 'company', id: 'E2E-2', title: 'e2e', line: 8, owner: 'le'}]); VO.inject(P);
            const Q = JSON.parse(JSON.stringify(prevPayload)); Q.find(x => x.id === 'needs-steve').board.items.find(i => i.id === 'E2E-2').owner = 'debugger'; VO.inject(Q); })()""")
        far, ys = 0, []
        for _ in range(16):
            s = seats(pg); a = s["le"]
            far = max(far, ((a["x"] - home["x"]) ** 2 + (a["z"] - home["z"]) ** 2) ** 0.5)
            ys.extend(v["y"] for v in s.values()); pg.wait_for_timeout(200)
        check("AC6_no_walk_on_handoff", far < 0.05, {"max_from_home": round(far, 3)})
        pg.evaluate("selectAgent('sa'); 0"); pg.keyboard.press("3"); pg.wait_for_timeout(300)
        check("AC6_no_hops", max(ys) < 0.01 and pg.evaluate("Math.abs(seatObj('sa').group.position.y)") < 0.01, {"max_y": max(ys)})
        pg.evaluate("focusSeat('pm'); 0")
        check("AC6_camera_cut", pg.evaluate("CAM.tween === null && Math.abs(CAM.target.x - seatObj('pm').group.position.x) < 0.01"))
        check("AC6_sound_off_default", pg.evaluate("SETTINGS.sound === false"))
        pg.screenshot(path=str(OUT / "p3a_09_reduced_motion.png"))
        # sound on but tab hidden -> silent
        pg.evaluate("""SETTINGS.sound = true; Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
            Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'}); document.dispatchEvent(new Event('visibilitychange'));
            chime(); chime(); 0""")
        check("AC6_silent_while_hidden", pg.evaluate("VO.chimes") == 0)
        c.close()

        # ---- AC7 hidden tab: no rAF frames, no fetches, resumes
        c, pg = open_page(b)
        pg.evaluate("""Object.defineProperty(document, 'hidden', {configurable: true, get: () => window.__hid === true});
            Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => window.__hid ? 'hidden' : 'visible'});
            window.__hid = true; document.dispatchEvent(new Event('visibilitychange')); 0""")
        pg.wait_for_timeout(500)
        fr0, fe0 = pg.evaluate("[VO.frames, VO.fetches]")
        pg.wait_for_timeout(12000)
        fr1, fe1 = pg.evaluate("[VO.frames, VO.fetches]")
        check("AC7_hidden_no_frames_no_fetches", fr1 == fr0 and fe1 == fe0, {"frames": fr1 - fr0, "fetches": fe1 - fe0})
        pg.evaluate("window.__hid = false; document.dispatchEvent(new Event('visibilitychange')); 0")
        pg.wait_for_timeout(6000)
        fr2, fe2 = pg.evaluate("[VO.frames, VO.fetches]")
        check("AC7_resumes", fr2 > fr1 and fe2 > fe1 and pg.evaluate("VO.events.length") == 0, {"frames": fr2 - fr1, "fetches": fe2 - fe1})

        # ---- AC8 perf: draw calls idle/active, geometry stability
        idle = pg.evaluate("window.__voPerf()")
        pg.evaluate("""(() => { liveStop(); const ids = ['pm','ba','le2','research-mgr','erp-research','product','ui-docs','grok'];
            const P = JSON.parse(JSON.stringify(prevPayload)); ids.forEach((id, i) => { const a = P.find(x => x.id === id);
            a.cursor = {count: 1, chats: [], latest: {id: 'e2e-perf-' + i, state: 'active', toolKind: ['write','read','shell','task','search','edit','fetch','write'][i], step: 'perf step ' + i, lastActivity: Date.now(), subagents: i === 3 ? 3 : 0}}; });
            VO.inject(P); ids.forEach(id => react(id, '3', 'perf')); })()""")
        pg.wait_for_timeout(1500)
        act = pg.evaluate("window.__voPerf()")
        pg.screenshot(path=str(OUT / "p3a_10_active_perf.png"))
        check("AC8_draw_calls_le_150", idle["calls"] <= 150 and act["calls"] <= 150, {"idle": idle, "active": act})
        g0 = t0g = None  # baseline after 3 warm-up cycles (first use fills the bounded chip/emoji/badge texture caches)
        cycles = 4 if QUICK else 12
        soak_end = time.time() + SOAK_MIN * 60
        n = 0
        while n < cycles or time.time() < soak_end:
            n += 1
            pg.evaluate(f"""(() => {{ const P = JSON.parse(JSON.stringify(prevPayload)); const a = P.find(x => x.id === 'pm');
                a.task = 'soak ' + {n}; a.cursor = {{count:1, chats:[], latest:{{id:'soak-{n}', state: {n} % 2 ? 'active' : 'ended', endStatus: 'success', endedAt: Date.now(), toolKind: 'write', step: 'soak {n}', lastActivity: Date.now()}}}};
                VO.inject(P); react('product', '1', 'soak'); selectAgent('pm'); closeDetail(); }})()""")
            pg.wait_for_timeout(4500)
            if n == 3:
                g0 = pg.evaluate("renderer.info.memory.geometries"); t0g = pg.evaluate("renderer.info.memory.textures")
        pg.wait_for_timeout(3000)
        g1 = pg.evaluate("renderer.info.memory.geometries"); t1g = pg.evaluate("renderer.info.memory.textures")
        check("AC8_geometries_textures_stable", g1 == g0 and t1g <= t0g + 1,
              {"geom": [g0, g1], "tex": [t0g, t1g], "cycles": n, "minutes": round(n * 4.5 / 60, 1)})
        res["perf"] = {"idle": idle, "active": act}
        c.close()
        b.close()
finally:
    srv.terminate()
check("no_page_errors", not errs, errs[:8])
(OUT / "e2e_phase3a_results.json").write_text(json.dumps({"results": res, "fails": fails}, indent=1, ensure_ascii=False))
print(json.dumps({"fails": fails}, ensure_ascii=False))
sys.exit(1 if fails else 0)
