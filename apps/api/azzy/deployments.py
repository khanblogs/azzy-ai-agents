"""Deployment records + lifecycle (CONTRACT-v2 §7).

planned → awaiting_approval → running → verifying → succeeded | failed | rolled_back
Pre-checks run before `running`; a per-environment Redis lock (10 min) makes a concurrent deploy
fail fast; post-verification probes health and settles the row.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

from azzy.bus import Bus
from azzy.config import Settings
from azzy.db import repo
from azzy.db.engine import session_scope
from azzy.events import DeploymentChangedEvent

log = logging.getLogger("azzy.deployments")

LOCK_TTL_SECONDS = 600
_VERSION = re.compile(r"^v?\d+\.\d+(\.\d+)?([-.][A-Za-z0-9]+)?$")


def normalise_version(value: Any, default: str = "previous") -> str:
    version = str(value or default).strip()
    if version == "previous":
        return version
    if not version.startswith("v"):
        version = "v" + version
    if version.count(".") == 1:
        version += ".0"
    return version


def version_from_args(tool: str, args: dict[str, Any]) -> str:
    if tool == "aws.rollback" or (tool == "ssh.safe_action" and args.get("action") == "rollback"):
        return normalise_version(args.get("to") or args.get("version"), "previous")
    return normalise_version(args.get("version"), "v0.0.0")


def pre_checks(*, env_row: dict[str, Any] | None, version: str, open_incidents: int, approval_id: str | None, risk: str, is_rollback: bool) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    health = (env_row or {}).get("health", "unknown")
    checks.append({"name": "env_healthy", "ok": health in {"healthy", "unknown"} or is_rollback, "detail": f"health={health}"})
    checks.append({"name": "version_format", "ok": version == "previous" or bool(_VERSION.match(version)), "detail": version})
    checks.append({"name": "no_open_incident", "ok": open_incidents == 0 or is_rollback, "detail": f"{open_incidents} open" + (" (rollback allowed)" if is_rollback and open_incidents else "")})
    if risk == "high":
        checks.append({"name": "approval_present", "ok": approval_id is not None, "detail": approval_id or "missing"})
    return checks


class DeploymentService:
    def __init__(self, settings: Settings, bus: Bus) -> None:
        self.settings = settings
        self.bus = bus

    async def _emit(self, row: Any) -> None:
        await self.bus.publish(DeploymentChangedEvent(deployment=repo.deployment_to_model(row)))

    async def hook(
        self, phase: str, *, agent: str, task_id: str | None, tool: str, args: dict[str, Any], env_row: dict[str, Any] | None,
        risk: str, deployment_id: str | None, approval_id: str | None = None, detail: str = "",
    ) -> str | None:
        """Called by the executor at each lifecycle point. Returns the deployment id."""
        env_id = str((env_row or {}).get("id") or args.get("env_id") or "unknown")
        version = version_from_args(tool, args)
        is_rollback = version == "previous" or tool == "aws.rollback" or args.get("action") == "rollback"
        async with session_scope() as session:
            if deployment_id is None:
                existing = await repo.list_deployments(session, env_id=env_id, limit=1)
                planned = existing[0] if existing and existing[0].status == "planned" and existing[0].version == version and existing[0].task_id == task_id else None
                row = planned or await repo.create_deployment(
                    session, env_id=env_id, account_id=(env_row or {}).get("account_id"), version=version,
                    previous_version=(env_row or {}).get("version"), agent=agent, task_id=task_id, approval_id=approval_id,
                    status="planned", risk=str(risk), change_summary=f"{tool} {version} on {env_id}", checks=[],
                )
                deployment_id = row.id
            row = await repo.get_deployment(session, deployment_id)
            if row is None:
                return deployment_id
            if phase == "awaiting_approval":
                row.status = "awaiting_approval"
            elif phase == "running":
                open_incidents = await repo.open_incident_count(session, env_id)
                checks = pre_checks(env_row=env_row, version=version, open_incidents=open_incidents, approval_id=approval_id, risk=str(risk), is_rollback=is_rollback)
                row.checks = checks
                row.approval_id = approval_id or row.approval_id
                if not all(c["ok"] for c in checks):
                    row.status = "failed"
                    row.finished_at = datetime.now(UTC)
                    row.change_summary += " — pre-checks failed: " + ", ".join(c["name"] for c in checks if not c["ok"])
                    await session.commit()
                    await self._emit(row)
                    from azzy.tools.base import ToolError  # noqa: PLC0415

                    raise ToolError("deployment pre-checks failed: " + "; ".join(f"{c['name']} ({c['detail']})" for c in checks if not c["ok"]))
                if not await self.bus.acquire_lock(f"deploy:{env_id}", LOCK_TTL_SECONDS):
                    row.status = "failed"
                    row.finished_at = datetime.now(UTC)
                    row.change_summary += " — another deployment holds the lock"
                    await session.commit()
                    await self._emit(row)
                    from azzy.tools.base import ToolError  # noqa: PLC0415

                    raise ToolError(f"a deployment is already running on {env_id}; try again when it finishes")
                row.status = "running"
                row.started_at = datetime.now(UTC)
            elif phase == "verifying":
                row.status = "verifying"
            elif phase == "failed":
                row.status = "failed"
                row.finished_at = datetime.now(UTC)
                if detail:
                    row.change_summary = (row.change_summary + " — " + detail[:200])[:2000]
                await self.bus.release_lock(f"deploy:{env_id}")
            await session.commit()
            await self._emit(row)
        if phase == "verifying":
            await self.post_verify(deployment_id, env_id, is_rollback)
        return deployment_id

    async def post_verify(self, deployment_id: str, env_id: str, is_rollback: bool) -> None:
        from azzy.health import probe_environment  # noqa: PLC0415

        try:
            result = await probe_environment(env_id, self.settings, self.bus)
            healthy = bool(result and result.get("health") in {"healthy", "degraded"})
            detail = f"post-deploy probe: {result.get('health') if result else 'no env'} {result.get('latency_ms') if result else ''}ms"
        except Exception as exc:  # noqa: BLE001
            healthy, detail = False, f"probe error {type(exc).__name__}"
        async with session_scope() as session:
            row = await repo.get_deployment(session, deployment_id)
            if row is None:
                return
            row.checks = [*list(row.checks or []), {"name": "post_verify", "ok": healthy, "detail": detail}]
            row.status = ("rolled_back" if is_rollback else "succeeded") if healthy else "failed"
            row.finished_at = datetime.now(UTC)
            await session.commit()
            await self._emit(row)
        await self.bus.release_lock(f"deploy:{env_id}")

    async def plan(self, *, env_id: str, version: str, by: str) -> tuple[Any, Any]:
        """POST /deployments/plan: a planned row + a Jimmy command task."""
        from azzy.orchestrator.service import create_task  # noqa: PLC0415

        version = normalise_version(version, "v0.0.0")
        async with session_scope() as session:
            env = await repo.get_environment(session, env_id)
            if env is None:
                raise ValueError("environment not found")
            prompt = f"Deploy {version} to {env.name}"
            task = await create_task(session, self.bus, prompt, created_by=by, meta={"planned_deployment": True})
            row = await repo.create_deployment(
                session, env_id=env_id, account_id=env.account_id, version=version, previous_version=env.version, agent="jimmy",
                task_id=task.id, approval_id=None, status="planned", risk="high" if env.kind == "prod" else "medium",
                change_summary=f"planned by {by}: {version} → {env.name}", checks=[],
            )
            await session.commit()
            await self._emit(row)
            return row, task
