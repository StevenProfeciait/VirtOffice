# TEVA HQ asset credits

This repository currently contains no third-party character, furniture, or animation files.
The modular renderer supports local `.glb` / `.gltf` assets through agent avatar configuration and
falls back to the original project procedural humanoid when an asset is missing.

Before adding an external asset, record:

- Provider and direct asset URL.
- Author or publisher.
- License and redistribution terms.
- Download date and any conversion tool used.
- The manifest entry and intended agent roles.

## Bundled vs user-supplied

- **Procedural humanoid fallback** — original to this project (no external model).
- **Optional GLB** — install at `public/assets/avatars/office-worker/model.glb` (see `scripts/install_cc0_assets.sh`).

## Candidates reviewed (not committed)

- [Business Office Man Character Rigged on Fab](https://www.fab.com/listings/9daf452e-e0af-45fc-b157-34a0533a78aa) — confirm purchase/redistribution licence before commit.
- [Office Executive Character on Fab](https://www.fab.com/listings/3355817d-6a02-474a-bba9-de3a40cb297e) — Mixamo-compatible; confirm licence.
- [Quaternius CC0 packs](https://quaternius.com/) — suitable for local install when using CC0 releases.
- [Kenney CC0 assets](https://kenney.nl/assets) — furniture/props for environment upgrades.

Do not add extracted proprietary game assets or assets whose license does not permit redistribution.
