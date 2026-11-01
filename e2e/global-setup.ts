import { chromium, request, type FullConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { BASE_URL, SCREENSHOTS_DIR, STORAGE_STATE } from "./playwright.config";

const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owner@azzy.local";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? "change-me-now";

async function waitForHealth(timeoutMs: number): Promise<void> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  try {
    while (Date.now() < deadline) {
      try {
        const res = await ctx.get("/healthz", { timeout: 5_000 });
        if (res.ok()) return;
        lastError = `status ${res.status()}`;
      } catch (err) {
        lastError = String(err);
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
  } finally {
    await ctx.dispose();
  }
  throw new Error(`AZZY stack at ${BASE_URL} not healthy after ${timeoutMs / 1000}s (${lastError})`);
}

// Logs the admin in once through the real /login UI (which sends the CSRF header
// X-Requested-With: azzy itself) and saves the azzy_session cookie for every project.
// Tests that need another user or an anonymous browser override storageState.
export default async function globalSetup(_config: FullConfig): Promise<void> {
  await waitForHealth(180_000);

  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  try {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByTestId("login-email").fill(OWNER_EMAIL);
    await page.getByTestId("login-password").fill(OWNER_PASSWORD);
    await page.getByTestId("login-submit").click();
    await page.waitForURL((url) => url.pathname.startsWith("/app"), { timeout: 30_000 });

    const cookies = await context.cookies();
    if (!cookies.some((c) => c.name === "azzy_session")) {
      throw new Error("login succeeded but no azzy_session cookie was set");
    }
    const me = await context.request.get("/api/auth/me");
    if (!me.ok()) throw new Error(`/api/auth/me -> ${me.status()} after login`);
    const body = (await me.json()) as { role?: string };
    if (body.role !== "admin") throw new Error(`expected OWNER to be admin, got role=${body.role}`);

    await context.storageState({ path: STORAGE_STATE });
  } finally {
    await browser.close();
  }
}
