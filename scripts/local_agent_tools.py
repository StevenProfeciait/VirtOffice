#!/usr/bin/env python3
"""Allowlisted tools for TEVA HQ local Ollama agent. No unrestricted shell."""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Any

MAX_READ_BYTES = int(os.environ.get("TEVA_LOCAL_READ_MAX", str(64 * 1024)))
MAX_SEARCH_HITS = 40
MAX_LIST = 80
ALLOW_TESTS = os.environ.get("TEVA_LOCAL_ALLOW_TESTS", "").strip() in ("1", "true", "yes")

# Redact obvious secrets in tool output
_SECRET_RE = re.compile(
    r"(?i)(api[_-]?key|secret|token|password|authorization)\s*[=:]\s*\S+"
)


def redact(text: str) -> str:
    if not text:
        return text
    return _SECRET_RE.sub(r"\1=[REDACTED]", text)


def resolve_under_roots(path_str: str, roots: list) -> tuple[bool, Any]:
    """Return (ok, resolved_Path|error_str). Rejects escapes and symlink escape."""
    if not path_str or not isinstance(path_str, str):
        return False, "path required"
    roots = [Path(r).resolve() for r in (roots or []) if r]
    if not roots:
        return False, "no workspace roots configured"
    raw = Path(path_str)
    # absolute: must be under a root; relative: try each root
    candidates = []
    if raw.is_absolute():
        candidates = [raw]
    else:
        candidates = [root / raw for root in roots]
    for cand in candidates:
        try:
            resolved = cand.resolve()
        except OSError:
            continue
        for root in roots:
            try:
                if resolved == root or root in resolved.parents or resolved.is_relative_to(root):
                    # symlink escape: resolved must still be under root
                    return True, resolved
            except AttributeError:
                # py<3.9 fallback
                try:
                    resolved.relative_to(root)
                    return True, resolved
                except ValueError:
                    continue
    return False, "path outside workspace roots"


TOOL_SPECS = [
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "List files in a directory under the allowlisted workspace roots.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Directory path"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a text file under workspace roots (size-capped).",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_code",
            "description": "Search for a text pattern under workspace roots.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "path": {"type": "string", "description": "Optional subdir"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_edit",
            "description": "Propose full new file content. Does NOT write disk; Steve must approve.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string", "description": "Full file content after edit"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_tests",
            "description": "Run allowlisted tests if enabled (often disabled).",
            "parameters": {
                "type": "object",
                "properties": {"suite": {"type": "string"}},
                "required": [],
            },
        },
    },
]


class ToolContext:
    def __init__(self, roots, proposed_patch=None):
        self.roots = [str(Path(r).resolve()) for r in (roots or [])]
        self.proposed_patch = list(proposed_patch or [])

    def run(self, name: str, args: dict) -> dict:
        args = args or {}
        if name == "list_dir":
            return self._list_dir(args.get("path") or ".")
        if name == "read_file":
            return self._read_file(args.get("path"))
        if name == "search_code":
            return self._search_code(args.get("query"), args.get("path") or ".")
        if name == "propose_edit":
            return self._propose_edit(args.get("path"), args.get("content"))
        if name == "run_tests":
            return self._run_tests(args.get("suite"))
        return {"ok": False, "error": f"unknown tool {name}"}

    def _list_dir(self, path_str):
        ok, resolved = resolve_under_roots(path_str, self.roots)
        if not ok:
            return {"ok": False, "error": resolved}
        if not resolved.is_dir():
            return {"ok": False, "error": "not a directory"}
        try:
            entries = sorted(resolved.iterdir(), key=lambda p: p.name)[:MAX_LIST]
        except OSError as e:
            return {"ok": False, "error": str(e)}
        return {
            "ok": True,
            "path": str(resolved),
            "entries": [
                {"name": e.name, "type": "dir" if e.is_dir() else "file"}
                for e in entries
            ],
        }

    def _read_file(self, path_str):
        ok, resolved = resolve_under_roots(path_str, self.roots)
        if not ok:
            return {"ok": False, "error": resolved}
        if not resolved.is_file():
            return {"ok": False, "error": "not a file"}
        try:
            data = resolved.read_bytes()
        except OSError as e:
            return {"ok": False, "error": str(e)}
        truncated = len(data) > MAX_READ_BYTES
        data = data[:MAX_READ_BYTES]
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            return {"ok": False, "error": "binary or non-utf8 file"}
        return {
            "ok": True,
            "path": str(resolved),
            "content": redact(text),
            "truncated": truncated,
        }

    def _search_code(self, query, path_str):
        if not query or not isinstance(query, str):
            return {"ok": False, "error": "query required"}
        ok, resolved = resolve_under_roots(path_str or ".", self.roots)
        if not ok:
            return {"ok": False, "error": resolved}
        hits = []
        # Prefer ripgrep if available
        try:
            proc = subprocess.run(
                ["rg", "-n", "--max-count", "5", "-m", str(MAX_SEARCH_HITS),
                 "--glob", "!**/node_modules/**", "--glob", "!**/.git/**",
                 query, str(resolved)],
                capture_output=True, text=True, timeout=15,
            )
            if proc.returncode in (0, 1):
                for line in (proc.stdout or "").splitlines()[:MAX_SEARCH_HITS]:
                    hits.append(redact(line))
                return {"ok": True, "hits": hits, "engine": "rg"}
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            pass
        # Python walk fallback
        q = query.lower()
        for root, dirs, files in os.walk(resolved):
            dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__", ".venv")]
            for fn in files:
                if len(hits) >= MAX_SEARCH_HITS:
                    break
                fp = Path(root) / fn
                try:
                    if fp.stat().st_size > MAX_READ_BYTES:
                        continue
                    text = fp.read_text(encoding="utf-8", errors="ignore")
                except OSError:
                    continue
                for i, line in enumerate(text.splitlines(), 1):
                    if q in line.lower():
                        hits.append(redact(f"{fp}:{i}:{line[:200]}"))
                        if len(hits) >= MAX_SEARCH_HITS:
                            break
            if len(hits) >= MAX_SEARCH_HITS:
                break
        return {"ok": True, "hits": hits, "engine": "walk"}

    def _propose_edit(self, path_str, content):
        if content is None or not isinstance(content, str):
            return {"ok": False, "error": "content required"}
        ok, resolved = resolve_under_roots(path_str, self.roots)
        if not ok:
            return {"ok": False, "error": resolved}
        # store relative-ish path as resolved string; apply will re-check
        # replace existing proposal for same path
        self.proposed_patch = [p for p in self.proposed_patch if p.get("path") != str(resolved)]
        self.proposed_patch.append({
            "path": str(resolved),
            "content": content,
            "bytes": len(content.encode("utf-8")),
        })
        return {
            "ok": True,
            "path": str(resolved),
            "note": "Edit proposed only — not written. Steve must approve the job.",
            "patch_count": len(self.proposed_patch),
        }

    def _run_tests(self, suite=None):
        if not ALLOW_TESTS:
            return {
                "ok": False,
                "error": "tool_disabled",
                "message": "run_tests disabled (set TEVA_LOCAL_ALLOW_TESTS=1 to enable)",
            }
        # Only allow unittest under first root if it looks like VirtOffice
        root = Path(self.roots[0]) if self.roots else None
        if not root or not (root / "tests").is_dir():
            return {"ok": False, "error": "no tests directory under workspace root"}
        try:
            proc = subprocess.run(
                ["python3", "-m", "unittest", "discover", "-s", "tests", "-q"],
                cwd=str(root), capture_output=True, text=True, timeout=120,
            )
            out = ((proc.stdout or "") + "\n" + (proc.stderr or ""))[:4000]
            return {"ok": proc.returncode == 0, "returncode": proc.returncode, "output": redact(out)}
        except Exception as e:
            return {"ok": False, "error": str(e)}


def apply_proposed_patch(proposed_patch, roots) -> tuple[bool, dict]:
    """Write proposed file contents after Steve approval. Returns (ok, result)."""
    roots = [Path(r).resolve() for r in (roots or [])]
    if not proposed_patch:
        return False, {"ok": False, "error": "no proposed patch"}
    applied = []
    for item in proposed_patch:
        path_str = item.get("path")
        content = item.get("content")
        if content is None:
            return False, {"ok": False, "error": f"missing content for {path_str}"}
        ok, resolved = resolve_under_roots(path_str, roots)
        if not ok:
            return False, {"ok": False, "error": f"reject {path_str}: {resolved}"}
        # ensure parent under roots
        try:
            resolved.parent.mkdir(parents=True, exist_ok=True)
            tmp = resolved.with_suffix(resolved.suffix + ".teva_tmp")
            data = content.encode("utf-8")
            fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(tmp, resolved)
            applied.append(str(resolved))
        except OSError as e:
            return False, {"ok": False, "error": str(e), "applied": applied}
    return True, {"ok": True, "applied": applied}
