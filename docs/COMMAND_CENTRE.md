# TEVA HQ command centre

Layers stay separate:

| Layer | Question | Status |
|-------|----------|--------|
| Visualisation | What does the office show? | `office.html` — rings, labels, timeline, instruction + local-job lifecycle |
| Orchestration | What should each agent do next? | Thin local-job queue (Ollama MVP); full tasks = later Phase 3 |
| Messaging | Was an instruction saved / handed off / acked? | Phase 2 — lifecycle + Cursor manual handoff |
| Local jobs | Did Ollama run a controlled loop? | Ollama fallback MVP — propose patch → Steve approves |
| Execution | Who performs the work? | Cursor observation + optional local Ollama; **executed is never a message status** |

## Agent registry (Phase 1)

- Module: `scripts/agent_registry.py`
- Store: `~/.teva_hq/agents_registry.json` (`TEVA_AGENTS_REGISTRY`)
- Seeded from `teva_sync.ROSTER`; imports `seat_map.json` as explicit session maps
- Exports compatibility `seat_map.json` for `cursor_activity`
- APIs: `GET /api/registry`, `POST /api/registry/map` (token + Origin)

Ambiguous Cursor chats stay unassigned. Mapping is always an explicit Steve action.

### Mapping queue (Phase 2 ops)

- Each Cursor chat carries `candidates: [seatId, …]` (title ∪ prompt ∪ doc-owner hits) and `conflict: true` when unassigned with more than one candidate.
- Unique evidence still auto-maps; candidates never auto-assign on their own.
- Team board (📋) **Mapping queue** lists unassigned chats with evidence, candidate one-click chips, and Map-to-seat → `POST /api/registry/map`. Uncertain stays unassigned until Steve confirms.

## State reconciliation (Phase 1)

- Module: `scripts/state_aggregator.py`
- Attaches `activity: { state, confidence, source, lastSeenAt, observedState, boardStatus, boardWorking }`
- Stale “active” Cursor (older than 120s) never keeps high-confidence TYPING/RUNNING
- `ERROR` (failed turn) presents as `BLOCKED` for existing poses
- `AT_DESK` = board WIP without live tools (compatibility alias)

`vo_events.baseState` prefers `activity.presentationState` when present.

## Event store (Phase 1+)

- Module: `scripts/event_store.py`
- Store: `~/.teva_hq/events/<agent_id>.jsonl`
- Provenance: `observed | agent_reported | server | user | inferred`
- Inbox save: `message_saved` (≠ delivered)
- Message lifecycle: `message_created`, `message_queued`, `delivery_started`, `delivery_confirmed`, `message_acknowledged`, `message_responded`, `delivery_failed`, `message_retry`, `message_cancelled`, `outcome_observed`
- API: `GET /api/agents/<id>/timeline`

## Messaging & delivery (Phase 2 + observed outcome)

Three channels stay distinct:

| Channel | API | Meaning |
|---------|-----|---------|
| Inbox notes / reactions | `POST /api/inbox` | Saved-only parking lot |
| Agent instructions | `/api/messages*` | Delivery lifecycle + optional Cursor `observed_outcome` |
| Local jobs | `/api/local-jobs*` | Ollama propose → Steve Approves (not a message status) |

### Lifecycle (frozen contract)

```
QUEUED → DELIVERING → DELIVERED → ACKNOWLEDGED → RESPONDED
       ↘ FAILED ⇄ QUEUED (retry, max 3) → CANCELLED
```

- Create skips unused DRAFT and starts as `QUEUED`. Illegal transitions are rejected. Same status twice is idempotent (no duplicate timeline event from the action handlers).
- **No EXECUTED status.** Delivery ≠ acknowledgment ≠ Steve-recorded response ≠ Cursor turn end.
- **`observed_outcome`** (optional, provenance only) on a message while status is `DELIVERED` or `ACKNOWLEDGED`:

  `{ chatId, endStatus, endedAt, source: "cursor", observedAt }`

  Attached when a Cursor chat mapped to that seat ends (`endStatus` present) and the newest open
  message matches `handoff.sessionId`, a registry session id, or an unbound handoff on that seat.
  Emits timeline `outcome_observed`. **Does not** advance status to RESPONDED.

Roster: **14 ROSTER seats** in `teva_sync.ROSTER` + synthetic **`needs-steve`** (15 floor agents).
Messages and inbox reject `needs-steve` as a recipient.

### Persistence

- `~/.teva_hq/messages/<agent_id>.jsonl` + `messages_index.jsonl`
- Env: `TEVA_MESSAGES_DIR`, `TEVA_MESSAGES_INDEX`
- Module: `scripts/message_store.py`

### Adapters (`scripts/delivery_adapters.py`)

| Adapter | When | `submit` result |
|---------|------|-----------------|
| `CursorDeeplinkAdapter` | `runtime == cursor` / `CURSOR_SEATS` | `DELIVERING` + `handoff.url` (never claims DELIVERED) |
| `UnsupportedAdapter` | grok / none | `FAILED` + `runtime_unsupported` |

Cursor path: client opens handoff URL, then `POST .../handoff-opened` → `DELIVERED` with provenance `user`. Ack/respond are Steve-authorised only. Registry session IDs annotate handoff metadata only.

Capabilities returned to the client: `programmatic_send`, `deeplink_handoff`, `ack`, `respond`, `user_confirm_delivered`.

### API (all POSTs: Origin + `X-TEVA-Token`)

| Method | Path | Behaviour |
|--------|------|-----------|
| POST | `/api/messages` | Create QUEUED, run adapter, emit events |
| GET | `/api/messages?agent=&status=&limit=` | List newest-first |
| GET | `/api/messages/<id>` | Detail |
| POST | `/api/messages/<id>/handoff-opened` | DELIVERING→DELIVERED (cursor) |
| POST | `/api/messages/<id>/acknowledge` | →ACKNOWLEDGED |
| POST | `/api/messages/<id>/respond` | body `{text}` →RESPONDED |
| POST | `/api/messages/<id>/retry` | FAILED→QUEUED + resubmit if attempts &lt; 3 |
| POST | `/api/messages/<id>/cancel` | Cancel from open states |

SSE: `{type:"message", message}` on status change and when `observed_outcome` is attached.

### Attention / blockers

- N-key order: Needs Steve → board-blocked (including when pose is OFFLINE) → FAILED open instructions → your-turn.
- `activity.boardBlocked` is true when the board marks the seat blocked, even if `presentationState` is OFFLINE.

### How to add a runtime

1. Implement `DeliveryAdapter` with truthful `capabilities()` and `submit()` (no invented send APIs).
2. Branch in `pick_adapter()` on registry `runtime`.
3. Wire any new confirmation endpoints only if the runtime can prove delivery.
4. Extend tests for lock + adapter behaviour.

### Office composer

- **Save to inbox** — notes/reactions (saved only)
- **Queue instruction** — lifecycle message (Cursor path for `le2`)
- **Run on Ollama** — local job (pilot `le2` when healthy); not a message DELIVERED claim
- **Open in Cursor / Copy for Grok** — standalone handoff without a message record
- Cursor: **Open handoff** → handoff-opened; **Mark acknowledged** / **Record response** when allowed
- Unsupported: show adapter error; no fake success

## Local Ollama fallback (MVP)

Cursor remains the primary coding path. Ollama is a **manual** local fallback for pilot seat `le2`. No Cursor session inheritance; no auto-detection of Cursor usage limits.

### Provider

- Module: `scripts/ollama_provider.py`
- Config: `~/.teva_hq/ollama_config.json` (`TEVA_OLLAMA_CONFIG`)
- URL: `TEVA_OLLAMA_URL` default `http://127.0.0.1:11434` (loopback only unless `TEVA_OLLAMA_ALLOW_REMOTE=1`)
- Discovery via `/api/tags` — never invents model names
- APIs: `GET /api/ollama/health`, `GET/POST /api/ollama/config`

### Local jobs

- Modules: `scripts/local_job_store.py`, `scripts/local_job_worker.py`, `scripts/local_agent_tools.py`
- Store: `~/.teva_hq/local_jobs/`
- Lifecycle: `QUEUED → RUNNING → AWAITING_APPROVAL → APPLIED | REJECTED` (or `FAILED` / `CANCELLED`)
- Tools (allowlisted roots only): `list_dir`, `read_file`, `search_code`, `propose_edit` (no disk write), `run_tests` (disabled unless `TEVA_LOCAL_ALLOW_TESTS=1`)
- Worker never auto-writes files; **Approve patch** applies under roots

| Method | Path | Behaviour |
|--------|------|-----------|
| POST | `/api/local-jobs` | Create QUEUED (le2 + Ollama healthy) |
| GET | `/api/local-jobs?agent=` | List |
| GET | `/api/local-jobs/<id>` | Detail |
| POST | `/api/local-jobs/<id>/cancel` | Cancel |
| POST | `/api/local-jobs/<id>/approve` | Apply proposed patch |
| POST | `/api/local-jobs/<id>/reject` | Reject without write |

SSE: `{type:"local_job", job}`. Timeline: `local_job_*` events.

### How to add a seat/model

1. Install model (`ollama pull …`); confirm on `GET /api/ollama/health`.
2. `POST /api/ollama/config` with `seat_models.<seat>.model` and add seat to `pilot_seats` (code still gates MVP to `le2` until generalized).
3. Ensure `workspace_roots` cover the repo the agent may touch.

### Follow-ons (not this MVP)

- Full task engine + Needs Steve approval centre
- Multi-seat local coding + policy router
- Richer office dual-pose “LE2 Local” from real events only

## What this does **not** claim

- Inbox save ≠ delivered or acknowledged
- Handoff DELIVERED ≠ agent executed the work
- `observed_outcome` ≠ RESPONDED ≠ work applied
- Local job APPLIED ≠ Cursor executed the same task
- Idle runtime ≠ task completed
- Animations ≠ productivity
- No programmatic Cursor send API
- No automatic Cursor usage-limit detection
- No resuming Cursor agent sessions inside Ollama

## Next phases

2. Unassigned Cursor chat mapping queue (evidence + one-click confirm)  
3. Tasks + Needs Steve approval centre (generalize local jobs)  
4. Multi-agent workflows  
5. Visual polish / renderer choice (after ops are dependable)

## Verification (manual) — Phase 1 acceptance

| Check | Expect |
|-------|--------|
| Save note | Saved only; `message_saved` on timeline |
| Queue Cursor instruction (e.g. le2) | `message_id` + DELIVERING + handoff URL |
| Unsupported runtime | FAILED + clear error; Retry / Cancel visible |
| Open handoff | DELIVERED only after handoff-opened |
| Cursor turn ends on mapped chat | Observed chip success/fail; status still DELIVERED/ACKNOWLEDGED; timeline `outcome_observed` |
| Record response | RESPONDED; Observed ≠ Responded in UI copy |
| Force delivery failure | FAILED in panel + Attention; Retry / Cancel work; no fake success |
| Board blocked + offline signal | Pose may be OFFLINE; blocker chip + N Attention still list the seat |
| Ollama health | Office chip up/down; models from discovery |
| Run on Ollama (le2) | Job QUEUED→…→AWAITING_APPROVAL; no files written yet |
| Approve / Reject | Files change only on Approve |
| Restart server | Last job/message status + observed_outcome preserved on disk |
