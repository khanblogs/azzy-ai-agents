"""Routines: cron from agent YAML → APScheduler jobs (worker) and next_run via croniter (API)."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from croniter import croniter

from azzy.agents.loader import get_agents

log = logging.getLogger("azzy.scheduler")


SYSTEM_ROUTINES: tuple[dict[str, str], ...] = (
    {"id": "knowledge_retention", "agent": "sara", "cron": "30 3 * * *", "title": "Knowledge & memory retention sweep", "prompt": "Purge knowledge documents and memories past their retention window and record the sweep in the audit log."},
)


def _next(cron: str, now: datetime) -> str | None:
    try:
        return croniter(cron, now).get_next(datetime).astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    except (ValueError, KeyError):
        return None


def list_routines(now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(UTC)
    out: list[dict[str, Any]] = []
    for agent in get_agents().values():
        for routine in agent.routines:
            out.append({"id": routine.id, "agent": agent.id, "cron": routine.cron, "title": routine.title, "prompt": routine.prompt, "next_run": _next(routine.cron, now), "system": False})
    for routine in SYSTEM_ROUTINES:
        out.append({**routine, "next_run": _next(routine["cron"], now), "system": True})
    return out


def find_routine(routine_id: str) -> tuple[str, dict[str, Any]] | None:
    for item in list_routines():
        if item["id"] == routine_id:
            return item["agent"], item
    return None


def build_scheduler(on_fire: Any, on_system: Any | None = None) -> Any:
    """AsyncIOScheduler with one cron job per routine. `on_fire(agent_id, routine)` / `on_system(routine)` are awaited."""
    from apscheduler.schedulers.asyncio import AsyncIOScheduler  # noqa: PLC0415
    from apscheduler.triggers.cron import CronTrigger  # noqa: PLC0415

    scheduler = AsyncIOScheduler(timezone="UTC")
    for agent in get_agents().values():
        for routine in agent.routines:
            trigger = CronTrigger.from_crontab(routine.cron, timezone="UTC")
            scheduler.add_job(
                on_fire, trigger, args=[agent.id, routine.model_dump()], id=f"{agent.id}:{routine.id}",
                name=routine.title, coalesce=True, max_instances=1, misfire_grace_time=600,
            )
            log.info("routine scheduled", extra={"fields": {"agent": agent.id, "routine": routine.id, "cron": routine.cron}})
    if on_system is not None:
        for routine in SYSTEM_ROUTINES:
            scheduler.add_job(on_system, CronTrigger.from_crontab(routine["cron"], timezone="UTC"), args=[dict(routine)], id=f"system:{routine['id']}", name=routine["title"], coalesce=True, max_instances=1, misfire_grace_time=3600)
    return scheduler
