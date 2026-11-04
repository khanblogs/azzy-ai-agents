"""Snapshot builders shared by /state, /agents, /team."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from azzy.agents.loader import get_agents
from azzy.bus import Bus
from azzy.config import Settings
from azzy.db import repo
from datetime import UTC, datetime, timedelta

import os

import httpx

from azzy import __version__
from azzy.events import AGENT_IDS, AGENT_META, CREATOR_CREDIT, PRODUCT_NAME, PRODUCT_VERSION, rank_for

STARTED_AT = time.monotonic()

# --- Uptime Kuma services (feeds the office LED wall) ------------------------
# Same source as the uptime.status tool: Kuma's public status-page API.
# Cached for 30s (Kuma itself checks every 60s; snapshots are frequent) and
# failure-isolated: any Kuma problem returns the last good list, never an error.
_KUMA_LABELS = {
    "Azzy AI Agents (web)": "azzy.negdtech.in",
    "Azzy API health": "azzy api",
    "Sarvnex website": "www.sarvnex.com",
    "sarvnex.com": "sarvnex.com",
    "HMS": "hms.negdtech.in",
    "PBM AI API": "ai-dev-pbm",
    "Healthchecks": "healthchecks",
}
_KUMA_STATE = {0: "DOWN", 1: "UP", 2: "PENDING", 3: "MAINTENANCE"}
_kuma_cache: dict[str, Any] = {"at": 0.0, "data": []}


async def kuma_services() -> list[dict[str, Any]]:
    now = time.monotonic()
    if now - float(_kuma_cache["at"]) < 30:
        return list(_kuma_cache["data"])
    _kuma_cache["at"] = now
    base = os.environ.get("UPTIME_KUMA_URL", "").rstrip("/")
    if not base:
        return list(_kuma_cache["data"])
    slug = os.environ.get("UPTIME_KUMA_STATUS_SLUG", "azzy")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            page = (await client.get(f"{base}/api/status-page/{slug}")).json()
            beats = (await client.get(f"{base}/api/status-page/heartbeat/{slug}")).json()
    except Exception:  # noqa: BLE001 - LED data must never break the snapshot
        return list(_kuma_cache["data"])
    names: dict[str, str] = {}
    for group in page.get("publicGroupList") or []:
        for mon in group.get("monitorList") or []:
            names[str(mon.get("id"))] = str(mon.get("name") or mon.get("id"))
    heartbeat = beats.get("heartbeatList") or {}
    uptime_map = beats.get("uptimeList") or {}
    out: list[dict[str, Any]] = []
    for mid, name in names.items():
        series = heartbeat.get(mid) or []
        last = series[-1] if series else None
        status = _KUMA_STATE.get(last.get("status"), "UNKNOWN") if last else "UNKNOWN"
        up24 = uptime_map.get(f"{mid}_24")
        out.append({
            "name": name,
            "label": _KUMA_LABELS.get(name, name),
            "status": status,
            "ping": last.get("ping") if last else None,
            "uptime24": round(up24 * 100, 1) if isinstance(up24, (int, float)) else None,
        })
    if out:
        _kuma_cache["data"] = out
    return out


async def live_agent_state(bus: Bus) -> dict[str, dict[str, Any]]:
    """Latest phase/spot/task per agent, reconstructed from the recent events stream."""
    state: dict[str, dict[str, Any]] = {a: {"phase": "idle", "spot": "desk", "task_id": None, "detail": ""} for a in AGENT_META}
    seen_phase: set[str] = set()
    seen_spot: set[str] = set()
    for event in await bus.recent_events(count=400):
        agent = event.get("agent")
        if agent not in state:
            continue
        kind = event.get("type")
        if kind == "agent.phase" and agent not in seen_phase:
            state[agent]["phase"] = event.get("phase", "idle")
            state[agent]["task_id"] = event.get("task_id")
            state[agent]["detail"] = event.get("detail", "")
            seen_phase.add(agent)
        elif kind == "agent.move" and agent not in seen_spot:
            state[agent]["spot"] = event.get("to", "desk")
            seen_spot.add(agent)
        if len(seen_phase) == len(AGENT_IDS) and len(seen_spot) == len(AGENT_IDS):
            break
    return state


async def agent_summaries(session: AsyncSession, bus: Bus, settings: Settings) -> list[dict[str, Any]]:
    agents = get_agents()
    xp = await repo.get_xp(session)
    costs = await repo.cost_summary(session, settings.DAILY_BUDGET_USD)
    live = await live_agent_state(bus)
    out: list[dict[str, Any]] = []
    for agent_id in AGENT_IDS:
        config = agents[agent_id]
        xp_row = xp.get(agent_id)
        total = xp_row.total_xp if xp_row else 0
        out.append({
            "id": agent_id, "name": config.name, "role": AGENT_META[agent_id]["role"], "short": AGENT_META[agent_id]["short"],
            "domain_role": config.domain_role, "color": AGENT_META[agent_id]["color"], "avatar": config.avatar.model_dump(),
            **live[agent_id], "xp": total, "rank": rank_for(total),
            "today_usd": round(costs["per_agent"].get(agent_id, 0.0), 4), "daily_budget_usd": config.budgets.daily_usd,
            "tasks_done": xp_row.tasks_done if xp_row else 0,
        })
    return out


async def state_snapshot(session: AsyncSession, bus: Bus, settings: Settings) -> dict[str, Any]:
    office = await repo.get_kv(session, "office", {"status": "nominal", "note": ""})
    if await repo.open_incident_count(session) and office.get("status") == "nominal":
        office = {"status": "incident", "note": "war room active"}
    tasks = [repo.task_to_model(r).model_dump() for r in await repo.list_tasks(session, limit=100)]
    approvals = [repo.approval_to_model(r).model_dump() for r in await repo.list_approvals(session, "all")]
    incidents = [repo.incident_to_model(r).model_dump() for r in await repo.list_incidents(session)]
    environments = [repo.env_to_dict(r) for r in await repo.list_environments(session)]
    costs = await repo.cost_summary(session, settings.DAILY_BUDGET_USD)
    accounts = [repo.account_to_model(a).model_dump() for a in await repo.list_accounts(session)]
    deployments = [repo.deployment_to_model(d).model_dump() for d in await repo.list_deployments(session, limit=20)]
    cutoff = datetime.now(UTC) - timedelta(minutes=30)
    messages = [repo.agent_message_to_model(m).model_dump() for m in await repo.recent_agent_messages(session, since=cutoff, limit=50)]
    return {
        "office": {"status": office.get("status", "nominal"), "note": office.get("note", "")},
        "product": {"name": PRODUCT_NAME, "version": PRODUCT_VERSION, "credit": CREATOR_CREDIT, "api_version": __version__},
        "accounts": accounts,
        "deployments": deployments,
        "agent_messages": messages,
        "agents": await agent_summaries(session, bus, settings),
        "tasks": tasks,
        "approvals": approvals,
        "incidents": incidents,
        "environments": environments,
        "costs": {"today_usd": costs["today_usd"], "per_agent": costs["per_agent"], "budget_usd": costs["budget_usd"]},
        "updates": await repo.recent_updates(session, 20),
        "services": await kuma_services(),
        "uptime_seconds": int(time.monotonic() - STARTED_AT),
        "demo": settings.DEMO,
    }
