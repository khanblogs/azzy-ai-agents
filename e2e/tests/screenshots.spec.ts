import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { SCREENSHOTS_DIR } from "../playwright.config";
import { PORTAL_ROUTES } from "../lib/helpers";

// Saves a PNG of every major screen into e2e/screenshots/<project>/<name>.png.
// Runs in both projects (desktop-chromium and mobile); never asserts on pixels.

const PUBLIC: Array<[string, string]> = [
  ["public-home", "/"],
  ["public-platform", "/platform"],
  ["public-agents", "/agents"],
  ["public-capabilities", "/capabilities"],
  ["public-architecture", "/architecture"],
  ["public-security", "/security"],
  ["public-contact", "/contact"],
  ["login", "/login"],
];

const PORTAL: Array<[string, string]> = [
  ...Object.entries(PORTAL_ROUTES).map(([k, v]) => [`app-${k}`, v] as [string, string]),
  ["app-agent-jimmy-chat", "/app/agents/jimmy"],
  ["app-agent-cyber-chat", "/app/agents/cyber"],
];

test.describe("screenshots", () => {
  test.describe.configure({ mode: "serial" });

  test("public screens", async ({ page }, testInfo) => {
    const dir = path.join(SCREENSHOTS_DIR, testInfo.project.name);
    fs.mkdirSync(dir, { recursive: true });
    const ctx = await page.context().browser()!.newContext({
      ...testInfo.project.use,
      storageState: { cookies: [], origins: [] },
    });
    const anon = await ctx.newPage();
    try {
      for (const [name, route] of PUBLIC) {
        await anon.goto(route, { waitUntil: "networkidle" });
        await anon.waitForTimeout(300);
        await anon.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
      }
    } finally {
      await ctx.close();
    }
  });

  test("portal screens", async ({ page }, testInfo) => {
    const dir = path.join(SCREENSHOTS_DIR, testInfo.project.name);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, route] of PORTAL) {
      await page.goto(route, { waitUntil: "networkidle" });
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
      // Give the office / graphs a moment to paint their first frame.
      await page.waitForTimeout(route.includes("office") || route.includes("collaboration") ? 2_500 : 400);
      await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: !route.includes("office") });
    }
    // Office camera modes.
    await page.goto("/app/office", { waitUntil: "networkidle" });
    for (const mode of ["overview", "focus", "collaboration", "execution", "monitoring"]) {
      const chip = page.getByTestId(`office-mode-${mode}`);
      if ((await chip.count()) === 0) continue;
      await chip.click();
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: path.join(dir, `app-office-${mode}.png`) });
    }
    if (testInfo.project.name === "mobile") {
      const more = page.getByTestId("tab-more");
      if ((await more.count()) > 0) {
        await page.goto("/app", { waitUntil: "networkidle" });
        await more.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(dir, "app-more-sheet.png") });
      }
    }
    const written = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
    expect(written.length).toBeGreaterThanOrEqual(PUBLIC.length + PORTAL.length);
  });
});
