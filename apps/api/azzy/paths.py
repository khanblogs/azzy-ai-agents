"""Filesystem path resolution shared by pure modules (stdlib only)."""

from __future__ import annotations

import os
from pathlib import Path

_HERE = Path(__file__).resolve().parent  # apps/api/azzy
_REPO_AGENTS = _HERE.parent.parent.parent / "packages" / "agents"  # repo-relative fallback
_DOCKER_AGENTS = Path("/app/packages/agents")


def agents_dir() -> Path:
    """Directory holding packages/agents/*.yaml (+ policy.yaml).

    Order: $AGENTS_DIR if it exists → /app/packages/agents (docker image) → repo-relative.
    """
    env = os.environ.get("AGENTS_DIR")
    candidates = [Path(env)] if env else []
    candidates += [_DOCKER_AGENTS, _REPO_AGENTS]
    for candidate in candidates:
        if (candidate / "policy.yaml").is_file():
            return candidate
    return candidates[0]


_REPO_ARTIFACTS = _HERE.parent / "data" / "artifacts"  # apps/api/data/artifacts (local dev fallback)


def _writable(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".write-probe"
        probe.touch()
        probe.unlink()
        return True
    except OSError:
        return False


def writable_dir(preferred: str, fallback_name: str) -> Path:
    """`preferred` when writable, else apps/api/data/<fallback_name> (local dev)."""
    wanted = Path(preferred)
    if _writable(wanted):
        return wanted
    fallback = _HERE.parent / "data" / fallback_name
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def artifacts_dir(preferred: str | None = None) -> Path:
    """$ARTIFACTS_DIR (default /data/artifacts), falling back to a repo-relative ./data/artifacts."""
    wanted = Path(preferred or os.environ.get("ARTIFACTS_DIR") or "/data/artifacts")
    if _writable(wanted):
        return wanted
    _REPO_ARTIFACTS.mkdir(parents=True, exist_ok=True)
    return _REPO_ARTIFACTS
