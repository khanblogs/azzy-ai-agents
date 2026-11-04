"use client";

import { useMemo } from "react";
import { create } from "zustand";
import {
  AGENT_IDS,
  AGENT_META,
  rankFor,
  type AgentId,
  type AgentMessage,
  type Approval,
  type AuditEntry,
  type AwsAccount,
  type AzzyEvent,
  type ChatMessage,
  type Deployment,
  type Incident,
  type Task,
  type UserRole,
} from "@azzy/events";
import { api, onForbidden, onRateLimited } from "@/lib/api";
import type { AgentSummary, CostTick, Environment, Me, MemoryWritten, OfficeState, ServiceStatus, StateSnapshot, ToolLog, UpdateItem } from "@/lib/types";

export type WsStatus = "connecting" | "connected" | "disconnected";

export interface Bubble {
  id: string;
  text: string;
  until: number;
}

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone: "info" | "success" | "error";
  until: number;
}

export interface CostsState {
  today_usd: number;
  budget_usd: number;
  per_agent: Record<string, number>;
  series: { hour: string; usd: number }[];
  recent: CostTick[];
}

export type CameraMode = "overview" | "focus" | "collaboration" | "execution" | "monitoring";

const TOOL_LOG_RING = 200;
const UPDATES_MAX = 20;
const AGENT_MESSAGES_MAX = 150;
const AUDIT_MAX = 100;

function emptyAgent(id: AgentId): AgentSummary {
  const meta = AGENT_META[id];
  return {
    id,
    name: meta.name,
    role: meta.role,
    color: meta.color,
    phase: "idle",
    spot: "desk",
    task_id: null,
    detail: "",
    xp: 0,
    rank: rankFor(0),
    today_usd: 0,
    daily_budget_usd: 0,
    tasks_done: 0,
  };
}

function perAgent<T>(make: (id: AgentId) => T): Record<AgentId, T> {
  return { jimmy: make("jimmy"), emir: make("emir"), cyber: make("cyber"), sara: make("sara"), marwah: make("marwah") };
}

let toastSeq = 0;

export interface AzzyState {
  hydrated: boolean;
  hydrateError: string | null;
  me: Me | null;
  office: OfficeState;
  agents: Record<AgentId, AgentSummary>;
  bubbles: Partial<Record<AgentId, Bubble>>;
  tasks: Task[];
  approvals: Approval[];
  incidents: Incident[];
  environments: Environment[];
  deployments: Deployment[];
  awsAccounts: AwsAccount[];
  costs: CostsState;
  toolLogs: Record<AgentId, ToolLog[]>;
  memories: MemoryWritten[];
  agentMessages: AgentMessage[];
  /** chat messages keyed by conversation id; streaming chunks replace by message id */
  chat: Record<string, ChatMessage[]>;
  audit: AuditEntry[];
  updates: UpdateItem[];
  uptimeSeconds: number;
  uptimeAt: number;
  services: ServiceStatus[];
  demo: boolean;
  ws: WsStatus;
  toasts: Toast[];
  selectedAgent: AgentId | null;
  cameraMode: CameraMode;
  focusRequest: { agent: AgentId | null; view: "agent" | "wall" | "reset"; nonce: number };

  hydrate: () => Promise<void>;
  loadMe: () => Promise<void>;
  applyEvent: (ev: AzzyEvent) => void;
  setWs: (s: WsStatus) => void;
  toast: (t: Omit<Toast, "id" | "until"> & { ttlMs?: number }) => void;
  dismissToast: (id: string) => void;
  sweep: (now?: number) => void;
  setSelectedAgent: (id: AgentId | null) => void;
  setCameraMode: (m: CameraMode) => void;
  requestFocus: (agent: AgentId | null, view?: "agent" | "wall" | "reset") => void;
  upsertTask: (t: Task) => void;
  upsertApproval: (a: Approval) => void;
  upsertIncident: (i: Incident) => void;
  upsertEnvironment: (e: Environment) => void;
  removeEnvironment: (id: string) => void;
  upsertDeployment: (d: Deployment) => void;
  upsertAccount: (a: AwsAccount) => void;
  removeAccount: (id: string) => void;
  setChat: (cid: string, msgs: ChatMessage[]) => void;
  appendChat: (cid: string, msg: ChatMessage) => void;
  decideApprovalOptimistic: (id: string, status: "approved" | "rejected") => void;
  setCostsExtra: (series: { hour: string; usd: number }[], recent: CostTick[]) => void;
}

function upsertById<T extends { id: string }>(list: T[], item: T, pos: "front" | "keep" = "front"): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return pos === "front" ? [item, ...list] : [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}

function sortApprovals(list: Approval[]): Approval[] {
  return list.slice().sort((a, b) => {
    const pa = a.status === "pending" ? 0 : 1;
    const pb = b.status === "pending" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
}

function sortIncidents(list: Incident[]): Incident[] {
  return list.slice().sort((a, b) => {
    const oa = a.status === "resolved" ? 1 : 0;
    const ob = b.status === "resolved" ? 1 : 0;
    if (oa !== ob) return oa - ob;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
}

function bumpSeries(series: { hour: string; usd: number }[], ts: string, usd: number) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return series;
  d.setUTCMinutes(0, 0, 0);
  const hour = d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const idx = series.findIndex((p) => p.hour === hour);
  if (idx === -1) return [...series, { hour, usd }].slice(-48);
  const next = series.slice();
  next[idx] = { hour, usd: next[idx].usd + usd };
  return next;
}

export const useAzzy = create<AzzyState>((set, get) => ({
  hydrated: false,
  hydrateError: null,
  me: null,
  office: { status: "nominal", note: "" },
  agents: perAgent(emptyAgent),
  bubbles: {},
  tasks: [],
  approvals: [],
  incidents: [],
  environments: [],
  deployments: [],
  awsAccounts: [],
  costs: { today_usd: 0, budget_usd: 0, per_agent: {}, series: [], recent: [] },
  toolLogs: perAgent<ToolLog[]>(() => []),
  memories: [],
  agentMessages: [],
  chat: {},
  audit: [],
  updates: [],
  uptimeSeconds: 0,
  uptimeAt: 0,
  services: [],
  demo: false,
  ws: "connecting",
  toasts: [],
  selectedAgent: null,
  cameraMode: "overview",
  focusRequest: { agent: null, view: "reset", nonce: 0 },

  hydrate: async () => {
    try {
      const snap: StateSnapshot = await api.state();
      const agents = perAgent(emptyAgent);
      for (const a of snap.agents) {
        if ((AGENT_IDS as string[]).includes(a.id)) agents[a.id] = { ...agents[a.id], ...a };
      }
      set((s) => ({
        hydrated: true,
        hydrateError: null,
        office: snap.office,
        agents,
        tasks: snap.tasks,
        approvals: sortApprovals(snap.approvals),
        incidents: sortIncidents(snap.incidents),
        environments: snap.environments,
        deployments: snap.deployments ?? s.deployments,
        awsAccounts: snap.accounts ?? s.awsAccounts,
        agentMessages: snap.agent_messages ?? s.agentMessages,
        costs: { ...s.costs, today_usd: snap.costs.today_usd, budget_usd: snap.costs.budget_usd, per_agent: snap.costs.per_agent },
        updates: snap.updates.slice(0, UPDATES_MAX),
        uptimeSeconds: snap.uptime_seconds,
        uptimeAt: Date.now(),
        services: snap.services ?? s.services,
        demo: snap.demo,
      }));
    } catch (err) {
      set({ hydrateError: err instanceof Error ? err.message : "Failed to load state" });
    }
  },

  loadMe: async () => {
    try {
      const me = await api.auth.me();
      set({ me });
    } catch {
      // 401 redirects to /login inside api.ts
    }
  },

  applyEvent: (ev) => {
    const s = get();
    switch (ev.type) {
      case "agent.phase": {
        const a = s.agents[ev.agent];
        set({ agents: { ...s.agents, [ev.agent]: { ...a, phase: ev.phase, task_id: ev.task_id, detail: ev.detail ?? "" } } });
        break;
      }
      case "agent.move": {
        const a = s.agents[ev.agent];
        set({ agents: { ...s.agents, [ev.agent]: { ...a, spot: ev.to } } });
        break;
      }
      case "agent.say": {
        const until = Date.now() + (ev.ttl_ms ?? 6000);
        set({
          bubbles: { ...s.bubbles, [ev.agent]: { id: ev.id, text: ev.text, until } },
          updates: [{ ts: ev.ts, agent: ev.agent, text: ev.text }, ...s.updates].slice(0, UPDATES_MAX),
        });
        break;
      }
      case "approval.requested": {
        set({
          approvals: sortApprovals(upsertById(s.approvals, ev.approval)),
          focusRequest: { agent: ev.approval.agent, view: "agent", nonce: s.focusRequest.nonce + 1 },
          updates: [{ ts: ev.ts, agent: ev.approval.agent, text: `Approval requested: ${ev.approval.summary}` }, ...s.updates].slice(0, UPDATES_MAX),
        });
        break;
      }
      case "approval.decided":
      case "approval.expired": {
        set({ approvals: sortApprovals(upsertById(s.approvals, ev.approval)) });
        break;
      }
      case "task.updated": {
        const text = `${ev.task.title} → ${ev.task.state.replace(/_/g, " ")}`;
        set({
          tasks: upsertById(s.tasks, ev.task).slice(0, 100),
          updates: [{ ts: ev.ts, agent: ev.task.lead, text }, ...s.updates].slice(0, UPDATES_MAX),
        });
        break;
      }
      case "incident.changed": {
        set({ incidents: sortIncidents(upsertById(s.incidents, ev.incident)) });
        break;
      }
      case "cost.tick": {
        const a = s.agents[ev.agent];
        const tick: CostTick = ev;
        set({
          agents: { ...s.agents, [ev.agent]: { ...a, today_usd: ev.agent_today_usd } },
          costs: {
            ...s.costs,
            today_usd: ev.today_usd,
            per_agent: { ...s.costs.per_agent, [ev.agent]: ev.agent_today_usd },
            recent: [tick, ...s.costs.recent].slice(0, 50),
            series: bumpSeries(s.costs.series, ev.ts, ev.usd),
          },
        });
        break;
      }
      case "memory.written": {
        const mem: MemoryWritten = ev;
        set({ memories: [mem, ...s.memories].slice(0, 100) });
        break;
      }
      case "tool.log": {
        const log: ToolLog = ev;
        set({ toolLogs: { ...s.toolLogs, [ev.agent]: [log, ...s.toolLogs[ev.agent]].slice(0, TOOL_LOG_RING) } });
        break;
      }
      case "office.status": {
        set({ office: { status: ev.status, note: ev.note ?? "" } });
        break;
      }
      case "env.health": {
        set({
          environments: s.environments.map((e) =>
            e.id === ev.env_id ? { ...e, health: ev.health, latency_ms: ev.latency_ms, version: ev.version ?? e.version, last_checked: ev.ts } : e,
          ),
        });
        break;
      }
      case "agent.xp": {
        const a = s.agents[ev.agent];
        set({ agents: { ...s.agents, [ev.agent]: { ...a, xp: ev.total_xp, rank: ev.rank } } });
        break;
      }
      case "agent.message": {
        const m = ev.message;
        const to = m.to_agent ? AGENT_META[m.to_agent].name : "all";
        set({
          agentMessages: upsertById(s.agentMessages, m).slice(0, AGENT_MESSAGES_MAX),
          updates: [{ ts: ev.ts, agent: m.from_agent, text: `${m.type} → ${to}: ${m.content}` }, ...s.updates].slice(0, UPDATES_MAX),
        });
        break;
      }
      case "chat.message": {
        const m = ev.message;
        const list = s.chat[m.conversation_id] ?? [];
        set({ chat: { ...s.chat, [m.conversation_id]: upsertById(list, m, "keep") } });
        break;
      }
      case "deployment.changed": {
        set({ deployments: upsertById(s.deployments, ev.deployment).slice(0, 100) });
        break;
      }
      case "account.changed": {
        set({ awsAccounts: upsertById(s.awsAccounts, ev.account, "keep") });
        break;
      }
      case "audit.appended": {
        set({ audit: upsertById(s.audit, ev.entry).slice(0, AUDIT_MAX) });
        break;
      }
      default:
        break;
    }
  },

  setWs: (ws) => set({ ws }),

  toast: ({ ttlMs = 4500, ...t }) => {
    const id = `t${++toastSeq}`;
    set((s) => ({ toasts: [...s.toasts, { ...t, id, until: Date.now() + ttlMs }].slice(-5) }));
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  sweep: (now = Date.now()) => {
    const s = get();
    let bubblesChanged = false;
    const bubbles: Partial<Record<AgentId, Bubble>> = {};
    for (const id of AGENT_IDS) {
      const b = s.bubbles[id];
      if (!b) continue;
      if (b.until > now) bubbles[id] = b;
      else bubblesChanged = true;
    }
    const toasts = s.toasts.filter((t) => t.until > now);
    const toastsChanged = toasts.length !== s.toasts.length;
    if (bubblesChanged || toastsChanged) set({ ...(bubblesChanged ? { bubbles } : {}), ...(toastsChanged ? { toasts } : {}) });
  },

  setSelectedAgent: (id) => set({ selectedAgent: id }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  requestFocus: (agent, view = "agent") => set((s) => ({ focusRequest: { agent, view, nonce: s.focusRequest.nonce + 1 } })),

  upsertTask: (t) => set((s) => ({ tasks: upsertById(s.tasks, t).slice(0, 100) })),
  upsertApproval: (a) => set((s) => ({ approvals: sortApprovals(upsertById(s.approvals, a)) })),
  upsertIncident: (i) => set((s) => ({ incidents: sortIncidents(upsertById(s.incidents, i)) })),
  upsertEnvironment: (e) => set((s) => ({ environments: upsertById(s.environments, e, "keep") })),
  removeEnvironment: (id) => set((s) => ({ environments: s.environments.filter((e) => e.id !== id) })),
  upsertDeployment: (d) => set((s) => ({ deployments: upsertById(s.deployments, d) })),
  upsertAccount: (a) => set((s) => ({ awsAccounts: upsertById(s.awsAccounts, a, "keep") })),
  removeAccount: (id) => set((s) => ({ awsAccounts: s.awsAccounts.filter((a) => a.id !== id) })),
  setChat: (cid, msgs) =>
    set((s) => {
      // keep any streaming chunks that arrived before the history request resolved
      const live = s.chat[cid] ?? [];
      let merged = msgs;
      for (const m of live) merged = upsertById(merged, m, "keep");
      return { chat: { ...s.chat, [cid]: merged } };
    }),
  appendChat: (cid, msg) => set((s) => ({ chat: { ...s.chat, [cid]: upsertById(s.chat[cid] ?? [], msg, "keep") } })),

  decideApprovalOptimistic: (id, status) =>
    set((s) => ({
      approvals: sortApprovals(s.approvals.map((a) => (a.id === id ? { ...a, status, decided_at: new Date().toISOString(), decided_by: s.me?.email ?? "you" } : a))),
    })),

  setCostsExtra: (series, recent) => set((s) => ({ costs: { ...s.costs, series, recent } })),
}));

// Cross-cutting HTTP outcomes → toasts.
onForbidden((err) => useAzzy.getState().toast({ tone: "error", title: "Not permitted", body: err.message || "Your role cannot perform this action." }));
onRateLimited(() => useAzzy.getState().toast({ tone: "error", title: "Slow down", body: "Rate limit hit — try again in a minute." }));

/**
 * Derived-state hooks. zustand v5 compares selector results by reference, so selectors must not
 * return fresh arrays; these hooks select the stable slice and derive with useMemo.
 */
export const EMPTY_LOGS: ToolLog[] = [];

export function usePendingApprovals(): Approval[] {
  const approvals = useAzzy((s) => s.approvals);
  return useMemo(() => approvals.filter((a) => a.status === "pending"), [approvals]);
}

export function useActiveTasks(): Task[] {
  const tasks = useAzzy((s) => s.tasks);
  return useMemo(() => tasks.filter((t) => !["done", "failed", "cancelled"].includes(t.state)), [tasks]);
}

/** Uptime in seconds, advanced locally from the last snapshot; `now` comes from a ticking hook. */
export function useLiveUptime(now: number): number {
  const uptimeSeconds = useAzzy((s) => s.uptimeSeconds);
  const uptimeAt = useAzzy((s) => s.uptimeAt);
  return uptimeAt ? uptimeSeconds + Math.max(0, Math.floor((now - uptimeAt) / 1000)) : uptimeSeconds;
}

export function pendingApprovalFor(approvals: Approval[], agent: AgentId): Approval | undefined {
  return approvals.find((a) => a.status === "pending" && a.agent === agent);
}

/** RBAC helpers mirroring CONTRACT-v2 §3 (server enforces; UI only disables with a tooltip). */
const APPROVAL_ROLES: Record<AgentId, UserRole[]> = {
  jimmy: ["admin", "devops"],
  emir: ["admin", "developer", "devops"],
  cyber: ["admin", "security"],
  sara: ["admin", "operations"],
  marwah: ["admin", "marketing"],
};

export function can(me: Me | null, action: "write" | "admin" | "approve" | "cancel", ctx?: { agent?: AgentId | null; task?: Task | null }): boolean {
  if (!me) return true; // unknown yet: let the server decide
  if (me.role === "readonly") return false;
  switch (action) {
    case "write":
      return true;
    case "admin":
      return me.role === "admin";
    case "approve":
      return me.role === "admin" || (ctx?.agent ? APPROVAL_ROLES[ctx.agent].includes(me.role) : false);
    case "cancel": {
      if (me.role === "admin") return true;
      const t = ctx?.task;
      if (!t) return false;
      if (t.created_by && t.created_by === me.email) return true;
      return Boolean(t.lead && AGENT_META[t.lead].domainRole === me.role);
    }
    default:
      return false;
  }
}

export { AGENT_IDS };
