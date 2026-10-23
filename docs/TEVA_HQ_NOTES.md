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
- Seat id must be one of the **14 ROSTER ids** (regex + allowlist, so no path traversal).
  The floor also has a synthetic **`needs-steve`** desk (15 agents visible); inbox notes are
  roster-only — Needs Steve is not an inbox recipient.
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
- **`public/office_layout.js`** — single source for room size (52×36 main), **TEVA seat coordinates**, zone labels, furniture anchors, and camera presets. Keep seat ids aligned with `scripts/teva_sync.py` **14 ROSTER seats + synthetic `needs-steve` (15 floor agents)**.
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

## Phase 1 ops: observed outcome + blocker cue (2026-10-23)

Operational reliability before more visuals. Channels stay distinct (inbox / messages / local jobs).

- **`observed_outcome`** on messages in `DELIVERED` or `ACKNOWLEDGED`: when a Cursor chat mapped to that
  seat ends, the server attaches `{ chatId, endStatus, endedAt, source: "cursor" }` and emits timeline
  `outcome_observed`. Status does **not** become RESPONDED (and never EXECUTED). Steve still records the response.
- **Attention (N):** Needs Steve → board-blocked (including OFFLINE+blocked) → FAILED open instructions → your-turn.
  Pose may stay OFFLINE when `signal` is false; the blocker chip and Attention still surface the board flag
  via `activity.boardBlocked`.
- **UI:** delivery stepper + separate Observed chip; honesty copy (Observed ≠ Responded ≠ work applied).
- Helpers: `public/js/teva_messages_ui.js`. Acceptance checklist in [`docs/COMMAND_CENTRE.md`](COMMAND_CENTRE.md).

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

## UI style toggle (2026-10-22)

Steve asked for a way to switch between the two office looks in the UI.

- **Looks:** ⬜ **Classic** (bright glass/concrete office, still the default) and 🌆 **Cyberpunk** (the
  "modular"/futuristic office: dark floor, cyan lighting, neon workstations from `js/teva_environment.js`,
  modular avatars).
- **Controls:** the badge in the top bar next to DEMO / ✨ Ambient shows the current look (`⬜ Classic` or
  `🌆 Cyberpunk`); click it to switch. Same option in ⚙️ Settings ("Office look: Cyberpunk (U)" switch), and
  the **U** key (ignored while typing in an input/textarea/select or with Cmd/Ctrl/Alt).
- **How it switches:** the look is chosen while the scene is built, so switching sets or removes
  `localStorage.teva_modular`, strips any `?modular=` from the URL (other params such as `?ambient=` are kept)
  and reloads. The choice is per browser and per address (`localhost` and `127.0.0.1` remember separately).
- **Precedence per load** (pure helper `public/js/teva_ui_style.js`, used by `modularAvatarsEnabled()`):
  `?modular=1` forces Cyberpunk, `?modular=0` now really forces Classic (before only `1` was checked), then
  `localStorage.teva_modular === '1'`, then the Classic default. Resolved once per page load.
- **Note:** ambient life stays paused in Cyberpunk (it already skipped modular avatars, see Ambient mode).
- **Tests:** `tests/test_teva_ui_style.js` + `tests/test_teva_ui_style_node.py` (11 checks).
- **Rollback:** restore `public/office.html` and `docs/TEVA_HQ_NOTES.md` from their `.bak-uitoggle-2026-10-22`
  copies and delete `public/js/teva_ui_style.js`, `tests/test_teva_ui_style.js` and
  `tests/test_teva_ui_style_node.py`. No server restart needed (static files).

## Cyberpunk default + ambient in Cyberpunk (2026-10-22)

Steve: "Make Cyberpunk the default and add ambient to it".

- **New default:** 🌆 Cyberpunk, unless `?modular=0` or `localStorage.teva_modular === '0'`. A stored `'1'`
  (or `?modular=1`) also means Cyberpunk; any other stored value falls back to the Cyberpunk default.
  Switching to Classic now **stores `'0'`** instead of removing the key, so a Classic choice survives the new
  default. (Browsers that never touched the switch, or that had Classic only by default, now open in Cyberpunk.)
  `DEFAULT_MODULAR = true` in `public/js/teva_ui_style.js`; the inline no-helper fallback in `office.html`
  matches. The UI-style note above ("Classic, still the default" / "ambient stays paused") is superseded.
- **Why ambient was Classic-only:** `ambientOn()` had `!modularAvatarsEnabled()`, and ambient only ever moved
  and posed the legacy instanced avatars, which are hidden in Cyberpunk; the modular avatars only got desk /
  idle-spot moves from `syncModularIdleDestinations()`.
- **How it works now:** the same `TevaAmbient` scheduler, honesty rules, cancels and toggle (A / Settings /
  `?ambient=`) run in both looks. In Cyberpunk, `ambientModularSync()` mirrors each ambient leg onto the modular
  avatar with one `TevaAvatarManager.moveAgent` per leg along the scheduler's own route
  (`TevaAmbient.modularRoute`), at stroll pace (1.3 m/s); while a leg runs, `syncModularIdleDestinations()` leaves
  that seat alone, and a real event sends it back at once. `ambientModularPose()` adds small fidget / chat poses
  (`TevaAmbient.modularPose`) every frame after the mixer — bone deltas on rigged GLB avatars, arm / body deltas on
  the procedural fallback avatars — and removes them completely when they end; ambient walkers face where they
  walk. It never writes to the feed, statuses or counters (the bottom bar still shows 0 WALKING during a stroll).
  Diagnostics: `VO.ambient().modular`.
- **Tests:** `tests/test_teva_ui_style.js` (11 checks, updated for the new default and the stored `'0'`) and
  `tests/test_teva_ambient.js` (+4 checks: modularRoute, modularPose, office.html wiring and honesty).
- **Rollback:** restore `public/office.html`, `public/js/teva_ui_style.js`, `public/js/teva_ambient.js`,
  `tests/test_teva_ui_style.js`, `tests/test_teva_ambient.js` and `docs/TEVA_HQ_NOTES.md` from their
  `.bak-cyberdefault-2026-10-22` copies (e.g. `for f in $(find . -name '*.bak-cyberdefault-2026-10-22'); do cp -p
  "$f" "${f%.bak-cyberdefault-2026-10-22}"; done`), then hard-reload the page (Cmd+Shift+R). Static files only, so
  no server restart is needed. Quicker partial rollbacks: `?modular=0` / press U for Classic; press A to turn
  ambient off.

## Phase 2: Babylon look, natural walking, real-event zones (2026-10-22)

Research summary, sources and the full zone design are in `docs/TEVA_HQ_ZONES_RESEARCH.md`.

**Babylon look.** The existing renderer `public/babylon-pilot.html` is wired in as a third look:
Settings → "Office look" lists Classic / Cyberpunk / 🧪 Babylon (pilot) ↗ (`TevaUiStyle.LOOKS`, `chooseLook()`).
Babylon opens as its own page and has a "← Back to TEVA HQ" link. It does not overwrite `teva_modular`.
Babylon.js loads from a CDN, so it needs internet access. The pilot does not have the walking or zone changes below.

**Walking.** `public/js/teva_motion.js` (`TevaMotion`, a pure module) is used by Cyberpunk avatars
(`teva_avatar_manager.js` `_stepMotion`) and by the Classic legacy walkers in `office.html`.
- Walk speed is 1.35 m/s, ambient strolls 1.0 m/s, capped at 1.6 m/s.
- The speed profile is a trapezoid (ease in and out), so travel time now follows distance. The old fixed 2.5 s walk is gone.
- The walk cycle and the clip timeScale are driven by distance (stride 1.25 m), so feet don't slide.
- Avatars turn to face their target before a big heading change.
- On arrival they sit at seats, or stand and face the target in zones.
If `TevaMotion` is missing, the manager falls back to the old behaviour.

**Zones.** `public/js/teva_zones.js` (`TevaZones`) turns real feed events into short zone sessions:
- handoff → boardroom "Hand-off review" (sender + receiver)
- BA board-round doc → boardroom
- SA review/gate doc or task → boardroom
- research seats READING → Research Lab
- a real turn or task completion → a 4 s "✓ Turn done" chip at the desk

A session ends 25 s after everyone has arrived, or as soon as a member starts real work. Working, blocked,
offline, meeting and Needs Steve seats are never pulled into a zone. A zone move is only annotated on the
real event's own feed line. Fun Wing / lounge use stays ambient-only and is never written to the feed.
Debug: `VO.zones()` in the console.

**Tests.** New: `tests/test_teva_motion.js` (13 checks), `tests/test_teva_zones.js` (8 checks), and their
unittest wrappers `test_teva_motion_node.py` / `test_teva_zones_node.py`. `tests/test_teva_ui_style.js` gained
a Babylon look check.

**Rollback phase 2 only (keeps the Cyberpunk default + ambient from phase 1):**
```
cd ~/Documents/GitHub/VirtOffice
for f in public/office.html public/js/teva_avatar_manager.js public/js/teva_ui_style.js \
         public/babylon-pilot.html tests/test_teva_ui_style.js docs/TEVA_HQ_NOTES.md; do
  cp -p "$f.bak-phase2-2026-10-22" "$f"; done
rm public/js/teva_motion.js public/js/teva_zones.js tests/test_teva_motion.js tests/test_teva_zones.js \
   tests/test_teva_motion_node.py tests/test_teva_zones_node.py docs/TEVA_HQ_ZONES_RESEARCH.md
```
Then restart the office and hard-reload (Cmd+Shift+R). To roll back both phases, run this first and then the phase 1 rollback above.

## Seat fix: one reservation system for every place (2026-10-22)

**Symptom (Steve):** some avatars sat on the same seat on top of each other (for example a green one and a red one
mixed together) while other spaces stayed free.

**Root cause:**
- `idleSpotForAgent()` in `office.html` gave every IDLE seat the Fun Wing pad `idleSpots[hash(id) % 6]`, which is
  used by both looks (Classic `seatTarget`, Cyberpunk `modularRestDest`). 14 seats share 6 pads, and the hash put
  pm + le + product on one pad, le2 (green) + debugger (red) + erp-research on another, and sa (red) + ui-docs, ba + grok
  and research-mgr + ai-research + competitor on others.
- Nothing checked whether a place was already taken. The same was true of ambient trips (a random point near a destination),
  ambient chat spots, hand-off and meeting standing points, and the Research Lab (`index % 3`).
- Box check with every seat forced idle in Cyberpunk: 11 pairs of avatars stood within 0.6 m of each other (most at
  0.00 m) before the fix, and none after.

**Fix:**
- `public/js/teva_spots.js` (`TevaSpots`, pure) is a single registry of every reservable place, built from the real
  floor plan and the props that are actually drawn there:
  - Fun Wing: sofa and beanbag pads, arcade stools and the 5 arcade cabinets, ping pong ends, foosball sides, vending
    machines and snack bar stools.
  - Main floor: coffee corner, lounge sofas, Cyber Lounge.
  - Terrace: lounge, huddle and coffee cart.
  - Boardroom chairs (15) and Research Lab chairs (3).
- Each spot holds one avatar at a time. Ad-hoc points (hand-off, backlog meeting slot, ambient chat) keep 0.9 m from
  every other held place and from desk chairs.
- Every seat has named slots: `home` (idle place), `away` (ambient leg), `zone` (boardroom or lab chair) and `point`
  (hand-off or meeting). If the target is taken, the seat gets the nearest free spot. Fun Wing pads come first, then
  the play stations, then the rest. Idle seats keep their place, so nobody gets reshuffled.
- Ambient trips spread out: they pick the least-used place within reach, then its nearest free spot.
- Reservations are released when the avatar leaves:
  - ambient: on walking back, cancel or reset;
  - zones: when the session ends or the seat starts real work;
  - `spotsSync()` (run before every target update): when a seat stops being idle, leaves for a zone, hand-off or
    meeting, or drops out of the roster.
- Working, blocked, error, offline, meeting and your-turn (waiting on Steve) seats never hold an idle, ambient or
  zone place, and are never moved by it. `ERROR` was added to the zone never-move list.
- Wiring:
  - `office.html`: `spotsInit` / `SPOTS`, `idleSpotForAgent` (registry, with the old hash only as a no-registry
    fallback), `spotPoint`, `spotsSync`, `VO.spots()`.
  - `teva_ambient.js`: `opts.spots`.
  - `teva_zones.js`: `opts.spots`. Its own registry is used when none is passed.
- Tests: `tests/test_teva_spots.js` (10 checks, plus the `test_teva_spots_node.py` wrapper). The checks cover:
  - the old hash collision;
  - catalog spacing;
  - one holder per spot, nearest free spot, and release;
  - all 14 idle at once;
  - stability;
  - ad-hoc points;
  - spread;
  - zone chairs;
  - a 3000-step stress run with 14 seats in which idle, ambient (6 walkers), hand-off sessions, the lab and random
    state changes all happen at once, asserting after every step that no two avatars share a spot or stand within 0.9 m;
  - the `office.html` wiring.
- Debug: `VO.spots()` in the console (`conflicts` is always `[]`).

## Part 2: walking and interactions (2026-10-22)

**Walking:**
- `public/js/teva_nav.js` (`TevaNav`, pure) routes avatars around furniture in both looks. It builds a 0.5 m grid from
  the real floor plan:
  - boardroom and round tables, dividers, the kitchen counter and fridge, lounge sofas;
  - the Fun Wing arcade cabinets, ping pong, foosball, vending machines, snack cart and chill-pit sofa;
  - the terrace sofa, huddle table, coffee cart and hot desks;
  - the desks the active look draws (legacy desks in Classic, modular workstations in Cyberpunk).
- Walls are solid except the real openings: the Fun Wing corridor and the 7 m terrace doorway, which has the coffee
  cart in its middle. Routes use A* plus string pulling.
  - Classic walkers now follow the waypoints instead of walking a straight line.
  - Cyberpunk moves and ambient legs chain the same routes.
  - Falls back to the old door route if no path is found.
- Cyberpunk capsule avatars (`teva_avatar_manager.js` `proceduralPose`):
  - Arms and legs now swing about the shoulder, hip and knee (they used to rotate about the middle of the limb).
  - Arms swing opposite the legs, and the trailing knee bends.
  - The body bobs, leans into the walk and shifts its weight side to side. All of this scales with the speed
    profile, so starts and stops ease in and out.
  - Turn-to-face and smoothing come from the existing `TevaMotion`.
- Rigged walk clip (`teva_avatars.js`): 4-phase cycle (contact, passing, contact, passing) with knee bend, elbow bend
  and chest counter-rotation.

**Interactions:** each reserved spot carries an activity, and the avatar does it once it arrives.
- Activities by place:
  - sofa / beanbag → lounge (sit back);
  - arcade → play (hands on the controls);
  - ping pong (swing, side-step) and foosball (rods);
  - coffee, snacks and coffee cart → coffee (sips, with a mug);
  - stool → watch;
  - terrace huddle and ambient chats → talk.
- Boardroom: avatars sit on the real chairs, everyone faces the speaker (the seat whose real event opened the session,
  e.g. the hand-off giver), and the speaker gestures.
- Research Lab: avatars sit on the lab chairs and read from a tablet.
- Desks: Cyberpunk has stand-up and sit-down transitions, typing hands that move, and the head down at the screen.
- Props:
  - Cyberpunk: a mug and a tablet are added to every avatar, shown only during sips, coffee spots and reading.
  - Classic: reuses its instanced mug and folder parts.
- Task done: the "✓ Turn done" chip stays 3 s, the avatar jumps twice with both fists up and waving, and a small
  confetti burst fires (full motion only). In Cyberpunk the burst comes from where the modular avatar actually is.
- Classic sits at sofas, stools and boardroom and lab chairs.
- Everything is still driven by real events or the base state. Ambient stays labelled ambient and never touches the
  feed, and every place goes through the seat reservations.
- Tests:
  - `tests/test_teva_nav.js` (6 checks): furniture and walls are solid, openings are open, desk → Fun Wing routes cross
    no furniture and pass through the opening, the straight line through the boardroom table goes around instead, 60
    random routes, wiring.
  - `tests/test_teva_interactions.js` (8 checks): arms opposite legs, shoulder and hip pivots, bob, lean, sway,
    speed-scaled stride, typing, reading, coffee, celebrate, speaker gestures, play, manager sit / face / activity on
    arrival, rigged clip keys, office.html wiring.
  - Wrappers: `test_teva_nav_node.py`, `test_teva_interactions_node.py`.

**Rollback (seat fix + part 2 together):**
```
cd ~/Documents/GitHub/VirtOffice
for f in public/office.html public/js/teva_ambient.js public/js/teva_zones.js public/js/teva_avatar_manager.js \
         public/js/teva_avatars.js docs/TEVA_HQ_NOTES.md; do
  cp -p "$f.bak-seatfix-2026-10-22" "$f"; done
rm public/js/teva_spots.js public/js/teva_nav.js tests/test_teva_spots.js tests/test_teva_spots_node.py \
   tests/test_teva_nav.js tests/test_teva_nav_node.py tests/test_teva_interactions.js tests/test_teva_interactions_node.py
```
Then restart the office and hard-reload (Cmd+Shift+R). This returns to the phase 2 state (zones, Babylon look, natural
pace).
