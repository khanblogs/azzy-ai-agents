"""Pydantic mirror of packages/events/src/index.ts (AZZY AI AGENTS v2.0).

Every enum literal and field name here must match the zod schema exactly; tests/test_events.py
parses the TypeScript file and compares the literal lists.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

PRODUCT_NAME = "AZZY AI AGENTS"
PRODUCT_VERSION = "v2.0"
CREATOR_CREDIT = "Created by Shahrukh Khan"


class AgentId(StrEnum):
    jimmy = "jimmy"
    emir = "emir"
    cyber = "cyber"
    sara = "sara"
    marwah = "marwah"


AGENT_IDS: tuple[str, ...] = tuple(a.value for a in AgentId)


class AgentPhase(StrEnum):
    idle = "idle"
    think = "think"
    tool = "tool"
    observe = "observe"
    act = "act"
    learn = "learn"
    waiting_approval = "waiting_approval"
    meeting = "meeting"
    away = "away"
    chatting = "chatting"


class Spot(StrEnum):
    desk = "desk"
    table = "table"
    bar = "bar"
    lounge = "lounge"
    wall = "wall"


class PipelineState(StrEnum):
    needs_work = "needs_work"
    needs_review = "needs_review"
    needs_qa = "needs_qa"
    needs_docs = "needs_docs"
    ready = "ready"
    needs_human = "needs_human"
    done = "done"
    failed = "failed"
    cancelled = "cancelled"


class RiskLevel(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"


class ApprovalStatus(StrEnum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    expired = "expired"


class IncidentStatus(StrEnum):
    open = "open"
    investigating = "investigating"
    mitigating = "mitigating"
    resolved = "resolved"


class OfficeStatus(StrEnum):
    nominal = "nominal"
    meeting = "meeting"
    incident = "incident"


class UserRole(StrEnum):
    admin = "admin"
    devops = "devops"
    developer = "developer"
    security = "security"
    operations = "operations"
    marketing = "marketing"
    readonly = "readonly"


class AwsScope(StrEnum):
    readonly = "readonly"
    audit = "audit"
    deploy = "deploy"


class AccountStatus(StrEnum):
    pending = "pending"
    verified = "verified"
    failed = "failed"


class DeploymentStatus(StrEnum):
    planned = "planned"
    awaiting_approval = "awaiting_approval"
    running = "running"
    verifying = "verifying"
    succeeded = "succeeded"
    rolled_back = "rolled_back"
    failed = "failed"


class AgentMessageType(StrEnum):
    handoff = "handoff"
    request = "request"
    result = "result"
    note = "note"
    escalation = "escalation"


class TaskKind(StrEnum):
    command = "command"
    incident = "incident"
    routine = "routine"
    meeting = "meeting"
    chat = "chat"
    workflow = "workflow"


IncidentSource = Literal["cloudwatch", "manual", "agent"]
IncidentSeverity = Literal["sev1", "sev2", "sev3"]
MemoryKind = Literal["fact", "lesson", "skill_proposal"]
EnvHealth = Literal["healthy", "degraded", "down", "unknown"]
ChatRole = Literal["user", "agent", "system"]
MessageStatus = Literal["sent", "acknowledged", "completed", "failed"]
Stage = Literal["dev", "uat", "staging", "prod"]

TERMINAL_STATES: frozenset[str] = frozenset({"done", "failed", "cancelled"})

PIPELINE_ORDER: tuple[PipelineState, ...] = (
    PipelineState.needs_work,
    PipelineState.needs_review,
    PipelineState.needs_qa,
    PipelineState.needs_docs,
    PipelineState.ready,
    PipelineState.needs_human,
    PipelineState.done,
)

RANKS: tuple[tuple[str, int], ...] = (
    ("Intern", 0),
    ("Associate", 100),
    ("Senior", 300),
    ("Lead", 700),
    ("Principal", 1500),
    ("Fellow", 3000),
)

AGENT_META: dict[str, dict[str, str]] = {
    "jimmy": {"name": "Jimmy", "role": "DevOps Agent", "short": "DevOps", "color": "#00E5FF", "domainRole": "devops"},
    "emir": {"name": "Emir", "role": "Developer Agent", "short": "Developer", "color": "#FFB547", "domainRole": "developer"},
    "cyber": {"name": "Cyber", "role": "Security / Testing / Audit / VAPT Agent", "short": "Security", "color": "#9747FF", "domainRole": "security"},
    "sara": {"name": "Sara", "role": "Operations Agent", "short": "Operations", "color": "#F04DFF", "domainRole": "operations"},
    "marwah": {"name": "Marwah", "role": "Marketing Agent", "short": "Marketing", "color": "#34D399", "domainRole": "marketing"},
}

BRAND: dict[str, str] = {
    "navy": "#050816",
    "midnight": "#0B1025",
    "cyan": "#00E5FF",
    "purple": "#9747FF",
    "magenta": "#F04DFF",
    "gold": "#FFB547",
}


def rank_for(xp: int) -> str:
    name = RANKS[0][0]
    for rank_name, minimum in RANKS:
        if xp >= minimum:
            name = rank_name
    return name


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_id() -> str:
    return str(uuid.uuid4())


class _Model(BaseModel):
    model_config = ConfigDict(use_enum_values=True, extra="forbid")


# ---- entity shapes -------------------------------------------------------------------


class Approval(_Model):
    id: str
    task_id: str
    agent: AgentId
    tool: str
    risk: RiskLevel
    summary: str
    args: dict[str, Any]
    env_id: str | None
    status: ApprovalStatus
    created_at: str
    decided_at: str | None
    decided_by: str | None
    expires_at: str


class Task(_Model):
    id: str
    title: str
    prompt: str
    state: PipelineState
    assignees: list[AgentId]
    lead: AgentId | None
    env_id: str | None
    kind: TaskKind
    created_by: str | None
    created_at: str
    updated_at: str
    result: str | None
    xp_awarded: int = 0
    steps_total: int = 0
    steps_done: int = 0


class TimelineEntry(_Model):
    ts: str
    agent: AgentId | None
    text: str


class Incident(_Model):
    id: str
    title: str
    source: IncidentSource
    severity: IncidentSeverity
    status: IncidentStatus
    env_id: str | None
    task_id: str | None
    timeline: list[TimelineEntry]
    created_at: str
    resolved_at: str | None


class MessageArtifact(_Model):
    kind: str
    ref: str
    label: str


class AgentMessage(_Model):
    id: str
    task_id: str
    from_agent: AgentId
    to_agent: AgentId | None
    type: AgentMessageType
    content: str
    artifacts: list[MessageArtifact] = Field(default_factory=list)
    status: MessageStatus
    created_at: str


class ChatMessage(_Model):
    id: str
    agent: AgentId
    conversation_id: str
    role: ChatRole
    content: str
    task_id: str | None
    created_at: str
    streaming: bool = False


class DeploymentCheck(_Model):
    name: str
    ok: bool
    detail: str


class Deployment(_Model):
    id: str
    env_id: str
    account_id: str | None
    version: str
    previous_version: str | None
    agent: AgentId
    task_id: str | None
    approval_id: str | None
    status: DeploymentStatus
    risk: RiskLevel
    change_summary: str
    checks: list[DeploymentCheck] = Field(default_factory=list)
    started_at: str | None
    finished_at: str | None
    created_at: str


class PermissionCheck(_Model):
    name: str
    ok: bool


class AwsAccount(_Model):
    id: str
    name: str
    account_id: str
    role_arn: str
    has_external_id: bool
    scope: AwsScope
    regions: list[str]
    stage: Stage
    status: AccountStatus
    permissions: list[PermissionCheck] = Field(default_factory=list)
    last_verified: str | None
    error: str | None
    created_at: str
    demo: bool = False


class AuditEntry(_Model):
    id: str
    ts: str
    actor: str
    action: str
    target: str | None
    task_id: str | None
    detail: dict[str, Any] = Field(default_factory=dict)
    ip: str | None


# ---- events ---------------------------------------------------------------------------


class _Event(_Model):
    id: str = Field(default_factory=new_id)
    ts: str = Field(default_factory=now_iso)


class AgentPhaseEvent(_Event):
    type: Literal["agent.phase"] = "agent.phase"
    agent: AgentId
    phase: AgentPhase
    task_id: str | None
    detail: str = ""


class AgentMoveEvent(_Event):
    type: Literal["agent.move"] = "agent.move"
    agent: AgentId
    to: Spot


class AgentSayEvent(_Event):
    type: Literal["agent.say"] = "agent.say"
    agent: AgentId
    text: str
    ttl_ms: int = Field(default=6000, gt=0)


class ApprovalRequestedEvent(_Event):
    type: Literal["approval.requested"] = "approval.requested"
    approval: Approval


class ApprovalDecidedEvent(_Event):
    type: Literal["approval.decided"] = "approval.decided"
    approval: Approval


class ApprovalExpiredEvent(_Event):
    type: Literal["approval.expired"] = "approval.expired"
    approval: Approval


class TaskUpdatedEvent(_Event):
    type: Literal["task.updated"] = "task.updated"
    task: Task


class IncidentChangedEvent(_Event):
    type: Literal["incident.changed"] = "incident.changed"
    incident: Incident


class CostTickEvent(_Event):
    type: Literal["cost.tick"] = "cost.tick"
    agent: AgentId
    task_id: str | None
    model: str
    input_tokens: int
    output_tokens: int
    usd: float
    today_usd: float
    agent_today_usd: float


class MemoryWrittenEvent(_Event):
    type: Literal["memory.written"] = "memory.written"
    agent: AgentId
    task_id: str | None
    memory_id: str
    text: str
    kind: MemoryKind


class ToolLogEvent(_Event):
    type: Literal["tool.log"] = "tool.log"
    agent: AgentId
    task_id: str | None
    tool: str
    args: dict[str, Any]
    output: str
    ok: bool
    duration_ms: int
    risk: RiskLevel


class OfficeStatusEvent(_Event):
    type: Literal["office.status"] = "office.status"
    status: OfficeStatus
    note: str = ""


class EnvHealthEvent(_Event):
    type: Literal["env.health"] = "env.health"
    env_id: str
    health: EnvHealth
    latency_ms: int | None
    version: str | None


class XpEvent(_Event):
    type: Literal["agent.xp"] = "agent.xp"
    agent: AgentId
    xp: int
    total_xp: int
    rank: str


class AgentMessageEvent(_Event):
    type: Literal["agent.message"] = "agent.message"
    message: AgentMessage


class ChatMessageEvent(_Event):
    type: Literal["chat.message"] = "chat.message"
    message: ChatMessage


class DeploymentChangedEvent(_Event):
    type: Literal["deployment.changed"] = "deployment.changed"
    deployment: Deployment


class AccountChangedEvent(_Event):
    type: Literal["account.changed"] = "account.changed"
    account: AwsAccount


class AuditAppendedEvent(_Event):
    type: Literal["audit.appended"] = "audit.appended"
    entry: AuditEntry


AzzyEvent = Annotated[
    AgentPhaseEvent
    | AgentMoveEvent
    | AgentSayEvent
    | ApprovalRequestedEvent
    | ApprovalDecidedEvent
    | ApprovalExpiredEvent
    | TaskUpdatedEvent
    | IncidentChangedEvent
    | CostTickEvent
    | MemoryWrittenEvent
    | ToolLogEvent
    | OfficeStatusEvent
    | EnvHealthEvent
    | XpEvent
    | AgentMessageEvent
    | ChatMessageEvent
    | DeploymentChangedEvent
    | AccountChangedEvent
    | AuditAppendedEvent,
    Field(discriminator="type"),
]

EVENT_CLASSES: dict[str, type[_Event]] = {
    "agent.phase": AgentPhaseEvent,
    "agent.move": AgentMoveEvent,
    "agent.say": AgentSayEvent,
    "approval.requested": ApprovalRequestedEvent,
    "approval.decided": ApprovalDecidedEvent,
    "approval.expired": ApprovalExpiredEvent,
    "task.updated": TaskUpdatedEvent,
    "incident.changed": IncidentChangedEvent,
    "cost.tick": CostTickEvent,
    "memory.written": MemoryWrittenEvent,
    "tool.log": ToolLogEvent,
    "office.status": OfficeStatusEvent,
    "env.health": EnvHealthEvent,
    "agent.xp": XpEvent,
    "agent.message": AgentMessageEvent,
    "chat.message": ChatMessageEvent,
    "deployment.changed": DeploymentChangedEvent,
    "account.changed": AccountChangedEvent,
    "audit.appended": AuditAppendedEvent,
}

EVENT_TYPES: tuple[str, ...] = tuple(EVENT_CLASSES)


def new_event(type: str, **fields: Any) -> _Event:  # noqa: A002 - mirrors the TS field name
    """Build a validated event of the given `type`, filling `id` and `ts`."""
    try:
        cls = EVENT_CLASSES[type]
    except KeyError as exc:
        raise ValueError(f"unknown event type {type!r}") from exc
    return cls(**fields)


def parse_event(raw: dict[str, Any]) -> _Event | None:
    cls = EVENT_CLASSES.get(str(raw.get("type")))
    if cls is None:
        return None
    try:
        return cls.model_validate(raw)
    except ValueError:
        return None


def event_json(event: _Event) -> str:
    return event.model_dump_json()
