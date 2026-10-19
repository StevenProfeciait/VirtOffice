# TEVA HQ / VirtOffice

Local-only Python server and 3D AI-agent office dashboard. The server uses only the Python standard library.

![TEVA HQ screenshot](docs/assets/screenshot.png)

## What This Is

TEVA HQ (built on VirtOffice) is a self-hosted command centre for AI agents. It serves a 3D office dashboard, live agent state, activity events, inbox notes, and message-delivery tracking. It runs locally by default and is not an npm package.

## Quick Start

### From source

```bash
git clone https://github.com/OneByJorah/VirtOffice.git
cd VirtOffice
python3 server.py
```

Open `http://127.0.0.1:9502`.

### Docker

```bash
git clone https://github.com/OneByJorah/VirtOffice.git
cd VirtOffice
docker compose up -d
```

The host port is published on `127.0.0.1` only. Open `http://127.0.0.1:9502`.

## Configuration

Copy `.env.example` to `.env` only when you need overrides. `.env` is optional; real environment variables always win. Defaults are local-only (`HOST=127.0.0.1`, `PORT=9502`).

The server refuses non-loopback binds unless `TEVA_ALLOW_NON_LOOPBACK=1` is set (container use only).

## Modular 3D prototype

The established office renderer is the default. The modular avatar/workstation layer can be enabled
without changing the default dashboard:

```text
http://127.0.0.1:9502/office.html?modular=1&prototype=1
```

This enables live avatar reconciliation, role-styled procedural characters, aligned workstations for
all seats (with `?modular=1&workstations=all`), and optional GLB characters via the asset manifest.
Configure per agent with `avatar.model`, `avatar.scale`, `avatar.offset`, `avatar.seated`, and
`avatar.animations`; missing assets fall back safely. See
[`docs/AVATAR_ASSETS.md`](docs/AVATAR_ASSETS.md), [`public/assets/asset-manifest.json`](public/assets/asset-manifest.json),
and [`scripts/install_cc0_assets.sh`](scripts/install_cc0_assets.sh).

## Renderer-neutral scene contract

The Python backend exposes `GET /api/scene`, a stable contract for future Babylon.js or Unreal
clients. It contains the shared TEVA room dimensions, seat IDs, anchors, zones, navigation points,
asset manifest URL, and live-state endpoints. The current `office.html` remains the reference client;
see [`docs/ENGINE_MIGRATION_PLAN.md`](docs/ENGINE_MIGRATION_PLAN.md).

The first experimental client is available at `/babylon-pilot.html`. It renders the shared floor
contract, live agent roster, zone overlays, camera focus, and SSE updates without changing the main
Three.js office. It also loads the bundled office-worker GLB for the supervisor seat and falls back
to a procedural avatar if the external Babylon loader is unavailable.

## Modes

1. Demo mode — generated sample agents (default).
2. Static JSON drop — serve `AGENTS_JSON_PATH` if it exists.
3. Hermes status API — poll `HERMES_AGENT_API`.
4. Webhook push — `POST /webhook/agents` with `X-TEVA-Token` and allowed Origin.

## Tests

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall server.py scripts tests
```

## Security

- Local-only by default.
- Host header allowlist blocks DNS rebinding.
- POST endpoints require allowed Origin and per-install token.
- Token file is created outside the repository with `0600` permissions.

## License

MIT — see [LICENSE](LICENSE).
