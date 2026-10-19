# TEVA HQ renderer migration plan

The Python server remains the source of truth for agent state, activity, messages, and events.
Renderers consume the same engine-neutral scene contract at `/api/scene` and live agent state at
`/api/agents` plus `/events`.

## Current decision

Keep the existing Three.js office as the reference client while making the data and scene boundary
portable. This preserves the working local dashboard and avoids a destructive renderer rewrite.

## Implemented in this slice

- Added `public/assets/teva-scene-contract.json`.
- Added `GET /api/scene` to expose room dimensions, stable seats, named anchors, zones, navigation
  points, asset manifest location, and live-state endpoints.
- Declared the coordinate convention explicitly: Y-up, XZ ground plane, world-meter units.
- Added `public/babylon-pilot.html`, which renders the contract, live roster, zone overlays, camera
  focus, and SSE updates as a side-by-side experimental client.
- Loaded the bundled `office-worker-glb` into the Babylon pilot for the supervisor seat, with a
  procedural avatar fallback when the GLB loader or model is unavailable.
- Added seat markers, a direct-file warning, and live GLB alignment telemetry showing measured
  model height, seat position, and applied rotation.
- Added animation-group detection and live-state mapping. The current bundled GLB reports zero
  embedded clips, so the pilot explicitly shows a stable-pose fallback instead of inventing a
  misleading animation result.

## Next renderer milestones

1. Compare the Babylon GLB’s material, scale, seated rotation, and animation behavior with the
   existing Three.js loader.
2. Compare load time, GLB material support, animation blending, seat alignment, and camera/input
   behavior against the Three.js reference client.
3. Move only after the pilot proves the required avatar and workstation interactions.
4. Treat Unreal Engine as a separate desktop-client track if photorealistic rendering becomes the
   priority; it should consume the same API contract rather than duplicate Python logic.

The contract is intentionally small. It describes shared world facts, not renderer-specific mesh,
shader, physics, or animation implementation details.
