#!/usr/bin/env python3
"""TEVA HQ local Ollama provider: discovery, health, chat, config (stdlib only).

Never invents model names — discovery via /api/tags is the source of truth.
Loopback-only base_url unless TEVA_OLLAMA_ALLOW_REMOTE=1.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from copy import deepcopy
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

HOME_HQ = Path(os.environ.get("TEVA_HQ_DIR") or (Path.home() / ".teva_hq"))
CONFIG_PATH = Path(os.environ.get("TEVA_OLLAMA_CONFIG") or (HOME_HQ / "ollama_config.json"))
DEFAULT_BASE_URL = os.environ.get("TEVA_OLLAMA_URL") or "http://127.0.0.1:11434"
ALLOW_REMOTE = os.environ.get("TEVA_OLLAMA_ALLOW_REMOTE", "").strip() in ("1", "true", "yes")
TIMEOUT_S = float(os.environ.get("TEVA_OLLAMA_TIMEOUT", "60"))
PILOT_SEAT = "le2"
CODE_HINTS = ("code", "coder", "deepseek", "qwen", "devstral", "starcoder", "codellama", "llama")

_lock = threading.RLock()
_http_opener = None  # tests may inject


class OllamaError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def _now_ms():
    return int(time.time() * 1000)


def is_loopback_url(url: str) -> bool:
    try:
        p = urlparse(url)
    except Exception:
        return False
    if p.scheme not in ("http", "https"):
        return False
    host = (p.hostname or "").lower()
    return host in ("127.0.0.1", "localhost", "::1")


def validate_base_url(url: str) -> tuple[bool, Optional[str]]:
    if not isinstance(url, str) or not url.strip():
        return False, "base_url required"
    url = url.strip().rstrip("/")
    if not ALLOW_REMOTE and not is_loopback_url(url):
        return False, "base_url must be loopback (set TEVA_OLLAMA_ALLOW_REMOTE=1 for remote)"
    return True, url


def default_config(base_url=None, workspace=None):
    ok, url = validate_base_url(base_url or DEFAULT_BASE_URL)
    if not ok:
        url = "http://127.0.0.1:11434"
    roots = []
    if workspace:
        roots.append(str(workspace))
    teva = os.environ.get("TEVA_REPO", "").strip()
    if teva and teva not in roots:
        roots.append(teva)
    return {
        "version": 1,
        "enabled": True,
        "base_url": url,
        "defaults": {"chat": None, "code": None},
        "seat_models": {
            PILOT_SEAT: {"model": None, "role": "code"},
        },
        "workspace_roots": roots,
        "fallback": {"enabled": True, "triggers": ["manual"]},
        "pilot_seats": [PILOT_SEAT],
        "updatedAt": _now_ms(),
    }


def load_config(path=None, workspace=None):
    path = Path(path or CONFIG_PATH)
    with _lock:
        if not path.exists():
            cfg = default_config(workspace=workspace)
            save_config(cfg, path)
            return cfg
        try:
            cfg = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            cfg = default_config(workspace=workspace)
            save_config(cfg, path)
            return cfg
        if not isinstance(cfg, dict):
            cfg = default_config(workspace=workspace)
        # merge defaults for missing keys
        base = default_config(workspace=workspace)
        for k, v in base.items():
            if k not in cfg:
                cfg[k] = v
        ok, url_or_err = validate_base_url(cfg.get("base_url") or DEFAULT_BASE_URL)
        cfg["base_url"] = url_or_err if ok else "http://127.0.0.1:11434"
        return cfg


def save_config(cfg, path=None):
    path = Path(path or CONFIG_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    cfg = deepcopy(cfg)
    cfg["updatedAt"] = _now_ms()
    ok, url_or_err = validate_base_url(cfg.get("base_url") or DEFAULT_BASE_URL)
    if not ok:
        raise OllamaError("invalid_base_url", url_or_err)
    cfg["base_url"] = url_or_err
    data = json.dumps(cfg, indent=2, ensure_ascii=False) + "\n"
    tmp = path.with_suffix(".tmp")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(data)
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return cfg


def public_config(cfg=None):
    cfg = cfg or load_config()
    return {
        "enabled": bool(cfg.get("enabled")),
        "base_url": cfg.get("base_url"),
        "defaults": cfg.get("defaults") or {},
        "seat_models": cfg.get("seat_models") or {},
        "workspace_roots": cfg.get("workspace_roots") or [],
        "fallback": cfg.get("fallback") or {},
        "pilot_seats": cfg.get("pilot_seats") or [PILOT_SEAT],
        "allow_remote": ALLOW_REMOTE,
    }


def _request(method, url, body=None, timeout=None):
    timeout = TIMEOUT_S if timeout is None else timeout
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    opener = _http_opener or urllib.request.urlopen
    try:
        with opener(req, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                return {}
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            detail = str(e)
        raise OllamaError("http_error", f"HTTP {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        raise OllamaError("ollama_unreachable", f"Ollama unreachable: {e.reason}") from e
    except TimeoutError as e:
        raise OllamaError("ollama_unreachable", "Ollama request timed out") from e
    except ValueError as e:
        raise OllamaError("bad_response", f"Invalid JSON from Ollama: {e}") from e


def list_models(base_url=None):
    cfg = load_config()
    url = (base_url or cfg.get("base_url") or DEFAULT_BASE_URL).rstrip("/")
    ok, validated = validate_base_url(url)
    if not ok:
        raise OllamaError("invalid_base_url", validated)
    payload = _request("GET", validated + "/api/tags", timeout=min(5.0, TIMEOUT_S))
    models = []
    for m in payload.get("models") or []:
        name = m.get("name") or m.get("model")
        if name:
            models.append({
                "name": name,
                "size": m.get("size"),
                "modified_at": m.get("modified_at"),
                "digest": m.get("digest"),
            })
    return models


def _pick_defaults(model_names):
    if not model_names:
        return None, None
    code = None
    lower = [(n, n.lower()) for n in model_names]
    for n, ln in lower:
        if any(h in ln for h in CODE_HINTS):
            code = n
            break
    chat = model_names[0]
    code = code or chat
    return chat, code


def fill_defaults_from_discovery(cfg=None, models=None):
    cfg = deepcopy(cfg or load_config())
    try:
        models = models if models is not None else list_models(cfg.get("base_url"))
    except OllamaError:
        return cfg, False
    names = [m["name"] for m in models]
    chat, code = _pick_defaults(names)
    defaults = cfg.setdefault("defaults", {})
    changed = False
    if not defaults.get("chat") and chat:
        defaults["chat"] = chat
        changed = True
    if not defaults.get("code") and code:
        defaults["code"] = code
        changed = True
    seat = cfg.setdefault("seat_models", {}).setdefault(PILOT_SEAT, {"model": None, "role": "code"})
    if not seat.get("model") and code:
        seat["model"] = code
        changed = True
    if changed:
        save_config(cfg)
    return cfg, changed


def health(base_url=None, fill_defaults=True):
    t0 = time.time()
    cfg = load_config()
    url = base_url or cfg.get("base_url")
    try:
        models = list_models(url)
        latency = int((time.time() - t0) * 1000)
        if fill_defaults:
            cfg, _ = fill_defaults_from_discovery(cfg, models)
        return {
            "ok": True,
            "reachable": True,
            "base_url": cfg.get("base_url"),
            "model_count": len(models),
            "models": models,
            "latency_ms": latency,
            "enabled": bool(cfg.get("enabled")),
            "defaults": cfg.get("defaults") or {},
            "seat_models": cfg.get("seat_models") or {},
            "pilot_seats": cfg.get("pilot_seats") or [PILOT_SEAT],
            "error_code": None,
            "error_message": None,
        }
    except OllamaError as e:
        latency = int((time.time() - t0) * 1000)
        return {
            "ok": False,
            "reachable": False,
            "base_url": url,
            "model_count": 0,
            "models": [],
            "latency_ms": latency,
            "enabled": bool(cfg.get("enabled")),
            "defaults": cfg.get("defaults") or {},
            "seat_models": cfg.get("seat_models") or {},
            "pilot_seats": cfg.get("pilot_seats") or [PILOT_SEAT],
            "error_code": e.code,
            "error_message": e.message,
        }


def model_for_seat(agent_id, cfg=None):
    cfg = cfg or load_config()
    seat = (cfg.get("seat_models") or {}).get(agent_id) or {}
    model = seat.get("model")
    if model:
        return model
    role = seat.get("role") or "code"
    defaults = cfg.get("defaults") or {}
    return defaults.get(role) or defaults.get("code") or defaults.get("chat")


def is_pilot_seat(agent_id, cfg=None):
    cfg = cfg or load_config()
    pilots = cfg.get("pilot_seats") or [PILOT_SEAT]
    return agent_id in pilots


def chat_completions(messages, model, tools=None, base_url=None, temperature=0.2):
    """OpenAI-compatible chat. Returns dict with message, tool_calls, raw."""
    if not model:
        raise OllamaError("model_missing", "model required")
    cfg = load_config()
    url = (base_url or cfg.get("base_url") or DEFAULT_BASE_URL).rstrip("/")
    ok, validated = validate_base_url(url)
    if not ok:
        raise OllamaError("invalid_base_url", validated)
    # verify model exists when tags available
    try:
        names = {m["name"] for m in list_models(validated)}
        if names and model not in names and not any(model in n or n.startswith(model) for n in names):
            raise OllamaError("model_missing", f"model '{model}' not installed (ollama list)")
    except OllamaError as e:
        if e.code == "model_missing":
            raise
        # unreachable during verify — let chat fail with same
        if e.code == "ollama_unreachable":
            raise
    body = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "stream": False,
    }
    if tools:
        body["tools"] = tools
    payload = _request("POST", validated + "/v1/chat/completions", body=body)
    choices = payload.get("choices") or []
    if not choices:
        raise OllamaError("bad_response", "no choices in chat completion")
    msg = choices[0].get("message") or {}
    return {
        "message": msg,
        "content": msg.get("content"),
        "tool_calls": msg.get("tool_calls") or [],
        "finish_reason": choices[0].get("finish_reason"),
        "raw": payload,
    }


def update_config_patch(patch, path=None):
    """Apply a partial update from Steve. Returns (ok, cfg_or_error)."""
    if not isinstance(patch, dict):
        return False, {"ok": False, "error": "JSON object expected"}
    with _lock:
        cfg = load_config(path)
        if "enabled" in patch:
            cfg["enabled"] = bool(patch["enabled"])
        if "base_url" in patch:
            ok, url_or_err = validate_base_url(patch["base_url"])
            if not ok:
                return False, {"ok": False, "error": url_or_err}
            cfg["base_url"] = url_or_err
        if "defaults" in patch and isinstance(patch["defaults"], dict):
            cfg.setdefault("defaults", {}).update(
                {k: patch["defaults"][k] for k in ("chat", "code") if k in patch["defaults"]}
            )
        if "seat_models" in patch and isinstance(patch["seat_models"], dict):
            for seat, entry in patch["seat_models"].items():
                if not re.match(r"^[a-z0-9][a-z0-9-]{0,31}$", seat):
                    return False, {"ok": False, "error": f"invalid seat {seat}"}
                if not isinstance(entry, dict):
                    continue
                cur = cfg.setdefault("seat_models", {}).setdefault(seat, {})
                if "model" in entry:
                    cur["model"] = entry["model"]
                if "role" in entry:
                    cur["role"] = entry["role"]
        if "workspace_roots" in patch and isinstance(patch["workspace_roots"], list):
            roots = []
            for r in patch["workspace_roots"]:
                if isinstance(r, str) and r.strip():
                    roots.append(str(Path(r.strip()).resolve()))
            cfg["workspace_roots"] = roots
        if "fallback" in patch and isinstance(patch["fallback"], dict):
            fb = cfg.setdefault("fallback", {})
            if "enabled" in patch["fallback"]:
                fb["enabled"] = bool(patch["fallback"]["enabled"])
            if "triggers" in patch["fallback"] and isinstance(patch["fallback"]["triggers"], list):
                fb["triggers"] = [t for t in patch["fallback"]["triggers"] if isinstance(t, str)]
        try:
            save_config(cfg, path)
        except OllamaError as e:
            return False, {"ok": False, "error": e.message}
        return True, public_config(cfg)


def seat_ollama_view(agent_id, health_snap=None):
    """Compact view for registry/agent payload merge."""
    cfg = load_config()
    h = health_snap if health_snap is not None else health(fill_defaults=False)
    model = model_for_seat(agent_id, cfg)
    return {
        "enabled": bool(cfg.get("enabled")) and bool((cfg.get("fallback") or {}).get("enabled", True)),
        "model": model,
        "healthy": bool(h.get("ok")),
        "pilot": is_pilot_seat(agent_id, cfg),
        "fallback_runtime": "ollama" if is_pilot_seat(agent_id, cfg) else None,
    }
