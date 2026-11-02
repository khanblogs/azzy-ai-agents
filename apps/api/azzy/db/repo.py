"""Repository functions shared by the API and the worker. Each function takes an AsyncSession."""

from __future__ import annotations

import hashlib
import math
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, desc, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from azzy.costs import CostRow as CostTuple
from azzy.costs import daily_totals, hourly_series
from azzy.db.models import (
    EMBEDDING_DIM,
    AgentMessageRow,
    ApprovalRow,
    ArtifactRow,
    AuditRow,
    AwsAccountRow,
    ChatMessageRow,
    ContactMessageRow,
    ConversationRow,
    CostRow,
    DeploymentRow,
    DocumentChunkRow,
    DocumentRow,
    EnvironmentRow,
    EventLogRow,
    IncidentRow,
    MemoryRow,
    SettingRow,
    StateRow,
    TaskRow,
    ToolLogRow,
    UserRow,
    XpRow,
    utcnow,
)
from azzy.embeddings import cosine
from azzy.events import (
    TERMINAL_STATES,
    AgentMessage,
    Approval,
    AuditEntry,
    AwsAccount,
    ChatMessage,
    Deployment,
    Incident,
    Task,
    new_id,
    rank_for,
)

# ------------------------------------------------------------------------------------------
# serialisation helpers
# ------------------------------------------------------------------------------------------


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def task_to_model(row: TaskRow) -> Task:
    return Task(
        id=row.id, title=row.title, prompt=row.prompt, state=row.state, assignees=list(row.assignees or []),
        lead=row.lead, env_id=row.env_id, kind=row.kind, created_by=row.created_by, created_at=iso(row.created_at) or "",
        updated_at=iso(row.updated_at) or "", result=row.result, xp_awarded=row.xp_awarded or 0,
        steps_total=row.steps_total or 0, steps_done=row.steps_done or 0,
    )


def agent_message_to_model(row: AgentMessageRow) -> AgentMessage:
    return AgentMessage(
        id=row.id, task_id=row.task_id, from_agent=row.from_agent, to_agent=row.to_agent, type=row.type, content=row.content,
        artifacts=list(row.artifacts or []), status=row.status, created_at=iso(row.created_at) or "",
    )


def chat_message_to_model(row: ChatMessageRow) -> ChatMessage:
    return ChatMessage(
        id=row.id, agent=row.agent, conversation_id=row.conversation_id, role=row.role, content=row.content,
        task_id=row.task_id, created_at=iso(row.created_at) or "", streaming=bool(row.streaming),
    )


def deployment_to_model(row: DeploymentRow) -> Deployment:
    return Deployment(
        id=row.id, env_id=row.env_id, account_id=row.account_id, version=row.version, previous_version=row.previous_version,
        agent=row.agent, task_id=row.task_id, approval_id=row.approval_id, status=row.status, risk=row.risk,
        change_summary=row.change_summary or "", checks=list(row.checks or []), started_at=iso(row.started_at),
        finished_at=iso(row.finished_at), created_at=iso(row.created_at) or "",
    )


def account_to_model(row: AwsAccountRow) -> AwsAccount:
    return AwsAccount(
        id=row.id, name=row.name, account_id=row.account_id, role_arn=row.role_arn, has_external_id=bool(row.external_id_enc),
        scope=row.scope, regions=list(row.regions or []), stage=row.stage, status=row.status, permissions=list(row.permissions or []),
        last_verified=iso(row.last_verified), error=row.error, created_at=iso(row.created_at) or "", demo=bool(row.demo),
    )


def audit_to_model(row: AuditRow) -> AuditEntry:
    return AuditEntry(id=row.id, ts=iso(row.created_at) or "", actor=row.actor, action=row.action, target=row.target, task_id=row.task_id, detail=dict(row.detail or {}), ip=row.ip)


def user_to_dict(row: UserRow) -> dict[str, Any]:
    return {"id": row.id, "email": row.email, "role": row.role, "mfa_enabled": bool(row.mfa_secret), "disabled": bool(row.disabled), "created_at": iso(row.created_at), "last_login": iso(row.last_login)}


def conversation_to_dict(row: ConversationRow) -> dict[str, Any]:
    return {"id": row.id, "agent": row.agent, "user_email": row.user_email, "title": row.title, "created_at": iso(row.created_at), "updated_at": iso(row.updated_at)}


def document_to_dict(row: DocumentRow, with_content: bool = False) -> dict[str, Any]:
    out = {"id": row.id, "title": row.title, "source": row.source, "tags": list(row.tags or []), "scope": row.scope, "created_by": row.created_by, "created_at": iso(row.created_at), "chars": len(row.content or "")}
    if with_content:
        out["content"] = row.content
    return out


def artifact_to_dict(row: ArtifactRow) -> dict[str, Any]:
    return {"id": row.id, "agent": row.agent, "task_id": row.task_id, "kind": row.kind, "filename": row.filename, "path": row.path, "bytes": row.bytes, "created_at": iso(row.created_at)}


def approval_to_model(row: ApprovalRow) -> Approval:
    return Approval(
        id=row.id, task_id=row.task_id, agent=row.agent, tool=row.tool, risk=row.risk, summary=row.summary,
        args=dict(row.args or {}), env_id=row.env_id, status=row.status, created_at=iso(row.created_at) or "",
        decided_at=iso(row.decided_at), decided_by=row.decided_by, expires_at=iso(row.expires_at) or "",
    )


def incident_to_model(row: IncidentRow) -> Incident:
    return Incident(
        id=row.id, title=row.title, source=row.source, severity=row.severity, status=row.status,
        env_id=row.env_id, task_id=row.task_id, timeline=list(row.timeline or []),
        created_at=iso(row.created_at) or "", resolved_at=iso(row.resolved_at),
    )


def env_to_dict(row: EnvironmentRow) -> dict[str, Any]:
    return {
        "id": row.id, "name": row.name, "kind": row.kind, "stage": row.stage, "method": row.method, "target": row.target,
        "region": row.region, "account_id": row.account_id, "auto_allow": list(row.auto_allow or []),
        "allowed_roles": list(row.allowed_roles or []), "health": row.health, "version": row.version,
        "latency_ms": row.latency_ms, "last_checked": iso(row.last_checked), "has_external_id": bool(row.external_id),
        "secret_ref": row.secret_ref, "seeded": bool(row.seeded),
    }


def memory_to_dict(row: MemoryRow) -> dict[str, Any]:
    return {"id": row.id, "agent": row.agent, "task_id": row.task_id, "kind": row.kind, "text": row.text, "created_at": iso(row.created_at)}


def tool_log_to_dict(row: ToolLogRow) -> dict[str, Any]:
    return {
        "id": row.id, "ts": iso(row.created_at), "type": "tool.log", "agent": row.agent, "task_id": row.task_id,
        "tool": row.tool, "args": dict(row.args or {}), "output": row.output, "ok": bool(row.ok),
        "duration_ms": int(row.duration_ms or 0), "risk": row.risk,
    }


def cost_to_dict(row: CostRow) -> dict[str, Any]:
    return {
        "id": row.id, "ts": iso(row.created_at), "type": "cost.tick", "agent": row.agent, "task_id": row.task_id,
        "model": row.model, "input_tokens": row.input_tokens, "output_tokens": row.output_tokens, "usd": row.usd,
    }


# ------------------------------------------------------------------------------------------
# tasks
# ------------------------------------------------------------------------------------------


async def create_task(
    session: AsyncSession, *, title: str, prompt: str, lead: str | None, assignees: list[str], env_id: str | None,
    kind: str, state: str = "needs_work", meta: dict[str, Any] | None = None, task_id: str | None = None,
    created_by: str | None = None, steps_total: int = 0,
) -> TaskRow:
    row = TaskRow(
        id=task_id or new_id(), title=title[:200], prompt=prompt, state=state, assignees=assignees, lead=lead,
        env_id=env_id, kind=kind, created_by=created_by, result=None, xp_awarded=0, steps_total=steps_total, steps_done=0,
        meta=meta or {},
    )
    session.add(row)
    await session.flush()
    return row


async def get_task(session: AsyncSession, task_id: str) -> TaskRow | None:
    return await session.get(TaskRow, task_id)


async def list_tasks(session: AsyncSession, limit: int = 100, agent: str | None = None) -> list[TaskRow]:
    stmt = select(TaskRow).order_by(desc(TaskRow.created_at)).limit(limit)
    rows = list((await session.execute(stmt)).scalars())
    if agent:
        rows = [r for r in rows if agent in (r.assignees or []) or r.lead == agent]
    return rows


async def update_task(session: AsyncSession, task_id: str, **fields: Any) -> TaskRow | None:
    row = await session.get(TaskRow, task_id)
    if row is None:
        return None
    for key, value in fields.items():
        setattr(row, key, value)
    row.updated_at = utcnow()
    await session.flush()
    return row


async def active_meeting_task(session: AsyncSession) -> TaskRow | None:
    stmt = (
        select(TaskRow)
        .where(TaskRow.kind == "meeting", TaskRow.state.not_in(list(TERMINAL_STATES)))
        .order_by(desc(TaskRow.created_at))
        .limit(1)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def active_tasks(session: AsyncSession, limit: int = 50) -> list[TaskRow]:
    stmt = select(TaskRow).where(TaskRow.state.not_in(list(TERMINAL_STATES))).order_by(desc(TaskRow.created_at)).limit(limit)
    return list((await session.execute(stmt)).scalars())


async def task_counts(session: AsyncSession) -> dict[str, int]:
    rows = (await session.execute(select(TaskRow.state, func.count()).group_by(TaskRow.state))).all()
    counts = {state: int(n) for state, n in rows}
    active = sum(n for state, n in counts.items() if state not in TERMINAL_STATES)
    return {"active": active, "done": counts.get("done", 0), "failed": counts.get("failed", 0), "cancelled": counts.get("cancelled", 0), **counts}


async def expire_task_approvals(session: AsyncSession, task_id: str) -> list[ApprovalRow]:
    stmt = select(ApprovalRow).where(ApprovalRow.task_id == task_id, ApprovalRow.status == "pending")
    rows = list((await session.execute(stmt)).scalars())
    for row in rows:
        row.status = "expired"
        row.decided_at = utcnow()
        row.decided_by = "system"
        row.reason = "task cancelled"
    await session.flush()
    return rows


# ------------------------------------------------------------------------------------------
# approvals
# ------------------------------------------------------------------------------------------


async def create_approval(
    session: AsyncSession, *, task_id: str, agent: str, tool: str, risk: str, summary: str, args: dict[str, Any],
    env_id: str | None, timeout_seconds: int,
) -> ApprovalRow:
    now = utcnow()
    row = ApprovalRow(
        id=new_id(), task_id=task_id, agent=agent, tool=tool, risk=risk, summary=summary[:2000], args=args,
        env_id=env_id, status="pending", created_at=now, expires_at=now + timedelta(seconds=timeout_seconds),
    )
    session.add(row)
    await session.flush()
    return row


async def get_approval(session: AsyncSession, approval_id: str) -> ApprovalRow | None:
    return await session.get(ApprovalRow, approval_id)


async def list_approvals(session: AsyncSession, status: str = "all", decided_limit: int = 50) -> list[ApprovalRow]:
    pending = list((await session.execute(select(ApprovalRow).where(ApprovalRow.status == "pending").order_by(desc(ApprovalRow.created_at)))).scalars())
    if status == "pending":
        return pending
    decided = list(
        (await session.execute(select(ApprovalRow).where(ApprovalRow.status != "pending").order_by(desc(ApprovalRow.created_at)).limit(decided_limit))).scalars()
    )
    return pending + decided


async def decide_approval(session: AsyncSession, approval_id: str, status: str, decided_by: str, reason: str | None = None) -> ApprovalRow | None:
    row = await session.get(ApprovalRow, approval_id)
    if row is None or row.status != "pending":
        return row
    row.status = status
    row.decided_at = utcnow()
    row.decided_by = decided_by
    row.reason = reason
    await session.flush()
    return row


async def expire_stale_approvals(session: AsyncSession) -> list[ApprovalRow]:
    stmt = select(ApprovalRow).where(ApprovalRow.status == "pending", ApprovalRow.expires_at < utcnow())
    rows = list((await session.execute(stmt)).scalars())
    for row in rows:
        row.status = "expired"
        row.decided_at = utcnow()
        row.decided_by = "system"
    await session.flush()
    return rows


# ------------------------------------------------------------------------------------------
# incidents
# ------------------------------------------------------------------------------------------


async def create_incident(
    session: AsyncSession, *, title: str, source: str, severity: str, env_id: str | None, task_id: str | None,
    first_entry: str,
) -> IncidentRow:
    row = IncidentRow(
        id=new_id(), title=title[:200], source=source, severity=severity, status="open", env_id=env_id,
        task_id=task_id, timeline=[{"ts": iso(utcnow()), "agent": None, "text": first_entry}],
    )
    session.add(row)
    await session.flush()
    return row


async def get_incident(session: AsyncSession, incident_id: str) -> IncidentRow | None:
    return await session.get(IncidentRow, incident_id)


async def list_incidents(session: AsyncSession, closed_limit: int = 20) -> list[IncidentRow]:
    open_rows = list((await session.execute(select(IncidentRow).where(IncidentRow.status != "resolved").order_by(desc(IncidentRow.created_at)))).scalars())
    closed = list((await session.execute(select(IncidentRow).where(IncidentRow.status == "resolved").order_by(desc(IncidentRow.created_at)).limit(closed_limit))).scalars())
    return open_rows + closed


async def open_incident_count(session: AsyncSession, env_id: str | None = None) -> int:
    stmt = select(func.count()).select_from(IncidentRow).where(IncidentRow.status != "resolved")
    if env_id:
        stmt = stmt.where(IncidentRow.env_id == env_id)
    return int((await session.execute(stmt)).scalar_one())


async def incident_append(
    session: AsyncSession, incident_id: str, *, text: str, agent: str | None = None, status: str | None = None,
) -> IncidentRow | None:
    row = await session.get(IncidentRow, incident_id)
    if row is None:
        return None
    timeline = list(row.timeline or [])
    timeline.append({"ts": iso(utcnow()), "agent": agent, "text": text[:500]})
    row.timeline = timeline
    if status:
        row.status = status
        if status == "resolved":
            row.resolved_at = utcnow()
    await session.flush()
    return row


# ------------------------------------------------------------------------------------------
# environments
# ------------------------------------------------------------------------------------------


async def list_environments(session: AsyncSession) -> list[EnvironmentRow]:
    return list((await session.execute(select(EnvironmentRow).order_by(EnvironmentRow.created_at))).scalars())


async def get_environment(session: AsyncSession, env_id: str) -> EnvironmentRow | None:
    return await session.get(EnvironmentRow, env_id)


def slugify(name: str) -> str:
    slug = "".join(c.lower() if c.isalnum() else "-" for c in name).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug[:60] or "env"


async def create_environment(session: AsyncSession, **fields: Any) -> EnvironmentRow:
    base = slugify(str(fields.get("name", "env")))
    env_id = base
    suffix = 2
    while await session.get(EnvironmentRow, env_id) is not None:
        env_id = f"{base}-{suffix}"
        suffix += 1
    row = EnvironmentRow(id=env_id, health="unknown", seeded=False, **fields)
    session.add(row)
    await session.flush()
    return row


async def delete_environment(session: AsyncSession, env_id: str) -> bool:
    row = await session.get(EnvironmentRow, env_id)
    if row is None or row.seeded:
        return False
    await session.delete(row)
    await session.flush()
    return True


async def set_env_health(
    session: AsyncSession, env_id: str, *, health: str, latency_ms: int | None, version: str | None = None,
) -> EnvironmentRow | None:
    row = await session.get(EnvironmentRow, env_id)
    if row is None:
        return None
    row.health = health
    row.latency_ms = latency_ms
    row.last_checked = utcnow()
    if version:
        row.version = version
    await session.flush()
    return row


async def set_env_version(session: AsyncSession, env_id: str, version: str) -> None:
    await session.execute(update(EnvironmentRow).where(EnvironmentRow.id == env_id).values(version=version))


# ------------------------------------------------------------------------------------------
# memories (pgvector)
# ------------------------------------------------------------------------------------------


def demo_embedding(text: str, dim: int = EMBEDDING_DIM) -> list[float]:
    """Deterministic hash-derived unit vector, so DEMO still exercises the vector column."""
    values: list[float] = []
    counter = 0
    while len(values) < dim:
        digest = hashlib.sha256(f"{counter}:{text}".encode()).digest()
        values.extend((b - 127.5) / 127.5 for b in digest)
        counter += 1
    values = values[:dim]
    norm = math.sqrt(sum(v * v for v in values)) or 1.0
    return [round(v / norm, 6) for v in values]


async def add_memory(
    session: AsyncSession, *, agent: str, task_id: str | None, kind: str, text: str, embedding: list[float] | None,
) -> MemoryRow:
    row = MemoryRow(id=new_id(), agent=agent, task_id=task_id, kind=kind, text=text[:2000], embedding=embedding)
    session.add(row)
    await session.flush()
    return row


async def list_memories(session: AsyncSession, *, agent: str | None = None, task_id: str | None = None, limit: int = 50) -> list[MemoryRow]:
    stmt = select(MemoryRow).order_by(desc(MemoryRow.created_at)).limit(limit)
    if agent:
        stmt = stmt.where(MemoryRow.agent == agent)
    if task_id:
        stmt = stmt.where(MemoryRow.task_id == task_id)
    return list((await session.execute(stmt)).scalars())


async def delete_memory(session: AsyncSession, agent: str, memory_id: str) -> bool:
    row = await session.get(MemoryRow, memory_id)
    if row is None or row.agent != agent:
        return False
    await session.delete(row)
    await session.flush()
    return True


async def similar_memories(session: AsyncSession, agent: str, embedding: list[float], limit: int = 5) -> list[MemoryRow]:
    stmt = (
        select(MemoryRow)
        .where(MemoryRow.agent == agent, MemoryRow.embedding.is_not(None))
        .order_by(MemoryRow.embedding.cosine_distance(embedding))
        .limit(limit)
    )
    return list((await session.execute(stmt)).scalars())


# ------------------------------------------------------------------------------------------
# tool logs / costs / audit
# ------------------------------------------------------------------------------------------


async def add_tool_log(
    session: AsyncSession, *, log_id: str, agent: str, task_id: str | None, tool: str, args: dict[str, Any], output: str,
    ok: bool, duration_ms: int, risk: str,
) -> ToolLogRow:
    row = ToolLogRow(id=log_id, agent=agent, task_id=task_id, tool=tool, args=args, output=output[:20000], ok=ok, duration_ms=duration_ms, risk=risk)
    session.add(row)
    await session.flush()
    return row


async def list_tool_logs(session: AsyncSession, *, task_id: str | None = None, agent: str | None = None, limit: int = 100) -> list[ToolLogRow]:
    stmt = select(ToolLogRow).order_by(desc(ToolLogRow.created_at)).limit(limit)
    if task_id:
        stmt = stmt.where(ToolLogRow.task_id == task_id)
    if agent:
        stmt = stmt.where(ToolLogRow.agent == agent)
    rows = list((await session.execute(stmt)).scalars())
    rows.reverse()  # chronological for the UI log
    return rows


async def add_cost(
    session: AsyncSession, *, agent: str, task_id: str | None, model: str, input_tokens: int, output_tokens: int, usd: float,
) -> CostRow:
    row = CostRow(id=new_id(), agent=agent, task_id=task_id, model=model, input_tokens=input_tokens, output_tokens=output_tokens, usd=usd)
    session.add(row)
    await session.flush()
    return row


async def cost_rows_since(session: AsyncSession, since: datetime) -> list[CostRow]:
    stmt = select(CostRow).where(CostRow.created_at >= since).order_by(CostRow.created_at)
    return list((await session.execute(stmt)).scalars())


async def cost_summary(session: AsyncSession, budget_usd: float) -> dict[str, Any]:
    now = datetime.now(UTC)
    rows = await cost_rows_since(session, now - timedelta(hours=24))
    tuples = [CostTuple(r.created_at, r.agent, r.usd) for r in rows]
    today_usd, per_agent = daily_totals(tuples, now)
    return {
        "today_usd": today_usd,
        "budget_usd": budget_usd,
        "per_agent": per_agent,
        "series": hourly_series(tuples, hours=24, now=now),
        "recent": [cost_to_dict(r) for r in rows[-30:]][::-1],
    }


async def agent_spent_today(session: AsyncSession, agent: str) -> float:
    start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    total = (await session.execute(select(func.coalesce(func.sum(CostRow.usd), 0.0)).where(CostRow.agent == agent, CostRow.created_at >= start))).scalar_one()
    return float(total or 0.0)


async def add_event_log(session: AsyncSession, *, event_id: str, type_: str, agent: str | None, task_id: str | None, payload: dict[str, Any]) -> None:
    session.add(EventLogRow(id=event_id, type=type_, agent=agent, task_id=task_id, payload=payload))


async def add_audit(session: AsyncSession, *, actor: str, action: str, target: str | None = None, task_id: str | None = None, detail: dict[str, Any] | None = None, ip: str | None = None) -> AuditRow:
    row = AuditRow(id=new_id(), actor=actor[:200], action=action[:64], target=(target or None) and str(target)[:300], task_id=task_id, detail=detail or {}, ip=ip)
    session.add(row)
    await session.flush()
    return row


async def list_audit(session: AsyncSession, *, limit: int = 100, before: datetime | None = None, action: str | None = None, actor: str | None = None) -> list[AuditRow]:
    stmt = select(AuditRow).order_by(desc(AuditRow.created_at)).limit(limit)
    if before is not None:
        stmt = stmt.where(AuditRow.created_at < before)
    if action:
        stmt = stmt.where(AuditRow.action.like(f"{action}%"))
    if actor:
        stmt = stmt.where(AuditRow.actor == actor)
    return list((await session.execute(stmt)).scalars())


async def recent_updates(session: AsyncSession, limit: int = 20) -> list[dict[str, Any]]:
    """Last `limit` agent.say + task.updated entries for the LED wall."""
    stmt = (
        select(EventLogRow)
        .where(EventLogRow.type.in_(["agent.say", "task.updated"]))
        .order_by(desc(EventLogRow.created_at))
        .limit(limit)
    )
    out: list[dict[str, Any]] = []
    for row in (await session.execute(stmt)).scalars():
        payload = row.payload or {}
        if row.type == "agent.say":
            text = str(payload.get("text", ""))
        else:
            task = payload.get("task") or {}
            text = f"{task.get('title', 'task')} → {task.get('state', '')}"
        out.append({"ts": iso(row.created_at), "agent": row.agent, "text": text})
    return out


# ------------------------------------------------------------------------------------------
# xp / kv
# ------------------------------------------------------------------------------------------


async def get_xp(session: AsyncSession) -> dict[str, XpRow]:
    return {row.agent: row for row in (await session.execute(select(XpRow))).scalars()}


async def add_xp(session: AsyncSession, agent: str, amount: int, *, task_done: bool = False, approval_requested: bool = False) -> tuple[int, str]:
    row = await session.get(XpRow, agent)
    if row is None:
        row = XpRow(agent=agent, total_xp=0, tasks_done=0, approvals_requested=0)
        session.add(row)
    row.total_xp = (row.total_xp or 0) + amount
    if task_done:
        row.tasks_done = (row.tasks_done or 0) + 1
    if approval_requested:
        row.approvals_requested = (row.approvals_requested or 0) + 1
    await session.flush()
    return row.total_xp, rank_for(row.total_xp)


async def get_kv(session: AsyncSession, key: str, default: dict[str, Any] | None = None) -> dict[str, Any]:
    row = await session.get(StateRow, key)
    return dict(row.value) if row is not None else dict(default or {})


async def set_kv(session: AsyncSession, key: str, value: dict[str, Any]) -> None:
    row = await session.get(StateRow, key)
    if row is None:
        session.add(StateRow(key=key, value=value))
    else:
        row.value = value
    await session.flush()


async def purge_old(session: AsyncSession, *, event_days: int = 30, knowledge_days: int = 365, memory_days: int = 180) -> dict[str, int]:
    """Retention sweep. Returns counts per table."""
    now = datetime.now(UTC)
    counts: dict[str, int] = {}
    counts["event_log"] = (await session.execute(delete(EventLogRow).where(EventLogRow.created_at < now - timedelta(days=event_days)))).rowcount or 0
    counts["memories"] = (await session.execute(delete(MemoryRow).where(MemoryRow.created_at < now - timedelta(days=memory_days)))).rowcount or 0
    counts["documents"] = (await session.execute(delete(DocumentRow).where(DocumentRow.created_at < now - timedelta(days=knowledge_days), DocumentRow.source != "seed"))).rowcount or 0
    return counts


# ------------------------------------------------------------------------------------------
# users
# ------------------------------------------------------------------------------------------


async def get_user_by_email(session: AsyncSession, email: str) -> UserRow | None:
    return (await session.execute(select(UserRow).where(UserRow.email == email.lower()))).scalar_one_or_none()


async def get_user(session: AsyncSession, user_id: str) -> UserRow | None:
    return await session.get(UserRow, user_id)


async def list_users(session: AsyncSession) -> list[UserRow]:
    return list((await session.execute(select(UserRow).order_by(UserRow.created_at))).scalars())


async def create_user(session: AsyncSession, *, email: str, password_hash: str, role: str, seed_hash: str | None = None) -> UserRow:
    row = UserRow(id=new_id(), email=email.lower(), password_hash=password_hash, role=role, seed_hash=seed_hash, disabled=False)
    session.add(row)
    await session.flush()
    return row


async def admin_count(session: AsyncSession) -> int:
    return int((await session.execute(select(func.count()).select_from(UserRow).where(UserRow.role == "admin", UserRow.disabled.is_(False)))).scalar_one())


async def disabled_emails(session: AsyncSession) -> set[str]:
    return {row.email for row in (await session.execute(select(UserRow).where(UserRow.disabled.is_(True)))).scalars()}


# ------------------------------------------------------------------------------------------
# conversations / chat
# ------------------------------------------------------------------------------------------


async def create_conversation(session: AsyncSession, *, agent: str, user_email: str, title: str) -> ConversationRow:
    row = ConversationRow(id=new_id(), agent=agent, user_email=user_email.lower(), title=title[:200])
    session.add(row)
    await session.flush()
    return row


async def get_conversation(session: AsyncSession, conversation_id: str) -> ConversationRow | None:
    return await session.get(ConversationRow, conversation_id)


async def list_conversations(session: AsyncSession, *, agent: str, user_email: str | None, limit: int = 50) -> list[ConversationRow]:
    stmt = select(ConversationRow).where(ConversationRow.agent == agent).order_by(desc(ConversationRow.updated_at)).limit(limit)
    if user_email:
        stmt = stmt.where(ConversationRow.user_email == user_email.lower())
    return list((await session.execute(stmt)).scalars())


async def delete_conversation(session: AsyncSession, conversation_id: str) -> None:
    await session.execute(delete(ChatMessageRow).where(ChatMessageRow.conversation_id == conversation_id))
    await session.execute(delete(ConversationRow).where(ConversationRow.id == conversation_id))


async def add_chat_message(session: AsyncSession, *, agent: str, conversation_id: str, role: str, content: str, task_id: str | None, streaming: bool = False, message_id: str | None = None) -> ChatMessageRow:
    row = ChatMessageRow(id=message_id or new_id(), agent=agent, conversation_id=conversation_id, role=role, content=content, task_id=task_id, streaming=streaming)
    session.add(row)
    conversation = await session.get(ConversationRow, conversation_id)
    if conversation is not None:
        conversation.updated_at = utcnow()
        if role == "user" and conversation.title == "New conversation":
            conversation.title = content.strip()[:80] or conversation.title
    await session.flush()
    return row


async def update_chat_message(session: AsyncSession, message_id: str, *, content: str, streaming: bool) -> ChatMessageRow | None:
    row = await session.get(ChatMessageRow, message_id)
    if row is None:
        return None
    row.content = content
    row.streaming = streaming
    await session.flush()
    return row


async def list_chat_messages(session: AsyncSession, conversation_id: str, limit: int = 200) -> list[ChatMessageRow]:
    stmt = select(ChatMessageRow).where(ChatMessageRow.conversation_id == conversation_id).order_by(desc(ChatMessageRow.created_at)).limit(limit)
    rows = list((await session.execute(stmt)).scalars())
    rows.reverse()
    return rows


# ------------------------------------------------------------------------------------------
# agent messages (collaboration)
# ------------------------------------------------------------------------------------------


async def add_agent_message(session: AsyncSession, *, task_id: str, from_agent: str, to_agent: str | None, type_: str, content: str, artifacts: list[dict[str, Any]] | None = None, status: str = "sent") -> AgentMessageRow:
    row = AgentMessageRow(id=new_id(), task_id=task_id, from_agent=from_agent, to_agent=to_agent, type=type_, content=content[:4000], artifacts=artifacts or [], status=status)
    session.add(row)
    await session.flush()
    return row


async def list_agent_messages(session: AsyncSession, task_id: str, limit: int = 200) -> list[AgentMessageRow]:
    stmt = select(AgentMessageRow).where(AgentMessageRow.task_id == task_id).order_by(AgentMessageRow.created_at).limit(limit)
    return list((await session.execute(stmt)).scalars())


async def recent_agent_messages(session: AsyncSession, *, since: datetime, limit: int = 500) -> list[AgentMessageRow]:
    stmt = select(AgentMessageRow).where(AgentMessageRow.created_at >= since).order_by(desc(AgentMessageRow.created_at)).limit(limit)
    return list((await session.execute(stmt)).scalars())


async def count_agent_messages(session: AsyncSession, task_id: str) -> int:
    return int((await session.execute(select(func.count()).select_from(AgentMessageRow).where(AgentMessageRow.task_id == task_id))).scalar_one())


# ------------------------------------------------------------------------------------------
# AWS accounts
# ------------------------------------------------------------------------------------------


async def list_accounts(session: AsyncSession) -> list[AwsAccountRow]:
    return list((await session.execute(select(AwsAccountRow).order_by(AwsAccountRow.created_at))).scalars())


async def get_account(session: AsyncSession, account_id: str) -> AwsAccountRow | None:
    return await session.get(AwsAccountRow, account_id)


async def get_account_by_aws_id(session: AsyncSession, aws_account_id: str) -> AwsAccountRow | None:
    return (await session.execute(select(AwsAccountRow).where(AwsAccountRow.account_id == aws_account_id).limit(1))).scalar_one_or_none()


async def create_account(session: AsyncSession, **fields: Any) -> AwsAccountRow:
    row = AwsAccountRow(id=fields.pop("id", None) or new_id(), status="pending", **fields)
    session.add(row)
    await session.flush()
    return row


async def delete_account(session: AsyncSession, account_id: str) -> bool:
    row = await session.get(AwsAccountRow, account_id)
    if row is None:
        return False
    await session.delete(row)
    await session.flush()
    return True


# ------------------------------------------------------------------------------------------
# deployments
# ------------------------------------------------------------------------------------------


async def create_deployment(session: AsyncSession, **fields: Any) -> DeploymentRow:
    row = DeploymentRow(id=new_id(), **fields)
    session.add(row)
    await session.flush()
    return row


async def get_deployment(session: AsyncSession, deployment_id: str) -> DeploymentRow | None:
    return await session.get(DeploymentRow, deployment_id)


async def update_deployment(session: AsyncSession, deployment_id: str, **fields: Any) -> DeploymentRow | None:
    row = await session.get(DeploymentRow, deployment_id)
    if row is None:
        return None
    for key, value in fields.items():
        setattr(row, key, value)
    await session.flush()
    return row


async def list_deployments(session: AsyncSession, *, env_id: str | None = None, limit: int = 50) -> list[DeploymentRow]:
    stmt = select(DeploymentRow).order_by(desc(DeploymentRow.created_at)).limit(limit)
    if env_id:
        stmt = stmt.where(DeploymentRow.env_id == env_id)
    return list((await session.execute(stmt)).scalars())


async def last_deployment(session: AsyncSession) -> DeploymentRow | None:
    return (await session.execute(select(DeploymentRow).order_by(desc(DeploymentRow.created_at)).limit(1))).scalar_one_or_none()


# ------------------------------------------------------------------------------------------
# knowledge
# ------------------------------------------------------------------------------------------


async def create_document(session: AsyncSession, *, title: str, source: str, content: str, tags: list[str], scope: str, embedding: list[float] | None, created_by: str | None, chunks: list[tuple[str, list[float] | None]]) -> DocumentRow:
    row = DocumentRow(id=new_id(), title=title[:200], source=source[:200], content=content, tags=tags, scope=scope, embedding=embedding, created_by=created_by)
    session.add(row)
    await session.flush()
    for idx, (chunk, vector) in enumerate(chunks):
        session.add(DocumentChunkRow(id=new_id(), document_id=row.id, idx=idx, content=chunk, embedding=vector))
    await session.flush()
    return row


async def list_documents(session: AsyncSession, *, scopes: set[str] | None = None, limit: int = 200) -> list[DocumentRow]:
    stmt = select(DocumentRow).order_by(desc(DocumentRow.created_at)).limit(limit)
    if scopes is not None:
        stmt = stmt.where(DocumentRow.scope.in_(sorted(scopes)))
    return list((await session.execute(stmt)).scalars())


async def get_document(session: AsyncSession, document_id: str) -> DocumentRow | None:
    return await session.get(DocumentRow, document_id)


async def delete_document(session: AsyncSession, document_id: str) -> bool:
    row = await session.get(DocumentRow, document_id)
    if row is None:
        return False
    await session.execute(delete(DocumentChunkRow).where(DocumentChunkRow.document_id == document_id))
    await session.delete(row)
    await session.flush()
    return True


async def document_count(session: AsyncSession) -> int:
    return int((await session.execute(select(func.count()).select_from(DocumentRow))).scalar_one())


async def search_chunks(session: AsyncSession, *, embedding: list[float], scopes: set[str], limit: int = 8) -> list[dict[str, Any]]:
    """pgvector cosine search over chunks restricted to visible scopes; falls back to Python cosine."""
    stmt = (
        select(DocumentChunkRow, DocumentRow)
        .join(DocumentRow, DocumentRow.id == DocumentChunkRow.document_id)
        .where(DocumentRow.scope.in_(sorted(scopes)), DocumentChunkRow.embedding.is_not(None))
        .order_by(DocumentChunkRow.embedding.cosine_distance(embedding))
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    out: list[dict[str, Any]] = []
    for chunk, document in rows:
        score = cosine(list(chunk.embedding), embedding) if chunk.embedding is not None else 0.0
        out.append({"document_id": document.id, "title": document.title, "chunk": chunk.content, "score": float(round(score, 4)), "scope": document.scope})
    return out

def _lexical_terms(query: str) -> list[str]:
    """Distinct query terms (>=3 chars, max 8) used by the lexical fallbacks."""
    seen: list[str] = []
    for term in re.split(r"[^a-z0-9]+", query.lower()):
        if len(term) >= 3 and term not in seen:
            seen.append(term)
    return seen[:8]


async def search_chunks_lexical(session: AsyncSession, *, query: str, scopes: set[str], limit: int = 8) -> list[dict[str, Any]]:
    """Keyword fallback for knowledge search when embeddings are unavailable or return no
    hits: ILIKE match over chunk text, ranked in Python by the fraction of query terms
    present. Same result shape as search_chunks, so callers cannot tell the difference."""
    terms = _lexical_terms(query)
    if not terms:
        return []
    stmt = (
        select(DocumentChunkRow, DocumentRow)
        .join(DocumentRow, DocumentRow.id == DocumentChunkRow.document_id)
        .where(DocumentRow.scope.in_(sorted(scopes)), or_(*[DocumentChunkRow.content.ilike(f"%{t}%") for t in terms]))
        .limit(limit * 4)
    )
    rows = (await session.execute(stmt)).all()
    scored: list[tuple[float, dict[str, Any]]] = []
    for chunk, document in rows:
        text = chunk.content.lower()
        hits = sum(1 for t in terms if t in text)
        if hits:
            score = round(hits / len(terms), 4)
            scored.append((score, {"document_id": document.id, "title": document.title, "chunk": chunk.content, "score": score, "scope": document.scope}))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in scored[:limit]]


async def search_memories(session: AsyncSession, *, agent: str, embedding: list[float], limit: int = 5) -> list[MemoryRow]:
    """Semantic recall over an agent's memories (an embedding is stored at write time);
    nearest-first by pgvector cosine distance."""
    stmt = (
        select(MemoryRow)
        .where(MemoryRow.agent == agent, MemoryRow.embedding.is_not(None))
        .order_by(MemoryRow.embedding.cosine_distance(embedding))
        .limit(limit)
    )
    return list((await session.execute(stmt)).scalars().all())



# ------------------------------------------------------------------------------------------
# artifacts / settings / contact
# ------------------------------------------------------------------------------------------


async def add_artifact(session: AsyncSession, *, agent: str, task_id: str | None, kind: str, filename: str, path: str, size: int) -> ArtifactRow:
    row = ArtifactRow(id=new_id(), agent=agent, task_id=task_id, kind=kind, filename=filename[:200], path=path[:500], bytes=size)
    session.add(row)
    await session.flush()
    return row


async def list_artifacts(session: AsyncSession, limit: int = 100) -> list[ArtifactRow]:
    return list((await session.execute(select(ArtifactRow).order_by(desc(ArtifactRow.created_at)).limit(limit))).scalars())


async def get_artifact(session: AsyncSession, artifact_id: str) -> ArtifactRow | None:
    return await session.get(ArtifactRow, artifact_id)


async def get_settings_overrides(session: AsyncSession) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for row in (await session.execute(select(SettingRow))).scalars():
        out[row.key] = row.value.get("value") if isinstance(row.value, dict) else row.value
    return out


async def set_setting(session: AsyncSession, key: str, value: Any, by: str) -> None:
    row = await session.get(SettingRow, key)
    if row is None:
        session.add(SettingRow(key=key, value={"value": value}, updated_by=by))
    else:
        row.value = {"value": value}
        row.updated_by = by
    await session.flush()


async def add_contact_message(session: AsyncSession, *, name: str, email: str, message: str, ip: str | None) -> ContactMessageRow:
    row = ContactMessageRow(id=new_id(), name=name[:120], email=email[:200], message=message[:5000], ip=ip)
    session.add(row)
    await session.flush()
    return row


async def list_contact_messages(session: AsyncSession, limit: int = 100) -> list[dict[str, Any]]:
    rows = (await session.execute(select(ContactMessageRow).order_by(desc(ContactMessageRow.created_at)).limit(limit))).scalars()
    return [{"id": r.id, "name": r.name, "email": r.email, "message": r.message, "read": r.read, "created_at": iso(r.created_at)} for r in rows]


async def last_scan_log(session: AsyncSession) -> ToolLogRow | None:
    stmt = select(ToolLogRow).where(ToolLogRow.tool.like("%.scan")).order_by(desc(ToolLogRow.created_at)).limit(1)
    return (await session.execute(stmt)).scalar_one_or_none()
