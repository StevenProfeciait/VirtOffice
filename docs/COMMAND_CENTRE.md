# TEVA HQ command centre

Layers stay separate:

| Layer | Question | Status |
|-------|----------|--------|
| Visualisation | What does the office show? | `office.html` — rings, labels, timeline, instruction lifecycle |
| Orchestration | What should each agent do next? | Not yet (tasks = Phase 3) |
| Messaging | Was an instruction saved / handed off / acked? | Phase 2 — lifecycle + Cursor manual handoff |
| Execution | Who performs the work? | Cursor observation only; **executed is never a message status** |

## Agent registry (Phase 1)

- Module: `scripts/agent_registry.py`
- Store: `~/.teva_hq/agents_registry.json` (`TEVA_AGENTS_REGISTRY`)
- Seeded from `teva_sync.ROSTER`; imports `seat_map.json` as explicit session maps
- Exports compatibility `seat_map.json` for `cursor_activity`
- APIs: `GET /api/registry`, `POST /api/registry/map` (token + Origin)

Ambiguous Cursor chats stay unassigned. Mapping is always an explicit Steve action.

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
- Message lifecycle (Phase 2): `message_created`, `message_queued`, `delivery_started`, `delivery_confirmed`, `message_acknowledged`, `message_responded`, `delivery_failed`, `message_retry`, `message_cancelled`
- API: `GET /api/agents/<id>/timeline`

## Messaging & delivery (Phase 2)

Two channels stay distinct:

| Channel | API | Meaning |
|---------|-----|---------|
| Inbox notes / reactions | `POST /api/inbox` | Saved-only parking lot; unchanged Phase 1 behaviour |
| Agent instructions | `/api/messages*` | Lifecycle states + delivery adapter |

### Lifecycle

```
QUEUED → DELIVERING → DELIVERED → ACKNOWLEDGED → RESPONDED
       ↘ FAILED ⇄ QUEUED (retry, max 3) → CANCELLED
```

Create skips unused DRAFT and starts as `QUEUED`. Illegal transitions are rejected. Same status twice is idempotent (no duplicate timeline event from the action handlers).

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

SSE: `{type:"message", message}` on status change.

### How to add a runtime

1. Implement `DeliveryAdapter` with truthful `capabilities()` and `submit()` (no invented send APIs).
2. Branch in `pick_adapter()` on registry `runtime`.
3. Wire any new confirmation endpoints only if the runtime can prove delivery.
4. Extend tests for lock + adapter behaviour.

### Office composer

- **Save to inbox** — notes/reactions (saved only)
- **Queue instruction** — lifecycle message
- **Open in Cursor / Copy for Grok** — standalone handoff without a message record
- Cursor: **Open handoff** → handoff-opened; **Mark acknowledged** / **Record response** when allowed
- Unsupported: show adapter error; no fake success

## What this does **not** claim

- Inbox save ≠ delivered or acknowledged
- Handoff DELIVERED ≠ agent executed the work
- Idle runtime ≠ task completed
- Animations ≠ productivity
- No programmatic Cursor send API

## Next phases

3. Tasks + Needs Steve approval centre  
4. Multi-agent workflows  
5. Analytics / health from real task+event records  

## Verification (manual)

| Check | Expect |
|-------|--------|
| Save note | Saved only; `message_saved` on timeline |
| Queue Cursor instruction | `message_id` + DELIVERING + handoff URL |
| Unsupported runtime | FAILED + clear error |
| Open handoff | DELIVERED only after handoff-opened |
| Retry / cancel | Tracked; timeline events |
| Ack / respond | Timeline + status chips |
| Restart server | Last confirmed status preserved on disk |
