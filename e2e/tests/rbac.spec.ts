import { expect, test, type Browser } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { apiGet, apiPost, submitCommand, uiLogin } from "../lib/helpers";

// RBAC (CONTRACT-v2 §3): admin creates a readonly user through the API (admin storageState +
// CSRF header), the readonly user logs in in a fresh context and is denied approve (403) and
// sees the button disabled.
test.describe.configure({ mode: "serial" });

const READONLY_EMAIL = `e2e-readonly-${Date.now()}@azzy.local`;
const READONLY_PASSWORD = "ReadOnly-e2e-pass-1";

async function readonlyContext(browser: Browser) {
  const ctx = await browser.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "X-Requested-With": "azzy" },
  });
  const page = await ctx.newPage();
  await uiLogin(page, READONLY_EMAIL, READONLY_PASSWORD);
  return { ctx, page };
}

test.describe("rbac", () => {
  let userId: string;
  let taskId: string;

  test("admin creates a readonly user via the API", async ({ request }) => {
    const { body } = await apiPost<{ id: string; email: string; role: string }>(
      request,
      "/api/users",
      { email: READONLY_EMAIL, password: READONLY_PASSWORD, role: "readonly" },
      201,
    );
    userId = body.id;
    expect(body.role).toBe("readonly");
    const users = await apiGet<Array<{ email: string }>>(request, "/api/users");
    expect(users.some((u) => u.email === READONLY_EMAIL)).toBe(true);
  });

  test("admin raises a prod deploy so a pending approval exists", async ({ page }) => {
    await page.goto("/app");
    const task = await submitCommand(page, "Client B VPS pe v2.5 deploy karo");
    taskId = task.id;
    await expect
      .poll(
        async () =>
          (await apiGet<Array<{ task_id?: string }>>(page.request, "/api/approvals?status=pending")).some(
            (a) => a.task_id === taskId,
          ),
        { timeout: 60_000, intervals: [2_000] },
      )
      .toBe(true);
  });

  test("readonly: GET works, writes are 403, approve button is disabled", async ({ browser }) => {
    const { ctx, page } = await readonlyContext(browser);
    try {
      const me = await apiGet<{ role: string }>(page.request, "/api/auth/me");
      expect(me.role).toBe("readonly");

      // Reads are fine.
      const state = await page.request.get("/api/state");
      expect(state.ok()).toBe(true);

      // Writes are denied.
      const pending = await apiGet<Array<{ id: string; task_id?: string }>>(page.request, "/api/approvals?status=pending");
      const approval = pending.find((a) => a.task_id === taskId);
      expect(approval, "pending approval visible to readonly").toBeTruthy();
      const approve = await page.request.post(`/api/approvals/${approval!.id}/approve`);
      expect(approve.status()).toBe(403);
      const create = await page.request.post("/api/tasks", { data: { prompt: "readonly should not create" } });
      expect(create.status()).toBe(403);
      const envs = await page.request.post("/api/environments", {
        data: { name: "x", kind: "staging", method: "tailscale_ssh", target: "100.64.0.9" },
      });
      expect(envs.status()).toBe(403);

      // UI: the approve button renders disabled for a readonly user.
      await page.goto("/app/approvals");
      const card = page.locator(`[data-testid="approval-card"][data-task-id="${taskId}"]`).or(page.getByTestId("approval-card")).first();
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.getByTestId("approve-btn")).toBeDisabled();
      await expect(card.getByTestId("reject-btn")).toBeDisabled();

      // Command bar is not usable either (disabled or hidden).
      const input = page.getByTestId("command-input");
      if ((await input.count()) > 0) await expect(input).toBeDisabled();
    } finally {
      await ctx.close();
    }
  });

  test("a non-matching domain role cannot approve Jimmy's request; admin can", async ({ request, browser }) => {
    // marketing is not in approval_roles[jimmy].
    const marketingEmail = `e2e-marketing-${Date.now()}@azzy.local`;
    const { body: mk } = await apiPost<{ id: string }>(
      request,
      "/api/users",
      { email: marketingEmail, password: READONLY_PASSWORD, role: "marketing" },
      201,
    );
    const ctx = await browser.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { "X-Requested-With": "azzy" },
    });
    try {
      const login = await ctx.request.post("/api/auth/login", { data: { email: marketingEmail, password: READONLY_PASSWORD } });
      expect(login.status()).toBe(200);
      const pending = await apiGet<Array<{ id: string; task_id?: string }>>(ctx.request, "/api/approvals?status=pending");
      const approval = pending.find((a) => a.task_id === taskId);
      expect(approval).toBeTruthy();
      const denied = await ctx.request.post(`/api/approvals/${approval!.id}/approve`);
      expect(denied.status()).toBe(403);

      // Admin cleans up: approve so the task finishes, then delete both users.
      const ok = await request.post(`/api/approvals/${approval!.id}/approve`, { headers: { "X-Requested-With": "azzy" } });
      expect(ok.ok()).toBe(true);
    } finally {
      await ctx.close();
      await request.delete(`/api/users/${mk.id}`, { headers: { "X-Requested-With": "azzy" } });
    }
  });

  test("admin cannot delete themselves; readonly user is removed", async ({ request }) => {
    const users = await apiGet<Array<{ id: string; email: string; role: string }>>(request, "/api/users");
    const self = users.find((u) => u.role === "admin");
    expect(self).toBeTruthy();
    const selfDelete = await request.delete(`/api/users/${self!.id}`, { headers: { "X-Requested-With": "azzy" } });
    expect([400, 403, 409]).toContain(selfDelete.status());

    const del = await request.delete(`/api/users/${userId}`, { headers: { "X-Requested-With": "azzy" } });
    expect(del.ok()).toBe(true);
  });
});
