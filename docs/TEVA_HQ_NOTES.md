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
- **Seat state machine** (priority): OFFLINE > BLOCKED > MEETING > TYPING / READING / RUNNING / DELEGATING > THINKING > YOUR_TURN > AT_DESK > IDLE. Step text shows on the seat's monitor (one shared atlas). The old 3.5 s random behaviour tick is gone.
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
- **Visual language** — bright modern glass/concrete HQ (not warm wood). ACES tone mapping, daylight sky dome, cool fog (`0xc8d0dc`). Minimal brand wall panels (“TEVA” / “HQ”) instead of emoji posters.
- **Camera gestures** — drag to orbit, Shift-drag or right-drag to pan, scroll / pinch to zoom (`touch-action: none` on the canvas). Tap (not drag) still selects seats. Esc / sidebar presets reset pitch and view; `[` / `]` switch main floor vs terrace.

## Open items
- **Seats read the inbox only after PM/Supervisor agree.** No seat (Cursor or Grok Bot) is wired to
  read `inbox/<seat>.jsonl` or write `inbox/<seat>.read` yet. Until PM/Supervisor adopt a convention
  ("read your inbox at the start of a turn, then record the line count"), inbox notes are a parking
  place for Steve, not a delivery channel.
- Phase 3 (gated on Steve + SA + a spike): Cursor CLI resume / replies into existing chats. Not built.
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
