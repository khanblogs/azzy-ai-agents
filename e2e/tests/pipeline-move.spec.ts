import { expect, test } from "@playwright/test";
import { submitCommand, taskCard } from "../lib/helpers";

// Manual board move: POST /api/tasks/{id}/move through the card's move control (routes to Emir).
test.describe.configure({ mode: "serial" });

test.describe("pipeline board", () => {
  let task: { id: string; title: string };

  test("a review task shows up on the board", async ({ page }) => {
    await page.goto("/app");
    task = await submitCommand(page, "Review PR 42 for client A");

    await page.goto("/app/tasks");
    for (const state of ["needs_work", "needs_review", "needs_qa", "needs_docs", "ready", "needs_human", "done"]) {
      await expect(page.getByTestId(`pipeline-column-${state}`)).toBeVisible();
    }
    await expect(taskCard(page, task)).toBeVisible({ timeout: 30_000 });
  });

  test("the card can be moved to needs_qa with its move control", async ({ page }) => {
    // Let the worker finish with the task first so the manual move is not raced by
    // the agent's own transitions (demo tasks settle well within 90 s).
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/tasks/${task.id}`);
          return ((await res.json()) as { task: { state: string } }).task.state;
        },
        { timeout: 90_000, intervals: [1_000, 2_000], message: "task did not settle" },
      )
      .toMatch(/^(done|needs_human|failed)$/);

    await page.goto("/app/tasks");
    const card = taskCard(page, task);
    await expect(card).toBeVisible({ timeout: 30_000 });

    // The move control is a <select data-testid="task-move"> on the card (a menu of states).
    const move = card.getByTestId("task-move");
    await expect(move).toBeVisible();
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/api/tasks/${task.id}/move`) && r.request().method() === "POST",
        { timeout: 20_000 },
      ),
      move.selectOption("needs_qa"),
    ]);
    expect(response.ok()).toBe(true);

    const column = page.getByTestId("pipeline-column-needs_qa");
    await expect(taskCard(column, task), "card rendered in needs_qa").toBeVisible({ timeout: 20_000 });

    const detail = await page.request.get(`/api/tasks/${task.id}`);
    expect(((await detail.json()) as { task: { state: string } }).task.state).toBe("needs_qa");
  });
});
