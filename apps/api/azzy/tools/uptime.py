"""uptime.*: read-only service uptime status from Uptime Kuma.

Reads the public status-page API of the self-hosted Uptime Kuma instance
(UPTIME_KUMA_URL; page slug from UPTIME_KUMA_STATUS_SLUG, default "azzy").
No credentials are involved: the status-page API is public by design, and
the summary is derived entirely from it.

Runs for real in DEMO mode (demo_passthrough): uptime is exactly the kind
of operational fact that must never be fabricated.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from azzy.tools.base import NotConfigured, ToolContext, ToolError, ToolSpec, schema, str_prop

TIMEOUT_S = 15
_STATE = {0: "DOWN", 1: "UP", 2: "PENDING", 3: "MAINTENANCE"}


def _base() -> str:
    base = os.environ.get("UPTIME_KUMA_URL", "").rstrip("/")
    if not base:
        raise NotConfigured("Uptime Kuma", "UPTIME_KUMA_URL is not set")
    return base


async def _get(path: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            resp = await client.get(_base() + path)
            resp.raise_for_status()
            return resp.json()
    except ToolError:
        raise
    except Exception as exc:  # noqa: BLE001 - surface as a tool error, not a crash
        raise ToolError(f"uptime kuma request failed: {exc}") from None


async def uptime_status(ctx: ToolContext, args: dict[str, Any]) -> str:
    slug = str(args.get("slug") or os.environ.get("UPTIME_KUMA_STATUS_SLUG", "azzy"))
    page = await _get(f"/api/status-page/{slug}")
    beats = await _get(f"/api/status-page/heartbeat/{slug}")
    names: dict[str, str] = {}
    for group in page.get("publicGroupList") or []:
        for mon in group.get("monitorList") or []:
            names[str(mon.get("id"))] = str(mon.get("name") or mon.get("id"))
    title = (page.get("config") or {}).get("title") or slug
    lines = [f"Uptime Kuma status page '{slug}' - {title}"]
    if not names:
        lines.append("No monitors are published on this status page yet.")
        return "\n".join(lines)
    heartbeat = beats.get("heartbeatList") or {}
    uptime_map = beats.get("uptimeList") or {}
    for mid, name in names.items():
        series = heartbeat.get(mid) or []
        last = series[-1] if series else None
        if last is None:
            lines.append(f"- {name}: no heartbeats yet")
            continue
        state = _STATE.get(last.get("status"), "UNKNOWN")
        extra = ""
        if last.get("ping") is not None:
            extra += f", ping {last['ping']} ms"
        up24 = uptime_map.get(f"{mid}_24")
        if isinstance(up24, (int, float)):
            extra += f", 24h uptime {up24 * 100:.1f}%"
        lines.append(f"- {name}: {state}{extra} (last check {last.get('time', '?')} UTC)")
    return "\n".join(lines)


SPECS: list[ToolSpec] = [
    ToolSpec(
        "uptime.status",
        "Get the current up/down status of the monitored services (Azzy, Sarvnex, HMS, PBM AI and more) from Uptime Kuma, with last ping and 24h uptime. Read-only.",
        "low",
        schema({"slug": str_prop("Status page slug (default: azzy)")}, []),
        uptime_status,
        demo_passthrough=True,
    ),
]
