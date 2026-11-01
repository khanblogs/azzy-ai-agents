import { expect, test } from "@playwright/test";
import { apiGet, OWNER_EMAIL, OWNER_PASSWORD, uiLogin } from "../lib/helpers";

// Audit (CONTRACT-v2 §9): logins (and failures), approvals, tool calls, task changes are recorded.
test.describe("audit log", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/app/audit lists the login just performed (and the failed attempt before it)", async ({ page }) => {
    // A failed attempt first, so both outcomes are on record.
    await page.goto("/login");
    await page.getByTestId("login-email").fill(OWNER_EMAIL);
    await page.getByTestId("login-password").fill("wrong-password-for-audit");
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/login/);

    const before = new Date();
    await uiLogin(page, OWNER_EMAIL, OWNER_PASSWORD);

    await page.goto("/app/audit");
    await expect(page.locator("h1").first()).toBeVisible();
    const rows = page.getByTestId("audit-row");
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    await expect(rows.filter({ hasText: OWNER_EMAIL }).filter({ hasText: /auth\.login|login/i }).first()).toBeVisible();

    const entries = await apiGet<Array<{ ts: string; actor: string; action: string; detail: Record<string, unknown> }>>(
      page.request,
      `/api/audit?limit=50&actor=${encodeURIComponent(OWNER_EMAIL)}`,
    );
    const recent = entries.filter((e) => new Date(e.ts).getTime() >= before.getTime() - 60_000);
    expect(recent.some((e) => e.action === "auth.login")).toBe(true);
    expect(entries.some((e) => /auth\.login_failed|auth\.login/.test(e.action) && e.detail?.ok === false)).toBe(true);

    // Filter by action works server-side.
    const onlyLogins = await apiGet<Array<{ action: string }>>(page.request, "/api/audit?limit=20&action=auth.login");
    expect(onlyLogins.length).toBeGreaterThan(0);
    expect(onlyLogins.every((e) => e.action === "auth.login")).toBe(true);
  });
});
