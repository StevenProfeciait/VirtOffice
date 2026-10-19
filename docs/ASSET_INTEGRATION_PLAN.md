# TEVA HQ expansion and asset integration plan

The office now uses a hybrid layout: the TEVA floor plan and agent anchors remain owned by
VirtOffice, while workstations, avatars, materials, and room modules can be replaced by licensed
GLB assets through the manifest.

## Implemented foundation

- Expanded the main room to 72 × 54 world units.
- Added Innovation Lab, Simulation Bay, Briefing Room, Command Deck, and Cyber Lounge zones.
- Added six unassigned cyberpunk expansion stations for future agents.
- Registered the workstation and first room-module contracts with procedural fallbacks in
  `public/assets/asset-manifest.json`.
- Added a cached, manifest-driven GLTF room-module loader. A room model is cloned onto its
  named TEVA anchor only after it loads successfully; otherwise the procedural pod stays visible.
- Kept every existing agent seat and navigation anchor stable.
- Preserved procedural fallbacks when an external asset is unavailable.

## Next integration stages

1. Add the curated Quaternius room-module file to one manifest entry and validate its anchor,
   scale, and collision envelope. The runtime replacement hook is now in place.
2. Add optional Poly Haven materials without making textures mandatory at runtime.
3. Add authored seated, typing, walking, and talking clips to the shared avatar profile.
4. Replace the room pods selectively with licensed environment modules while keeping the TEVA
   navigation and agent coordinate system.

Every bundled asset must record its provider, source URL, author, licence, download date, hash,
and any conversion step in `docs/ASSET_CREDITS.md`.
