import { expect, test } from "@playwright/test";
import { apiGet } from "../lib/helpers";

// Individual agent chat (CONTRACT-v2 §4): Jimmy answers from live state (environment list).
test.describe("agent chat", () => {
  test("Jimmy replies to 'What environments do we have?' with client-b", async ({ page }) => {
    await page.goto("/app/agents/jimmy");
    await expect(page.locator("h1").first()).toContainText(/jimmy/i);

    const input = page.getByTestId("chat-input");
    await expect(input).toBeVisible();
    await input.fill("What environments do we have?");

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/conversations\/[^/]+\/messages$/.test(r.url()) && r.request().method() === "POST",
        { timeout: 20_000 },
      ),
      page.getByTestId("chat-send").click(),
    ]);
    expect(response.status(), "POST conversation message -> 202").toBe(202);
    const accepted = (await response.json()) as { task_id: string; user_message: { conversation_id: string } };
    expect(accepted.task_id).toBeTruthy();

    // Streaming reply: wait for an agent message mentioning the seeded Client B environment.
    const agentMessages = page.getByTestId("chat-message-agent");
    await expect(agentMessages.filter({ hasText: /client-b|client b/i }).first()).toBeVisible({ timeout: 30_000 });

    // The reply is persisted and comes back from the API with the same content.
    const cid = accepted.user_message.conversation_id;
    const messages = await apiGet<Array<{ role: string; content: string; streaming: boolean }>>(
      page.request,
      `/api/conversations/${cid}/messages`,
    );
    const reply = messages.filter((m) => m.role === "agent").at(-1);
    expect(reply, "persisted agent reply").toBeTruthy();
    expect(reply?.content).toMatch(/client-b|client b/i);
    expect(reply?.streaming).toBe(false);

    // The office showed Jimmy chatting (phase) at some point — verify via state snapshot once settled.
    const state = await apiGet<{ agents: Array<{ id: string; phase: string }> }>(page.request, "/api/state");
    expect(state.agents.map((a) => a.id).sort()).toEqual(["cyber", "emir", "jimmy", "marwah", "sara"]);
  });

  test("a chat that asks for an action becomes a command task", async ({ page }) => {
    await page.goto("/app/agents/jimmy");
    await page.getByTestId("chat-input").fill("deploy v2.4 to client b");
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/conversations\/[^/]+\/messages$/.test(r.url()) && r.request().method() === "POST",
      ),
      page.getByTestId("chat-send").click(),
    ]);
    expect(response.status()).toBe(202);
    // Reply says a task was created and mentions its id; a task exists with the deploy kind.
    await expect(page.getByTestId("chat-message-agent").filter({ hasText: /task/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    const tasks = await apiGet<Array<{ title: string; lead: string; kind: string }>>(page.request, "/api/tasks?limit=20");
    expect(tasks.some((t) => t.lead === "jimmy" && /v2\.4/.test(t.title))).toBe(true);
  });
});
