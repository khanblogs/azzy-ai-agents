import { expect, test } from "@playwright/test";
import { apiGet, approveViaUi, submitCommand, waitForTaskState, WORKFLOW_PROMPT } from "../lib/helpers";

// The ECS workflow: Jimmy -> Emir -> Cyber -> Jimmy -> Sara -> prod approval -> done.
// Agent-to-agent messages are persisted and drawn as live edges (CONTRACT-v2 §5).
test.describe.configure({ mode: "serial" });

test.describe("multi-agent collaboration", () => {
  let task: { id: string; title: string };

  test("the workflow prompt routes to Jimmy with four assignees", async ({ page }) => {
    await page.goto("/app");
    task = await submitCommand(page, WORKFLOW_PROMPT);
    const detail = await apiGet<{ task: { kind: string; lead: string; assignees: string[] } }>(
      page.request,
      `/api/tasks/${task.id}`,
    );
    expect(detail.task.kind).toBe("workflow");
    expect(detail.task.lead).toBe("jimmy");
    expect(detail.task.assignees).toEqual(expect.arrayContaining(["jimmy", "emir", "cyber", "sara"]));
  });

  test("the collaboration graph shows at least one active edge", async ({ page }) => {
    await page.goto("/app/collaboration");
    await expect(page.getByTestId("collab-edge").first()).toBeVisible({ timeout: 60_000 });
    const live = await apiGet<{ edges: Array<{ from: string; to: string; count: number; active: boolean }> }>(
      page.request,
      "/api/collaboration/live",
    );
    expect(live.edges.length).toBeGreaterThan(0);
    expect(live.edges.some((e) => e.from === "jimmy" && e.to === "emir")).toBe(true);
  });

  test("the task's messages tab lists at least three persisted agent messages", async ({ page }) => {
    await expect
      .poll(
        async () => (await apiGet<unknown[]>(page.request, `/api/tasks/${task.id}/messages`)).length,
        { timeout: 60_000, intervals: [2_000], message: "agent messages for the task" },
      )
      .toBeGreaterThanOrEqual(3);

    await page.goto(`/app/tasks/${task.id}`);
    await page.getByRole("tab", { name: /messages/i }).or(page.getByTestId("task-tab-messages")).first().click();
    await expect(page.getByTestId("agent-message").nth(2)).toBeVisible({ timeout: 20_000 });
  });

  test("prod deploy waits for approval, then the workflow completes", async ({ page }) => {
    await approveViaUi(page, task.id, 90_000);
    const state = await waitForTaskState(page.request, task.id, /^(done|failed|needs_human)$/, 90_000);
    expect(state).toBe("done");

    // AgentMessage shape (packages/events): from_agent / to_agent (null = broadcast to the task room).
    const messages = await apiGet<Array<{ from_agent: string; to_agent: string | null; type: string }>>(
      page.request,
      `/api/tasks/${task.id}/messages`,
    );
    const pairs = messages.map((m) => `${m.from_agent}>${m.to_agent ?? "azzy"}`);
    expect(pairs).toEqual(expect.arrayContaining(["jimmy>emir", "emir>cyber", "cyber>jimmy", "jimmy>sara"]));
    expect(messages.length).toBeLessThanOrEqual(60);
  });
});
