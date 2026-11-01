"""Core REST routers: auth, state, tasks, approvals, incidents, environments, meeting, costs,
agents, team, routines, webhooks (mounted under /api by main.py). v2 routers live in routes_v2.py."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from azzy.agents.loader import get_agents
from azzy.api.deps import DB, AdminDep, BusDep, PrincipalDep, SettingsDep, WriterDep, forbid
from azzy.api.state import agent_summaries, state_snapshot
from azzy.audit import record as audit_record
from azzy.auth import (
    LOGIN_RATE_LIMIT,
    check_password,
    clear_session_cookie,
    client_ip,
    issue_token,
    rate_limited,
    set_session_cookie,
    verify_webhook_secret,
)
from azzy.bus import Bus
from azzy.config import Settings
from azzy.crypto import decrypt, encrypt, new_totp_secret, otpauth_uri, verify_totp
from azzy.db import repo
from azzy.events import AGENT_META, PipelineState, rank_for
from azzy.health import probe_environment
from azzy.orchestrator import service
from azzy.policy import get_policy
from azzy.rbac import Principal, can_cancel_task, can_decide_approval
from azzy.scheduler import find_routine, list_routines

log = logging.getLogger("azzy.api")

public = APIRouter()  # no auth
protected = APIRouter(dependencies=[PrincipalDep])


# ---------------------------------------------------------------------------- auth


class LoginBody(BaseModel):
    email: str
    password: str
    otp: str | None = None


@public.post("/auth/login")
async def login(body: LoginBody, request: Request, response: Response, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    ip = client_ip(request)
    if await rate_limited(bus, f"login:{ip}", LOGIN_RATE_LIMIT):
        raise HTTPException(status_code=429, detail="too many login attempts; try again in a minute")
    email = body.email.strip().lower()
    user = await repo.get_user_by_email(session, email)
    ok = user is not None and not user.disabled and check_password(body.password, user.password_hash)
    if not ok:
        await audit_record(bus, actor=email or "unknown", action="auth.login", detail={"ok": False, "reason": "bad credentials"}, ip=ip, session=session)
        raise HTTPException(status_code=401, detail="invalid email or password")
    assert user is not None
    if user.mfa_secret:
        try:
            secret = decrypt(user.mfa_secret)
        except ValueError:
            secret = ""
        if not body.otp or not secret or not verify_totp(secret, body.otp):
            await audit_record(bus, actor=email, action="auth.login", detail={"ok": False, "reason": "mfa_required"}, ip=ip, session=session)
            raise HTTPException(status_code=403, detail="mfa_required")
    user.last_login = datetime.now(UTC)
    set_session_cookie(response, issue_token(user.email, user.role), request)
    await audit_record(bus, actor=email, action="auth.login", detail={"ok": True, "role": user.role, "mfa": bool(user.mfa_secret)}, ip=ip, session=session)
    return {"ok": True, "email": user.email, "role": user.role}


@public.post("/auth/logout")
async def logout(request: Request, response: Response, bus: Bus = BusDep) -> dict[str, Any]:
    clear_session_cookie(response)
    from azzy.auth import _principal_from_cookie  # noqa: PLC0415

    principal = _principal_from_cookie(request.cookies)
    if principal:
        await audit_record(bus, actor=principal.email, action="auth.logout", ip=client_ip(request))
    return {"ok": True}


@protected.get("/auth/me")
async def me(principal: Principal = PrincipalDep, session: AsyncSession = DB) -> dict[str, Any]:
    user = await repo.get_user_by_email(session, principal.email)
    return {"email": principal.email, "role": principal.role, "mfa_enabled": bool(user and user.mfa_secret)}


class OtpBody(BaseModel):
    otp: str = Field(min_length=6, max_length=8)


@protected.post("/auth/mfa/setup")
async def mfa_setup(principal: Principal = PrincipalDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    user = await repo.get_user_by_email(session, principal.email)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    secret = new_totp_secret()
    await bus.redis.set(f"azzy:mfa:pending:{principal.email}", encrypt(secret), ex=600)
    return {"secret": secret, "otpauth_uri": otpauth_uri(secret, principal.email)}


@protected.post("/auth/mfa/enable")
async def mfa_enable(body: OtpBody, request: Request, principal: Principal = PrincipalDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    pending = await bus.redis.get(f"azzy:mfa:pending:{principal.email}")
    if not pending:
        raise HTTPException(status_code=400, detail="run /auth/mfa/setup first")
    secret = decrypt(pending)
    if not verify_totp(secret, body.otp):
        raise HTTPException(status_code=400, detail="invalid otp")
    user = await repo.get_user_by_email(session, principal.email)
    assert user is not None
    user.mfa_secret = encrypt(secret)
    await bus.redis.delete(f"azzy:mfa:pending:{principal.email}")
    await audit_record(bus, actor=principal.email, action="auth.mfa_enabled", ip=client_ip(request), session=session)
    return {"ok": True, "mfa_enabled": True}


@protected.post("/auth/mfa/disable")
async def mfa_disable(body: OtpBody, request: Request, principal: Principal = PrincipalDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    user = await repo.get_user_by_email(session, principal.email)
    if user is None or not user.mfa_secret:
        raise HTTPException(status_code=400, detail="mfa is not enabled")
    if not verify_totp(decrypt(user.mfa_secret), body.otp):
        raise HTTPException(status_code=400, detail="invalid otp")
    user.mfa_secret = None
    await audit_record(bus, actor=principal.email, action="auth.mfa_disabled", ip=client_ip(request), session=session)
    return {"ok": True, "mfa_enabled": False}


# ---------------------------------------------------------------------------- state


@protected.get("/state")
async def get_state(session: AsyncSession = DB, bus: Bus = BusDep, settings: Settings = SettingsDep) -> dict[str, Any]:
    return await state_snapshot(session, bus, settings)


# ---------------------------------------------------------------------------- tasks


class TaskBody(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)


class MoveBody(BaseModel):
    state: PipelineState


@protected.post("/tasks", status_code=status.HTTP_201_CREATED)
async def create_task(body: TaskBody, request: Request, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    row = await service.create_task(session, bus, body.prompt, created_by=principal.email, ip=client_ip(request))
    return repo.task_to_model(row).model_dump()


@protected.get("/tasks")
async def list_tasks(limit: int = Query(100, ge=1, le=500), session: AsyncSession = DB) -> list[dict[str, Any]]:
    return [repo.task_to_model(r).model_dump() for r in await repo.list_tasks(session, limit)]


@protected.get("/tasks/{task_id}")
async def get_task(task_id: str, session: AsyncSession = DB) -> dict[str, Any]:
    row = await repo.get_task(session, task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="task not found")
    logs = await repo.list_tool_logs(session, task_id=task_id, limit=200)
    memories = await repo.list_memories(session, task_id=task_id, limit=20)
    messages = await repo.list_agent_messages(session, task_id)
    return {
        "task": repo.task_to_model(row).model_dump(), "log": [repo.tool_log_to_dict(r) for r in logs],
        "memories": [repo.memory_to_dict(m) for m in memories], "messages": [repo.agent_message_to_model(m).model_dump() for m in messages],
    }


@protected.get("/tasks/{task_id}/messages")
async def task_messages(task_id: str, session: AsyncSession = DB) -> list[dict[str, Any]]:
    if await repo.get_task(session, task_id) is None:
        raise HTTPException(status_code=404, detail="task not found")
    return [repo.agent_message_to_model(m).model_dump() for m in await repo.list_agent_messages(session, task_id)]


@protected.post("/tasks/{task_id}/move")
async def move_task(task_id: str, body: MoveBody, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    row = await service.move_task(session, bus, task_id, body.state.value, principal.email)
    if row is None:
        raise HTTPException(status_code=404, detail="task not found")
    return repo.task_to_model(row).model_dump()


@protected.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str, request: Request, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    row = await repo.get_task(session, task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="task not found")
    if not can_cancel_task(principal, created_by=row.created_by, lead_agent=row.lead):
        raise forbid("only the creator, an admin or the lead agent's domain role may cancel this task")
    try:
        updated = await service.cancel_task(session, bus, task_id, principal.email, ip=client_ip(request))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    assert updated is not None
    return repo.task_to_model(updated).model_dump()


# ---------------------------------------------------------------------------- approvals


class RejectBody(BaseModel):
    reason: str | None = None


@protected.get("/approvals")
async def list_approvals(status_filter: Literal["pending", "all"] = Query("all", alias="status"), session: AsyncSession = DB) -> list[dict[str, Any]]:
    return [repo.approval_to_model(r).model_dump() for r in await repo.list_approvals(session, status_filter)]


async def _decide(session: AsyncSession, bus: Bus, approval_id: str, decision: str, principal: Principal, reason: str | None, ip: str) -> dict[str, Any]:
    existing = await repo.get_approval(session, approval_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="approval not found")
    if not can_decide_approval(principal.role, existing.agent, get_policy().approval_roles):
        raise forbid(f"role {principal.role} may not decide approvals raised by {existing.agent}")
    if existing.status != "pending":
        raise HTTPException(status_code=409, detail=f"approval already {existing.status}")
    row = await service.decide_approval(session, bus, approval_id, decision, principal.email, reason, ip=ip)
    assert row is not None
    return repo.approval_to_model(row).model_dump()


@protected.post("/approvals/{approval_id}/approve")
async def approve(approval_id: str, request: Request, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    return await _decide(session, bus, approval_id, "approved", principal, None, client_ip(request))


@protected.post("/approvals/{approval_id}/reject")
async def reject(approval_id: str, request: Request, body: RejectBody | None = None, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    return await _decide(session, bus, approval_id, "rejected", principal, body.reason if body else None, client_ip(request))


# ---------------------------------------------------------------------------- incidents


class SimulateBody(BaseModel):
    env_id: str | None = None
    title: str | None = None


@protected.get("/incidents")
async def list_incidents(session: AsyncSession = DB) -> list[dict[str, Any]]:
    return [repo.incident_to_model(r).model_dump() for r in await repo.list_incidents(session)]


@protected.post("/incidents/simulate", status_code=status.HTTP_201_CREATED)
async def simulate_incident(request: Request, body: SimulateBody | None = None, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    body = body or SimulateBody()
    if body.env_id and await repo.get_environment(session, body.env_id) is None:
        raise HTTPException(status_code=404, detail="environment not found")
    row = await service.simulate_incident(session, bus, env_id=body.env_id, title=body.title, by=principal.email, ip=client_ip(request))
    return repo.incident_to_model(row).model_dump()


@protected.post("/incidents/{incident_id}/resolve")
async def resolve_incident(incident_id: str, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    row = await service.resolve_incident(session, bus, incident_id, principal.email)
    if row is None:
        raise HTTPException(status_code=404, detail="incident not found")
    return repo.incident_to_model(row).model_dump()


@public.post("/webhooks/cloudwatch")
async def cloudwatch_webhook(request: Request, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    if not verify_webhook_secret(request.headers.get("X-Azzy-Webhook-Secret")):
        await audit_record(bus, actor="webhook", action="webhook.rejected", detail={"source": "cloudwatch"}, ip=client_ip(request), session=session)
        raise HTTPException(status_code=401, detail="bad webhook secret")
    try:
        payload: dict[str, Any] = await request.json()
    except ValueError:
        payload = {}
    if isinstance(payload.get("Message"), str):  # SNS envelope
        try:
            payload = json.loads(payload["Message"])
        except json.JSONDecodeError:
            payload = {"AlarmName": payload["Message"]}
    alarm = str(payload.get("AlarmName") or payload.get("alarmName") or "CloudWatch alarm")
    state = str(payload.get("NewStateValue") or payload.get("state", {}).get("value", "ALARM")).upper()
    reason = str(payload.get("NewStateReason") or payload.get("state", {}).get("reason", ""))[:400]
    await audit_record(bus, actor="webhook", action="webhook.received", target=alarm, detail={"source": "cloudwatch", "state": state}, ip=client_ip(request), session=session)
    if state != "ALARM":
        return {"incident_id": None, "ignored": state}
    env_id = None
    lowered = alarm.lower()
    for row in await repo.list_environments(session):
        if row.id in lowered or row.name.lower().split("—")[0].strip() in lowered:
            env_id = row.id
            break
    incident = await service.simulate_incident(
        session, bus, env_id=env_id, title=alarm, source="cloudwatch", severity="sev1" if "sev1" in lowered or "critical" in lowered else "sev2",
        reason=f"CloudWatch: {alarm} → ALARM. {reason}", by="cloudwatch",
    )
    return {"incident_id": incident.id}


# ---------------------------------------------------------------------------- environments


class EnvironmentBody(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    kind: Literal["staging", "prod", "hq"]
    stage: Literal["dev", "uat", "staging", "prod"] | None = None
    method: Literal["assume_role", "access_key", "tailscale_ssh"]
    target: str = Field(min_length=1, max_length=300)
    region: str | None = None
    account_id: str | None = None
    external_id: str | None = None
    secret_ref: str | None = None
    auto_allow: list[str] = Field(default_factory=list)
    allowed_roles: list[str] = Field(default_factory=list)


@protected.get("/environments")
async def list_environments(session: AsyncSession = DB) -> list[dict[str, Any]]:
    return [repo.env_to_dict(r) for r in await repo.list_environments(session)]


@protected.post("/environments", status_code=status.HTTP_201_CREATED)
async def create_environment(body: EnvironmentBody, request: Request, principal: Principal = AdminDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    policy = get_policy()
    bad = [t for t in body.auto_allow if not policy.is_allowed_tool(t) or policy.tool_defaults.get(t) == "high"]
    if bad:
        raise HTTPException(status_code=400, detail=f"auto_allow may only contain low/medium allowlisted tools; invalid: {bad}")
    if body.method == "tailscale_ssh":
        from azzy.tools.base import ToolError  # noqa: PLC0415
        from azzy.tools.ssh import validate_host  # noqa: PLC0415

        try:
            validate_host(body.target)
        except ToolError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if body.method == "assume_role" and not body.target.startswith("arn:aws:iam::"):
        raise HTTPException(status_code=400, detail="assume_role target must be a role ARN")
    if body.method == "access_key" and not body.secret_ref:
        raise HTTPException(status_code=400, detail="access_key environments need a secret_ref (Secrets Manager name)")
    if body.account_id and await repo.get_account(session, body.account_id) is None:
        raise HTTPException(status_code=400, detail="unknown account_id")
    fields = body.model_dump()
    fields["stage"] = body.stage or ("prod" if body.kind == "prod" else "staging")
    fields["external_id"] = encrypt(body.external_id) if body.external_id else None
    row = await repo.create_environment(session, **fields)
    await audit_record(bus, actor=principal.email, action="environment.created", target=row.id, detail={"kind": row.kind, "method": row.method}, ip=client_ip(request), session=session)
    return repo.env_to_dict(row)


@protected.delete("/environments/{env_id}")
async def delete_environment(env_id: str, request: Request, principal: Principal = AdminDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    row = await repo.get_environment(session, env_id)
    if row is None:
        raise HTTPException(status_code=404, detail="environment not found")
    if row.seeded:
        raise HTTPException(status_code=400, detail="seeded environments cannot be deleted")
    await repo.delete_environment(session, env_id)
    await audit_record(bus, actor=principal.email, action="environment.deleted", target=env_id, ip=client_ip(request), session=session)
    return {"ok": True}


@protected.post("/environments/{env_id}/check")
async def check_environment(env_id: str, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep, settings: Settings = SettingsDep) -> dict[str, Any]:
    if await repo.get_environment(session, env_id) is None:
        raise HTTPException(status_code=404, detail="environment not found")
    await session.commit()
    result = await probe_environment(env_id, settings, bus)
    if result is None:
        raise HTTPException(status_code=404, detail="environment not found")
    return result


# ---------------------------------------------------------------------------- meeting


class MeetingBody(BaseModel):
    topic: str | None = Field(default=None, max_length=200)


@protected.post("/meeting/call")
async def call_meeting(body: MeetingBody | None = None, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    task = await service.call_meeting(session, bus, body.topic if body else None, by=principal.email)
    if task is None:
        raise HTTPException(status_code=409, detail="a meeting is already running")
    return {"task_id": task.id}


# ---------------------------------------------------------------------------- costs


@protected.get("/costs")
async def costs(session: AsyncSession = DB, settings: Settings = SettingsDep) -> dict[str, Any]:
    return await repo.cost_summary(session, settings.DAILY_BUDGET_USD)


# ---------------------------------------------------------------------------- agents / team


@protected.get("/agents")
async def agents(session: AsyncSession = DB, bus: Bus = BusDep, settings: Settings = SettingsDep) -> list[dict[str, Any]]:
    return await agent_summaries(session, bus, settings)


@protected.get("/agents/{agent_id}")
async def agent_detail(agent_id: str, session: AsyncSession = DB, bus: Bus = BusDep, settings: Settings = SettingsDep) -> dict[str, Any]:
    configs = get_agents()
    if agent_id not in configs:
        raise HTTPException(status_code=404, detail="unknown agent")
    config = configs[agent_id]
    summary = next(a for a in await agent_summaries(session, bus, settings) if a["id"] == agent_id)
    return {
        "agent": summary,
        "config": {
            "role": config.role, "domain_role": config.domain_role, "tools": config.tools, "budgets": config.budgets.model_dump(),
            "routines": [r.model_dump() for r in config.routines], "skills": config.skills, "avatar": config.avatar.model_dump(),
        },
        "memories": [repo.memory_to_dict(m) for m in await repo.list_memories(session, agent=agent_id, limit=50)],
        "log": [repo.tool_log_to_dict(r) for r in await repo.list_tool_logs(session, agent=agent_id, limit=100)],
        "tasks": [repo.task_to_model(t).model_dump() for t in await repo.list_tasks(session, limit=100, agent=agent_id)][:30],
    }


@protected.delete("/agents/{agent_id}/memories/{memory_id}")
async def delete_memory(agent_id: str, memory_id: str, request: Request, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    if agent_id not in AGENT_META:
        raise HTTPException(status_code=404, detail="unknown agent")
    if not await repo.delete_memory(session, agent_id, memory_id):
        raise HTTPException(status_code=404, detail="memory not found")
    await audit_record(bus, actor=principal.email, action="memory.deleted", target=memory_id, detail={"agent": agent_id}, ip=client_ip(request), session=session)
    return {"ok": True}


@protected.get("/team")
async def team(session: AsyncSession = DB, settings: Settings = SettingsDep) -> list[dict[str, Any]]:
    xp = await repo.get_xp(session)
    costs_summary = await repo.cost_summary(session, settings.DAILY_BUDGET_USD)
    rows = []
    for agent_id in AGENT_META:
        row = xp.get(agent_id)
        total = row.total_xp if row else 0
        rows.append({
            "agent": agent_id, "xp": total, "rank": rank_for(total), "tasks_done": row.tasks_done if row else 0,
            "approvals_requested": row.approvals_requested if row else 0, "usd_today": round(costs_summary["per_agent"].get(agent_id, 0.0), 4),
        })
    return sorted(rows, key=lambda r: r["xp"], reverse=True)


# ---------------------------------------------------------------------------- routines


@protected.get("/routines")
async def routines() -> list[dict[str, Any]]:
    return [{k: v for k, v in r.items() if k != "prompt"} for r in list_routines()]


@protected.post("/routines/{routine_id}/run")
async def run_routine(routine_id: str, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep, settings: Settings = SettingsDep) -> dict[str, Any]:
    found = find_routine(routine_id)
    if found is None:
        raise HTTPException(status_code=404, detail="routine not found")
    agent_id, routine = found
    if routine.get("system"):
        from azzy.worker import retention_sweep  # noqa: PLC0415

        await retention_sweep(settings, bus)
    task = await service.run_routine(session, bus, agent_id, routine_id, routine["title"], routine["prompt"], by=principal.email)
    return {"task_id": task.id}
