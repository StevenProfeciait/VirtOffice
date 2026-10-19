# Avatar Assets

TEVA HQ supports user-supplied character models in glTF 2.0 format.

## Supported formats

- `.glb` (binary glTF, recommended)
- `.gltf` with associated `.bin` and texture files

## Directory convention

Place assets under:

```text
public/assets/avatars/<agent-id>/model.glb
```

Example:

```text
public/assets/avatars/laravel-expert/model.glb
public/assets/avatars/laravel-expert/textures/diffuse.png
```

## Agent configuration

Add an `avatar` object to an agent entry in `agents.json` or the registry:

```json
{
  "id": "laravel-expert",
  "name": "Laravel Expert",
  "role": "Tactical technical operator",
  "avatar": {
    "model": "/assets/avatars/laravel-expert/model.glb",
    "fallback": {
      "color": "#EF4444",
      "shape": "capsule",
      "emoji": "🛠️"
    },
    "workstation": "le",
    "zone": "Engineering",
    "animations": {
      "idle": "Idle",
      "working": "Typing",
      "researching": "Reading",
      "testing": "Diagnostics",
      "planning": "Presenting",
      "waiting": "Waiting",
      "error": "Alert",
      "completed": "Complete"
    }
  }
}
```

## Behaviour

- If `model` is null or fails to load, the procedural fallback character is used.
- If a supplied model has no animation clips, TEVA HQ uses procedural idle and state animations.
- Animation clip names are matched by the `animations` map; unmatched states fall back to idle.
- Only use models you have permission to use. Do not package proprietary game assets.

## Performance notes

- Keep models reasonably low-poly for browser use.
- Prefer compressed textures and Draco-compressed geometry where practical.
- Unused geometries, materials, and textures are disposed when an avatar is replaced.
