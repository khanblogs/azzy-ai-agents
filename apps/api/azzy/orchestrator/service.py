"""Orchestrator services used by the API: create/route tasks, chat, cancel, approvals, incidents,
meetings, routines. Heavy lifting happens in the worker after `enqueue_task`."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from azzy.audit import record as audit_record
from azzy.bus import Bus
from azzy.config import Settings
from azzy.db import repo
from azzy.db.models import ApprovalRow, ChatMessageRow, IncidentRow, TaskRow, utcnow
from azzy.events import (
    AGENT_IDS,
    TERMINAL_STATES,
    ApprovalDecidedEvent,
    ApprovalExpiredEvent,
    ChatMessageEvent,
    IncidentChangedEvent,
    OfficeStatusEvent,
    TaskUpdatedEvent,
)
from azzy.orchestrator.planner import build_plan, steps_total_for
from azzy.orchestrator.router import EnvRef, Route, route

log = logging.getLogger("azzy.orchestrator")

MEETING_LOCK = "meeting"
MEETING_LOCK_TTL = 120
MEETING_STALE_MINUTES = 30
CANCEL_TTL = 3600


async def env_refs(session: AsyncSession) -> list[EnvRef]:
    refs: list[EnvRef] = []
    for row in await repo.list_environments(session):
        aliases: list[str] = []
        lowered = row.name.lower()
        if "client a" in lowered:
            aliases += ["client a", "client-a", "clienta"]
        if "client b" in lowered:
            aliases += ["client b", "client-b", "clientb"]
        if row.method == "tailscale_ssh":
            aliases.append("vps")
        if row.kind == "prod":
            aliases += ["prod", "production"]
        if row.kind == "staging":
            aliases += ["staging", "stage"]
        if row.kind == "hq":
            aliases += ["hq", "head office"]
        refs.append(EnvRef(id=row.id, name=row.name, kind=row.kind, aliases=tuple(aliases)))
    return refs


async def route_prompt(session: AsyncSession, prompt: str) -> Route:
    return route(prompt, await env_refs(session))


async def _publish_new_task(session: AsyncSession, bus: Bus, row: TaskRow, *, priority: bool = False) -> None:
    await session.commit()
    await bus.publish(TaskUpdatedEvent(task=repo.task_to_model(row)))
    await bus.enqueue_task(row.id, priority=priority)


async def create_task(
    session: AsyncSession, bus: Bus, prompt: str, *, created_by: str | None = None, kind_override: str | None = None,
    meta: dict[str, Any] | None = None, ip: str | None = None,
) -> TaskRow:
    prompt = prompt.strip()
    if not prompt:
        raise ValueError("prompt is empty")
    routed = await route_prompt(session, prompt)
    kind = kind_override or routed.kind
    plan = build_plan(kind, routed.lead, list(routed.assignees))
    task_meta = {"version": routed.version, "scores": routed.scores, **(meta or {})}
    row = await repo.create_task(
        session, title=routed.title, prompt=prompt, lead=routed.lead, assignees=list(routed.assignees), env_id=routed.env_id,
        kind=kind, meta=task_meta, created_by=created_by, steps_total=steps_total_for(plan),
    )
    await audit_record(bus, actor=created_by or "system", action="task.created", target=row.id, task_id=row.id, detail={"kind": kind, "lead": routed.lead, "env_id": routed.env_id}, ip=ip, session=session)
    await _publish_new_task(session, bus, row)
    return row


async def move_task(session: AsyncSession, bus: Bus, task_id: str, state: str, by: str) -> TaskRow | None:
    row = await repo.update_task(session, task_id, state=state)
    if row is None:
        return None
    await audit_record(bus, actor=by, action="task.moved", target=task_id, task_id=task_id, detail={"state": state}, session=session)
    await session.commit()
    await bus.publish(TaskUpdatedEvent(task=repo.task_to_model(row)))
    return row


async def cancel_task(session: AsyncSession, bus: Bus, task_id: str, by: str, ip: str | None = None) -> TaskRow | None:
    """Set the Redis cancel flag (the worker checks it between steps), expire approvals, mark cancelled."""
    row = await repo.get_task(session, task_id)
    if row is None:
        return None
    if row.state in TERMINAL_STATES:
        raise ValueError(f"task already {row.state}")
    try:
        await bus.redis.set(f"azzy:cancel:{task_id}", "1", ex=CANCEL_TTL)
    except Exception as exc:  # noqa: BLE001
        log.warning("cancel flag failed", extra={"fields": {"error": type(exc).__name__}})
    expired = await repo.expire_task_approvals(session, task_id)
    row = await repo.update_task(session, task_id, state="cancelled", result=f"cancelled by {by}")
    await audit_record(bus, actor=by, action="task.cancelled", target=task_id, task_id=task_id, detail={"approvals_expired": len(expired)}, ip=ip, session=session)
    await session.commit()
    for approval in expired:
        await bus.publish(ApprovalExpiredEvent(approval=repo.approval_to_model(approval)))
        await bus.notify_approval(approval.id, "expired")
    assert row is not None
    await bus.publish(TaskUpdatedEvent(task=repo.task_to_model(row)))
    return row


async def decide_approval(session: AsyncSession, bus: Bus, approval_id: str, status: str, decided_by: str, reason: str | None = None, ip: str | None = None) -> ApprovalRow | None:
    row = await repo.decide_approval(session, approval_id, status, decided_by, reason)
    if row is None:
        return None
    await audit_record(bus, actor=decided_by, action=f"approval.{status}", target=approval_id, task_id=row.task_id, detail={"tool": row.tool, "risk": row.risk, "reason": reason}, ip=ip, session=session)
    await session.commit()
    await bus.publish(ApprovalDecidedEvent(approval=repo.approval_to_model(row)))
    await bus.notify_approval(approval_id, status)
    return row


async def simulate_incident(
    session: AsyncSession, bus: Bus, *, env_id: str | None, title: str | None, source: str = "manual", severity: str = "sev2",
    reason: str | None = None, by: str = "system", ip: str | None = None,
) -> IncidentRow:
    env_id = env_id or "client-b-vps"
    env = await repo.get_environment(session, env_id)
    env_name = env.name if env else env_id
    title = title or f"Elevated 5xx on {env_name}"
    incident = await repo.create_incident(
        session, title=title, source=source, severity=severity, env_id=env_id, task_id=None,
        first_entry=reason or f"{'CloudWatch alarm' if source == 'cloudwatch' else 'Incident'} opened: {title}",
    )
    prompt = f"INCIDENT {severity.upper()} on {env_name}: {title}. Run the war room: triage, root cause, attack check, client update."
    task = await repo.create_task(
        session, title=f"War room: {title}", prompt=prompt, lead="jimmy", assignees=["jimmy", "emir", "cyber", "sara"],
        env_id=env_id, kind="incident", meta={"incident_id": incident.id}, created_by=by, steps_total=4,
    )
    incident.task_id = task.id
    await audit_record(bus, actor=by, action="incident.opened", target=incident.id, task_id=task.id, detail={"source": source, "severity": severity, "env_id": env_id}, ip=ip, session=session)
    await session.commit()
    await bus.publish(IncidentChangedEvent(incident=repo.incident_to_model(incident)))
    await bus.publish(TaskUpdatedEvent(task=repo.task_to_model(task)))
    await bus.enqueue_task(task.id)
    return incident


async def resolve_incident(session: AsyncSession, bus: Bus, incident_id: str, by: str) -> IncidentRow | None:
    row = await repo.incident_append(session, incident_id, text=f"Resolved manually by {by}", agent=None, status="resolved")
    if row is None:
        return None
    await audit_record(bus, actor=by, action="incident.resolved", target=incident_id, task_id=row.task_id, session=session)
    await session.commit()
    await bus.publish(IncidentChangedEvent(incident=repo.incident_to_model(row)))
    if await repo.open_incident_count(session) == 0:
        await repo.set_kv(session, "office", {"status": "nominal", "note": ""})
        await session.commit()
        await bus.publish(OfficeStatusEvent(status="nominal", note=""))
    return row


async def call_meeting(session: AsyncSession, bus: Bus, topic: str | None, by: str = "system") -> TaskRow | None:
    """Returns None when a meeting is already running (caller maps to 409).

    A meeting left non-terminal for over MEETING_STALE_MINUTES is stale —
    typically parked in a human-waiting pipeline state (needs_qa / needs_review)
    that nobody will ever advance. It is cancelled so that calling a fresh
    meeting works instead of 409-ing forever.
    """
    active = await repo.active_meeting_task(session)
    if active is not None:
        now = utcnow()
        created = active.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=now.tzinfo)
        if now - created <= timedelta(minutes=MEETING_STALE_MINUTES):
            return None
        stale_state = active.state
        stale = await repo.update_task(session, active.id, state="cancelled")
        await audit_record(bus, actor=by, action="meeting.auto_cancelled", target=active.id, task_id=active.id, detail={"was_state": stale_state}, session=session)
        await session.commit()
        if stale is not None:
            await bus.publish(TaskUpdatedEvent(task=repo.task_to_model(stale)))
        log.info("auto-cancelled stale meeting task %s (was %s)", active.id, stale_state)
    if not await bus.acquire_lock(MEETING_LOCK, MEETING_LOCK_TTL):
        return None
    topic = (topic or "Team sync").strip()
    task = await repo.create_task(
        session, title=f"Meeting: {topic}"[:200], prompt=f"Call a team meeting: {topic}", lead="sara",
        assignees=list(AGENT_IDS), env_id=None, kind="meeting", meta={"topic": topic}, created_by=by, steps_total=1,
    )
    await audit_record(bus, actor=by, action="meeting.called", target=task.id, task_id=task.id, detail={"topic": topic}, session=session)
    await _publish_new_task(session, bus, task)
    return task


async def run_routine(session: AsyncSession, bus: Bus, agent_id: str, routine_id: str, title: str, prompt: str, by: str = "scheduler") -> TaskRow:
    assignees = [agent_id] if agent_id == "sara" else [agent_id, "sara"]
    plan = build_plan("routine", agent_id, assignees)
    task = await repo.create_task(
        session, title=title, prompt=prompt, lead=agent_id, assignees=assignees, env_id=None, kind="routine",
        meta={"routine_id": routine_id}, created_by=by, steps_total=steps_total_for(plan),
    )
    await audit_record(bus, actor=by, action="routine.run", target=routine_id, task_id=task.id, session=session)
    await _publish_new_task(session, bus, task)
    return task


async def post_chat_message(session: AsyncSession, bus: Bus, *, conversation_id: str, agent: str, content: str, by: str) -> tuple[ChatMessageRow, TaskRow]:
    """Persist the user message, emit chat.message, enqueue a priority `chat` task."""
    user_row = await repo.add_chat_message(session, agent=agent, conversation_id=conversation_id, role="user", content=content, task_id=None)
    task = await repo.create_task(
        session, title=f"Chat with {agent}: {content[:50]}", prompt=content, lead=agent, assignees=[agent], env_id=None, kind="chat",
        meta={"conversation_id": conversation_id}, created_by=by, steps_total=1,
    )
    user_row.task_id = task.id
    await session.commit()
    await bus.publish(ChatMessageEvent(message=repo.chat_message_to_model(user_row)))
    await bus.publish(TaskUpdatedEvent(task=repo.task_to_model(task)))
    await bus.enqueue_task(task.id, priority=True)
    return user_row, task


async def notify_slack_approval(settings: Settings, approval: dict[str, Any]) -> None:
    """Best-effort Slack ping when an approval is requested."""
    if not settings.SLACK_WEBHOOK_URL:
        return
    base = (settings.PUBLIC_BASE_URL or "").rstrip("/")
    link = f"{base}/app/approvals" if base else "/app/approvals"
    text = f":rotating_light: *Approval needed* — {approval['agent']} wants `{approval['tool']}` ({approval['risk']}): {approval['summary']}\n{link}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(settings.SLACK_WEBHOOK_URL, json={"text": text})
    except Exception as exc:  # noqa: BLE001
        log.warning("slack notify failed", extra={"fields": {"error": type(exc).__name__}})
