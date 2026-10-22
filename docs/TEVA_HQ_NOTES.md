# TEVA HQ notes (VirtOffice, R-VO-001)

Local virtual office for Steve's TEVA bot org: `./start_teva_hq.command`, then
http://localhost:9502/office.html. Server binds 127.0.0.1 only.

## Phase 2 (2026-10-17): live Cursor activity, write lock, seat inbox

### Write lock
- Per-install token: created on first start at `~/.teva_hq/token` (dir 0700, file 0600), outside git.
  Override with `TEVA_HQ_TOKEN_FILE`. Delete the file and restart to rotate it.
- `server.py` injects the token into `office.html` only when it serves that page
  (`<meta name="teva-token">`). The page sends it as `X-TEVA-Token`.
- Every request must carry `Host: 127.0.0.1:9502` or `localhost:9502` (blocks DNS rebinding), else 403.
- Every POST (`/api/inbox`, `/webhook/agents`) needs `Origin` = `http://127.0.0.1:9502` or
  `http://localhost:9502` (else 403) **and** the token (else 401), `Content-Type: application/json`,
  and a bounded body. Wildcard CORS (`Access-Control-Allow-Origin: *`) is gone.
- `scripts/hermes_bridge.py --webhook` reads the token file and sends the token + Origin. Nothing in
  the TEVA HQ start script pushes to the webhook.

### Seat inbox
- "Save to inbox" in a seat's message box POSTs `{seat, text}` to `/api/inbox`, which appends
  `{"time","ts","from":"Steve","seat","text"}` as one JSON line to `inbox/<seat>.jsonl` (gitignored, 0600).
- Seat id must be one of the 14 ROSTER ids (regex + allowlist, so no path traversal).
  Text ≤ 4096 bytes UTF-8; each seat file ≤ 1 MiB (413 when full).
- Counts: `sent` = lines in the file; `unread` = sent − the number in `inbox/<seat>.read`. No seat writes
  `.read` in Phase 2, so everything is unread.
- Nothing is auto-sent to Cursor or Grok Bot. "Open in Cursor" (prefilled deeplink) and
  "Copy for Grok Bot" are unchanged.

### Cursor activity (read-only)
- `scripts/cursor_activity.py` (port of `template_1/pixel-agents-cursor` `fileWatcher.ts` +
  `transcriptParser.ts`) tails `~/.cursor/projects/Users-stevenayensu-Documents-GitHub-template-1/agent-transcripts/<uuid>/<uuid>.jsonl`
  every 30 s from a thread in `server.py`, reading only new bytes. Titles come from Cursor's
  globalStorage `state.vscdb` (`composerData:<uuid>` → `name`), opened read-only.
- A chat maps to a seat only on evidence: `seat_map.json` (hand-edited `{"<uuid>": "<seat>"}`),
  else a title naming one seat, else a first prompt naming one seat in a role form
  ("To LE2 (TEVA … seat)", "You are the Security Auditor", "acting as …", "LE2: …"),
  else docs/*.md it writes that match one seat's ROSTER patterns (board docs excluded).
  Conflicts or no evidence → "Unassigned Cursor chat". Nothing is guessed.
- `python3 scripts/cursor_activity.py` prints the current mapping.

## Phase 3a (2026-10-17, R-VO-002): honest procedural animation

Every motion is caused by a field in `/api/agents` or by a click/key from Steve. With no data change nothing moves except idle breathing/blinks and the camera.

- **Events** (`public/vo_events.js`, pure, node-tested): `deriveEvents(prev, next)` turns payload edges into sourced events (toolStart, turnEnded, stalled, statusChange, blocked/unblocked, taskChange, docWritten, needsSteveAdded, researchDone, handoff, inbox). The first payload after a load and any roster change are silent, so a reload never replays animations. At most one overlay per seat every 4 s.
- **Activity feed**: every event writes a line naming its source (backlog `file:line`, Cursor chat id, `docs/<file>`, inbox file, or "you"). Ticker bottom left, full list in 📊.
- **Seat state machine** (priority): OFFLINE > BLOCKED > MEETING > TYPING / READING / RUNNING / DELEGATING > YOUR_TURN > **AT_DESK (board `working`/WIP)** > THINKING (stale chat only when board is not WIP) > IDLE. Step text shows on the seat's monitor (one shared atlas). The old 3.5 s random behaviour tick is gone.
- **Reactions** (seat panel or keys 1–6 with a seat selected): 1 👋 wave and 5 👉 poke are local only. 2 👍, 3 🎉, 4 👀 and 6 ✋ are saved to `~/.teva_hq/inbox/<seat>.jsonl` as `{"kind":"reaction","emoji":…}` through the same token-locked POST. 👀 clears "your turn". Nothing is ever sent to a chat. Single-click on an avatar waves; double-click pokes.
- **Attention**: N (or the N · Next button) cycles Needs Steve → blocked → your-turn seats. Off-screen seats get edge arrows, and the tab title shows the count. F follows the selected seat, Esc resets the camera, P toggles the perf HUD.
- **Settings**: Motion (Auto follows `prefers-reduced-motion`; Reduced = no walking/hops/confetti and camera cuts; Off = static). The chime is off by default and silent while the tab is hidden. Also screen-reader announcements and the ticker.
- **Hidden tab**: rendering, polling and SSE stop, and the page polls once on return.
- **Perf**: shared geometry + instanced avatar parts, room meshes merged per material, one monitor atlas, LEDs merged and cached, pooled particles, 30 fps cap when idle. Box swiftshader: 712 → ~67 draw calls idle, ~91 active.

### Board conventions the office reads (template_1 docs, read-only)
- `MEETING: <seat codes> <topic>` — an upper-case line at the start of a line in `TEVA_COMPANY_BACKLOG.md` puts those seats in the meeting room. Nothing else does.
- `**<SEAT> BLOCKED**`, or `BLOCKED` / `FAIL(ED)` / "waiting on" in the seat's own task text, sets `blocked` (⚠ + one head-scratch when it appears).
- `### <id>. …` headings with `- **Owner(s):** <codes>` give per-item owners. An owner change animates a folder hand-off A → B → A.
- `cursor_activity.py` now reports `toolKind` (write/edit/read/search/fetch/shell/task/reply/other), `endStatus` and `endedAt`. The server rescans every 10 s (`CURSOR_SCAN_SECONDS`).

### 3D office layout (2026-10-17)
- **`public/office_layout.js`** — single source for room size (52×36 main), **TEVA seat coordinates**, zone labels, furniture anchors, and camera presets. Keep seat ids aligned with `scripts/teva_sync.py` `ROSTER` (+ `needs-steve`).
- **Main floor** — zone edge strips (not filled color pads), glass/black-metal dividers, slim cool ceiling fixtures, light concrete floor, off-white walls with black skirting, front doorway into the wing.
- **Collab terrace (wing)** — separate group south of the main floor; sidebar **🌿** or keys **`]`** / **`[`** (terrace / main) tween the camera. Agents stay on the main floor; unassigned Cursor chats label hot desks on the terrace (from `GET /api/cursor`, cosmetic only).
- **Visual language** — bright modern glass/concrete HQ (not warm wood). ACES tone mapping, daylight sky dome, cool fog (`0xc8d0dc`). Procedural exterior: paved ground, entrance plaza/steps, distant box skyline. Minimal brand wall panels (“TEVA” / “HQ”) instead of emoji posters.
- **Equipment** — sit-stand desks with dual monitors + dock, mesh task chairs, blade server racks, digital meeting board, wall lounge display, stainless kitchen, glass phone booths, terrace hot desks with laptop/monitor.
- **Avatars** — procedural InstancedMesh humanoids restyled for HQ: rounded heads, slimmer torso/limbs, cool skin/hair, desaturated seat-color tops, light nameplates with a color accent bar. Pose / event system unchanged.
- **Camera gestures** — drag to orbit, Shift-drag or right-drag to pan, scroll / pinch to zoom (`touch-action: none` on the canvas). Tap (not drag) still selects seats. Esc / sidebar presets reset pitch and view; `[` / `]` switch main floor vs terrace.

## Command centre Phase 1 (2026-10-17)
- **Agent registry** (`scripts/agent_registry.py`, `~/.teva_hq/agents_registry.json`) — stable seat identities + explicit session maps; `GET /api/registry`, `POST /api/registry/map`. Unassigned chats get a Map-to-seat control; nothing is guessed. See [`docs/COMMAND_CENTRE.md`](COMMAND_CENTRE.md).
- **State aggregator** — each agent carries `activity` (state, confidence, source, lastSeenAt). Stale Cursor “active” is low-confidence, not live RUNNING/TYPING.
- **Event store** — per-seat JSONL timeline (`GET /api/agents/<id>/timeline`); detail panel Activity history. Inbox save records `message_saved` only (not delivered).
- **Office UI** — status-coloured rings, task on nameplate, confidence/last-seen chips, blocker / pending-decision cues.

## Command centre Phase 2 (2026-10-17)
- **Message store** (`scripts/message_store.py`, `~/.teva_hq/messages/`) — instruction lifecycle (QUEUED→…→RESPONDED / FAILED / CANCELLED). Distinct from `/api/inbox` notes.
- **Delivery adapters** (`scripts/delivery_adapters.py`) — `CursorDeeplinkAdapter` (manual handoff; DELIVERED only after `handoff-opened`); `UnsupportedAdapter` for grok/none (truthful failure).
- **APIs** — `POST/GET /api/messages`, actions: handoff-opened / acknowledge / respond / retry / cancel. Token + Origin locked. SSE `{type:"message"}`.
- **Composer** — Queue instruction + lifecycle stepper; Save to inbox / Open in Cursor / Copy for Grok unchanged. Executed is never a message status.
- Full detail: [`docs/COMMAND_CENTRE.md`](COMMAND_CENTRE.md).

## Local Ollama fallback MVP (2026-10-21)
- **Provider** (`scripts/ollama_provider.py`) — discovery/health/chat against localhost Ollama; config in `~/.teva_hq/ollama_config.json`.
- **Local jobs** (`scripts/local_job_store.py` + worker + allowlisted tools) — pilot seat `le2` only; ReAct loop proposes edits; Steve **Approve patch** writes files.
- **Composer** — **Run on Ollama** when healthy; job lifecycle chips; does not claim Cursor session resume or usage-limit detection.
- See [`docs/COMMAND_CENTRE.md`](COMMAND_CENTRE.md) § Local Ollama fallback.

## Open items
- **Seats read the inbox only after PM/Supervisor agree.** No seat (Cursor or Grok Bot) is wired to
  read `inbox/<seat>.jsonl` or write `inbox/<seat>.read` yet. Until PM/Supervisor adopt a convention
  ("read your inbox at the start of a turn, then record the line count"), inbox notes remain a parking
  place for Steve. Instructions use `/api/messages` with a truthful Cursor handoff (not programmatic send).
- Phase 3: generalize local jobs → full task engine / Needs Steve approval; more seats; optional policy router. Cursor CLI resume only if proven safe.
- `agents.json` is still tracked in git from before; run `git rm --cached agents.json` at the next commit.
- Most of Steve's template_1 Cursor chats are ad-hoc (no seat in title/prompt), so they show as
  unassigned. To tag one, add it to `seat_map.json` or start the chat from the office composer
  ("Open in Cursor" puts "To <seat> (TEVA … seat)" first, which maps it).

## Tests
`python3 -m unittest discover -s tests` (parsers, Cursor mapping fixtures, server lock + inbox).
`tests/e2e_clickthrough.py` needs Playwright + Chrome (run on the box; Mac headless Chrome can't save screenshots).

Phase 3a:
- `python3 -m unittest discover -s tests` (includes `tests/test_vo_events.js` through node when node is installed; it skips otherwise).
- `node tests/test_vo_events.js` (event/state-machine logic).
- `node tests/test_office_layout.js` (layout seats vs teva_sync roster).
- `python3 tests/e2e_phase3a.py OUT_DIR [--quick] [--soak-min 10]` (Playwright acceptance test; starts its own server on a free port with a temp token and inbox).

## Ambient mode (2026-10-21)

Steve asked for this ("Yes, add ambient mode with a toggle"). It is an explicit, opt-out exception to
the Phase 3a honesty rule, so the office looks alive when no bot is working.

- **Toggle:** ⚙️ Settings → "Ambient life (A)", or press **A**. Stored as `SETTINGS.ambient` in
  `localStorage['teva-hq.settings.v1']`; **on by default**. URL override: `?ambient=0` / `?ambient=1`
  (`tests/e2e_phase3a.py` loads `?ambient=0` so its "nothing moves for 60 s" checks still hold).
- **Who:** only seats whose base state is `IDLE` or `WAITING`. Offline (greyed), working, meeting,
  blocked, your-turn and the Needs Steve seat never take part.
- **What:** seated fidgets with per-seat jitter (stretch, lean back, look around, sip from a mug);
  about one stroll every 20–40 s, at most two seats away at once, to the coffee corner, lounge,
  Cyber Lounge or Fun Wing (snacks, arcade, chill pit), or over to another idle seat for a short chat
  (both face each other, the host stays put); a 5–11 s pause, then a walk back to the seat's own spot.
  Routes go through the Fun Wing glass corridor and the south doorway, not through walls. Ambient
  strolls are slower (1.3 m/s) than real walks (2.0 m/s).
- **Honesty:** ambient motion never writes to the Activity feed, never sets `walking` status and never
  changes status, stats or footer counters. A "✨ Ambient · decorative" badge sits next to the
  LIVE/DEMO badge while it runs, and the Activity ticker header says ambient motion is not listed.
  Any real event for a seat (data event, overlay, reaction, base-state change) cancels its ambient
  action at once; the seat goes back to its spot or wherever the event sends it. Real events always win.
- **Off automatically:** when Motion is not "full" (so `prefers-reduced-motion` turns it off via
  Motion = Auto), while paused or the tab is hidden, and with the opt-in modular avatar renderer.
- **Code:** scheduler `public/js/teva_ambient.js` (pure, no THREE/DOM); wiring in `public/office.html`
  (`ambientTick`, `ambientPose`, `ambientCancel`, `ambientMotion`, mug instanced pool). Tests:
  `tests/test_teva_ambient.js` via `tests/test_teva_ambient_node.py`. Debug: `VO.ambient()` in the console.
- **Cost:** draw calls unchanged when nothing sips; +1 (mug pool) while a seat sips, a few more when
  walkers come into view. Measured on the box (SwiftShader, 1600×900): main floor 155 before, 155 with
  ambient off, 155–158 with ambient on; Fun Station view 106 / 106 / 106–107. No geometry/texture growth
  over 2.5 min. The main-floor baseline was already above 150 before this change (the scene grew
  with the Oct 20 Boardroom / Cyber Lounge / Fun Wing work; Phase 3a's 67/91 predates that).
- **Rollback:** restore `public/office.html`, `docs/TEVA_HQ_NOTES.md` and `tests/e2e_phase3a.py` from their
  `.bak-ambient-2026-10-21` copies, delete `public/js/teva_ambient.js`, `tests/test_teva_ambient.js` and
  `tests/test_teva_ambient_node.py`, then restart the office. Or just press A to turn it off.
