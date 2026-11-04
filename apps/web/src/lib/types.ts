import type { z } from "zod";
import type {
  AgentId,
  AgentMessage,
  AgentPhase,
  Approval,
  AwsAccount,
  ChatMessage,
  Deployment,
  Incident,
  OfficeStatus,
  Spot,
  Task,
  UserRole,
  CostTickEvent,
  ToolLogEvent,
  MemoryWrittenEvent,
} from "@azzy/events";

export type CostTick = z.infer<typeof CostTickEvent>;
export type ToolLog = z.infer<typeof ToolLogEvent>;
export type MemoryWritten = z.infer<typeof MemoryWrittenEvent>;

export type EnvKind = "staging" | "prod" | "hq";
export type EnvMethod = "assume_role" | "access_key" | "tailscale_ssh";
export type EnvHealth = "healthy" | "degraded" | "down" | "unknown";
export type Stage = "dev" | "uat" | "staging" | "prod";

export interface AgentSummary {
  id: AgentId;
  name: string;
  role: string;
  short?: string;
  domain_role?: UserRole;
  color: string;
  avatar?: Record<string, unknown>;
  phase: AgentPhase;
  spot: Spot;
  task_id: string | null;
  detail: string;
  xp: number;
  rank: string;
  today_usd: number;
  daily_budget_usd: number;
  tasks_done: number;
}

export interface Environment {
  id: string;
  name: string;
  kind: EnvKind;
  method: EnvMethod;
  target: string;
  region: string | null;
  auto_allow: string[];
  allowed_roles?: string[];
  health: EnvHealth;
  version: string | null;
  latency_ms: number | null;
  last_checked: string | null;
  account_id?: string | null;
  stage?: Stage | null;
  has_external_id?: boolean;
  secret_ref?: string | null;
  seeded?: boolean;
  demo?: boolean;
}

export interface Memory {
  id: string;
  agent: AgentId;
  task_id: string | null;
  kind: string;
  text: string;
  created_at: string | null;
}

export interface UpdateItem {
  ts: string;
  agent: AgentId | null;
  text: string;
}

export interface OfficeState {
  status: OfficeStatus;
  note: string;
}

/** One monitored service from Uptime Kuma's status page (via `GET /state`). */
export interface ServiceStatus {
  name: string;
  label: string;
  status: "UP" | "DOWN" | "PENDING" | "MAINTENANCE" | "UNKNOWN";
  ping: number | null;
  uptime24: number | null;
}

/** `GET /state` (CONTRACT.md + v2 additions). Key names mirror `azzy/api/state.py::state_snapshot` exactly. */
export interface StateSnapshot {
  office: OfficeState;
  product: { name: string; version: string; credit: string; api_version: string };
  agents: AgentSummary[];
  tasks: Task[];
  approvals: Approval[];
  incidents: Incident[];
  environments: Environment[];
  costs: { today_usd: number; per_agent: Record<string, number>; budget_usd: number };
  updates: UpdateItem[];
  uptime_seconds: number;
  services: ServiceStatus[];
  demo: boolean;
  deployments: Deployment[];
  /** AWS accounts — the API key is `accounts` (not `aws_accounts`). */
  accounts: AwsAccount[];
  agent_messages: AgentMessage[];
}

export interface CostsResponse {
  today_usd: number;
  budget_usd: number;
  per_agent: Record<string, number>;
  series: { hour: string; usd: number }[];
  recent: CostTick[];
}

export interface TaskDetail {
  task: Task;
  log: ToolLog[];
  memories: Memory[];
  /** persisted agent-to-agent messages of the task (same list as `GET /tasks/{id}/messages`) */
  messages: AgentMessage[];
}

export interface AgentConfig {
  role: string;
  domain_role?: UserRole;
  tools: string[];
  budgets: Record<string, unknown>;
  routines: { id: string; cron: string; title: string; prompt?: string }[];
  skills: string[];
  avatar?: Record<string, unknown>;
}

export interface AgentDetail {
  agent: AgentSummary;
  config: AgentConfig;
  memories: Memory[];
  log: ToolLog[];
  tasks: Task[];
}

export interface TeamRow {
  agent: AgentId;
  xp: number;
  rank: string;
  tasks_done: number;
  approvals_requested: number;
  usd_today: number;
}

export interface Routine {
  id: string;
  agent: AgentId;
  cron: string;
  title: string;
  next_run: string | null;
  /** true for platform routines (retention sweep) that are not owned by an agent's YAML */
  system?: boolean;
}

export interface NewEnvironmentInput {
  name: string;
  kind: EnvKind;
  method: EnvMethod;
  target: string;
  region?: string;
  external_id?: string;
  secret_ref?: string;
  auto_allow?: string[];
  account_id?: string | null;
  stage?: Stage;
}

/** Auth */
export interface Me {
  email: string;
  role: UserRole;
  mfa_enabled: boolean;
}

export interface UserRow {
  id: string;
  email: string;
  role: UserRole;
  created_at: string | null;
  last_login: string | null;
  disabled: boolean;
  mfa_enabled: boolean;
}

/** Chat */
export interface Conversation {
  id: string;
  agent: AgentId;
  user_email: string;
  title: string;
  created_at: string | null;
  updated_at: string | null;
}

export type { ChatMessage, AgentMessage, Deployment, AwsAccount };

export interface CollaborationEdge {
  from: AgentId;
  /** an agent id, or "azzy" for broadcasts to the task room (to_agent = null) */
  to: AgentId | "azzy";
  count: number;
  last_ts: string | null;
  active: boolean;
}

export interface CollaborationLive {
  edges: CollaborationEdge[];
  tasks: Task[];
}

/** AWS */
export interface NewAwsAccountInput {
  name: string;
  account_id: string;
  role_arn: string;
  external_id?: string;
  scope: "readonly" | "audit" | "deploy";
  regions: string[];
  stage: Stage;
}

export type InventoryResource = Record<string, unknown> & { id?: string; name?: string; status?: string };

export interface Inventory {
  account_id: string;
  region: string;
  generated_at: string;
  demo: boolean;
  resources: Record<string, InventoryResource[]>;
  /** real mode only: per-service boto3 errors */
  errors?: Record<string, string>;
}

/** Knowledge */
export interface KnowledgeDocument {
  id: string;
  title: string;
  source: string;
  /** only present on `GET /knowledge/documents/{id}` */
  content?: string;
  tags: string[];
  scope: string;
  created_by: string | null;
  created_at: string | null;
  /** content length in characters (listing) */
  chars: number;
  demo?: boolean;
}

export interface SearchHit {
  document_id: string;
  title: string;
  chunk: string;
  score: number;
  scope: string;
}

/** Audit / monitoring / reports / integrations / settings */
export interface SystemMetrics {
  uptime_seconds: number;
  ws_clients: number;
  queue_depth: number;
  worker_heartbeat_ts: string | null;
  worker_ok: boolean;
  db_ok: boolean;
  redis_ok: boolean;
  tasks_active: number;
  approvals_pending: number;
  incidents_open: number;
  today_usd: number;
  version: string;
  demo: boolean;
}

export interface Report {
  id: string;
  agent: AgentId;
  task_id: string | null;
  kind: string;
  filename: string;
  path?: string;
  bytes: number;
  created_at: string | null;
  demo?: boolean;
}

export type ReportKind = "ops_kpi" | "security_posture" | "growth" | "fleet";

export interface Integration {
  id: string;
  name: string;
  category: string;
  configured: boolean;
  demo: boolean;
  detail: string;
}

export interface Settings {
  demo: boolean;
  daily_budget_usd: number;
  approval_timeout_seconds: number;
  authorized_targets: string[];
  retention: Record<string, number>;
  public_base_url: string;
  roles: UserRole[];
  approval_roles: Record<string, UserRole[]>;
  agents: AgentId[];
}

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  read: boolean;
  created_at: string | null;
}
