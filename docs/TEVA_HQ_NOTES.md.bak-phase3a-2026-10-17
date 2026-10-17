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
