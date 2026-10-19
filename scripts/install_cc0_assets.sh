#!/usr/bin/env bash
# Install user-supplied CC0 / licensed GLB assets for TEVA HQ modular avatars.
# This script does not download assets automatically (licences vary). It prepares directories
# and prints recommended sources.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/public/assets/avatars/office-worker"
mkdir -p "$TARGET"

cat <<'EOF'
TEVA HQ — external asset install (manual)

1. Character (rigged GLB with seated + walk clips), e.g.:
   - Quaternius CC0 packs: https://quaternius.com/
   - Mixamo (Adobe): export FBX → merge clips → GLB at public/assets/avatars/office-worker/model.glb
   - Fab office characters (verify redistribution before committing)

2. Optional furniture GLBs can be added under public/assets/props/ and referenced from asset-manifest.json.

3. After copying model.glb, update docs/ASSET_CREDITS.md and set avatar.model in agents or use manifest preset.

Expected path:
EOF
echo "  $TARGET/model.glb"
if [[ -f "$TARGET/model.glb" ]]; then
  echo "Status: model.glb already present ($(wc -c < "$TARGET/model.glb") bytes)"
else
  echo "Status: model.glb not installed yet (procedural fallback remains active)"
fi
