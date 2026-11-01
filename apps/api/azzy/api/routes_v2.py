"""v2 routers: users, chat, collaboration, AWS accounts, deployments, knowledge, audit, metrics,
reports, integrations, settings, contact (CONTRACT-v2 §3–§9). Mounted under /api by main.py."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from azzy.agents.loader import get_agents
from azzy.api.deps import DB, AdminDep, BusDep, PrincipalDep, SettingsDep, WriterDep, forbid
from azzy.api.ws import hub
from azzy.audit import record as audit_record
from azzy.auth import client_ip, hash_password, rate_limited, set_disabled
from azzy.bus import Bus
from azzy.config import Settings
from azzy.crypto import decrypt, encrypt
from azzy.db import repo
from azzy.deployments import DeploymentService
from azzy.events import AGENT_IDS, AccountChangedEvent
from azzy.integrations import list_integrations, test_integration
from azzy.knowledge import extract_text, ingest, scopes_for, search
from azzy.metrics import collect
from azzy.orchestrator import service
from azzy.policy import get_policy
from azzy.rbac import ROLES, Principal, can_delete_user, can_write_knowledge
from azzy.tools.accounts import validate_account_input, verify_account_sync
from azzy.tools.base import ToolError
from azzy.tools.demo_data import demo_inventory, demo_verify_account

log = logging.getLogger("azzy.api.v2")

router = APIRouter(dependencies=[PrincipalDep])
public = APIRouter()


# ---------------------------------------------------------------------------- users


class UserBody(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=200)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["admin", "devops", "developer", "security", "operations", "marketing", "readonly"]


class UserPatch(BaseModel):
    role: Literal["admin", "devops", "developer", "security", "operations", "marketing", "readonly"] | None = None
    disabled: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


@router.get("/users")
async def list_users(principal: Principal = AdminDep, session: AsyncSession = DB) -> list[dict[str, Any]]:
    return [repo.user_to_dict(u) for u in await repo.list_users(session)]


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(body: UserBody, request: Request, principal: Principal = AdminDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    if await repo.get_user_by_email(session, body.email.lower()) is not None:
        raise HTTPException(status_code=409, detail="email already exists")
    row = await repo.create_user(session, email=body.email.lower(), password_hash=hash_password(body.password), role=body.role)
    await audit_record(bus, actor=principal.email, action="user.created", target=row.email, detail={"role": row.role}, ip=client_ip(request), session=session)
    return repo.user_to_dict(row)


@router.patch("/users/{user_id}")
async def patch_user(user_id: str, body: UserPatch, request: Request, principal: Principal = AdminDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    row = await repo.get_user(session, user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="user not found")
    changes: dict[str, Any] = {}
    if body.role is not None and body.role != row.role:
        if row.role == "admin" and body.role != "admin" and await repo.admin_count(session) <= 1:
            raise HTTPException(status_code=409, detail="cannot demote the last admin")
        row.role = body.role
        changes["role"] = body.role
    if body.disabled is not None and body.disabled != row.disabled:
        if body.disabled and row.email == principal.email:
            raise HTTPException(status_code=409, detail="cannot disable yourself")
        if body.disabled and row.role == "admin" and await repo.admin_count(session) <= 1:
            raise HTTPException(status_code=409, detail="cannot disable the last admin")
        row.disabled = body.disabled
        changes["disabled"] = body.disabled
        await set_disabled(row.email, body.disabled)
    if body.password:
        row.password_hash = hash_password(body.password)
        row.seed_hash = None  # changed in-app → env re-seeding no longer overrides it
        changes["password"] = True
    await audit_record(bus, actor=principal.email, action="user.updated", target=row.email, detail=changes, ip=client_ip(request), session=session)
    return repo.user_to_dict(row)


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request, principal: Principal = AdminDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    row = await repo.get_user(session, user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="user not found")
    if not can_delete_user(principal, target_email=row.email, target_role=row.role, admin_count=await repo.admin_count(session)):
        raise HTTPException(status_code=409, detail="cannot delete yourself or the last admin")
    await session.delete(row)
    await set_disabled(row.email, True)
    await audit_record(bus, actor=principal.email, action="user.deleted", target=row.email, ip=client_ip(request), session=session)
    return {"ok": True}


# ---------------------------------------------------------------------------- chat


class ConversationBody(BaseModel):
    title: str | None = Field(default=None, max_length=200)


class ChatBody(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


def _agent_or_404(agent_id: str) -> None:
    if agent_id not in AGENT_IDS:
        raise HTTPException(status_code=404, detail="unknown agent")


@router.get("/agents/{agent_id}/conversations")
async def list_conversations(agent_id: str, principal: Principal = PrincipalDep, session: AsyncSession = DB) -> list[dict[str, Any]]:
    _agent_or_404(agent_id)
    rows = await repo.list_conversations(session, agent=agent_id, user_email=None if principal.is_admin else principal.email)
    return [repo.conversation_to_dict(r) for r in rows]


@router.post("/agents/{agent_id}/conversations", status_code=status.HTTP_201_CREATED)
async def create_conversation(agent_id: str, body: ConversationBody | None = None, principal: Principal = WriterDep, session: AsyncSession = DB) -> dict[str, Any]:
    _agent_or_404(agent_id)
    row = await repo.create_conversation(session, agent=agent_id, user_email=principal.email, title=(body.title if body and body.title else "New conversation"))
    return repo.conversation_to_dict(row)


async def _conversation_for(session: AsyncSession, conversation_id: str, principal: Principal) -> Any:
    row = await repo.get_conversation(session, conversation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    if row.user_email != principal.email and not principal.is_admin:
        raise forbid("not your conversation")
    return row


@router.get("/conversations/{conversation_id}/messages")
async def conversation_messages(conversation_id: str, principal: Principal = PrincipalDep, session: AsyncSession = DB) -> list[dict[str, Any]]:
    await _conversation_for(session, conversation_id, principal)
    return [repo.chat_message_to_model(m).model_dump() for m in await repo.list_chat_messages(session, conversation_id)]


@router.post("/conversations/{conversation_id}/messages", status_code=status.HTTP_202_ACCEPTED)
async def post_message(conversation_id: str, body: ChatBody, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    conversation = await _conversation_for(session, conversation_id, principal)
    user_row, task = await service.post_chat_message(session, bus, conversation_id=conversation_id, agent=conversation.agent, content=body.content, by=principal.email)
    return {"user_message": repo.chat_message_to_model(user_row).model_dump(), "task_id": task.id}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, principal: Principal = WriterDep, session: AsyncSession = DB) -> dict[str, Any]:
    await _conversation_for(session, conversation_id, principal)
    await repo.delete_conversation(session, conversation_id)
    return {"ok": True}


# ---------------------------------------------------------------------------- collaboration


@router.get("/collaboration/live")
async def collaboration_live(session: AsyncSession = DB) -> dict[str, Any]:
    now = datetime.now(UTC)
    active = await repo.active_tasks(session)
    active_ids = {t.id for t in active}
    messages = await repo.recent_agent_messages(session, since=now - timedelta(hours=1))
    edges: dict[tuple[str, str], dict[str, Any]] = {}
    for message in messages:
        to = message.to_agent or "azzy"
        key = (message.from_agent, to)
        edge = edges.setdefault(key, {"from": message.from_agent, "to": to, "count": 0, "last_ts": repo.iso(message.created_at), "active": False})
        edge["count"] += 1
        if message.task_id in active_ids or (message.created_at and (now - message.created_at).total_seconds() < 20):
            edge["active"] = True
    return {"edges": sorted(edges.values(), key=lambda e: e["last_ts"] or "", reverse=True), "tasks": [repo.task_to_model(t).model_dump() for t in active]}


# ---------------------------------------------------------------------------- AWS accounts


class AccountBody(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    account_id: str = Field(pattern=r"^\d{12}$")
    role_arn: str = Field(min_length=20, max_length=300)
    external_id: str | None = Field(default=None, max_length=200)
    scope: Literal["readonly", "audit", "deploy"] = "readonly"
    regions: list[str] = Field(default_factory=lambda: ["ap-south-1"])
    stage: Literal["dev", "uat", "staging", "prod"] = "dev"


@router.get("/aws-accounts")
async def list_accounts(session: AsyncSession = DB) -> list[dict[str, Any]]:
    return [repo.account_to_model(r).model_dump() for r in await repo.list_accounts(session)]


@router.post("/aws-accounts", status_code=status.HTTP_201_CREATED)
async def create_account(body: AccountBody, request: Request, principal: Principal = AdminDep, session: AsyncSession = DB, bus: Bus = BusDep, settings: Settings = SettingsDep) -> dict[str, Any]:
    try:
        validate_account_input(body.account_id, body.role_arn, body.regions)
    except ToolError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if await repo.get_account_by_aws_id(session, body.account_id) is not None:
        raise HTTPException(status_code=409, detail="account already onboarded")
    row = await repo.create_account(
        session, name=body.name, account_id=body.account_id, role_arn=body.role_arn, external_id_enc=encrypt(body.external_id) if body.external_id else None,
        scope=body.scope, regions=body.regions, stage=body.stage, permissions=[], demo=settings.DEMO, created_by=principal.email,
    )
    await audit_record(bus, actor=principal.email, action="account.created", target=row.account_id, detail={"scope": row.scope, "stage": row.stage}, ip=client_ip(request), session=session)
    await session.commit()
    model = repo.account_to_model(row)
    await bus.publish(AccountChangedEvent(account=model))
    return model.model_dump()


@router.post("/aws-accounts/{account_id}/verify")
async def verify_account(account_id: str, request: Request, principal: Principal = AdminDep, session: AsyncSession = DB, bus: Bus = BusDep, settings: Settings = SettingsDep) -> dict[str, Any]:
    row = await repo.get_account(session, account_id)
    if row is None:
        raise HTTPException(status_code=404, detail="account not found")
    if settings.DEMO:
        await asyncio.sleep(1.2)  # the wizard shows a "verifying…" state
        status_, permissions, error = demo_verify_account(row.account_id, row.scope)
    else:
        external_id = decrypt(row.external_id_enc) if row.external_id_enc else None
        status_, permissions, error = await asyncio.to_thread(verify_account_sync, row.role_arn, external_id, row.scope, (row.regions or ["ap-south-1"])[0])
    row.status = status_
    row.permissions = permissions
    row.error = error
    row.last_verified = datetime.now(UTC)
    await audit_record(bus, actor=principal.email, action="account.verified", target=row.account_id, detail={"status": status_, "demo": settings.DEMO}, ip=client_ip(request), session=session)
    await session.commit()
    model = repo.account_to_model(row)
    await bus.publish(AccountChangedEvent(account=model))
    return model.model_dump()


@router.delete("/aws-accounts/{account_id}")
async def delete_account(account_id: str, request: Request, principal: Principal = AdminDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    row = await repo.get_account(session, account_id)
    if row is None:
        raise HTTPException(status_code=404, detail="account not found")
    aws_id = row.account_id
    await repo.delete_account(session, account_id)
    await audit_record(bus, actor=principal.email, action="account.deleted", target=aws_id, ip=client_ip(request), session=session)
    return {"ok": True}


@router.get("/aws-accounts/{account_id}/inventory")
async def account_inventory(account_id: str, region: str | None = Query(default=None), session: AsyncSession = DB, settings: Settings = SettingsDep) -> dict[str, Any]:
    row = await repo.get_account(session, account_id)
    if row is None:
        raise HTTPException(status_code=404, detail="account not found")
    region = region or (row.regions or ["ap-south-1"])[0]
    if row.status != "verified":
        raise HTTPException(status_code=409, detail=f"account is {row.status}; verify it first")
    if settings.DEMO or row.demo:
        return demo_inventory(row.account_id, region, seed=f"{row.id}:{datetime.now(UTC):%Y%m%d%H}")
    from azzy.tools.accounts import inventory_sync  # noqa: PLC0415

    external_id = decrypt(row.external_id_enc) if row.external_id_enc else None
    try:
        return await asyncio.to_thread(inventory_sync, row.role_arn, external_id, row.account_id, region)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"inventory failed: {type(exc).__name__}") from exc


# ---------------------------------------------------------------------------- deployments


class PlanBody(BaseModel):
    env_id: str
    version: str = Field(min_length=1, max_length=32)


@router.get("/deployments")
async def list_deployments(env_id: str | None = Query(default=None), limit: int = Query(50, ge=1, le=500), session: AsyncSession = DB) -> list[dict[str, Any]]:
    return [repo.deployment_to_model(r).model_dump() for r in await repo.list_deployments(session, env_id=env_id, limit=limit)]


@router.get("/deployments/{deployment_id}")
async def get_deployment(deployment_id: str, session: AsyncSession = DB) -> dict[str, Any]:
    row = await repo.get_deployment(session, deployment_id)
    if row is None:
        raise HTTPException(status_code=404, detail="deployment not found")
    return repo.deployment_to_model(row).model_dump()


@router.post("/deployments/plan", status_code=status.HTTP_201_CREATED)
async def plan_deployment(body: PlanBody, request: Request, principal: Principal = WriterDep, bus: Bus = BusDep, settings: Settings = SettingsDep) -> dict[str, Any]:
    try:
        row, task = await DeploymentService(settings, bus).plan(env_id=body.env_id, version=body.version, by=principal.email)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await audit_record(bus, actor=principal.email, action="deployment.planned", target=row.id, task_id=task.id, detail={"env_id": body.env_id, "version": row.version}, ip=client_ip(request))
    return {"deployment": repo.deployment_to_model(row).model_dump(), "task_id": task.id}


# ---------------------------------------------------------------------------- knowledge


class DocumentBody(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    content: str = Field(min_length=10)
    tags: list[str] = Field(default_factory=list)
    scope: str = "global"


async def _check_scope(session: AsyncSession, principal: Principal, scope: str) -> None:
    if not can_write_knowledge(principal.role, scope):
        raise forbid("only admins may write to env/account scopes")
    if scope != "global" and await repo.get_environment(session, scope) is None and await repo.get_account(session, scope) is None:
        raise HTTPException(status_code=400, detail="scope must be 'global', an environment id or an account id")


@router.get("/knowledge/documents")
async def list_documents(principal: Principal = PrincipalDep, session: AsyncSession = DB) -> list[dict[str, Any]]:
    return [repo.document_to_dict(d) for d in await repo.list_documents(session, scopes=await scopes_for(session, principal.role))]


@router.get("/knowledge/documents/{document_id}")
async def get_document(document_id: str, principal: Principal = PrincipalDep, session: AsyncSession = DB) -> dict[str, Any]:
    row = await repo.get_document(session, document_id)
    if row is None or row.scope not in await scopes_for(session, principal.role):
        raise HTTPException(status_code=404, detail="document not found")
    return repo.document_to_dict(row, with_content=True)


@router.post("/knowledge/documents", status_code=status.HTTP_201_CREATED)
async def create_document(request: Request, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep, settings: Settings = SettingsDep) -> dict[str, Any]:
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if not isinstance(upload, UploadFile):
            raise HTTPException(status_code=400, detail="file is required")
        data = await upload.read()
        try:
            text = extract_text(upload.filename or "upload.txt", data)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        title = str(form.get("title") or Path(upload.filename or "upload").stem)[:200]
        tags = [t.strip() for t in str(form.get("tags") or "").split(",") if t.strip()]
        scope = str(form.get("scope") or "global")
        store: tuple[str, bytes] | None = (upload.filename or "upload.txt", data)
        source = f"upload:{upload.filename}"
    else:
        body = DocumentBody.model_validate(await request.json())
        text, title, tags, scope, store, source = body.content, body.title, body.tags, body.scope, None, "manual"
    await _check_scope(session, principal, scope)
    try:
        row = await ingest(session, settings, title=title, content=text, tags=tags, scope=scope, source=source, created_by=principal.email, store_file=store)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await audit_record(bus, actor=principal.email, action="knowledge.created", target=row.id, detail={"title": title, "scope": scope, "source": source}, ip=client_ip(request), session=session)
    return repo.document_to_dict(row)


@router.delete("/knowledge/documents/{document_id}")
async def delete_document(document_id: str, request: Request, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    row = await repo.get_document(session, document_id)
    if row is None:
        raise HTTPException(status_code=404, detail="document not found")
    if not can_write_knowledge(principal.role, row.scope):
        raise forbid("only admins may delete env/account-scoped documents")
    await repo.delete_document(session, document_id)
    await audit_record(bus, actor=principal.email, action="knowledge.deleted", target=document_id, ip=client_ip(request), session=session)
    return {"ok": True}


@router.get("/knowledge/search")
async def knowledge_search(q: str = Query(min_length=1, max_length=500), scope: str | None = Query(default=None), principal: Principal = PrincipalDep, session: AsyncSession = DB, settings: Settings = SettingsDep) -> list[dict[str, Any]]:
    return await search(session, settings, query=q, role=principal.role, scope=scope)


# ---------------------------------------------------------------------------- audit / metrics


@router.get("/audit")
async def audit_list(limit: int = Query(100, ge=1, le=500), before: str | None = None, action: str | None = None, actor: str | None = None, session: AsyncSession = DB) -> list[dict[str, Any]]:
    before_dt: datetime | None = None
    if before:
        try:
            before_dt = datetime.fromisoformat(before.replace("Z", "+00:00"))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="before must be ISO-8601") from exc
    rows = await repo.list_audit(session, limit=limit, before=before_dt, action=action, actor=actor)
    return [repo.audit_to_model(r).model_dump() for r in rows]


@router.get("/system/metrics")
async def system_metrics(session: AsyncSession = DB, bus: Bus = BusDep, settings: Settings = SettingsDep) -> dict[str, Any]:
    from sqlalchemy import text  # noqa: PLC0415

    try:
        await session.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False
    redis_ok = await bus.ping()
    return await collect(session, bus, settings, db_ok=db_ok, redis_ok=redis_ok, ws_clients=hub.clients)


# ---------------------------------------------------------------------------- reports


REPORT_KINDS: dict[str, tuple[str, str]] = {
    "ops_kpi": ("sara", "Build the operations KPI report as a pptx deck with a one-page PDF summary."),
    "security_posture": ("cyber", "Produce the security posture report: IAM review of verified accounts, last scan findings, release-gate status, as a PDF."),
    "growth": ("marwah", "Produce the growth report: campaign performance, channel mix, engagement, spend vs plan, as a pptx with a PDF summary."),
    "fleet": ("jimmy", "Produce the fleet report for all environments and AWS accounts: health, versions, cost delta, open alerts; post a summary to Slack."),
}


class ReportBody(BaseModel):
    kind: Literal["ops_kpi", "security_posture", "growth", "fleet"]


@router.get("/reports")
async def list_reports(session: AsyncSession = DB) -> list[dict[str, Any]]:
    return [repo.artifact_to_dict(a) for a in await repo.list_artifacts(session)]


@router.get("/reports/{artifact_id}/download")
async def download_report(artifact_id: str, session: AsyncSession = DB, settings: Settings = SettingsDep) -> FileResponse:
    row = await repo.get_artifact(session, artifact_id)
    if row is None:
        raise HTTPException(status_code=404, detail="report not found")
    path = Path(row.path).resolve()
    root = Path(settings.ARTIFACTS_DIR).resolve()
    if root not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="file missing")
    return FileResponse(str(path), filename=row.filename)


@router.post("/reports/generate", status_code=status.HTTP_202_ACCEPTED)
async def generate_report(body: ReportBody, request: Request, principal: Principal = WriterDep, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    agent, prompt = REPORT_KINDS[body.kind]
    task = await repo.create_task(session, title=f"Report: {body.kind}", prompt=prompt, lead=agent, assignees=[agent] if agent == "sara" else [agent, "sara"], env_id=None, kind="command", meta={"report_kind": body.kind}, created_by=principal.email, steps_total=2)
    await audit_record(bus, actor=principal.email, action="report.requested", target=body.kind, task_id=task.id, ip=client_ip(request), session=session)
    await session.commit()
    from azzy.events import TaskUpdatedEvent  # noqa: PLC0415

    await bus.publish(TaskUpdatedEvent(task=repo.task_to_model(task)))
    await bus.enqueue_task(task.id)
    return {"task_id": task.id}


# ---------------------------------------------------------------------------- integrations / settings


@router.get("/integrations")
async def integrations(settings: Settings = SettingsDep) -> list[dict[str, Any]]:
    return list_integrations(settings)


@router.post("/integrations/{integration_id}/test")
async def integration_test(integration_id: str, request: Request, principal: Principal = AdminDep, bus: Bus = BusDep, settings: Settings = SettingsDep) -> dict[str, Any]:
    try:
        result = await test_integration(integration_id, settings)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="unknown integration") from exc
    await audit_record(bus, actor=principal.email, action="integration.tested", target=integration_id, detail={"ok": result["ok"], "demo": result["demo"]}, ip=client_ip(request))
    return result


class SettingsPatch(BaseModel):
    daily_budget_usd: float | None = Field(default=None, gt=0, le=10_000)
    authorized_targets: list[str] | None = None
    retention: dict[str, int] | None = None


async def effective_settings(session: AsyncSession, settings: Settings) -> dict[str, Any]:
    overrides = await repo.get_settings_overrides(session)
    return {
        "demo": settings.DEMO,
        "daily_budget_usd": float(overrides.get("daily_budget_usd", settings.DAILY_BUDGET_USD)),
        "approval_timeout_seconds": settings.APPROVAL_TIMEOUT_SECONDS,
        "authorized_targets": list(overrides.get("authorized_targets", settings.authorized_targets)),
        "retention": {"knowledge_days": int(overrides.get("knowledge_retention_days", settings.KNOWLEDGE_RETENTION_DAYS)), "memory_days": int(overrides.get("memory_retention_days", settings.MEMORY_RETENTION_DAYS))},
        "public_base_url": settings.PUBLIC_BASE_URL,
        "roles": list(ROLES),
        "approval_roles": {agent: list(roles) for agent, roles in get_policy().approval_roles.items()},
        "agents": sorted(get_agents()),
    }


@router.get("/settings")
async def get_settings_route(session: AsyncSession = DB, settings: Settings = SettingsDep) -> dict[str, Any]:
    return await effective_settings(session, settings)


@router.patch("/settings")
async def patch_settings(body: SettingsPatch, request: Request, principal: Principal = AdminDep, session: AsyncSession = DB, bus: Bus = BusDep, settings: Settings = SettingsDep) -> dict[str, Any]:
    changes: dict[str, Any] = {}
    if body.daily_budget_usd is not None:
        await repo.set_setting(session, "daily_budget_usd", body.daily_budget_usd, principal.email)
        settings.DAILY_BUDGET_USD = body.daily_budget_usd
        changes["daily_budget_usd"] = body.daily_budget_usd
    if body.authorized_targets is not None:
        cleaned = [t.strip().rstrip("/") for t in body.authorized_targets if t.strip()]
        await repo.set_setting(session, "authorized_targets", cleaned, principal.email)
        settings.AUTHORIZED_TARGETS = ",".join(cleaned)
        changes["authorized_targets"] = cleaned
    if body.retention:
        if "knowledge_days" in body.retention:
            await repo.set_setting(session, "knowledge_retention_days", max(1, int(body.retention["knowledge_days"])), principal.email)
        if "memory_days" in body.retention:
            await repo.set_setting(session, "memory_retention_days", max(1, int(body.retention["memory_days"])), principal.email)
        changes["retention"] = body.retention
    await audit_record(bus, actor=principal.email, action="settings.updated", detail=changes, ip=client_ip(request), session=session)
    await bus.redis.publish("azzy:settings", "changed")
    return await effective_settings(session, settings)


@router.get("/settings/contact-messages")
async def contact_inbox(principal: Principal = AdminDep, session: AsyncSession = DB) -> list[dict[str, Any]]:
    return await repo.list_contact_messages(session)


# ---------------------------------------------------------------------------- public contact form


class ContactBody(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=200)
    message: str = Field(min_length=5, max_length=5000)


@public.post("/contact", status_code=status.HTTP_201_CREATED)
async def contact(body: ContactBody, request: Request, session: AsyncSession = DB, bus: Bus = BusDep) -> dict[str, Any]:
    ip = client_ip(request)
    if await rate_limited(bus, f"contact:{ip}", 5):
        raise HTTPException(status_code=429, detail="too many messages; try again in a minute")
    row = await repo.add_contact_message(session, name=body.name, email=str(body.email), message=body.message, ip=ip)
    await audit_record(bus, actor=str(body.email), action="contact.received", target=row.id, ip=ip, session=session)
    return {"ok": True, "id": row.id}


__all__ = ["File", "Form", "public", "router"]
