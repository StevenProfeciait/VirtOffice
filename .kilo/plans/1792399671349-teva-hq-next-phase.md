# TEVA HQ — Next Phase Implementation Plan

## Overview
Complete the modularization of the 3D office, integrate avatars into the existing instanced rig system, add accessibility/responsive UI, finalize dark theme, and harden for local-only operation. Build on current Stage 2 foundation (modules + DataBridge).

## Phase 3A — Module Integration & Scene Wiring
- [ ] Extend TevaScene/TevaEnv to build the indoor room, wing, exterior using existing LAYOUT/TEVA_* constants.
- [ ] Wire TevaAvatarManager into the instanced rig lifecycle (reconcile with existing `buildRig`/`syncInstances`) — fallback capsules for avatars without GLB.
- [ ] Integrate TevaDataBridge into inline app: call start() on scene init and update AvatarManager on agent changes.
- [ ] Map animation states to existing part poses via `VOE.baseState` + `teva_animation_state.js`.
- [ ] Keep behavior identical to current inline; add feature flag `TEVA_USE_MODULAR=true` to toggle safely.

## Phase 3B — Avatar System Completion
- [ ] Add support for GLB model positioning (scale/offset) per agent workstation/zone.
- [ ] Animation clip discovery: if map missing, fallback to clip names matching state (case-insensitive).
- [ ] Procedural idle/poses when clips absent; dispose GLTF geometries/materials on removal.
- [ ] Add `public/assets/avatars/README.md` with example entries and validation.
- [ ] Tests: state mapping, clip resolution, fallback/error handling.

## Phase 3C — UI/UX Enhancements
- [ ] Add "Reset Camera" button (uses existing `resetCamera()`).
- [ ] Agent roster: show avatar badge (emoji/fallback color), state from `computeDisplay()`, provenance label.
- [ ] Timeline panel uses DataService; demo/real indicator.
- [ ] Dark theme polish: zone labels, glass panels, emissive accents, readable text.
- [ ] Responsive: mobile viewport support (safe area, smaller roster/timeline).

## Phase 3D — Performance & Quality
- [ ] GPU resource disposal verified (instanced meshes + GLTF). 
- [ ] No secrets in frontend; keep local-only policy.
- [ ] Update README with avatar usage, new launch notes.
- [ ] Add node tests for TevaScene/TevaEnv/TevaUIH logic; Python tests pass.
- [ ] Lint/compileall and full test suite.

## Acceptance
- Existing 93 tests still pass; new tests added.
- Application loads at http://127.0.0.1:9502 with no console errors in demo mode.
- Unknown/simulated activity labelled correctly.
- Missing avatar assets don't break office.

## Risks
- Conflicts between modular manager and legacy instanced rig — use feature flag and non-destructive integration.
- GLB positioning may need per-model offsets. Use config `avatar.offset`, `avatar.scale`.
- Large inline refactor incrementally.

## Implementation Order
1. Phase 3A (wiring) — minimal changes, behind flag.
2. Phase 3B (avatars) — extend manager/config.
3. Phase 3C (UI) — non-invasive DOM additions.
4. Phase 3D (tests/hardening).
