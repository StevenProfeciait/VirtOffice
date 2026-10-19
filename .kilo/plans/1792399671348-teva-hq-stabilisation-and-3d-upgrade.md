# TEVA HQ — Stabilisation and 3D Upgrade Plan

## Context

Repository: `VirtOffice`, branch `steve`, with uncommitted Stage 1 stabilisation changes already in progress.
The application is a stdlib-only Python server (`server.py`) plus a large browser frontend (`public/office.html`, `public/vo_events.js`, `public/office_layout.js`).
Existing validation surface: Python `unittest` (including node-wrapped frontend tests) and `compileall`.

This plan preserves the existing backend and tests while completing Stage 1 engineering fixes and then delivering the Stage 2 3D/avatar redesign incrementally.

## Current Baseline (observed)

- Branch: `steve`; uncommitted changes in `.dockerignore`, `.env.example`, `Dockerfile`, `docker-compose.yml`, `scripts/agent_registry.py`, `scripts/cursor_activity.py`, `scripts/teva_sync.py`, `server.py`.
- New untracked: `.freebuff/`, `public/vendor/`, `scripts/local_env.py`, `tests/test_bind_policy.py`.
- Tracked sensitive/obsolete files include `agents.json`, `agents.json.demo-backup-2026-10-17`, `*.bak-*`, `.freebuff/project-id`.
- `HOST` default is now `127.0.0.1`; `bind_allowed()` distinguishes loopback, wildcard-with-flag, and arbitrary addresses.
- `.env` loading exists via `scripts/local_env.py`.
- Three.js still loaded from CDN in `public/office.html`; local copy exists at `public/vendor/three.min.js` but is unused.
- `office.html` contains ~3,500 lines of inline JavaScript.
- README/package/npm-publish workflow advertise unsupported npm installation.

## Decisions

1. Keep stdlib-only Python server; no new Python dependencies.
2. Keep Three.js r128 for compatibility; serve it locally from `public/vendor/`. Add only r128-compatible example loaders (GLTFLoader, OrbitControls, DRACOLoader) locally when avatar loading needs them.
3. Split frontend into classic script files under `public/js/` (IIFE/global namespace), not a bundler, to preserve offline use and existing test style.
4. Avatar assets live under `public/assets/avatars/<agent-id>/` and are user-supplied; only placeholders ship.
5. Avatar config is additive and backward compatible: agents may include an `avatar` object; missing values use procedural fallback.
6. Stage 1 must be complete and tests green before Stage 2 visual changes.
7. Do not remove application-required fixtures (`agents.json.example`, tests fixtures).

## Stage 1 — Complete Stabilisation

### 1.1 Protect repository and establish baseline

- Run `git status`, inspect latest commits (done).
- Run `python3 -m unittest discover -s tests -v`.
- Run `python3 -m compileall server.py scripts tests`.
- Run node tests through the Python wrappers.
- Read touched files before further edits (done for server/config).

### 1.2 Finish engineering fixes

- Docker:
  - Keep `.env` optional in compose (`required: false`) (done).
  - Keep container opt-in `TEVA_ALLOW_NON_LOOPBACK=1` with `HOST=0.0.0.0`; publish host port as `127.0.0.1:${PORT}:${PORT}` (done).
  - Keep `scripts/` copied in image (done).
  - Validate with `docker compose config` when Docker is available; do not claim a live container test unless run.
- Bind policy:
  - Keep `bind_allowed()` semantics (done).
  - Ensure `main()` calls it and exits 2 on refusal (done).
  - Keep tests in `tests/test_bind_policy.py`.
- Configuration:
  - Keep `scripts/local_env.py` and server loading (done).
  - Document `.env` optional behaviour in README and `.env.example` (partly done).
  - Expose `env_file` in `/api/config` (done).
- Hardcoded paths:
  - Keep `TEVA_REPO` defaulting to repo root (done in server/scripts).
  - Ensure `cursor_activity.py` slug derivation and `CURSOR_TRANSCRIPTS` override work (done).
  - Remove any remaining personal absolute paths from tracked files.
- CI:
  - Remove `|| true` from lint and test steps.
  - Add `steve` (and current dev branches) to push trigger, or use a broad safe branch filter.
  - Add Node setup and run frontend tests via existing Python wrappers.
  - Run `python3 -m compileall server.py scripts tests`.
  - Make smoke import use the test environment (neutral env).
- Package/deployment claims:
  - Rewrite README to describe actual Python stdlib server, Docker, local launch, APIs, security, and demo mode.
  - Remove or disable `npm-publish.yml` unless package is genuinely published.
  - Update `package.json` description/scripts so it does not claim npm installation; either remove publish metadata or mark package private.
- Sensitive tracking:
  - `git rm --cached` tracked backups, `agents.json`, `agents.json.demo-backup-*`, `.freebuff/`.
  - Update `.gitignore` for `*.bak*`, `.freebuff/`, `agents.json`, demo backups, local state.
  - Preserve `agents.json.example` and test fixtures.
- Three.js:
  - Change `public/office.html` script source from CDN to `/vendor/three.min.js`.
  - Add local vendor files for any required examples loaders.
  - Remove external CDN dependency from normal page load.
- Inline JS:
  - Create `public/js/` modules and move inline code in stages:
    - `teva_data.js` (API/SSE/state, demo labelling)
    - `teva_scene.js` (renderer, camera, lights)
    - `teva_environment.js` (room/zones/props)
    - `teva_avatars.js` (placeholder + GLB loader)
    - `teva_animation.js` (state machine integration)
    - `teva_ui.js` (dashboard, filters, detail panel)
  - Keep `office.html` as shell + script includes.
  - Add node tests for module loading and pure helper functions.

### 1.3 Stage 1 validation

- `python3 -m unittest discover -s tests -v`
- `python3 -m compileall server.py scripts tests`
- Node tests pass when node is installed.
- `docker compose config` if Docker is available.
- Report changed files, tests, remaining issues, exact local launch command.

## Stage 2 — TEVA HQ 3D Upgrade

### 2.1 Establish modern environment and camera

- Replace basic materials/lighting with dark futuristic palette: charcoal base, glass, cyan/violet emissive accents, soft fog.
- Implement zones: Operations Command, Engineering Lab, QA Bay, Strategy Room, Collaboration Lounge, individual desks.
- Keep camera controls (rotate/zoom/reposition/reset) and add a visible reset control.
- Add zone labels and selection raycasting.
- Dispose geometries/materials/textures on rebuild.

### 2.2 Avatar system

- Add config fields:
  - `avatar.id`, `avatar.role`, `avatar.model` (relative GLB/glTF URL or null), `avatar.fallback` (color/shape/emoji), `avatar.workstation`, `avatar.zone`, `avatar.animations` (optional clip map).
- Extend `agent_registry`/`agents.json` schema additively; keep defaults.
- Implement `teva_avatars.js`:
  - Procedural placeholder characters with distinct silhouettes/colors/props.
  - GLTFLoader path for supplied GLB/glTF, textures, animation clips.
  - AnimationMixer when clips exist; procedural idle/state animations otherwise.
  - Graceful fallback and error state if model fails.
- No proprietary game assets; document supported formats and import steps.

### 2.3 Animation state system

- States: `IDLE`, `WORKING`, `RESEARCHING`, `TESTING`, `PLANNING`, `WAITING`, `ERROR`, `COMPLETED`.
- Map from `activity.state`/`activity.presentationState`, cursor activity, and explicit agent status.
- Use available clips; procedural fallback for missing clips.
- Move agents only on state change to relevant zone/workstation; no wandering.
- `COMPLETED` plays briefly then returns to idle.

### 2.4 Real activity integration

- Reuse `/api/agents`, `/api/agents/:id/timeline`, `/events` SSE.
- Display name, role, state, task, last activity, recent events, errors/completions, provenance.
- Label demo mode using `/api/config` mode and agent `source`/`signal`.
- Represent unknown as `unknown`/`awaiting status`, not guessed idle.
- Keep activity service module separate from animation module.

### 2.5 Control interface

- Compact TEVA HQ header with global status.
- Agent roster with avatars/state filters by role/state.
- Live activity timeline.
- Clickable agents open detail panel.
- Demo/real distinction.
- Responsive layouts for desktop window sizes.
- 3D scene remains primary; dashboard complements.

### 2.6 Performance and maintainability

- Local pinned dependencies only.
- Efficient avatar loading and caching.
- Dispose unused GPU resources.
- No secrets in frontend.
- Reuse API contracts; no unnecessary dependencies.

### 2.7 Stage 2 validation

- Existing Python suite passes.
- Frontend node tests updated/added.
- Manual browser check: scene loads, agents visible, state changes animate, missing avatar fallback works.
- Document avatar formats and import instructions (e.g. `docs/AVATAR_ASSETS.md`).

## Risks

- Splitting 3,500 lines of inline JS is high-risk; do in small commits and keep behavior tests.
- Three.js r128 APIs differ from newer versions; avoid upgrading unless required.
- GLB loading requires adding example loaders; ensure offline availability.
- Agent registry schema changes must remain backward compatible.
- Demo data must not be presented as confirmed activity.

## Open Questions

1. Should CI branch filter explicitly include `steve`, or should the repository standardize on `main`/`master` only?
2. Should npm packaging be removed entirely, or retained as metadata-only?
3. Where should user-supplied avatar assets be documented as required: `public/assets/avatars/`?

## Acceptance Criteria

- Documented local launch command works.
- New 3D HQ with zones and modern visuals.
- Multiple configurable agents display.
- Agents respond to activity-state changes.
- Registry/activity features remain functional.
- Unknown/simulated activity not presented as confirmed.
- Missing avatar assets do not break office.
- Python unittest suite passes; relevant frontend tests added/updated.
- Avatar asset formats and import instructions provided.
