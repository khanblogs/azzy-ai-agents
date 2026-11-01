import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const isCI = !!process.env.CI;

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost";
export const STORAGE_STATE = path.join(here, ".auth", "owner.json");
export const SCREENSHOTS_DIR = path.join(here, "screenshots");

// Budget: the whole suite should finish in ~6 minutes in CI. Specs that drive
// long demo scenarios (approval-flow, collaboration, incident) run serially
// inside their own file; files run in parallel across 2 workers.
export default defineConfig({
  testDir: path.join(here, "tests"),
  globalSetup: path.join(here, "global-setup.ts"),
  outputDir: path.join(here, "test-results"),
  fullyParallel: false,
  workers: isCI ? 2 : 2,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 120_000,
  globalTimeout: isCI ? 15 * 60_000 : 0,
  expect: { timeout: 15_000 },
  reporter: isCI
    ? [["list"], ["html", { open: "never", outputFolder: path.join(here, "playwright-report") }]]
    : [["list"], ["html", { open: "on-failure", outputFolder: path.join(here, "playwright-report") }]],
  use: {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
    // Every non-GET /api call from page.request / request fixtures carries the CSRF header.
    extraHTTPHeaders: { "X-Requested-With": "azzy" },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
      testMatch: /(mobile|screenshots)\.spec\.ts/,
    },
  ],
});
