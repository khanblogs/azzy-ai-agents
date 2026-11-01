"""env.registry: reads the environments table (never secrets). Real in DEMO too."""

from __future__ import annotations

import json
from typing import Any

from azzy.tools.base import ToolContext, ToolError, ToolSpec, schema, str_prop

_PUBLIC_FIELDS = ("id", "name", "kind", "method", "target", "region", "auto_allow", "health", "version", "latency_ms", "last_checked")


async def env_registry(ctx: ToolContext, args: dict[str, Any]) -> str:
    from azzy.db.engine import session_scope  # noqa: PLC0415
    from azzy.db.repo import env_to_dict, get_environment, list_environments  # noqa: PLC0415

    env_id = args.get("env_id")
    async with session_scope() as session:
        if env_id:
            row = await get_environment(session, str(env_id))
            if row is None:
                raise ToolError(f"unknown environment {env_id!r}")
            rows = [env_to_dict(row)]
        else:
            rows = [env_to_dict(r) for r in await list_environments(session)]
    public = [{k: r.get(k) for k in _PUBLIC_FIELDS} for r in rows]
    return json.dumps(public[0] if env_id else public, indent=2, default=str)


SPECS: list[ToolSpec] = [
    ToolSpec("env.registry", "List registered environments or fetch one (id, kind, method, target, auto_allow, health, version).", "low",
             schema({"env_id": str_prop("Environment id (omit for all)")}), env_registry, demo_passthrough=True),
]
