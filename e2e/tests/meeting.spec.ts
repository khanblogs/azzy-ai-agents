import { expect, test } from "@playwright/test";
import { officeStatus, waitForLive } from "../lib/helpers";

// "Call meeting": all five walk to the orchestration table, speak in turn, return; status meeting -> nominal.
test.describe("meeting", () => {
  test("call meeting flips the office status to meeting and back to nominal", async ({ page }) => {
    await page.goto("/app/office");
    await waitForLive(page);
    await expect(page.getByTestId("office-canvas").or(page.getByTestId("office-fallback")).first()).toBeVisible({
      timeout: 30_000,
    });

    const status = officeStatus(page);
    await expect(status).toBeVisible();
    // If a previous run left a meeting going, wait for it to finish (409 otherwise).
    await expect(status).toContainText(/nominal/i, { timeout: 60_000 });

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/meeting/call") && r.request().method() === "POST"),
      page.getByTestId("call-meeting").click(),
    ]);
    expect(response.ok(), `POST /api/meeting/call -> ${response.status()}`).toBe(true);

    await expect(status).toContainText(/meeting/i, { timeout: 20_000 });

    // Agents speak in turn at the orchestration table: at least one speech bubble is rendered during the meeting.
    await expect(page.locator('[data-testid^="agent-bubble-"]').first()).toBeVisible({ timeout: 30_000 });

    await expect(status).toContainText(/nominal/i, { timeout: 60_000 });
  });
});
