import { expect, test } from "@playwright/test";
import { apiGet, submitCommand, taskCard, waitForTaskState, WORKFLOW_PROMPT } from "../lib/helpers";

// Bounded execution: a running workflow can be cancelled; the worker stops between steps and
// pending approvals of that task are expired (CONTRACT-v2 §5).
test.describe("task cancellation", () => {
  test("a running workflow is cancelled from the task drawer", async ({ page }) => {
    await page.goto("/app");
    const task = await submitCommand(page, WORKFLOW_PROMPT);

    // Let it start (it is not done yet: the workflow takes ~45 s plus an approval wait).
    await waitForTaskState(page.request, task.id, /^(needs_work|needs_review|needs_qa)$/, 20_000);

    await page.goto("/app/tasks");
    await taskCard(page, task).click();
    const cancel = page.getByTestId("task-cancel");
    await expect(cancel).toBeEnabled();
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/tasks/${task.id}/cancel`) && r.request().method() === "POST"),
      cancel.click(),
    ]);
    expect(response.ok(), `cancel -> ${response.status()}`).toBe(true);

    const state = await waitForTaskState(page.request, task.id, /^cancelled$/, 20_000);
    expect(state).toBe("cancelled");

    // No pending approval survives the cancel.
    const pending = await apiGet<Array<{ task_id?: string }>>(page.request, "/api/approvals?status=pending");
    expect(pending.filter((a) => a.task_id === task.id)).toHaveLength(0);

    // Cancelling twice is a no-op / conflict, never a 500.
    const again = await page.request.post(`/api/tasks/${task.id}/cancel`);
    expect([200, 400, 409]).toContain(again.status());

    // The audit trail has the cancel.
    const audit = await apiGet<Array<{ action: string; task_id: string | null }>>(
      page.request,
      "/api/audit?limit=50&action=task.cancelled",
    );
    expect(audit.some((a) => a.task_id === task.id)).toBe(true);
  });
});
