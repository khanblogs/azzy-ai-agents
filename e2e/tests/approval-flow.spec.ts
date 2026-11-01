import { expect, test } from "@playwright/test";
import { apiGet, approvalCardFor, submitCommand, taskCard } from "../lib/helpers";

// Command -> Jimmy works -> prod approval -> approve -> deploy -> done (+ memory, costs, deployment row).
test.describe.configure({ mode: "serial" });

test.describe("approval flow (Client B prod deploy)", () => {
  let task: { id: string; title: string };

  test("command bar creates a routed task", async ({ page }) => {
    await page.goto("/app");
    task = await submitCommand(page, "Client B VPS pe v2.3 deploy karo");
    expect(task.title).toBeTruthy();
  });

  test("an approval appears and can be approved", async ({ page }) => {
    await page.goto("/app/approvals");
    const card = approvalCardFor(page, task.id);
    await expect(card, "approval card for the deploy").toBeVisible({ timeout: 60_000 });
    await expect(card.getByTestId("approve-btn")).toBeEnabled();
    await expect(card.getByTestId("reject-btn")).toBeVisible();

    const [decision] = await Promise.all([
      page.waitForResponse((r) => /\/api\/approvals\/[^/]+\/approve$/.test(r.url()) && r.request().method() === "POST"),
      card.getByTestId("approve-btn").click(),
    ]);
    expect(decision.ok()).toBe(true);

    await expect
      .poll(
        async () => {
          const pending = await apiGet<Array<{ task_id?: string }>>(page.request, "/api/approvals?status=pending");
          return pending.filter((a) => a.task_id === task.id).length;
        },
        { timeout: 20_000, message: "approval still pending for the task" },
      )
      .toBe(0);
  });

  test("the task reaches done on the board and leaves evidence behind", async ({ page }) => {
    await page.goto("/app/tasks");
    const doneColumn = page.getByTestId("pipeline-column-done");
    await expect(doneColumn).toBeVisible();
    await expect(taskCard(doneColumn, task), `task ${task.id} in done column`).toBeVisible({ timeout: 90_000 });

    const detail = await apiGet<{ task: { state: string }; memories: unknown[] }>(page.request, `/api/tasks/${task.id}`);
    expect(detail.task.state).toBe("done");
    expect(detail.memories.length).toBeGreaterThan(0);

    const costs = await apiGet<{ today_usd: number }>(page.request, "/api/costs");
    expect(costs.today_usd).toBeGreaterThan(0);

    // Deployment module recorded the rollout.
    const deployments = await apiGet<Array<{ task_id: string | null; status: string; version: string }>>(
      page.request,
      "/api/deployments?limit=20",
    );
    const mine = deployments.find((d) => d.task_id === task.id);
    expect(mine, "deployment row for the task").toBeTruthy();
    expect(mine?.status).toBe("succeeded");
    expect(mine?.version).toMatch(/^v2\.3/);
  });
});
