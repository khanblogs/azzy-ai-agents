"""Allowlisted tool registry + executor (the "execution gateway").

Executor pipeline for every call:
  cancel check → allowlisted (policy.yaml) → agent permitted (agent yaml) → account scope
  (policy.yaml scope_requirements) → policy.classify → approval if needed → deployment pre-checks
  → run (demo_data or real) → scrub → tool.log event (+ tool_logs row + audit tool.call)
  → deployment post-verify.

The approval wait is delegated to an `ApprovalGate` callback supplied by the runner so this
module stays independent of Redis/DB session handling.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from azzy.agents.loader import AgentConfig
from azzy.events import RiskLevel, ToolLogEvent, new_id
from azzy.guard import scrub
from azzy.policy import Env, Policy, get_policy
from azzy.tools import accounts, aws, collab, comms, envreg, github, memory_tool, office, playwright_tool, sandbox, security, sql, ssh, uptime, web
from azzy.tools.base import NotConfigured, ToolContext, ToolError, ToolSpec
from azzy.tools.demo_data import demo_latency_ms, demo_output

log = logging.getLogger("azzy.tools")

_MODULES = (envreg, accounts, aws, ssh, github, sandbox, sql, office, comms, security, playwright_tool, collab, memory_tool, web, uptime)

DEPLOY_TOOLS: frozenset[str] = frozenset({"aws.deploy", "aws.rollback"})


class ApprovalRejected(ToolError):
    def __init__(self, status: str, approval_id: str) -> None:
        super().__init__(f"approval {status}")
        self.status = status
        self.approval_id = approval_id


class Cancelled(ToolError):
    """The task was cancelled by a user before this call could run."""


@dataclass(slots=True)
class ToolOutcome:
    tool: str
    args: dict[str, Any]
    output: str  # scrubbed, safe for the LLM
    ok: bool
    duration_ms: int
    risk: RiskLevel
    approval_id: str | None = None
    event: ToolLogEvent | None = None


ApprovalGate = Callable[[str, dict[str, Any], RiskLevel, str, Env | None], Awaitable[tuple[str, str | None]]]
"""(tool, args, risk, summary, env) → (status, approval_id). status ∈ approved|rejected|expired."""

EventSink = Callable[[Any], Awaitable[None]]
CancelCheck = Callable[[], Awaitable[bool]]
DeployHook = Callable[..., Awaitable[Any]]


def build_registry(policy: Policy | None = None) -> dict[str, ToolSpec]:
    policy = policy or get_policy()
    registry: dict[str, ToolSpec] = {}
    for module in _MODULES:
        for spec in module.SPECS:
            if spec.name in policy.tool_allowlist:
                registry[spec.name] = spec
    missing = set(policy.tool_allowlist) - set(registry)
    if missing:
        raise RuntimeError(f"policy allowlists tools without an implementation: {sorted(missing)}")
    return registry


def summarize_call(tool: str, args: dict[str, Any], env: Env | None) -> str:
    """One-line human summary shown in the approval card."""
    where = f" on {env.id}" if env else ""
    if tool == "ssh.safe_action":
        action = args.get("action", "?")
        version = f" {args['version']}" if args.get("version") else ""
        return f"ssh.safe_action {action}{version}{where}"
    if tool in DEPLOY_TOOLS:
        version = args.get("version") or args.get("to") or ""
        return f"{tool} {version}{where}".rstrip()
    if tool == "gmail.send":
        return f"send email to {args.get('to', '?')}: {str(args.get('subject', ''))[:60]}"
    if tool == "zendesk.update":
        return f"update Zendesk ticket #{args.get('ticket_id', '?')} ({args.get('status', 'comment')})"
    if tool == "github.branch_pr":
        return f"open PR on {args.get('repo', '?')} → {args.get('base', 'develop')}"
    if tool in {"nuclei.scan", "zap.scan"}:
        return f"{tool} {args.get('target', '?')}"
    if tool == "gcal.schedule":
        return f"schedule '{args.get('title', 'event')}' {args.get('when', '')}".strip()
    compact = json.dumps(args, default=str)
    return f"{tool} {compact[:80]}"


def is_deploy_call(tool: str, args: dict[str, Any]) -> bool:
    return tool in DEPLOY_TOOLS or (tool == "ssh.safe_action" and str(args.get("action", "")).lower() in {"deploy", "rollback"})


class ToolExecutor:
    def __init__(
        self,
        *,
        settings: Any,
        emit: EventSink,
        approval_gate: ApprovalGate | None = None,
        policy: Policy | None = None,
        registry: dict[str, ToolSpec] | None = None,
        persist_log: Callable[[ToolLogEvent], Awaitable[None]] | None = None,
        audit: Callable[..., Awaitable[None]] | None = None,
        deploy_hook: DeployHook | None = None,
    ) -> None:
        self.settings = settings
        self.demo = bool(getattr(settings, "DEMO", True))
        self.policy = policy or get_policy()
        self.registry = registry or build_registry(self.policy)
        self._emit = emit
        self._gate = approval_gate
        self._persist = persist_log
        self._audit = audit
        self._deploy_hook = deploy_hook

    def specs_for(self, agent: AgentConfig) -> list[dict[str, Any]]:
        return [self.registry[t].llm_schema() for t in agent.tools if t in self.registry]

    async def execute(
        self,
        agent: AgentConfig,
        tool: str,
        args: dict[str, Any] | None,
        *,
        task_id: str | None,
        env: Env | None,
        env_row: dict[str, Any] | None = None,
        seed: str | None = None,
        extra: dict[str, Any] | None = None,
        approval_gate: ApprovalGate | None = None,
        cancel_check: CancelCheck | None = None,
        account_scope: str | None = None,
    ) -> ToolOutcome:
        args = dict(args or {})
        started = time.monotonic()
        risk = self.policy.classify(tool, args, env)
        approval_id: str | None = None
        gate = approval_gate or self._gate
        deployment_id: str | None = None

        try:
            if cancel_check is not None and await cancel_check():
                raise Cancelled("task cancelled")
            if not self.policy.is_allowed_tool(tool) or tool not in self.registry:
                raise ToolError(f"tool {tool!r} is not allowlisted")
            if not agent.allows_tool(tool):
                raise ToolError(f"agent {agent.id} is not permitted to use {tool}")
            if tool == "ssh.safe_action":
                try:
                    args["action"] = self.policy.validate_ssh_action(str(args.get("action") or ""))
                except ValueError as exc:
                    raise ToolError(str(exc)) from exc
            if tool in {"nuclei.scan", "zap.scan"}:
                # Always enforced, even in DEMO.
                args["target"] = security.authorized_target(str(args.get("target") or ""), tuple(self.settings.authorized_targets))
            if tool == "github.branch_pr" and str(args.get("base", "")).lower() in github.PROTECTED_BASES:
                raise ToolError(f"refusing to target protected base {args.get('base')!r}")
            needed = self.policy.required_scope(tool)
            if needed is not None and (env_row and env_row.get("account_id") or args.get("account_id") or account_scope is not None):
                # Only enforce when the call is bound to an onboarded account; HQ / local envs have none.
                if not self.policy.scope_allows(tool, account_scope):
                    raise ToolError(f"{tool} needs account scope '{needed}' but the linked account has '{account_scope or 'none'}'")

            if self.policy.needs_approval(risk, tool, env):
                if gate is None:
                    raise ToolError(f"{tool} requires approval but no approval gate is configured")
                if is_deploy_call(tool, args) and self._deploy_hook is not None:
                    deployment_id = await self._deploy_hook("awaiting_approval", agent=agent.id, task_id=task_id, tool=tool, args=args, env_row=env_row, risk=risk, deployment_id=None)
                status, approval_id = await gate(tool, args, risk, summarize_call(tool, args, env), env)
                if status != "approved":
                    if deployment_id and self._deploy_hook is not None:
                        await self._deploy_hook("failed", agent=agent.id, task_id=task_id, tool=tool, args=args, env_row=env_row, risk=risk, deployment_id=deployment_id, detail=f"approval {status}")
                    raise ApprovalRejected(status, approval_id or "")
                if cancel_check is not None and await cancel_check():
                    raise Cancelled("task cancelled")

            if is_deploy_call(tool, args) and self._deploy_hook is not None:
                deployment_id = await self._deploy_hook("running", agent=agent.id, task_id=task_id, tool=tool, args=args, env_row=env_row, risk=risk, deployment_id=deployment_id, approval_id=approval_id)

            spec = self.registry[tool]
            ctx = ToolContext(agent_id=agent.id, task_id=task_id, env=env_row, demo=self.demo, settings=self.settings, extra=extra if extra is not None else {})
            ctx.extra.setdefault("emit", self._emit)
            run_started = time.monotonic()
            if self.demo and not spec.demo_passthrough:
                demo_args = dict(args)
                if env_row and env_row.get("version"):
                    demo_args["_current_version"] = env_row["version"]
                raw = demo_output(tool, demo_args, seed or task_id or "demo")
                await asyncio.sleep(min(demo_latency_ms(tool, seed or task_id or "demo"), 1800) / 1000)
                duration_ms = demo_latency_ms(tool, seed or task_id or "demo")
                if raw.rstrip().endswith("result: rejected") or '"error"' in raw[:40]:
                    raise ToolError(raw)
            else:
                raw = await spec.run(ctx, args)
                duration_ms = int((time.monotonic() - run_started) * 1000)
            output = scrub(raw)
            ok = True
        except ApprovalRejected as exc:
            output = f"[approval {exc.status}] {summarize_call(tool, args, env)}"
            duration_ms = int((time.monotonic() - started) * 1000)
            await self._log(agent.id, task_id, tool, args, output, False, duration_ms, risk)
            raise
        except Cancelled:
            output = "[cancelled] task cancelled before the call ran"
            duration_ms = int((time.monotonic() - started) * 1000)
            await self._log(agent.id, task_id, tool, args, output, False, duration_ms, risk)
            raise
        except (ToolError, NotConfigured) as exc:
            output = scrub(f"error: {exc}")
            ok = False
            duration_ms = int((time.monotonic() - started) * 1000)
        except Exception as exc:  # noqa: BLE001 - a tool crash must never kill the agent loop
            log.exception("tool crashed", extra={"fields": {"tool": tool, "agent": agent.id}})
            output = scrub(f"error: {type(exc).__name__}: {exc}")
            ok = False
            duration_ms = int((time.monotonic() - started) * 1000)

        if deployment_id and self._deploy_hook is not None:
            await self._deploy_hook("verifying" if ok else "failed", agent=agent.id, task_id=task_id, tool=tool, args=args, env_row=env_row, risk=risk, deployment_id=deployment_id, detail=output[:300])
        event = await self._log(agent.id, task_id, tool, args, output, ok, duration_ms, risk)
        return ToolOutcome(tool=tool, args=args, output=output, ok=ok, duration_ms=duration_ms, risk=risk, approval_id=approval_id, event=event)

    async def _log(self, agent_id: str, task_id: str | None, tool: str, args: dict[str, Any], output: str, ok: bool, duration_ms: int, risk: RiskLevel) -> ToolLogEvent:
        safe_args = {k: v for k, v in args.items() if not str(k).startswith("_")}
        event = ToolLogEvent(
            id=new_id(), agent=agent_id, task_id=task_id, tool=tool, args=json.loads(json.dumps(safe_args, default=str)),
            output=output[:4000], ok=ok, duration_ms=int(duration_ms), risk=risk,
        )
        if self._persist is not None:
            try:
                await self._persist(event)
            except Exception:  # noqa: BLE001
                log.warning("tool log persist failed", extra={"fields": {"tool": tool}})
        if self._audit is not None:
            try:
                await self._audit(actor=agent_id, action="tool.call", target=tool, task_id=task_id, detail={"tool": tool, "risk": str(risk), "ok": ok, "duration_ms": int(duration_ms)})
            except Exception:  # noqa: BLE001
                log.debug("tool audit failed")
        await self._emit(event)
        return event
