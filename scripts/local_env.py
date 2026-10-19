#!/usr/bin/env python3
"""Load the project-local .env file with the standard library only.

Rules:
  - KEY=VALUE lines; '#' starts a comment; surrounding quotes are stripped.
  - Existing environment variables ALWAYS win (setdefault semantics), so real
    process env and Docker `environment:` values override the file.
  - Missing file is normal and returns None.

Usage:
    from local_env import load
    load()            # <project root>/.env
    load(Path(...))   # explicit file
"""
from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def load(path=None):
    """Parse a .env file into os.environ without overriding existing keys.

    Returns the loaded Path, or None when the file does not exist.
    """
    env_path = Path(path) if path else (PROJECT_ROOT / ".env")
    try:
        raw = env_path.read_text(encoding="utf-8")
    except OSError:
        return None
    for line in raw.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        key, _, value = s.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value
    return env_path


if __name__ == "__main__":  # pragma: no cover - manual helper
    loaded = load()
    print(f"loaded: {loaded}" if loaded else "no .env file found")
