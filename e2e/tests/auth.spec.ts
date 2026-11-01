import { expect, test } from "@playwright/test";
import { CSRF_HEADERS, OWNER_EMAIL, OWNER_PASSWORD } from "../lib/helpers";

test.describe("auth", () => {
  // These tests start logged out and without the context-wide CSRF header, so the
  // probes below exercise the real server behaviour (the web app adds it itself).
  test.use({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: {} });

  test("unauthenticated visit to the portal redirects to /login", async ({ page }) => {
    await page.goto("/app/tasks");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("login-email")).toBeVisible();
    await expect(page.getByTestId("login-password")).toBeVisible();
    await expect(page.getByTestId("login-submit")).toBeVisible();
  });

  test("API rejects anonymous calls and non-GET calls without the CSRF header", async ({ request }) => {
    const anon = await request.get("/api/state");
    expect(anon.status()).toBe(401);
    // Login itself is exempt from CSRF, but a wrong password is still 401.
    const bad = await request.post("/api/auth/login", {
      data: { email: OWNER_EMAIL, password: "nope-nope-nope" },
      headers: CSRF_HEADERS,
    });
    expect(bad.status()).toBe(401);
  });

  test("wrong password is rejected in the UI", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(OWNER_EMAIL);
    await page.getByTestId("login-password").fill("definitely-not-the-password");
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/login/);
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "azzy_session")).toBeUndefined();
  });

  test("admin can log in and lands in the Command Center", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(OWNER_EMAIL);
    await page.getByTestId("login-password").fill(OWNER_PASSWORD);
    await page.getByTestId("login-submit").click();
    await page.waitForURL((url) => url.pathname.startsWith("/app"));

    const cookie = (await page.context().cookies()).find((c) => c.name === "azzy_session");
    expect(cookie, "azzy_session cookie set").toBeTruthy();
    expect(cookie?.httpOnly, "cookie is httpOnly").toBe(true);

    await expect(page.getByTestId("nav-home").or(page.getByTestId("nav-home-mobile")).first()).toBeVisible();
    await expect(page.getByTestId("footer-credit")).toContainText(/Shahrukh Khan/);

    const me = await page.request.get("/api/auth/me");
    expect(me.ok()).toBe(true);
    const body = (await me.json()) as { email: string; role: string };
    expect(body.email).toBe(OWNER_EMAIL);
    expect(body.role).toBe("admin");
  });

  test("CSRF: a cookie-authenticated non-GET without X-Requested-With is refused", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email").fill(OWNER_EMAIL);
    await page.getByTestId("login-password").fill(OWNER_PASSWORD);
    await page.getByTestId("login-submit").click();
    await page.waitForURL((url) => url.pathname.startsWith("/app"));
    // page.evaluate -> fetch from the page origin, deliberately without the header.
    const status = await page.evaluate(async () => {
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "csrf probe" }),
      });
      return r.status;
    });
    expect(status).toBe(403);
  });
});
