import { expect, test } from "@playwright/test";
import { approvalCardFor, officeStatus, waitForLive } from "../lib/helpers";

// Simulate incident -> war room (Jimmy lead, Emir root cause, Cyber attack check, Sara comms) -> rollback approval -> resolved.
test.describe.configure({ mode: "serial" });

test.describe("incident war room", () => {
  let incidentId: string;

  test("simulate incident opens an incident and flips the office status", async ({ page }) => {
    await page.goto("/app/office");
    await waitForLive(page);
    await expect(officeStatus(page)).toContainText(/nominal/i, { timeout: 60_000 });

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/incidents/simulate") && r.request().method() === "POST"),
      page.getByTestId("simulate-incident").click(),
    ]);
    expect(response.status()).toBe(201);
    incidentId = ((await response.json()) as { id: string }).id;
    expect(incidentId).toBeTruthy();

    await expect(officeStatus(page)).toContainText(/incident/i, { timeout: 20_000 });

    await page.goto("/app/monitoring");
    const card = page.locator(`[data-testid="incident-card"][data-incident-id="${incidentId}"]`).or(
      page.getByTestId("incident-card").first(),
    );
    await expect(card.first()).toBeVisible({ timeout: 20_000 });
    await expect(card.first()).toContainText(/open|investigating|mitigating/i);
  });

  test("the rollback approval appears and approving it resolves the incident", async ({ page }) => {
    await page.goto("/app/approvals");
    const card = page
      .getByTestId("approval-card")
      .filter({ hasText: /rollback/i })
      .or(approvalCardFor(page))
      .first();
    await expect(card, "rollback approval card").toBeVisible({ timeout: 60_000 });

    const [decision] = await Promise.all([
      page.waitForResponse((r) => /\/api\/approvals\/[^/]+\/approve$/.test(r.url()) && r.request().method() === "POST"),
      card.getByTestId("approve-btn").click(),
    ]);
    expect(decision.ok()).toBe(true);

    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/incidents");
          const list = (await res.json()) as Array<{ id: string; status: string }>;
          return list.find((i) => i.id === incidentId)?.status ?? "missing";
        },
        { timeout: 90_000, intervals: [2_000], message: "incident did not resolve" },
      )
      .toBe("resolved");

    await page.goto("/app/office");
    await expect(officeStatus(page)).toContainText(/nominal/i, { timeout: 30_000 });
  });
});
