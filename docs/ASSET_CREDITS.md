# TEVA HQ asset credits

This repository contains one derived CC0 character GLB and no third-party furniture or animation files.
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
- **Office worker GLB** — `public/assets/avatars/office-worker/model.glb`, SHA-256
  `d6f3b64cab629f6ddca9ba063811aeffd3663a8a4e49ade47cd9505dc2bbd70f`.
  Prepared character source: [programasweights/avatar ASSETS.md](https://github.com/programasweights/avatar/blob/main/ASSETS.md).
  The source documents the Superhero Male model as derived from Quaternius Universal Base Characters,
  CC0 1.0 Universal, with the original license preserved at `public/assets/avatars/office-worker/QUATERNIUS-LICENSE.txt`.
  The GLB contains the rig but no embedded animation clips; TEVA HQ generates compatible seated,
  working, and transition clips at load time.

## Candidates reviewed (not committed)

- [Business Office Man Character Rigged on Fab](https://www.fab.com/listings/9daf452e-e0af-45fc-b157-34a0533a78aa) — confirm purchase/redistribution licence before commit.
- [Office Executive Character on Fab](https://www.fab.com/listings/3355817d-6a02-474a-bba9-de3a40cb297e) — Mixamo-compatible; confirm licence.
- [Quaternius Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) / [download page](https://quaternius.itch.io/universal-base-characters) — CC0 candidate for the rigged character prototype; not installed.
- [Quaternius Universal Animation Library](https://quaternius.itch.io/universal-animation-library) — CC0 candidate for seated, locomotion, and working clips; not installed.
- [Kenney CC0 assets](https://kenney.nl/assets) — furniture/props for environment upgrades.
- [Quaternius Modular Sci-Fi MegaKit](https://quaternius.com/packs/modularscifimegakit.html) — CC0
  environment-module source reviewed for the room replacement hook. No archive was bundled in this
  slice because the local certificate chain prevented a verified automated download; the manifest
  keeps the procedural pod active until a curated module file is added and hashed here.

Do not add extracted proprietary game assets or assets whose license does not permit redistribution.
