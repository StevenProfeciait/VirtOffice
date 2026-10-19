# TEVA HQ — Next Phase Implementation Plan

## Overview
Complete the modularization of the 3D office, integrate avatars into the existing instanced rig system, add accessibility/responsive UI, finalize dark theme, and harden for local-only operation. Build on current Stage 2 foundation (modules + DataBridge).

## Phase 3A — Module Integration & Scene Wiring
- [x] Extend TevaScene/TevaEnv to build the indoor room, wing, exterior using existing LAYOUT/TEVA_* constants.
- [x] Wire TevaAvatarManager into the inline app behind an opt-in modular flag; preserve the existing renderer by default.
- [x] Integrate TevaDataBridge into inline app: start on scene init and reconcile AvatarManager on agent changes.
- [x] Map live activity states to procedural fallback poses and GLB animation clips.
- [x] Keep behavior identical to current inline; use `?modular=1` / `localStorage.teva_modular=1` to toggle safely.

## Phase 3B — Avatar System Completion
- [x] Add support for GLB model positioning (scale/offset) per agent workstation/zone.
- [x] Animation clip discovery: if map missing, fallback to clip names matching state (case-insensitive).
- [x] Procedural idle/poses when clips absent; dispose GLTF geometries/materials on removal.
- [x] Add `public/assets/avatars/README.md` with example entries and validation.
- [x] Tests: state mapping, clip resolution, fallback/error handling.

## Phase 3C — UI/UX Enhancements
- [x] Add "Reset Camera" button (uses existing `resetCamera()`).
- [x] Agent roster: show avatar badge (emoji/fallback color), state from `computeDisplay()`, provenance label.
- [x] Timeline panel uses DataService; demo/real indicator.
- [x] Dark theme polish: zone labels, glass panels, emissive accents, readable text.
- [x] Responsive: mobile viewport support (safe area, smaller roster/timeline).

## Phase 3D — Performance & Quality
- [x] GPU resource disposal implemented for modular GLTF/workstation objects.
- [x] No secrets in frontend; keep local-only policy.
- [x] Update README with avatar usage, new launch notes.
- [x] Add node tests for TevaScene/TevaEnv/TevaUIH logic; Python sources compile.
- [x] Compileall and full test suite; repository has no standalone lint command configured.

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
