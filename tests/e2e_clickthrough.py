#!/usr/bin/env python3
"""Playwright click-through for TEVA HQ (R-VO-001 Phase 2). Not part of unittest discovery.
Usage: python3 tests/e2e_clickthrough.py http://127.0.0.1:9502 OUT_DIR [INBOX_DIR]
Fails (exit 1) on any page error / console error or a broken control."""
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:9502"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "/workspace/vo_phase2")
INBOX = Path(sys.argv[3]) if len(sys.argv) > 3 else None
OUT.mkdir(parents=True, exist_ok=True)
res, fails = {}, []


def check(name, cond):
    res[name] = bool(cond)
    if not cond:
        fails.append(name)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome",
                          args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1600, "height": 1000})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)
    pg.goto(BASE + "/office.html")
    pg.wait_for_timeout(6000)
    pg.evaluate("window.__opened = []; window.openUrl = (u) => window.__opened.push(u); 0")
    check("token_injected", pg.evaluate("TEVA_TOKEN.length >= 32"))

    # 1. Team board with Cursor activity
    pg.click('.sidebar-icon[data-view=tasks]'); pg.wait_for_timeout(900)
    check("team_rows_15", pg.locator("#vpBody tr.tb-row").count() == 15)
    check("team_has_cursor_col", "cursor activity" in pg.inner_text("#vpBody thead").lower())
    pg.screenshot(path=str(OUT / "01_team_board_cursor_activity.png"))
    pg.evaluate("[...document.querySelectorAll('#vpBody .vp-section')].slice(-2)[0].scrollIntoView({block:'start'})")
    pg.wait_for_timeout(300)
    check("unassigned_listed", pg.locator("#vpBody .pill.unassigned").count() > 0)
    pg.screenshot(path=str(OUT / "01b_team_board_unassigned_cursor_chats.png"))

    # 2. Seat panel with activity line + inbox counts (first seat with a mapped chat, else LE2)
    seat = pg.evaluate("(AGENTS.find(a => a.cursor && a.cursor.count) || {id:'le2'}).id")
    res["panel_seat"] = seat
    pg.click(f'#vpBody tr.tb-row[data-select-agent="{seat}"] td:first-child'); pg.wait_for_timeout(900)
    check("panel_cursor_rows", pg.locator("#detailCursor .cur-row").count() > 0 or seat == "le2")
    check("panel_inbox_line", "sent" in pg.inner_text("#inboxLine"))
    pg.evaluate("document.getElementById('detail-panel').scrollTop = 0"); pg.wait_for_timeout(200)
    pg.screenshot(path=str(OUT / "02_seat_panel_cursor_activity.png"))
    before = pg.evaluate(f"(INBOX['{seat}'] || {{sent:0}}).sent")

    # 3. Save to inbox
    pg.fill("#msgText", "Phase 2 test note from the click-through (box only). Please ignore.")
    pg.click("#msgInbox"); pg.wait_for_timeout(900)
    check("inbox_saved_banner", "Saved to" in pg.inner_text("#inboxResult"))
    after = pg.evaluate(f"(INBOX['{seat}'] || {{sent:0}}).sent")
    check("inbox_count_incremented", after == before + 1)
    pg.evaluate("document.getElementById('inboxResult').scrollIntoView({block:'center'})"); pg.wait_for_timeout(300)
    pg.screenshot(path=str(OUT / "03_inbox_saved.png"))
    if INBOX:
        lines = (INBOX / f"{seat}.jsonl").read_text().splitlines()
        rec = json.loads(lines[-1])
        check("inbox_file_line", rec["from"] == "Steve" and rec["seat"] == seat and "click-through" in rec["text"])
    # empty text is refused client-side, nothing written
    pg.fill("#msgText", ""); pg.click("#msgInbox"); pg.wait_for_timeout(300)
    check("inbox_empty_refused", "Write a message first" in pg.inner_text("#inboxResult"))
    # Phase 1 actions still there and still send nothing
    pg.click("#msgCursor"); pg.wait_for_timeout(200); res["opened"] = [str(u)[:60] for u in pg.evaluate("window.__opened")]
    check("cursor_deeplink_kept", any(u.startswith("cursor://anysphere.cursor-deeplink/prompt?text=") for u in res["opened"]))
    check("grok_copy_kept", pg.locator("#msgGrok").count() == 1)

    # page-level fetch without token / with wrong token is rejected by the server
    n_err = len(errs)
    st = pg.evaluate("""async () => {
      const a = await fetch('/api/inbox', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({seat:'le2', text:'x'})});
      const b = await fetch('/api/inbox', {method:'POST', headers:{'Content-Type':'application/json','X-TEVA-Token':'nope'}, body: JSON.stringify({seat:'le2', text:'x'})});
      const c = await fetch('/webhook/agents', {method:'POST', headers:{'Content-Type':'application/json'}, body: '{"agents":[]}'});
      return [a.status, b.status, c.status]; }""")
    res["no_token_statuses"] = st
    pg.wait_for_timeout(300)
    # the three deliberate 401s log "Failed to load resource" in the console; drop exactly those
    expected = [e for e in errs[n_err:] if "401" in e]
    del errs[n_err:n_err + len(expected)]
    res["expected_401_console_lines"] = len(expected)
    check("no_token_rejected", st == [401, 401, 401])

    # 4. Settings
    pg.click("#detailClose"); pg.click('.sidebar-icon[data-view=settings]'); pg.wait_for_timeout(600)
    txt = pg.inner_text("#vpBody")
    check("settings_write_lock", "Write lock" in txt and "This page has the token: yes" in txt)
    check("settings_cursor", "Cursor transcripts" in txt)
    pg.screenshot(path=str(OUT / "04_settings.png"))

    # Every other control still works (Phase 1 regression)
    pg.click('.sidebar-icon[data-view=metrics]'); pg.wait_for_timeout(400)
    check("metrics_opens", pg.evaluate("currentView") == "metrics")
    pg.click('.sidebar-icon[data-view=office]'); pg.wait_for_timeout(400)
    check("office_resets", not pg.evaluate("document.getElementById('view-panel').classList.contains('open')"))
    pg.click("#standupBtn"); pg.wait_for_timeout(300)
    check("standup_opens", pg.evaluate("currentView") == "tasks")
    pg.evaluate("document.getElementById('rlAnalytics').click()"); pg.wait_for_timeout(300)
    check("analytics_opens", pg.evaluate("currentView") == "metrics")
    pg.evaluate("openView('office'); closeDetail()")
    check("chat_disabled_without_seat", pg.evaluate("document.getElementById('chatBtn').disabled"))
    pg.evaluate("selectAgent('le2')"); pg.wait_for_timeout(500); pg.click("#chatBtn"); pg.wait_for_timeout(300)
    check("chat_focuses_composer", pg.evaluate("document.activeElement.id") == "msgText")
    pg.evaluate("closeDetail(); openView('office')")
    pg.click('.sidebar-icon[data-view=lock]'); pg.wait_for_timeout(300)
    check("pause", pg.evaluate("paused"))
    pg.click("#pauseOverlay"); pg.wait_for_timeout(300)
    check("resume", not pg.evaluate("paused"))
    for sid in pg.evaluate("AGENTS.map(a => a.id)"):
        pg.evaluate(f"selectAgent('{sid}')")
    pg.wait_for_timeout(1500)
    res["errors"] = errs
    check("no_js_errors", not errs)
    b.close()

print(json.dumps(res, indent=1, ensure_ascii=False))
print("FAIL: " + ", ".join(fails) if fails else "ALL CHECKS PASSED")
sys.exit(1 if fails else 0)
