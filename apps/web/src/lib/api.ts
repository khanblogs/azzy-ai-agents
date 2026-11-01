import type { Approval, AuditEntry, AwsAccount, ChatMessage, Deployment, Incident, PipelineState, Task, UserRole } from "@azzy/events";
import type {
  AgentDetail,
  AgentMessage,
  AgentSummary,
  CollaborationLive,
  ContactMessage,
  Conversation,
  CostsResponse,
  Environment,
  Integration,
  Inventory,
  KnowledgeDocument,
  Me,
  NewAwsAccountInput,
  NewEnvironmentInput,
  Report,
  ReportKind,
  Routine,
  SearchHit,
  Settings,
  StateSnapshot,
  SystemMetrics,
  TaskDetail,
  TeamRow,
  UserRow,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Listeners for cross-cutting HTTP outcomes (the store wires toasts here to avoid a circular import). */
type Hook = (err: ApiError) => void;
const hooks: { forbidden: Hook[]; rateLimited: Hook[] } = { forbidden: [], rateLimited: [] };
export function onForbidden(h: Hook) {
  hooks.forbidden.push(h);
  return () => {
    hooks.forbidden = hooks.forbidden.filter((x) => x !== h);
  };
}
export function onRateLimited(h: Hook) {
  hooks.rateLimited.push(h);
  return () => {
    hooks.rateLimited = hooks.rateLimited.filter((x) => x !== h);
  };
}

const CSRF_HEADER = { "X-Requested-With": "azzy" };

async function request<T>(path: string, init?: RequestInit & { raw?: boolean }): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") Object.assign(headers, CSRF_HEADER);
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (init?.body && !isForm) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api${path}`, { credentials: "include", ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
      else if (body.detail) detail = JSON.stringify(body.detail);
    } catch {
      // non-JSON error body
    }
    const err = new ApiError(res.status, detail || `HTTP ${res.status}`);
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/") && !window.location.pathname.startsWith("/login")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    } else if (res.status === 403 && detail !== "mfa_required") {
      hooks.forbidden.forEach((h) => h(err));
    } else if (res.status === 429) {
      hooks.rateLimited.forEach((h) => h(err));
    }
    throw err;
  }
  if (res.status === 204) return undefined as T;
  if (init?.raw) return res as unknown as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? "{}" : body instanceof FormData ? body : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });
const q = (params: Record<string, string | number | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
};
const enc = encodeURIComponent;

export const api = {
  auth: {
    login: (email: string, password: string, otp?: string) =>
      post<{ ok: true; email: string; role: UserRole }>("/auth/login", otp ? { email, password, otp } : { email, password }),
    logout: () => post<{ ok: true }>("/auth/logout"),
    me: () => get<Me>("/auth/me"),
    mfaSetup: () => post<{ secret: string; otpauth_uri: string }>("/auth/mfa/setup"),
    mfaEnable: (otp: string) => post<{ ok: true; mfa_enabled: boolean }>("/auth/mfa/enable", { otp }),
    mfaDisable: (otp: string) => post<{ ok: true; mfa_enabled: boolean }>("/auth/mfa/disable", { otp }),
  },
  users: {
    list: () => get<UserRow[]>("/users"),
    create: (input: { email: string; password: string; role: UserRole }) => post<UserRow>("/users", input),
    update: (id: string, patchBody: { role?: UserRole; disabled?: boolean; password?: string }) => patch<UserRow>(`/users/${enc(id)}`, patchBody),
    remove: (id: string) => del<{ ok: true }>(`/users/${enc(id)}`),
  },
  state: () => get<StateSnapshot>("/state"),
  tasks: {
    create: (prompt: string) => post<Task>("/tasks", { prompt }),
    list: (limit = 100) => get<Task[]>(`/tasks?limit=${limit}`),
    get: (id: string) => get<TaskDetail>(`/tasks/${enc(id)}`),
    move: (id: string, state: PipelineState) => post<Task>(`/tasks/${enc(id)}/move`, { state }),
    cancel: (id: string) => post<Task>(`/tasks/${enc(id)}/cancel`),
    messages: (id: string) => get<AgentMessage[]>(`/tasks/${enc(id)}/messages`),
  },
  collaboration: { live: () => get<CollaborationLive>("/collaboration/live") },
  approvals: {
    list: (status: "pending" | "all" = "all") => get<Approval[]>(`/approvals?status=${status}`),
    approve: (id: string) => post<Approval>(`/approvals/${enc(id)}/approve`),
    reject: (id: string, reason?: string) => post<Approval>(`/approvals/${enc(id)}/reject`, reason ? { reason } : {}),
  },
  incidents: {
    list: () => get<Incident[]>("/incidents"),
    simulate: (input?: { env_id?: string; title?: string }) => post<Incident>("/incidents/simulate", input ?? {}),
    resolve: (id: string) => post<Incident>(`/incidents/${enc(id)}/resolve`),
  },
  environments: {
    list: () => get<Environment[]>("/environments"),
    create: (input: NewEnvironmentInput) => post<Environment>("/environments", input),
    remove: (id: string) => del<{ ok: true }>(`/environments/${enc(id)}`),
    check: (id: string) => post<Environment>(`/environments/${enc(id)}/check`),
  },
  awsAccounts: {
    list: () => get<AwsAccount[]>("/aws-accounts"),
    create: (input: NewAwsAccountInput) => post<AwsAccount>("/aws-accounts", input),
    verify: (id: string) => post<AwsAccount>(`/aws-accounts/${enc(id)}/verify`),
    remove: (id: string) => del<{ ok: true }>(`/aws-accounts/${enc(id)}`),
    inventory: (id: string, region?: string) => get<Inventory>(`/aws-accounts/${enc(id)}/inventory${q({ region })}`),
  },
  deployments: {
    list: (params?: { env_id?: string; limit?: number }) => get<Deployment[]>(`/deployments${q(params ?? {})}`),
    get: (id: string) => get<Deployment>(`/deployments/${enc(id)}`),
    plan: (env_id: string, version: string) => post<{ deployment: Deployment; task_id: string }>("/deployments/plan", { env_id, version }),
  },
  meeting: { call: (topic?: string) => post<{ task_id: string }>("/meeting/call", topic ? { topic } : {}) },
  costs: () => get<CostsResponse>("/costs"),
  agents: {
    list: () => get<AgentSummary[]>("/agents"),
    get: (id: string) => get<AgentDetail>(`/agents/${enc(id)}`),
    conversations: (id: string) => get<Conversation[]>(`/agents/${enc(id)}/conversations`),
    newConversation: (id: string, title?: string) => post<Conversation>(`/agents/${enc(id)}/conversations`, title ? { title } : {}),
    deleteMemory: (id: string, mid: string) => del<{ ok: true }>(`/agents/${enc(id)}/memories/${enc(mid)}`),
  },
  conversations: {
    messages: (cid: string) => get<ChatMessage[]>(`/conversations/${enc(cid)}/messages`),
    send: (cid: string, content: string) => post<{ user_message: ChatMessage; task_id: string }>(`/conversations/${enc(cid)}/messages`, { content }),
    remove: (cid: string) => del<{ ok: true }>(`/conversations/${enc(cid)}`),
  },
  team: () => get<TeamRow[]>("/team"),
  routines: {
    list: () => get<Routine[]>("/routines"),
    run: (id: string) => post<{ task_id: string }>(`/routines/${enc(id)}/run`),
  },
  knowledge: {
    list: () => get<KnowledgeDocument[]>("/knowledge/documents"),
    get: (id: string) => get<KnowledgeDocument>(`/knowledge/documents/${enc(id)}`),
    create: (input: { title: string; content: string; tags?: string[]; scope?: string }) => post<KnowledgeDocument>("/knowledge/documents", input),
    upload: (form: FormData) => post<KnowledgeDocument>("/knowledge/documents", form),
    remove: (id: string) => del<{ ok: true }>(`/knowledge/documents/${enc(id)}`),
    search: (query: string, scope?: string) => get<SearchHit[]>(`/knowledge/search${q({ q: query, scope })}`),
  },
  audit: {
    list: (params?: { limit?: number; before?: string; action?: string; actor?: string }) => get<AuditEntry[]>(`/audit${q(params ?? {})}`),
  },
  system: { metrics: () => get<SystemMetrics>("/system/metrics") },
  reports: {
    list: () => get<Report[]>("/reports"),
    generate: (kind: ReportKind) => post<{ task_id: string }>("/reports/generate", { kind }),
    downloadUrl: (id: string) => `/api/reports/${enc(id)}/download`,
  },
  integrations: {
    list: () => get<Integration[]>("/integrations"),
    test: (id: string) => post<{ ok: boolean; demo: boolean; detail: string }>(`/integrations/${enc(id)}/test`),
  },
  settings: {
    get: () => get<Settings>("/settings"),
    update: (body: Partial<Pick<Settings, "daily_budget_usd" | "authorized_targets" | "retention">>) => patch<Settings>("/settings", body),
    contactMessages: () => get<ContactMessage[]>("/settings/contact-messages"),
  },
  contact: (input: { name: string; email: string; message: string }) => post<{ ok: true; id: string }>("/contact", input),
};

export type Api = typeof api;
