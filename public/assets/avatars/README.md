# Avatar Assets — Usage Examples

Example entries for `agents.json`:

```json
{
  "id": "laravel-expert",
  "name": "Laravel Expert",
  "role": "Tactical technical operator",
  "avatar": {
    "model": "/assets/avatars/laravel-expert/model.glb",
    "fallback": { "color": "#EF4444", "shape": "capsule", "emoji": "🛠️" },
    "workstation": "le",
    "zone": "Engineering",
    "scale": 0.95,
    "offset": { "y": 0 },
    "animations": { "idle": "Idle", "working": "Typing", "error": "Alert" }
  }
}
```

## Validation Notes
- Prefer `.glb`. If using `.gltf`, include `.bin` and textures in same directory.
- Keep models low-poly and DRACO-compressed where possible.
- Missing files fall back to a procedural humanoid automatically.
- Animation names matched case-insensitively.
- Keep the matching entry in `public/assets/asset-manifest.json` and record attribution in `docs/ASSET_CREDITS.md`.
