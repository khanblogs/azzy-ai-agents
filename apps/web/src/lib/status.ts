import type { AgentPhase, OfficeStatus, PipelineState, RiskLevel } from "@azzy/events";

/** Visual state of a character, derived from live store data. Color is never the only signal: label is shown too. */
export type VisualStatus = "working" | "walking" | "talking" | "approval" | "away" | "idle";

export const STATUS_COLORS: Record<VisualStatus, string> = {
  working: "#22c55e",
  walking: "#3b82f6",
  talking: "#eab308",
  approval: "#ef4444",
  away: "#a855f7",
  idle: "#6b7280",
};

export const STATUS_LABELS: Record<VisualStatus, string> = {
  working: "At desk · working",
  walking: "Walking",
  talking: "Talking",
  approval: "Waiting approval",
  away: "Away",
  idle: "Idle",
};

export function deriveStatus(input: {
  phase: AgentPhase;
  arrived: boolean;
  hasBubble: boolean;
  hasPendingApproval: boolean;
}): VisualStatus {
  if (input.phase === "waiting_approval" || input.hasPendingApproval) return "approval";
  if (!input.arrived) return "walking";
  if (input.hasBubble) return "talking";
  if (input.phase === "away") return "away";
  if (input.phase === "idle") return "idle";
  return "working";
}

export const OFFICE_STATUS_COLORS: Record<OfficeStatus, string> = {
  nominal: "#34D399",
  meeting: "#00E5FF",
  incident: "#ef4444",
};

export const DEPLOYMENT_COLORS: Record<string, string> = {
  planned: "#94a3b8",
  awaiting_approval: "#FFB547",
  running: "#00E5FF",
  verifying: "#9747FF",
  succeeded: "#34D399",
  rolled_back: "#F04DFF",
  failed: "#ef4444",
};

export const ACCOUNT_STATUS_COLORS: Record<string, string> = {
  pending: "#FFB547",
  verified: "#34D399",
  failed: "#ef4444",
};

export const PIPELINE_TERMINAL: PipelineState[] = ["done", "failed", "cancelled"];

export const RISK_COLORS: Record<RiskLevel, { bg: string; fg: string; ring: string }> = {
  low: { bg: "bg-emerald-500/15", fg: "text-emerald-300", ring: "ring-emerald-500/30" },
  medium: { bg: "bg-amber-500/15", fg: "text-amber-300", ring: "ring-amber-500/30" },
  high: { bg: "bg-rose-500/15", fg: "text-rose-300", ring: "ring-rose-500/30" },
};

export const PIPELINE_LABELS: Record<PipelineState, string> = {
  needs_work: "Needs work",
  needs_review: "Needs review",
  needs_qa: "Needs QA",
  needs_docs: "Needs docs",
  ready: "Ready",
  needs_human: "Needs human",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const PIPELINE_ACCENTS: Record<PipelineState, string> = {
  needs_work: "#00E5FF",
  needs_review: "#9747FF",
  needs_qa: "#F04DFF",
  needs_docs: "#FFB547",
  ready: "#34D399",
  needs_human: "#f97316",
  done: "#22c55e",
  failed: "#ef4444",
  cancelled: "#64748b",
};

export const HEALTH_COLORS: Record<string, string> = {
  healthy: "#22c55e",
  degraded: "#eab308",
  down: "#ef4444",
  unknown: "#6b7280",
};

export const PHASE_LABELS: Record<AgentPhase, string> = {
  idle: "Idle",
  think: "Thinking",
  tool: "Using tool",
  observe: "Observing",
  act: "Acting",
  learn: "Learning",
  waiting_approval: "Waiting approval",
  meeting: "In meeting",
  away: "Away",
  chatting: "Chatting",
};
