import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

export const AGENT_IDS = ["jimmy", "emir", "cyber", "sara", "marwah"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** Every non-GET call under /api must carry this header (CONTRACT-v2 §3, CSRF). */
export const CSRF_HEADERS = { "X-Requested-With": "azzy" } as const;

export const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owner@azzy.local";
export const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? "change-me-now";

/** Portal routes (CONTRACT-v2 §10) keyed by the nav testid suffix. */
export const PORTAL_ROUTES = {
  home: "/app",
  office: "/app/office",
  agents: "/app/agents",
  collaboration: "/app/collaboration",
  tasks: "/app/tasks",
  "aws-accounts": "/app/aws-accounts",
  infrastructure: "/app/infrastructure",
  deployments: "/app/deployments",
  monitoring: "/app/monitoring",
  security: "/app/security",
  knowledge: "/app/knowledge",
  reports: "/app/reports",
  approvals: "/app/approvals",
  integrations: "/app/integrations",
  settings: "/app/settings",
  audit: "/app/audit",
} as const;
export type PortalRoute = keyof typeof PORTAL_ROUTES;

/** The five mobile bottom tabs; everything else is under "More". */
export const MOBILE_TABS: PortalRoute[] = ["home", "office", "tasks", "approvals"];
export const MORE_ROUTES: PortalRoute[] = (Object.keys(PORTAL_ROUTES) as PortalRoute[]).filter(
  (r) => !MOBILE_TABS.includes(r),
);

export const PUBLIC_ROUTES = ["/", "/platform", "/agents", "/capabilities", "/architecture", "/security", "/contact", "/login"];

export const WORKFLOW_PROMPT =
  "Investigate my failing ECS deployment, fix the application issue, test it, perform a security assessment, and request approval before deploying";

export const PIPELINE_STATES = [
  "needs_work",
  "needs_review",
  "needs_qa",
  "needs_docs",
  "ready",
  "needs_human",
  "done",
] as const;

/** Wait until the live socket reports a connected state (ws-status testid). */
export async function waitForLive(page: Page, timeoutMs = 30_000): Promise<void> {
  const status = page.getByTestId("ws-status");
  await expect(status).toBeVisible({ timeout: timeoutMs });
  await expect
    .poll(
      async () => {
        const state = (await status.getAttribute("data-state")) ?? "";
        const text = (await status.textContent()) ?? "";
        return `${state} ${text}`.toLowerCase();
      },
      { timeout: timeoutMs, message: "ws-status never reported connected/live" },
    )
    .toMatch(/connected|live|open/);
}

/** POST /api/... with the CSRF header. */
export async function apiPost<T = unknown>(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  expected?: number,
): Promise<{ status: number; body: T }> {
  const res = await request.post(path, { data, headers: CSRF_HEADERS });
  if (expected !== undefined) {
    expect(res.status(), `POST ${path} -> ${res.status()} ${await res.text()}`).toBe(expected);
  }
  let body: T = undefined as T;
  try {
    body = (await res.json()) as T;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status(), body };
}

export async function apiGet<T = unknown>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(path);
  expect(res.ok(), `GET ${path} -> ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}

/** Type a prompt into the command bar and submit it; returns the created task from POST /api/tasks. */
export async function submitCommand(page: Page, prompt: string): Promise<{ id: string; title: string }> {
  const input = page.getByTestId("command-input");
  await expect(input).toBeVisible();
  await input.fill(prompt);
  const [response] = await Promise.all([
    page.waitForResponse((r) => /\/api\/tasks$/.test(r.url()) && r.request().method() === "POST", {
      timeout: 20_000,
    }),
    page.getByTestId("command-submit").click(),
  ]);
  expect(response.status(), `POST /api/tasks returned ${response.status()}`).toBe(201);
  const task = (await response.json()) as { id: string; title: string };
  expect(task.id).toBeTruthy();
  return task;
}

/** Poll a task until its state matches `re`. */
export async function waitForTaskState(
  request: APIRequestContext,
  taskId: string,
  re: RegExp,
  timeoutMs: number,
): Promise<string> {
  let last = "";
  await expect
    .poll(
      async () => {
        const body = await apiGet<{ task: { state: string } }>(request, `/api/tasks/${taskId}`);
        last = body.task.state;
        return last;
      },
      { timeout: timeoutMs, intervals: [1_000, 2_000], message: `task ${taskId} state (last: ${last})` },
    )
    .toMatch(re);
  return last;
}

/** Task card in `root` (page or pipeline column) by data-task-id, falling back to title text. */
export function taskCard(root: Page | Locator, task: { id: string; title: string }): Locator {
  const byId = root.locator(`[data-testid="task-card"][data-task-id="${task.id}"]`);
  const byTitle = root.getByTestId("task-card").filter({ hasText: task.title });
  return byId.or(byTitle).first();
}

/** Pending approval card for a task (by data-task-id when the UI sets it, else the first card). */
export function approvalCardFor(page: Page, taskId?: string): Locator {
  const all = page.getByTestId("approval-card");
  if (!taskId) return all.first();
  const byId = page.locator(`[data-testid="approval-card"][data-task-id="${taskId}"]`);
  return byId.or(all).first();
}

/** Approve the first pending approval for `taskId` through the UI; returns the decision response status. */
export async function approveViaUi(page: Page, taskId?: string, timeoutMs = 60_000): Promise<void> {
  await page.goto("/app/approvals");
  const card = approvalCardFor(page, taskId);
  await expect(card, "pending approval card").toBeVisible({ timeout: timeoutMs });
  const [decision] = await Promise.all([
    page.waitForResponse((r) => /\/api\/approvals\/[^/]+\/approve$/.test(r.url()) && r.request().method() === "POST"),
    card.getByTestId("approve-btn").click(),
  ]);
  expect(decision.ok(), `approve -> ${decision.status()}`).toBe(true);
}

/** The office status pill (nominal / meeting / incident). */
export function officeStatus(page: Page) {
  return page.getByTestId("office-status");
}

/** Log in through the UI in the given page (used for non-admin users). */
export async function uiLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => url.pathname.startsWith("/app"), { timeout: 30_000 });
}
