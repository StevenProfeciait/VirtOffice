#!/usr/bin/env bash
# Install user-supplied CC0 / licensed GLB assets for TEVA HQ modular avatars.
# This script never downloads assets. It accepts a local .glb file, directory, or
# downloaded zip and copies one verified model into the documented target path.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/public/assets/avatars/office-worker"
mkdir -p "$TARGET"

SOURCE=""
EXPECTED_SHA256=""
usage() {
  cat <<'EOF'
Usage: scripts/install_cc0_assets.sh [--source PATH] [--sha256 HASH]

--source PATH    Local .glb file, directory, or downloaded zip archive.
--sha256 HASH   Optional SHA-256 for the selected source .glb.

The script does not download from Quaternius, Mixamo, Fab, or any other site.
Review the source licence and record it in docs/ASSET_CREDITS.md first.
EOF
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) [[ $# -ge 2 ]] || { usage; exit 2; }; SOURCE="$2"; shift 2 ;;
    --sha256) [[ $# -ge 2 ]] || { usage; exit 2; }; EXPECTED_SHA256="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -n "$SOURCE" ]]; then
  [[ -e "$SOURCE" ]] || { echo "Source does not exist: $SOURCE" >&2; exit 1; }
  TEMP=""
  cleanup() { [[ -n "$TEMP" && -d "$TEMP" ]] && rm -rf "$TEMP"; }
  trap cleanup EXIT
  CANDIDATE=""
  if [[ -f "$SOURCE" && "${SOURCE##*.}" == "glb" ]]; then
    CANDIDATE="$SOURCE"
  elif [[ -d "$SOURCE" ]]; then
    CANDIDATE="$(find "$SOURCE" -type f -iname '*.glb' -print -quit)"
  elif [[ -f "$SOURCE" && "${SOURCE##*.}" == "zip" ]]; then
    TEMP="$(mktemp -d)"
    unzip -q "$SOURCE" -d "$TEMP"
    CANDIDATE="$(find "$TEMP" -type f -iname '*.glb' -print -quit)"
  fi
  [[ -n "$CANDIDATE" && -f "$CANDIDATE" ]] || {
    echo "No .glb model found in source: $SOURCE" >&2
    exit 1
  }
  if [[ -n "$EXPECTED_SHA256" ]]; then
    ACTUAL_SHA256="$(shasum -a 256 "$CANDIDATE" | awk '{print $1}')"
    [[ "$ACTUAL_SHA256" == "$EXPECTED_SHA256" ]] || {
      echo "SHA-256 mismatch for $CANDIDATE" >&2
      echo "expected: $EXPECTED_SHA256" >&2
      echo "actual:   $ACTUAL_SHA256" >&2
      exit 1
    }
  fi
  cp "$CANDIDATE" "$TARGET/model.glb"
  echo "Installed local GLB: $TARGET/model.glb"
  echo "Record the provider, source URL, licence, date, and SHA-256 in docs/ASSET_CREDITS.md."
  exit 0
fi

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
