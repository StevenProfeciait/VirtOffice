# Avatar Assets

Avatar loading is opt-in through the modular renderer. Start with
`office.html?modular=1&prototype=1` to inspect the workstation integration. The repository does not
ship third-party character files; add only assets whose licenses permit local redistribution.

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
    },
    "seated": {
      "enabled": true,
      "seatHeight": 0.62,
      "offset": { "x": 0, "y": 0, "z": 0 },
      "rotation": 0,
      "pose": "seated_idle"
    }
  }
}
```

## Behaviour

- If `model` is null or fails to load, the procedural fallback character is used.
- If a supplied model has no animation clips, TEVA HQ uses procedural idle and state animations.
- Animation clip names are matched by the `animations` map; unmatched states fall back to idle.
- Working states prefer `seated_typing`, then `typing`, `working`, `seated_idle`, and `idle` clips.
- The `seated` block provides model-specific chair alignment corrections without changing the agent ID.
- Only use models you have permission to use. Do not package proprietary game assets.

## Performance notes

- Keep models reasonably low-poly for browser use.
- Prefer compressed textures and Draco-compressed geometry where practical.
- Unused geometries, materials, and textures are disposed when an avatar is replaced.
- Loaded models are cached and cloned for reuse; cache resources are released when the modular manager is disposed.
