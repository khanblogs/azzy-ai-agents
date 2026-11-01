import { expect, test } from "@playwright/test";
import { AGENT_IDS, PUBLIC_ROUTES } from "../lib/helpers";

// Public site (CONTRACT-v2 §10): no auth, logo + five agents + creator credit.
test.describe("public site", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("home renders the logo, the five agents and the footer credit", async ({ page }) => {
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);
    const logo = page.locator('img[src*="brand/azzy-logo"]').first();
    await expect(logo).toBeVisible();
    for (const id of AGENT_IDS) {
      await expect(page.getByTestId(`agent-card-${id}`), `agent card ${id}`).toBeVisible();
    }
    for (const name of ["Jimmy", "Emir", "Cyber", "Sara", "Marwah"]) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText(/\bjohn\b/i)).toHaveCount(0);
    const credit = page.getByTestId("footer-credit");
    await expect(credit).toContainText("AZZY AI AGENTS v2.0");
    await expect(credit).toContainText("Created by Shahrukh Khan");
    await expect(credit).not.toContainText(/DevOps/);
    await expect(page.getByRole("link", { name: /log ?in|sign in/i }).first()).toBeVisible();
  });

  test("every public page renders with an h1 and the credit, without redirecting", async ({ page }) => {
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route);
      expect(new URL(page.url()).pathname, `stayed on ${route}`).toBe(route);
      await expect(page.locator("h1").first(), `h1 on ${route}`).toBeVisible();
      await expect(page.getByTestId("footer-credit")).toBeVisible();
    }
  });

  test("architecture page embeds the HLD image", async ({ page }) => {
    await page.goto("/architecture");
    const hld = page.locator('img[src*="brand/hld"]').first();
    await expect(hld).toBeVisible();
    const natural = await hld.evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(natural).toBeGreaterThan(0);
  });

  test("contact form posts to /api/contact", async ({ page }) => {
    await page.goto("/contact");
    await page.getByTestId("contact-name").fill("E2E Visitor");
    await page.getByTestId("contact-email").fill("visitor@example.com");
    await page.getByTestId("contact-message").fill("Hello from the e2e suite.");
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/contact") && r.request().method() === "POST"),
      page.getByTestId("contact-submit").click(),
    ]);
    expect([200, 201, 202]).toContain(res.status());
    await expect(page.getByTestId("contact-success")).toBeVisible();
  });

  test("PWA manifest and service worker are served", async ({ request }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect(manifest.headers()["content-type"]).toContain("manifest+json");
    const body = (await manifest.json()) as { name: string; icons: unknown[] };
    expect(body.name).toContain("AZZY");
    expect(body.icons.length).toBeGreaterThan(0);
    const sw = await request.get("/sw.js");
    expect(sw.ok()).toBe(true);
  });
});
