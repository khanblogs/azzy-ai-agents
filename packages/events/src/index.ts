import { z } from "zod";

/**
 * Shared contract between the API (publisher) and the web UI (consumer) — AZZY AI AGENTS v2.0.
 * The Python side mirrors these shapes in apps/api/azzy/events.py; both sides are covered by
 * tests that pin the literal values below.
 */

export const PRODUCT_NAME = "AZZY AI AGENTS";
export const PRODUCT_VERSION = "v2.0";
export const CREATOR_CREDIT = "Created by Shahrukh Khan";

export const AgentId = z.enum(["jimmy", "emir", "cyber", "sara", "marwah"]);
export type AgentId = z.infer<typeof AgentId>;
export const AGENT_IDS: AgentId[] = ["jimmy", "emir", "cyber", "sara", "marwah"];

export const AgentPhase = z.enum(["idle", "think", "tool", "observe", "act", "learn", "waiting_approval", "meeting", "away", "chatting"]);
export type AgentPhase = z.infer<typeof AgentPhase>;

export const Spot = z.enum(["desk", "table", "bar", "lounge", "wall"]);
export type Spot = z.infer<typeof Spot>;

export const PipelineState = z.enum(["needs_work", "needs_review", "needs_qa", "needs_docs", "ready", "needs_human", "done", "failed", "cancelled"]);
export type PipelineState = z.infer<typeof PipelineState>;

export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const ApprovalStatus = z.enum(["pending", "approved", "rejected", "expired"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const IncidentStatus = z.enum(["open", "investigating", "mitigating", "resolved"]);
export type IncidentStatus = z.infer<typeof IncidentStatus>;

export const OfficeStatus = z.enum(["nominal", "meeting", "incident"]);
export type OfficeStatus = z.infer<typeof OfficeStatus>;

export const UserRole = z.enum(["admin", "devops", "developer", "security", "operations", "marketing", "readonly"]);
export type UserRole = z.infer<typeof UserRole>;

export const AwsScope = z.enum(["readonly", "audit", "deploy"]);
export type AwsScope = z.infer<typeof AwsScope>;

export const AccountStatus = z.enum(["pending", "verified", "failed"]);
export type AccountStatus = z.infer<typeof AccountStatus>;

export const DeploymentStatus = z.enum(["planned", "awaiting_approval", "running", "verifying", "succeeded", "rolled_back", "failed"]);
export type DeploymentStatus = z.infer<typeof DeploymentStatus>;

export const AgentMessageType = z.enum(["handoff", "request", "result", "note", "escalation"]);
export type AgentMessageType = z.infer<typeof AgentMessageType>;

const base = { id: z.string(), ts: z.string() };

export const AgentPhaseEvent = z.object({
  ...base,
  type: z.literal("agent.phase"),
  agent: AgentId,
  phase: AgentPhase,
  task_id: z.string().nullable(),
  detail: z.string().default(""),
});

export const AgentMoveEvent = z.object({ ...base, type: z.literal("agent.move"), agent: AgentId, to: Spot });

export const AgentSayEvent = z.object({
  ...base,
  type: z.literal("agent.say"),
  agent: AgentId,
  text: z.string(),
  ttl_ms: z.number().int().positive().default(6000),
});

export const Approval = z.object({
  id: z.string(),
  task_id: z.string(),
  agent: AgentId,
  tool: z.string(),
  risk: RiskLevel,
  summary: z.string(),
  args: z.record(z.unknown()),
  env_id: z.string().nullable(),
  status: ApprovalStatus,
  created_at: z.string(),
  decided_at: z.string().nullable(),
  decided_by: z.string().nullable(),
  expires_at: z.string(),
});
export type Approval = z.infer<typeof Approval>;

export const ApprovalRequestedEvent = z.object({ ...base, type: z.literal("approval.requested"), approval: Approval });
export const ApprovalDecidedEvent = z.object({ ...base, type: z.literal("approval.decided"), approval: Approval });
export const ApprovalExpiredEvent = z.object({ ...base, type: z.literal("approval.expired"), approval: Approval });

export const TaskKind = z.enum(["command", "incident", "routine", "meeting", "chat", "workflow"]);
export type TaskKind = z.infer<typeof TaskKind>;

export const Task = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  state: PipelineState,
  assignees: z.array(AgentId),
  lead: AgentId.nullable(),
  env_id: z.string().nullable(),
  kind: TaskKind,
  created_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  result: z.string().nullable(),
  xp_awarded: z.number().int().default(0),
  steps_total: z.number().int().default(0),
  steps_done: z.number().int().default(0),
});
export type Task = z.infer<typeof Task>;

export const TaskUpdatedEvent = z.object({ ...base, type: z.literal("task.updated"), task: Task });

export const Incident = z.object({
  id: z.string(),
  title: z.string(),
  source: z.enum(["cloudwatch", "manual", "agent"]),
  severity: z.enum(["sev1", "sev2", "sev3"]),
  status: IncidentStatus,
  env_id: z.string().nullable(),
  task_id: z.string().nullable(),
  timeline: z.array(z.object({ ts: z.string(), agent: AgentId.nullable(), text: z.string() })),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
});
export type Incident = z.infer<typeof Incident>;

export const IncidentChangedEvent = z.object({ ...base, type: z.literal("incident.changed"), incident: Incident });

export const CostTickEvent = z.object({
  ...base,
  type: z.literal("cost.tick"),
  agent: AgentId,
  task_id: z.string().nullable(),
  model: z.string(),
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  usd: z.number(),
  today_usd: z.number(),
  agent_today_usd: z.number(),
});

export const MemoryWrittenEvent = z.object({
  ...base,
  type: z.literal("memory.written"),
  agent: AgentId,
  task_id: z.string().nullable(),
  memory_id: z.string(),
  text: z.string(),
  kind: z.enum(["fact", "lesson", "skill_proposal"]),
});

export const ToolLogEvent = z.object({
  ...base,
  type: z.literal("tool.log"),
  agent: AgentId,
  task_id: z.string().nullable(),
  tool: z.string(),
  args: z.record(z.unknown()),
  output: z.string(),
  ok: z.boolean(),
  duration_ms: z.number().int(),
  risk: RiskLevel,
});

export const OfficeStatusEvent = z.object({ ...base, type: z.literal("office.status"), status: OfficeStatus, note: z.string().default("") });

export const EnvHealthEvent = z.object({
  ...base,
  type: z.literal("env.health"),
  env_id: z.string(),
  health: z.enum(["healthy", "degraded", "down", "unknown"]),
  latency_ms: z.number().int().nullable(),
  version: z.string().nullable(),
});

export const XpEvent = z.object({ ...base, type: z.literal("agent.xp"), agent: AgentId, xp: z.number().int(), total_xp: z.number().int(), rank: z.string() });

/** Persisted agent-to-agent message (table agent_messages). */
export const AgentMessage = z.object({
  id: z.string(),
  task_id: z.string(),
  from_agent: AgentId,
  to_agent: AgentId.nullable(), // null = broadcast to the task room
  type: AgentMessageType,
  content: z.string(),
  artifacts: z.array(z.object({ kind: z.string(), ref: z.string(), label: z.string() })).default([]),
  status: z.enum(["sent", "acknowledged", "completed", "failed"]),
  created_at: z.string(),
});
export type AgentMessage = z.infer<typeof AgentMessage>;

export const AgentMessageEvent = z.object({ ...base, type: z.literal("agent.message"), message: AgentMessage });

/** Persisted user ⇄ agent chat message (table chat_messages). */
export const ChatMessage = z.object({
  id: z.string(),
  agent: AgentId,
  conversation_id: z.string(),
  role: z.enum(["user", "agent", "system"]),
  content: z.string(),
  task_id: z.string().nullable(),
  created_at: z.string(),
  streaming: z.boolean().default(false),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatMessageEvent = z.object({ ...base, type: z.literal("chat.message"), message: ChatMessage });

export const Deployment = z.object({
  id: z.string(),
  env_id: z.string(),
  account_id: z.string().nullable(),
  version: z.string(),
  previous_version: z.string().nullable(),
  agent: AgentId,
  task_id: z.string().nullable(),
  approval_id: z.string().nullable(),
  status: DeploymentStatus,
  risk: RiskLevel,
  change_summary: z.string(),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string() })).default([]),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  created_at: z.string(),
});
export type Deployment = z.infer<typeof Deployment>;

export const DeploymentChangedEvent = z.object({ ...base, type: z.literal("deployment.changed"), deployment: Deployment });

export const AwsAccount = z.object({
  id: z.string(),
  name: z.string(),
  account_id: z.string(),
  role_arn: z.string(),
  has_external_id: z.boolean(),
  scope: AwsScope,
  regions: z.array(z.string()),
  stage: z.enum(["dev", "uat", "staging", "prod"]),
  status: AccountStatus,
  permissions: z.array(z.object({ name: z.string(), ok: z.boolean() })).default([]),
  last_verified: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  demo: z.boolean().default(false),
});
export type AwsAccount = z.infer<typeof AwsAccount>;

export const AccountChangedEvent = z.object({ ...base, type: z.literal("account.changed"), account: AwsAccount });

export const AuditEntry = z.object({
  id: z.string(),
  ts: z.string(),
  actor: z.string(), // user email, agent id, or "system"
  action: z.string(), // e.g. "approval.approved", "tool.call", "auth.login", "account.created"
  target: z.string().nullable(),
  task_id: z.string().nullable(),
  detail: z.record(z.unknown()).default({}),
  ip: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditAppendedEvent = z.object({ ...base, type: z.literal("audit.appended"), entry: AuditEntry });

export const AzzyEvent = z.discriminatedUnion("type", [
  AgentPhaseEvent,
  AgentMoveEvent,
  AgentSayEvent,
  ApprovalRequestedEvent,
  ApprovalDecidedEvent,
  ApprovalExpiredEvent,
  TaskUpdatedEvent,
  IncidentChangedEvent,
  CostTickEvent,
  MemoryWrittenEvent,
  ToolLogEvent,
  OfficeStatusEvent,
  EnvHealthEvent,
  XpEvent,
  AgentMessageEvent,
  ChatMessageEvent,
  DeploymentChangedEvent,
  AccountChangedEvent,
  AuditAppendedEvent,
]);
export type AzzyEvent = z.infer<typeof AzzyEvent>;
export type AzzyEventType = AzzyEvent["type"];

/** Pipeline column order used by the board and by XP math. */
export const PIPELINE_ORDER: PipelineState[] = ["needs_work", "needs_review", "needs_qa", "needs_docs", "ready", "needs_human", "done"];

/** Rank ladder — XP thresholds. */
export const RANKS: ReadonlyArray<{ name: string; min: number }> = [
  { name: "Intern", min: 0 },
  { name: "Associate", min: 100 },
  { name: "Senior", min: 300 },
  { name: "Lead", min: 700 },
  { name: "Principal", min: 1500 },
  { name: "Fellow", min: 3000 },
];

export function rankFor(xp: number): string {
  let r = RANKS[0].name;
  for (const step of RANKS) if (xp >= step.min) r = step.name;
  return r;
}

export const AGENT_META: Record<AgentId, { name: string; role: string; short: string; color: string; domainRole: UserRole }> = {
  jimmy: { name: "Jimmy", role: "DevOps Agent", short: "DevOps", color: "#00E5FF", domainRole: "devops" },
  emir: { name: "Emir", role: "Developer Agent", short: "Developer", color: "#FFB547", domainRole: "developer" },
  cyber: { name: "Cyber", role: "Security / Testing / Audit / VAPT Agent", short: "Security", color: "#9747FF", domainRole: "security" },
  sara: { name: "Sara", role: "Operations Agent", short: "Operations", color: "#F04DFF", domainRole: "operations" },
  marwah: { name: "Marwah", role: "Marketing Agent", short: "Marketing", color: "#34D399", domainRole: "marketing" },
};

/** Brand palette (also the Tailwind theme source of truth). */
export const BRAND = {
  navy: "#050816",
  midnight: "#0B1025",
  cyan: "#00E5FF",
  purple: "#9747FF",
  magenta: "#F04DFF",
  gold: "#FFB547",
} as const;

export function parseEvent(raw: unknown): AzzyEvent | null {
  const r = AzzyEvent.safeParse(raw);
  return r.success ? r.data : null;
}
