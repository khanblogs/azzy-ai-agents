"""AgentRunner: the Hermes loop (think → tool → observe → act → learn) for one task.

Emits every event described in CONTRACT.md "Agent loop (worker)" and CONTRACT-v2 §4/§5, drives the
pipeline transitions, XP, memories, cost ticks, approval waits, agent-to-agent handoffs, bounded
execution and cancellation. One instance per worker process; `run_task` may run concurrently for
different tasks (bounded by the worker semaphore).
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from azzy.agents.loader import AgentConfig, get_agents
from azzy.audit import record as audit_record
from azzy.bus import Bus
from azzy.config import Settings
from azzy.costs import usd_for
from azzy.db import repo
from azzy.db.engine import session_scope
from azzy.deployments import DeploymentService
from azzy.events import (
    AGENT_IDS,
    AgentMessageEvent,
    AgentMoveEvent,
    AgentPhaseEvent,
    AgentSayEvent,
    ApprovalExpiredEvent,
    ApprovalRequestedEvent,
    ChatMessageEvent,
    CostTickEvent,
    EnvHealthEvent,
    IncidentChangedEvent,
    MemoryWrittenEvent,
    OfficeStatusEvent,
    PipelineState,
    RiskLevel,
    TaskUpdatedEvent,
    ToolLogEvent,
    XpEvent,
    new_id,
)
from azzy.llm import LLM, BudgetExceeded, LLMResult, context_message
from azzy.orchestrator.bounds import BoundExceeded, CollaborationLedger
from azzy.orchestrator.planner import WORKFLOW_STEPS, Stage, build_plan, is_change, steps_total_for
from azzy.orchestrator.router import is_action_request
from azzy.policy import Env, get_policy
from azzy.tools.registry import ApprovalRejected, Cancelled, ToolExecutor, ToolOutcome

log = logging.getLogger("azzy.runner")

XP_TASK_DONE = 25
XP_APPROVED_ACTION = 10
XP_MEMORY = 5
MAX_STEPS = 12
SAY_LIMIT = 100
_VERSION = re.compile(r"\bv\d+\.\d+\.\d+\b")
_SENTENCE = re.compile(r"(?<=[.!?])\s+")

WORKFLOW_STATES: tuple[PipelineState, ...] = (
    PipelineState.needs_work, PipelineState.needs_work, PipelineState.needs_qa,
    PipelineState.needs_work, PipelineState.needs_docs, PipelineState.needs_work,
)
INCIDENT_SIDE_MEMBERS: tuple[str, ...] = ("emir", "cyber", "sara")


_MEMORY_KINDS = {"fact", "lesson", "skill_proposal"}

# Phrases that mean the model slipped out of its agent persona and started
# asserting its underlying nature ("I'm Claude 4.5 Haiku, an AI assistant...").
# Deliberately first-person/assertive forms only, so a good in-character line
# that merely negates them ("I'm Jimmy, not an AI assistant") still passes.
_CHARACTER_BREAK_PHRASES = (
    "i'm claude",
    "i am claude",
    "claude haiku",
    "claude 4.5",
    "claude 4",
    "claude 3",
    "i'm an ai",
    "i am an ai",
    "i'm an ai assistant",
    "i am an ai assistant",
    "as a language model",
    "i'm a language model",
    "i am a language model",
    "my training data",
    "fictional character",
    "roleplay",
    "role-play",
)


def _breaks_character(text: str) -> bool:
    lowered = text.lower()
    return any(phrase in lowered for phrase in _CHARACTER_BREAK_PHRASES)


# Meeting lines are tool-less, in-character speech. The agents' pinned model
# (ddgw/claude-haiku-4-5) refuses persona adoption through DuckDuckGo and
# answers with identity disclaimers, while ddgw/mistral-small-2603 stays in
# character with concrete, per-agent updates (verified live 2026-11-03), so
# meeting lines use it instead. Tool-driven work keeps the pinned model.
MEETING_MODEL = "openai/ddgw/mistral-small-2603"


def _parse_memory_lines(text: str) -> list[tuple[str, str]]:
    """Parse 'kind: text' lines from an LLM memory-extraction reply.

    Strict on purpose: unknown kinds, missing separators and too-short or
    too-long bodies are dropped, and a leading list marker/number is forgiven.
    Returns at most 3 memories.
    """
    out: list[tuple[str, str]] = []
    for raw in (text or "").splitlines():
        line = raw.strip().lstrip("-*").strip()
        line = re.sub(r"^\d+[.)]\s*", "", line)
        kind, sep, body = line.partition(":")
        kind = kind.strip().lower()
        body = body.strip()
        if sep and kind in _MEMORY_KINDS and 20 <= len(body) <= 300:
            out.append((kind, body))
    return out[:3]


class TaskAborted(Exception):
    """Raised inside a stage to stop the pipeline with a final state + result."""

    def __init__(self, state: PipelineState, result: str) -> None:
        super().__init__(result)
        self.state = state
        self.result = result


@dataclass(slots=True)
class TaskContext:
    task_id: str
    kind: str
    prompt: str
    title: str
    lead: str
    assignees: list[str]
    env: Env | None
    env_row: dict[str, Any] | None
    meta: dict[str, Any]
    created_by: str | None = None
    account_scope: str | None = None
    ledger: CollaborationLedger | None = None
    change_happened: bool = False
    approvals_granted: int = 0
    steps_done: int = 0
    outcomes: list[ToolOutcome] = field(default_factory=list)
    finals: dict[str, str] = field(default_factory=dict)
    memories: list[dict[str, Any]] = field(default_factory=list)


class AgentRunner:
    def __init__(self, settings: Settings, bus: Bus, llm: LLM) -> None:
        self.settings = settings
        self.bus = bus
        self.llm = llm
        self.agents: dict[str, AgentConfig] = get_agents()
        self.policy = get_policy()
        self.deployments = DeploymentService(settings, bus)
        self.executor = ToolExecutor(
            settings=settings, emit=self.emit, persist_log=self._persist_tool_log, audit=self._audit, deploy_hook=self.deployments.hook,
        )
        self.demo = settings.DEMO

    # ------------------------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------------------------

    async def emit(self, event: Any) -> None:
        await self.bus.publish(event)

    async def _audit(self, **kwargs: Any) -> None:
        await audit_record(self.bus, **kwargs)

    async def pace(self, lo: float = 0.8, hi: float = 1.6) -> None:
        if self.demo:
            await asyncio.sleep(random.uniform(lo, hi))  # noqa: S311 - pacing only
        else:
            await asyncio.sleep(0.15)

    async def phase(self, agent: str, phase: str, task_id: str | None, detail: str = "") -> None:
        await self.emit(AgentPhaseEvent(agent=agent, phase=phase, task_id=task_id, detail=detail[:200]))

    async def move(self, agent: str, to: str) -> None:
        await self.emit(AgentMoveEvent(agent=agent, to=to))

    async def say(self, agent: str, text: str, ttl_ms: int = 6000) -> None:
        text = " ".join(text.split())
        if len(text) > SAY_LIMIT:
            text = text[: SAY_LIMIT - 1].rstrip() + "…"
        await self.emit(AgentSayEvent(agent=agent, text=text, ttl_ms=ttl_ms))

    async def _persist_tool_log(self, event: ToolLogEvent) -> None:
        async with session_scope() as session:
            await repo.add_tool_log(
                session, log_id=event.id, agent=event.agent, task_id=event.task_id, tool=event.tool, args=event.args,
                output=event.output, ok=event.ok, duration_ms=event.duration_ms, risk=event.risk,
            )

    async def is_cancelled(self, task_id: str) -> bool:
        try:
            return bool(await self.bus.redis.exists(f"azzy:cancel:{task_id}"))
        except Exception:  # noqa: BLE001
            return False

    async def set_state(self, ctx: TaskContext, state: PipelineState, result: str | None = None, xp_awarded: int | None = None, steps_done: int | None = None) -> None:
        fields: dict[str, Any] = {"state": state.value}
        if result is not None:
            fields["result"] = result
        if xp_awarded is not None:
            fields["xp_awarded"] = xp_awarded
        if steps_done is not None:
            fields["steps_done"] = steps_done
        async with session_scope() as session:
            current = await repo.get_task(session, ctx.task_id)
            if current is not None and current.state == "cancelled" and state != PipelineState.cancelled:
                return  # a user cancelled while we were working; never overwrite that
            row = await repo.update_task(session, ctx.task_id, **fields)
            model = repo.task_to_model(row) if row else None
        if model:
            await self.emit(TaskUpdatedEvent(task=model))

    async def bump_step(self, ctx: TaskContext) -> None:
        ctx.steps_done += 1
        async with session_scope() as session:
            row = await repo.update_task(session, ctx.task_id, steps_done=ctx.steps_done)
            model = repo.task_to_model(row) if row else None
        if model:
            await self.emit(TaskUpdatedEvent(task=model))

    async def award_xp(self, agent: str, amount: int, *, task_done: bool = False, approval_requested: bool = False) -> None:
        async with session_scope() as session:
            total, rank = await repo.add_xp(session, agent, amount, task_done=task_done, approval_requested=approval_requested)
        if amount:
            await self.emit(XpEvent(agent=agent, xp=amount, total_xp=total, rank=rank))

    async def record_cost(self, agent: str, task_id: str | None, result: LLMResult) -> None:
        usage = result.usage
        usd = usd_for(usage.model, usage.input_tokens, usage.output_tokens)
        async with session_scope() as session:
            await repo.add_cost(session, agent=agent, task_id=task_id, model=usage.model, input_tokens=usage.input_tokens, output_tokens=usage.output_tokens, usd=usd)
            summary = await repo.cost_summary(session, self.settings.DAILY_BUDGET_USD)
        await self.emit(CostTickEvent(
            agent=agent, task_id=task_id, model=usage.model, input_tokens=usage.input_tokens, output_tokens=usage.output_tokens,
            usd=usd, today_usd=summary["today_usd"], agent_today_usd=summary["per_agent"].get(agent, 0.0),
        ))

    async def set_office(self, status: str, note: str = "") -> None:
        async with session_scope() as session:
            await repo.set_kv(session, "office", {"status": status, "note": note})
        await self.emit(OfficeStatusEvent(status=status, note=note))

    async def _office_after(self) -> None:
        async with session_scope() as session:
            open_incidents = await repo.open_incident_count(session)
        await self.set_office("incident" if open_incidents else "nominal", "war room active" if open_incidents else "")

    async def send_agent_message(self, ctx: TaskContext, *, from_agent: str, to_agent: str | None, type_: str, content: str, artifacts: list[dict[str, Any]] | None = None, status: str = "sent") -> None:
        """Orchestrator-written message (handoffs between stages). Counts against the task bounds."""
        if ctx.ledger is not None:
            ctx.ledger.record_message()
        async with session_scope() as session:
            row = await repo.add_agent_message(session, task_id=ctx.task_id, from_agent=from_agent, to_agent=to_agent, type_=type_, content=content, artifacts=artifacts, status=status)
            model = repo.agent_message_to_model(row)
        await self.emit(AgentMessageEvent(message=model))

    # ------------------------------------------------------------------------------------
    # approvals
    # ------------------------------------------------------------------------------------

    def _gate_for(self, ctx: TaskContext, agent: AgentConfig):  # noqa: ANN202
        async def gate(tool: str, args: dict[str, Any], risk: RiskLevel, summary: str, env: Env | None) -> tuple[str, str | None]:
            timeout = self.settings.APPROVAL_TIMEOUT_SECONDS or self.policy.approval_timeout_seconds
            async with session_scope() as session:
                row = await repo.create_approval(
                    session, task_id=ctx.task_id, agent=agent.id, tool=tool, risk=risk, summary=summary,
                    args={k: v for k, v in args.items() if not str(k).startswith("_")}, env_id=env.id if env else None,
                    timeout_seconds=timeout,
                )
                approval = repo.approval_to_model(row)
            await self.award_xp(agent.id, 0, approval_requested=True)
            await self.emit(ApprovalRequestedEvent(approval=approval))
            await self._audit(actor=agent.id, action="approval.requested", target=approval.id, task_id=ctx.task_id, detail={"tool": tool, "risk": str(risk), "summary": summary})
            await self.say(agent.id, f"Need your approval: {summary}", ttl_ms=10000)
            await self.phase(agent.id, "waiting_approval", ctx.task_id, summary)
            await self.set_state(ctx, PipelineState.needs_human)
            if self.settings.SLACK_WEBHOOK_URL:
                from azzy.orchestrator.service import notify_slack_approval  # noqa: PLC0415

                await notify_slack_approval(self.settings, approval.model_dump())

            status = await self._wait_decision(ctx, approval.id, timeout)
            if status is None:
                async with session_scope() as session:
                    expired = await repo.decide_approval(session, approval.id, "expired", "system", "timed out")
                    model = repo.approval_to_model(expired) if expired else approval
                await self.emit(ApprovalExpiredEvent(approval=model))
                return "expired", approval.id
            if status == "approved":
                ctx.approvals_granted += 1
                await self.award_xp(agent.id, XP_APPROVED_ACTION)
                await self.say(agent.id, "Approved — proceeding.")
                await self.set_state(ctx, PipelineState.needs_work)
            return status, approval.id

        return gate

    async def _wait_decision(self, ctx: TaskContext, approval_id: str, timeout: int) -> str | None:
        """Pub/sub wait with a DB fallback poll and cancel awareness."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                return None
            status = await self.bus.wait_for_approval(approval_id, timeout=min(remaining, 10.0))
            if status in {"approved", "rejected", "expired"}:
                return None if status == "expired" else status
            if await self.is_cancelled(ctx.task_id):
                return "expired"
            async with session_scope() as session:
                row = await repo.get_approval(session, approval_id)
                if row is not None and row.status in {"approved", "rejected"}:
                    return row.status
                if row is not None and row.status == "expired":
                    return None

    # ------------------------------------------------------------------------------------
    # core loop
    # ------------------------------------------------------------------------------------

    async def run_stage(self, ctx: TaskContext, stage: Stage, *, extra_ctx: dict[str, Any] | None = None, live_phase: str = "think") -> str:
        """Run one agent through the loop for a stage. Returns the agent's final text."""
        agent = self.agents[stage.agent]
        task_id = ctx.task_id
        ledger = ctx.ledger
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": agent.system_prompt},
            context_message(
                task_id=task_id, kind=ctx.kind, stage=stage.name, prompt=ctx.prompt, agent=agent.id,
                env=ctx.env_row and {k: ctx.env_row.get(k) for k in ("id", "name", "kind", "method", "target", "version")},
                routine_id=ctx.meta.get("routine_id", ""), **(extra_ctx or {}),
            ),
            {"role": "user", "content": self._stage_prompt(ctx, stage)},
        ]
        tools = self.executor.specs_for(agent)
        gate = self._gate_for(ctx, agent)
        final = ""

        async def cancelled() -> bool:
            return await self.is_cancelled(task_id)

        await self.move(agent.id, "desk")
        for step in range(MAX_STEPS):
            if ledger is not None:
                ledger.check_task_timeout()
            if await cancelled():
                raise TaskAborted(PipelineState.cancelled, "cancelled by user")
            await self.phase(agent.id, live_phase, task_id, f"{stage.name} step {step + 1}")
            await self.pace(0.6, 1.1)
            try:
                timeout = ledger.step_timeout() if ledger else 300.0
                result = await asyncio.wait_for(self.llm.complete(agent.id, messages, tools, task_id=task_id), timeout=timeout)
            except BudgetExceeded as exc:
                await self.say(agent.id, "Budget cap reached — stopping here.")
                raise TaskAborted(PipelineState.failed, f"budget exceeded: {exc}") from exc
            except TimeoutError as exc:
                raise TaskAborted(PipelineState.failed, f"step timeout: LLM call exceeded {int(timeout)}s") from exc
            await self.record_cost(agent.id, task_id, result)
            if result.text and live_phase != "chatting":
                await self.say(agent.id, result.text)
            messages.append({"role": "assistant", "content": result.text or "", "tool_calls": [c.model_dump() for c in result.tool_calls] or None})

            if result.finished or not result.tool_calls:
                final = result.text or final
                break

            for call in result.tool_calls:
                await self.phase(agent.id, "tool", task_id, call.name)
                try:
                    outcome = await self._execute_bounded(ctx, agent, call.name, call.args, gate, cancelled)
                except ApprovalRejected as exc:
                    if exc.status == "rejected":
                        await self.say(agent.id, "Understood — not proceeding without approval.")
                        raise TaskAborted(PipelineState.needs_human, "rejected by owner") from exc
                    if await cancelled():
                        raise TaskAborted(PipelineState.cancelled, "cancelled by user") from exc
                    await self.say(agent.id, "Approval timed out; stopping.")
                    raise TaskAborted(PipelineState.failed, "approval expired") from exc
                except Cancelled as exc:
                    raise TaskAborted(PipelineState.cancelled, "cancelled by user") from exc
                ctx.outcomes.append(outcome)
                await self.phase(agent.id, "observe", task_id, f"{call.name} {'ok' if outcome.ok else 'failed'}")
                await self.pace(0.5, 0.9)
                messages.append({"role": "tool", "name": call.name, "tool_call_id": call.id, "content": outcome.output})
                if is_change(call.name, call.args, outcome.ok):
                    ctx.change_happened = True
                    await self._after_change(ctx, call.name, call.args)
            await self.phase(agent.id, "act", task_id, stage.name)
            await self.pace(0.4, 0.8)
        else:
            final = final or "Reached the step limit for this stage."

        ctx.finals[f"{stage.name}:{agent.id}"] = final
        return final

    async def _execute_bounded(self, ctx: TaskContext, agent: AgentConfig, tool: str, args: dict[str, Any], gate: Any, cancelled: Any) -> ToolOutcome:
        """Tool call with the step timeout (not applied while waiting on an approval) and retry bound."""
        ledger = ctx.ledger
        needs_wait = self.policy.needs_approval(self.policy.classify(tool, args, ctx.env), tool, ctx.env)
        extra = {"ledger": ledger, "emit": self.emit}
        kwargs: dict[str, Any] = {
            "task_id": ctx.task_id, "env": ctx.env, "env_row": ctx.env_row, "seed": ctx.task_id, "approval_gate": gate,
            "cancel_check": cancelled, "account_scope": ctx.account_scope, "extra": extra,
        }
        step_key = f"{agent.id}:{tool}"
        while True:
            try:
                if needs_wait or ledger is None:
                    outcome = await self.executor.execute(agent, tool, args, **kwargs)
                else:
                    outcome = await asyncio.wait_for(self.executor.execute(agent, tool, args, **kwargs), timeout=ledger.step_timeout())
            except TimeoutError as exc:
                raise TaskAborted(PipelineState.failed, f"step timeout: {tool} exceeded {int(ledger.step_timeout()) if ledger else 300}s") from exc
            if outcome.ok or ledger is None or outcome.output.startswith("error: ") and "not allowlisted" in outcome.output:
                return outcome
            if "BoundExceeded" in outcome.output or "max_messages_per_task" in outcome.output:
                raise TaskAborted(PipelineState.failed, f"collaboration bound exceeded: {outcome.output[:120]}")
            try:
                attempt = ledger.record_retry(step_key)
            except BoundExceeded:
                return outcome  # give the agent the error; it decides how to proceed
            if not self._retryable(outcome.output):
                return outcome
            log.info("retrying tool", extra={"fields": {"tool": tool, "attempt": attempt, "task_id": ctx.task_id}})
            await asyncio.sleep(0.5)

    @staticmethod
    def _retryable(output: str) -> bool:
        lowered = output.lower()
        return any(k in lowered for k in ("timed out", "timeout", "connection", "throttl", "temporar", "503", "lock"))

    def _stage_prompt(self, ctx: TaskContext, stage: Stage) -> str:
        if stage.name in {"work", "routine", "incident", "meeting", "workflow", "chat"}:
            return ctx.prompt
        if stage.name == "review":
            lead_final = ctx.finals.get(f"work:{ctx.lead}", "")
            return f"Review the work {ctx.lead} did for: {ctx.prompt}\nTheir summary: {lead_final}"
        if stage.name == "qa":
            return f"Run the QA / release gate for: {ctx.prompt}\nA change was made in {ctx.env.id if ctx.env else 'the codebase'}."
        return f"Write the summary for: {ctx.prompt}\nOutcomes: " + " | ".join(v for v in ctx.finals.values())[:1500]

    async def _after_change(self, ctx: TaskContext, tool: str, args: dict[str, Any]) -> None:
        """A deploy/rollback happened: update the env version shown on the Environments page."""
        env_id = str(args.get("env_id") or (ctx.env_row or {}).get("id") or "")
        if not env_id or tool == "github.branch_pr":
            return
        version: str | None = None
        if tool in {"aws.deploy", "ssh.safe_action"} and args.get("version") and args.get("action") != "rollback":
            version = str(args["version"])
        elif tool == "aws.rollback" or (tool == "ssh.safe_action" and args.get("action") == "rollback"):
            version = str(args.get("to") or args.get("version") or "v2.2.9")
            if version == "previous":
                version = "v2.2.9"
        if not version:
            return
        if not version.startswith("v"):
            version = "v" + version
        if version.count(".") == 1:
            version += ".0"
        async with session_scope() as session:
            await repo.set_env_version(session, env_id, version)
            env = await repo.get_environment(session, env_id)
            latency = env.latency_ms if env else None
        if ctx.env_row and ctx.env_row.get("id") == env_id:
            ctx.env_row["version"] = version
        await self.emit(EnvHealthEvent(env_id=env_id, health="healthy", latency_ms=latency or 80, version=version))

    # ------------------------------------------------------------------------------------
    # learn: memories
    # ------------------------------------------------------------------------------------

    async def write_memories(self, ctx: TaskContext, agent_id: str, final: str) -> None:
        """Learn phase: 1-3 durable memories via the memory.write tool (real DB write, even in DEMO)."""
        agent = self.agents[agent_id]
        await self.phase(agent_id, "learn", ctx.task_id, "writing memories")
        for kind, text in (await self._learn_texts(ctx, agent_id, final))[:3]:
            outcome = await self.executor.execute(agent, "memory.write", {"kind": kind, "text": text}, task_id=ctx.task_id, env=ctx.env, env_row=ctx.env_row, seed=ctx.task_id)
            if not outcome.ok:
                continue
            try:
                memory_id = str(json.loads(outcome.output)["memory_id"])
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
            ctx.memories.append({"agent": agent_id, "kind": kind, "text": text, "id": memory_id})
            if not self.demo:
                from azzy import memory_ext  # noqa: PLC0415

                asyncio.ensure_future(memory_ext.add_memory(agent_id, kind, text))
            await self.emit(MemoryWrittenEvent(agent=agent_id, task_id=ctx.task_id, memory_id=memory_id, text=text, kind=kind))
            await self.award_xp(agent_id, XP_MEMORY)
            await self.pace(0.3, 0.6)

    async def _learn_texts(self, ctx: TaskContext, agent_id: str, final: str) -> list[tuple[str, str]]:
        """Real mode: extract durable memories from what actually happened in this task
        (one LLM call over the task transcript). DEMO — and any extraction failure —
        keeps the scripted templates, so the learn phase can never break a task."""
        if not self.demo:
            try:
                extracted = await self._extract_memories(ctx, agent_id, final)
            except Exception:  # noqa: BLE001
                extracted = None
            if extracted:
                return extracted
        return self._memory_texts(ctx, agent_id, final)

    async def _extract_memories(self, ctx: TaskContext, agent_id: str, final: str) -> list[tuple[str, str]] | None:
        tools_used = ", ".join(sorted({o.tool for o in ctx.outcomes})) or "none"
        transcript = (
            f"Task: {ctx.title}\nKind: {ctx.kind}\nRequest: {ctx.prompt[:600]}\n"
            f"Tools used: {tools_used}\nOutcome: {(final or '')[:1500]}"
        )
        messages = [
            {"role": "system", "content": "You extract durable memories for an AI agent from a completed task. Output ONLY up to 3 lines, one memory per line, formatted exactly as 'fact: <text>' or 'lesson: <text>'. A fact is a concrete state of the world worth remembering (versions, configs, decisions). A lesson is a reusable rule learned from this task. No preamble, no numbering, no markdown."},
            {"role": "user", "content": transcript},
        ]
        result = await asyncio.wait_for(self.llm.complete(agent_id, messages, [], task_id=ctx.task_id), timeout=45)
        parsed = _parse_memory_lines(result.text)
        return parsed or None

    def _memory_texts(self, ctx: TaskContext, agent_id: str, final: str) -> list[tuple[str, str]]:
        env_name = (ctx.env_row or {}).get("name") or "HQ"
        version = _VERSION.search(final or "") or _VERSION.search(" ".join(str(o.args.get("version", "")) for o in ctx.outcomes))
        out: list[tuple[str, str]] = []
        if ctx.kind == "meeting":
            return [("fact", f"Team sync held on {ctx.meta.get('topic', 'the roadmap')}: {final[:120]}")]
        if ctx.kind == "workflow":
            return {
                "jimmy": [("lesson", "Failing ECS tasks that exit right after start usually mean an application bug — read the task logs before touching infra."), ("fact", f"Workflow fix v2.3.2 deployed to staging then {env_name} with approval.")],
                "emir": [("fact", "payments/retry.py now has a bounded retry budget with a regression test."), ("lesson", "Reproduce in the sandbox before opening the PR; it keeps the fix minimal.")],
                "cyber": [("fact", "Fix branch fix/azzy-retry-budget cleared SAST + trivy with 1 medium dep bump."), ("skill_proposal", "Auto-run SAST on every PR Emir opens during a workflow.")],
                "sara": [("fact", "Incident summary template: what happened, root cause, fix & evidence, production plan.")],
            }.get(agent_id, [("fact", f"{ctx.title[:80]}: {final[:110]}")])
        if ctx.kind == "incident":
            if agent_id == "jimmy":
                out.append(("lesson", f"On {env_name}, a 5xx spike right after a deploy is best handled by immediate rollback; verify with aws.describe before closing."))
            elif agent_id == "emir":
                out.append(("fact", "payments/retry.py needs a bounded retry budget; regression test covers RetryBudgetExceeded."))
            elif agent_id == "cyber":
                out.append(("fact", f"Incident on {env_name} showed no attack signature in access logs."))
            else:
                out.append(("lesson", "Client incident updates are drafted immediately but sent only after the RCA is confirmed and approved."))
            return out
        if version:
            out.append(("fact", f"{env_name} is on {version.group(0)} as of this task ({ctx.title[:60]})."))
        else:
            out.append(("fact", f"{ctx.title[:80]}: {final[:110]}"))
        if ctx.approvals_granted:
            out.append(("lesson", f"Production changes on {env_name} need owner approval; status check first, then the change, then re-verify."))
        elif ctx.env and ctx.env.kind == "staging":
            out.append(("lesson", f"{env_name} auto-allows {', '.join(ctx.env.auto_allow) or 'nothing'}; no approval needed for routine deploys there."))
        if agent_id == "cyber" and ctx.change_happened:
            out.append(("skill_proposal", "Add a post-deploy smoke suite that runs automatically after every deploy."))
        return out[:3]

    # ------------------------------------------------------------------------------------
    # task kinds
    # ------------------------------------------------------------------------------------

    async def load_context(self, task_id: str) -> TaskContext | None:
        async with session_scope() as session:
            row = await repo.get_task(session, task_id)
            if row is None:
                return None
            env_row = None
            account_scope = None
            if row.env_id:
                env = await repo.get_environment(session, row.env_id)
                env_row = repo.env_to_dict(env) if env else None
                if env and env.account_id:
                    account = await repo.get_account(session, env.account_id)
                    account_scope = account.scope if account and account.status == "verified" else None
        env_obj = Env(id=env_row["id"], kind=env_row["kind"], auto_allow=tuple(env_row.get("auto_allow") or [])) if env_row else None
        lead = row.lead or (row.assignees[0] if row.assignees else "emir")
        return TaskContext(
            task_id=row.id, kind=row.kind, prompt=row.prompt, title=row.title, lead=lead, assignees=list(row.assignees or [lead]),
            env=env_obj, env_row=env_row, meta=dict(row.meta or {}), created_by=row.created_by, account_scope=account_scope,
            ledger=CollaborationLedger(self.policy.collaboration), steps_done=row.steps_done or 0,
        )

    async def run_task(self, task_id: str) -> None:
        ctx = await self.load_context(task_id)
        if ctx is None:
            log.warning("task vanished", extra={"fields": {"task_id": task_id}})
            return
        if await self.is_cancelled(task_id):
            await self.set_state(ctx, PipelineState.cancelled, result="cancelled before start")
            return
        log.info("task start", extra={"fields": {"task_id": task_id, "kind": ctx.kind, "lead": ctx.lead}})
        try:
            if ctx.kind == "meeting":
                await self.run_meeting(ctx)
            elif ctx.kind == "incident":
                await self.run_incident(ctx)
            elif ctx.kind == "chat":
                await self.run_chat(ctx)
            elif ctx.kind == "workflow":
                await self.run_workflow(ctx)
            else:
                await self.run_pipeline(ctx)
        except TaskAborted as aborted:
            await self.set_state(ctx, aborted.state, result=aborted.result)
            if aborted.state == PipelineState.cancelled:
                async with session_scope() as session:
                    await repo.expire_task_approvals(session, task_id)
            for agent_id in ctx.assignees:
                await self.phase(agent_id, "idle", None)
        except BoundExceeded as exc:
            await self.set_state(ctx, PipelineState.failed, result=f"bounded execution stopped the task — {exc}")
            for agent_id in ctx.assignees:
                await self.phase(agent_id, "idle", None)
        except Exception as exc:  # noqa: BLE001 - never crash the worker on a task
            log.exception("task crashed", extra={"fields": {"task_id": task_id}})
            await self.set_state(ctx, PipelineState.failed, result=f"internal error: {type(exc).__name__}")
            for agent_id in ctx.assignees:
                await self.phase(agent_id, "idle", None)
        finally:
            try:
                await self.bus.redis.delete(f"azzy:cancel:{task_id}")
            except Exception:  # noqa: BLE001
                pass

    async def run_pipeline(self, ctx: TaskContext) -> None:
        plan = build_plan(ctx.kind, ctx.lead, ctx.assignees)
        previous_agent: str | None = None
        for stage in plan.stages:
            if stage.conditional and not ctx.change_happened:
                continue
            if previous_agent and previous_agent != stage.agent:
                await self.send_agent_message(ctx, from_agent=previous_agent, to_agent=stage.agent, type_="handoff", content=f"{stage.name}: {ctx.finals.get(next(iter(reversed(ctx.finals))), ctx.title)[:300]}" if ctx.finals else f"{stage.name}: {ctx.title}")
            await self.set_state(ctx, stage.state)
            final = await self.run_stage(ctx, stage)
            if stage.name in {"work", "routine"} or (stage.name == "qa" and ctx.change_happened):
                await self.write_memories(ctx, stage.agent, final)
            await self.phase(stage.agent, "idle", None)
            await self.bump_step(ctx)
            previous_agent = stage.agent
        await self.set_state(ctx, PipelineState.ready)
        await self.pace(0.8, 1.2)
        summary = ctx.finals.get(f"work:{ctx.lead}") or ctx.finals.get(f"routine:{ctx.lead}") or next(iter(ctx.finals.values()), "done")
        xp_total = XP_TASK_DONE + ctx.approvals_granted * XP_APPROVED_ACTION + XP_MEMORY * len(ctx.memories)
        await self.set_state(ctx, PipelineState.done, result=summary, xp_awarded=xp_total)
        await self.award_xp(ctx.lead, XP_TASK_DONE, task_done=True)
        await self.say(ctx.lead, "Done. " + summary, ttl_ms=8000)
        await self.phase(ctx.lead, "idle", None)

    # ---- workflow (CONTRACT-v2 §5) ---------------------------------------------------------

    async def _env_context(self, env_id: str) -> tuple[Env | None, dict[str, Any] | None, str | None]:
        async with session_scope() as session:
            env = await repo.get_environment(session, env_id)
            if env is None:
                return None, None, None
            env_row = repo.env_to_dict(env)
            scope = None
            if env.account_id:
                account = await repo.get_account(session, env.account_id)
                scope = account.scope if account and account.status == "verified" else None
        return Env(id=env_row["id"], kind=env_row["kind"], auto_allow=tuple(env_row.get("auto_allow") or [])), env_row, scope

    async def run_workflow(self, ctx: TaskContext) -> None:
        """Scripted collaboration: steps 0-3 run against staging (auto-allowed), step 5 against production."""
        ledger = ctx.ledger
        assert ledger is not None
        staging = await self._env_context("client-a-staging")
        prod_id = ctx.env_row["id"] if ctx.env and ctx.env.kind == "prod" else "client-b-vps"
        prod = await self._env_context(prod_id)
        for index, (agent_id, to_agent, msg_type, message) in enumerate(WORKFLOW_STEPS):
            ledger.check_task_timeout()
            if await self.is_cancelled(ctx.task_id):
                raise TaskAborted(PipelineState.cancelled, "cancelled by user")
            ctx.env, ctx.env_row, ctx.account_scope = prod if index == 5 else staging if index < 4 else (None, None, None)
            stage = Stage(name="workflow", agent=agent_id, state=WORKFLOW_STATES[index])
            await self.set_state(ctx, stage.state)
            if msg_type in {"handoff", "request"}:
                ledger.enter_delegation()
            final = await self.run_stage(ctx, stage, extra_ctx={"workflow_step": index})
            if msg_type == "result":
                ledger.leave_delegation()
            artifacts = [{"kind": o.tool.split(".")[0], "ref": o.event.id if o.event else o.tool, "label": o.tool} for o in ctx.outcomes[-2:]]
            await self.send_agent_message(ctx, from_agent=agent_id, to_agent=to_agent, type_=msg_type, content=message, artifacts=artifacts, status="completed" if to_agent is None else "sent")
            await self.write_memories(ctx, agent_id, final)
            await self.phase(agent_id, "idle", None)
            await self.bump_step(ctx)
        await self.set_state(ctx, PipelineState.ready)
        xp_total = XP_TASK_DONE + ctx.approvals_granted * XP_APPROVED_ACTION + XP_MEMORY * len(ctx.memories)
        await self.set_state(ctx, PipelineState.done, result=ctx.finals.get("workflow:jimmy", "workflow complete"), xp_awarded=xp_total)
        await self.award_xp("jimmy", XP_TASK_DONE, task_done=True)
        await self.say("jimmy", "Workflow complete — production verified healthy.", ttl_ms=8000)
        await self.phase("jimmy", "idle", None)

    # ---- chat (CONTRACT-v2 §4) -------------------------------------------------------------

    async def _live_state(self, agent_id: str, query: str | None = None) -> dict[str, Any]:
        async with session_scope() as session:
            envs = [repo.env_to_dict(e) for e in await repo.list_environments(session)]
            accounts = [repo.account_to_model(a).model_dump() for a in await repo.list_accounts(session)]
            counts = await repo.task_counts(session)
            pending = len(await repo.list_approvals(session, "pending"))
            incidents = await repo.open_incident_count(session)
            costs = await repo.cost_summary(session, self.settings.DAILY_BUDGET_USD)
            last_dep = await repo.last_deployment(session)
            last_scan = await repo.last_scan_log(session)
            memories = await self._recall_memories(session, agent_id, query)
        return {
            "environments": [{k: e.get(k) for k in ("id", "name", "kind", "health", "version")} for e in envs],
            "accounts": [{k: a.get(k) for k in ("name", "account_id", "scope", "status")} for a in accounts if a.get("status") == "verified"],
            "tasks": {"active": counts.get("active", 0), "done": counts.get("done", 0), "failed": counts.get("failed", 0)},
            "approvals_pending": pending, "incidents_open": incidents, "today_usd": costs["today_usd"],
            "last_deployment": {"version": last_dep.version, "env_id": last_dep.env_id, "status": last_dep.status} if last_dep else None,
            "last_scan": {"tool": last_scan.tool, "target": (last_scan.args or {}).get("target") or (last_scan.args or {}).get("repo"), "ok": last_scan.ok, "when": repo.iso(last_scan.created_at)} if last_scan else None,
            "memories": [m["text"] for m in memories],
        }

    async def _recall_memories(self, session: Any, agent_id: str, query: str | None) -> list[dict[str, Any]]:
        """Semantic recall first (embeddings are stored on every memory); recency fallback.

        Mem0 hits (when MEM0_ENABLED) merge in as additive context - the native
        store stays authoritative and always comes first."""
        native: list[dict[str, Any]] = []
        if query:
            vector = None
            try:
                from azzy.embeddings import embed  # noqa: PLC0415

                vector = await embed(query, demo=self.demo, model=self.settings.EMBEDDINGS_MODEL, region=self.settings.AWS_REGION)
            except Exception:  # noqa: BLE001
                vector = None
            if vector is not None:
                rows = await repo.search_memories(session, agent=agent_id, embedding=vector, limit=5)
                if rows:
                    native = [repo.memory_to_dict(m) for m in rows]
        if not native:
            native = [repo.memory_to_dict(m) for m in await repo.list_memories(session, agent=agent_id, limit=5)]
        if query:
            try:
                from azzy import memory_ext  # noqa: PLC0415

                seen = {m["text"] for m in native}
                for text in await memory_ext.search_memories(agent_id, query, limit=3):
                    if text not in seen:
                        native.append({"id": "mem0", "agent": agent_id, "task_id": None, "kind": "mem0", "text": text, "created_at": None})
            except Exception:  # noqa: BLE001
                pass
        return native

    async def run_chat(self, ctx: TaskContext) -> None:
        agent_id = ctx.lead
        conversation_id = str(ctx.meta.get("conversation_id") or "")
        user_message = ctx.prompt
        await self.set_state(ctx, PipelineState.needs_work)
        await self.phase(agent_id, "chatting", ctx.task_id, "replying")
        async with session_scope() as session:
            history = [repo.chat_message_to_model(m).model_dump() for m in await repo.list_chat_messages(session, conversation_id, limit=20)] if conversation_id else []
        live = await self._live_state(agent_id, query=user_message)
        knowledge: list[dict[str, Any]] = []
        try:
            from azzy.embeddings import embed  # noqa: PLC0415

            vector = await embed(user_message, demo=self.demo, model=self.settings.EMBEDDINGS_MODEL, region=self.settings.AWS_REGION)
            if vector is not None:
                async with session_scope() as session:
                    knowledge = await repo.search_chunks(session, embedding=vector, scopes={"global"}, limit=3)
        except Exception:  # noqa: BLE001
            knowledge = []

        if is_action_request(user_message):
            from azzy.orchestrator.service import create_task  # noqa: PLC0415

            async with session_scope() as session:
                task = await create_task(session, self.bus, user_message, created_by=ctx.created_by, meta={"from_chat": conversation_id})
            reply = f"On it — I've opened task {task.id[:8]} ({task.title}) with {', '.join(task.assignees)}. Follow it on the Tasks board; I'll ask for approval if anything touches production."
            await self._stream_reply(ctx, agent_id, conversation_id, reply, task_link=task.id)
            await self.set_state(ctx, PipelineState.done, result=reply[:200])
            await self.phase(agent_id, "idle", None)
            return

        stage = Stage(name="chat", agent=agent_id, state=PipelineState.needs_work)
        extra = {"live": live, "history": [{"role": m["role"], "content": m["content"][:400]} for m in history[-20:]], "knowledge": [k["chunk"][:300] for k in knowledge]}
        final = await self.run_stage(ctx, stage, extra_ctx=extra, live_phase="chatting")
        await self._stream_reply(ctx, agent_id, conversation_id, final or "I don't have anything to add on that yet.")
        await self.set_state(ctx, PipelineState.done, result=(final or "")[:200])
        await self.phase(agent_id, "idle", None)

    async def _stream_reply(self, ctx: TaskContext, agent_id: str, conversation_id: str, text: str, task_link: str | None = None) -> None:
        """Persist the agent reply and stream it as chat.message chunks (same id, growing content)."""
        message_id = new_id()
        first = _SENTENCE.split(text.strip(), maxsplit=1)[0]
        await self.say(agent_id, first, ttl_ms=7000)
        async with session_scope() as session:
            row = await repo.add_chat_message(session, agent=agent_id, conversation_id=conversation_id, role="agent", content="", task_id=task_link or ctx.task_id, streaming=True, message_id=message_id)
            base = repo.chat_message_to_model(row).model_dump()
        words = text.split(" ")
        chunk_size = max(3, len(words) // 6)
        content = ""
        for i in range(0, len(words), chunk_size):
            content = " ".join(words[: i + chunk_size])
            await self.emit(ChatMessageEvent(message={**base, "content": content, "streaming": True}))
            await asyncio.sleep(0.18 if self.demo else 0.02)
        async with session_scope() as session:
            await repo.update_chat_message(session, message_id, content=text, streaming=False)
        await self.emit(ChatMessageEvent(message={**base, "content": text, "streaming": False}))

    # ---- meeting -------------------------------------------------------------------------

    async def run_meeting(self, ctx: TaskContext) -> None:
        order = list(AGENT_IDS)
        topic = str(ctx.meta.get("topic") or "Team sync")
        try:
            await self.set_office("meeting", topic)
            await self.set_state(ctx, PipelineState.needs_work)
            for agent_id in order:
                await self.move(agent_id, "table")
                await self.phase(agent_id, "meeting", ctx.task_id, topic)
                await asyncio.sleep(0.5 if self.demo else 0.05)
            await asyncio.sleep(2.0 if self.demo else 0.1)  # walking time
            for agent_id in order:
                if await self.is_cancelled(ctx.task_id):
                    raise TaskAborted(PipelineState.cancelled, "cancelled by user")
                stage = Stage(name="meeting", agent=agent_id, state=PipelineState.needs_work)
                final = await self._meeting_line(ctx, stage)
                await self.say(agent_id, final, ttl_ms=5000)
                async with session_scope() as session:
                    await repo.add_memory(session, agent=agent_id, task_id=ctx.task_id, kind="fact", text=f"Meeting ({topic}): {final}"[:500], embedding=repo.demo_embedding(final) if self.demo else None)
                await asyncio.sleep(3.0 if self.demo else 0.1)
            for agent_id in order:
                await self.move(agent_id, "desk")
                await self.phase(agent_id, "idle", None)
                await asyncio.sleep(0.3 if self.demo else 0.02)
            await self.set_state(ctx, PipelineState.done, result=f"Meeting on '{topic}' held; everyone reported.", xp_awarded=0)
        finally:
            for agent_id in order:
                await self.move(agent_id, "desk")
            await self._office_after()
            await self.bus.release_lock("meeting")

    async def _meeting_line(self, ctx: TaskContext, stage: Stage) -> str:
        agent = self.agents[stage.agent]
        topic = str(ctx.meta.get("topic") or "team sync")
        # Ground the line in the agent's own latest work note so each agent
        # reports on different work instead of producing the same generic line.
        grounding = ""
        try:
            async with session_scope() as session:
                recent = await self._recall_memories(session, agent.id, None)
            notes = [str(m.get("text") or "").strip() for m in recent]
            notes = [n for n in notes if n and not n.startswith("Meeting (")]
            if notes:
                grounding = f" Your most recent work note: {notes[0][:160]}"
        except Exception:  # noqa: BLE001
            grounding = ""
        ask = (
            f"Team meeting on: {topic}. Give your one-sentence status update (max 100 chars), "
            f"spoken as {agent.name}: what you are working on right now, anything blocked, and "
            f"anything you need from the team. Be concrete about your own work.{grounding}"
        )
        messages = [
            {"role": "system", "content": agent.system_prompt},
            context_message(task_id=ctx.task_id, kind="meeting", stage="meeting", prompt=ctx.prompt, agent=agent.id, topic=ctx.meta.get("topic", "")),
            {"role": "user", "content": ask},
        ]
        meeting_model = None if self.demo else MEETING_MODEL
        try:
            result = await self.llm.complete(agent.id, messages, [], task_id=ctx.task_id, model=meeting_model)
        except BudgetExceeded:
            return "Over budget today — listening only."
        await self.record_cost(agent.id, ctx.task_id, result)
        text = (result.text or "").replace("**", "").strip()
        if text and _breaks_character(text):
            # The model slipped out of persona and asserted its underlying nature
            # instead of reporting as the agent. Retry FRESH (showing it the bad
            # line only anchors the disclaimer) with a firmer in-character ask;
            # if it slips again, fall back to a plain in-character status line.
            retry_ask = (
                f"You are {agent.name}, the {agent.role} at AZZY AI AGENTS, in a team meeting on: {topic}. "
                "Give ONLY your one-sentence status update (max 100 chars) about your own work - "
                f"what is moving, what is blocked. Speak as yourself; do not discuss your nature.{grounding}"
            )
            retry = [messages[0], messages[1], {"role": "user", "content": retry_ask}]
            try:
                result2 = await self.llm.complete(agent.id, retry, [], task_id=ctx.task_id, model=meeting_model)
                await self.record_cost(agent.id, ctx.task_id, result2)
                text2 = (result2.text or "").replace("**", "").strip()
                if text2 and not _breaks_character(text2):
                    return text2[:240]
            except BudgetExceeded:
                pass
            return f"{topic}: on track, nothing blocked on my side."
        return text[:240] or "Nothing to report."

    # ---- incident war room -----------------------------------------------------------------

    async def run_incident(self, ctx: TaskContext) -> None:
        incident_id = str(ctx.meta.get("incident_id") or "")
        await self.set_office("incident", ctx.title)
        await self.set_state(ctx, PipelineState.needs_work)
        await self._incident_update(incident_id, "War room opened: Jimmy lead, Emir root cause, Cyber attack check, Sara client comms.", None, "investigating")
        for member in INCIDENT_SIDE_MEMBERS:
            await self.send_agent_message(ctx, from_agent="jimmy", to_agent=member, type_="handoff", content={"emir": "Please find the root cause in the last deploy's diff.", "cyber": "Please check the access logs for an attack signature.", "sara": "Please draft the client update; do not send."}[member])

        async def run_member(agent_id: str) -> None:
            stage = Stage(name="incident", agent=agent_id, state=PipelineState.needs_work)
            sub = TaskContext(
                task_id=ctx.task_id, kind=ctx.kind, prompt=ctx.prompt, title=ctx.title, lead=ctx.lead, assignees=ctx.assignees,
                env=ctx.env, env_row=dict(ctx.env_row) if ctx.env_row else None, meta=ctx.meta, created_by=ctx.created_by,
                account_scope=ctx.account_scope, ledger=ctx.ledger,
            )
            try:
                final = await self.run_stage(sub, stage)
            except TaskAborted as aborted:
                ctx.finals[f"incident:{agent_id}"] = aborted.result
                raise
            finally:
                ctx.outcomes.extend(sub.outcomes)
                ctx.approvals_granted += sub.approvals_granted
                ctx.change_happened = ctx.change_happened or sub.change_happened
                if sub.env_row and ctx.env_row and sub.env_row.get("version"):
                    ctx.env_row["version"] = sub.env_row["version"]
            ctx.finals[f"incident:{agent_id}"] = final
            await self._incident_update(incident_id, final, agent_id, None)
            await self.write_memories(sub, agent_id, final)
            ctx.memories.extend(sub.memories)
            await self.phase(agent_id, "idle", None)
            await self.bump_step(ctx)

        async def side(agent_id: str) -> None:
            try:
                await run_member(agent_id)
            except TaskAborted as aborted:
                await self._incident_update(incident_id, f"{agent_id} stopped: {aborted.result}", agent_id, None)
                await self.phase(agent_id, "idle", None)

        side_tasks = [asyncio.create_task(side(agent_id)) for agent_id in INCIDENT_SIDE_MEMBERS]
        lead_error: TaskAborted | None = None
        try:
            await self._incident_update(incident_id, "Jimmy: pulling logs and service state; rollback likely.", "jimmy", "mitigating")
            await run_member("jimmy")
        except TaskAborted as aborted:
            lead_error = aborted
        await asyncio.gather(*side_tasks, return_exceptions=True)

        if lead_error is not None:
            await self._incident_update(incident_id, f"Rollback not performed: {lead_error.result}.", "jimmy", "investigating")
            await self._office_after()
            raise lead_error

        await self._incident_update(incident_id, "Rollback complete, service healthy. Incident resolved; client update stays drafted until the RCA is approved.", "jimmy", "resolved")
        await self.set_state(ctx, PipelineState.ready)
        xp_total = XP_TASK_DONE + ctx.approvals_granted * XP_APPROVED_ACTION + XP_MEMORY * len(ctx.memories)
        await self.set_state(ctx, PipelineState.done, result=ctx.finals.get("incident:jimmy", "resolved"), xp_awarded=xp_total)
        await self.award_xp("jimmy", XP_TASK_DONE, task_done=True)
        await self._office_after()

    async def _incident_update(self, incident_id: str, text: str, agent: str | None, status: str | None) -> None:
        if not incident_id:
            return
        async with session_scope() as session:
            row = await repo.incident_append(session, incident_id, text=text, agent=agent, status=status)
            model = repo.incident_to_model(row) if row else None
        if model:
            await self.emit(IncidentChangedEvent(incident=model))


def recent_cutoff(seconds: int = 20) -> datetime:
    return datetime.now(UTC) - timedelta(seconds=seconds)
