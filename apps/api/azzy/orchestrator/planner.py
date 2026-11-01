"""Builds the stage plan for a task. Pure (stdlib + pydantic)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from azzy.events import PipelineState

StageName = Literal["work", "review", "qa", "docs", "meeting", "incident", "routine", "chat", "workflow"]

QA_AGENT = "cyber"
DOCS_AGENT = "sara"

# Tools whose success means "a deploy / code change happened" → Cyber runs the QA gate.
CHANGE_TOOLS: frozenset[str] = frozenset({"aws.deploy", "aws.rollback", "github.branch_pr"})
CHANGE_SSH_ACTIONS: frozenset[str] = frozenset({"deploy", "rollback", "restart"})


class Stage(BaseModel):
    name: StageName
    agent: str
    state: PipelineState
    conditional: bool = False  # qa runs only when a change happened


class Plan(BaseModel):
    kind: Literal["command", "incident", "routine", "meeting", "chat", "workflow"]
    stages: list[Stage]


# CONTRACT-v2 §5 scripted workflow: (agent, handoff target, handoff type, message)
WORKFLOW_STEPS: tuple[tuple[str, str | None, str, str], ...] = (
    ("jimmy", "emir", "handoff", "ECS diagnostics attached: tasks cycling with exit 1, RetryBudgetExceeded in payments/retry.py. Over to you for the fix."),
    ("emir", "cyber", "result", "Fix ready on branch fix/azzy-retry-budget (bounded retries + regression test, 54 passed). Please run the security checks."),
    ("cyber", "jimmy", "result", "Security checks pass: 0 critical, 0 high (1 medium dep bump noted). Cleared for staging deploy."),
    ("jimmy", "sara", "request", "Staging deploy healthy (2/2 tasks, 0 5xx). Please prepare the incident summary while I request production approval."),
    ("sara", "jimmy", "result", "Incident summary PDF exported for the owner. Production deploy can proceed once approved."),
    ("jimmy", None, "note", "Production deployment approved and verified healthy. Workflow complete."),
)


def pick_reviewer(lead: str, assignees: list[str]) -> str | None:
    """Second agent reviews if any — Sara is reserved for the docs stage."""
    for agent in assignees:
        if agent not in {lead, DOCS_AGENT}:
            return agent
    return None


def build_plan(kind: str, lead: str | None, assignees: list[str]) -> Plan:
    lead = lead or (assignees[0] if assignees else "emir")
    if kind == "meeting":
        return Plan(kind="meeting", stages=[Stage(name="meeting", agent=lead, state=PipelineState.needs_work)])
    if kind == "incident":
        return Plan(kind="incident", stages=[Stage(name="incident", agent="jimmy", state=PipelineState.needs_work)])
    if kind == "chat":
        return Plan(kind="chat", stages=[Stage(name="chat", agent=lead, state=PipelineState.needs_work)])
    if kind == "workflow":
        stages = [Stage(name="workflow", agent=agent, state=PipelineState.needs_work) for agent, _to, _t, _m in WORKFLOW_STEPS]
        return Plan(kind="workflow", stages=stages)
    stages: list[Stage] = [Stage(name="routine" if kind == "routine" else "work", agent=lead, state=PipelineState.needs_work)]
    reviewer = pick_reviewer(lead, assignees)
    if reviewer:
        stages.append(Stage(name="review", agent=reviewer, state=PipelineState.needs_review))
    stages.append(Stage(name="qa", agent=QA_AGENT, state=PipelineState.needs_qa, conditional=True))
    stages.append(Stage(name="docs", agent=DOCS_AGENT, state=PipelineState.needs_docs))
    return Plan(kind="routine" if kind == "routine" else "command", stages=stages)


def is_change(tool: str, args: dict[str, object], ok: bool) -> bool:
    if not ok:
        return False
    if tool in CHANGE_TOOLS:
        return True
    return tool == "ssh.safe_action" and str(args.get("action", "")).lower() in CHANGE_SSH_ACTIONS


def steps_total_for(plan: Plan) -> int:
    return len([s for s in plan.stages if not s.conditional])
