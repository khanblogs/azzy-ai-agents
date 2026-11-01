import { expect, test } from "@playwright/test";
import { apiGet } from "../lib/helpers";

// AWS account onboarding wizard (CONTRACT-v2 §6): scope -> CloudFormation snippet -> verify.
// In DEMO, verification succeeds for account ids starting with 1-4.
test.describe("aws accounts", () => {
  test("the two seeded demo accounts are listed and labelled demo", async ({ page }) => {
    const accounts = await apiGet<Array<{ account_id: string; demo: boolean; status: string }>>(page.request, "/api/aws-accounts");
    const ids = accounts.map((a) => a.account_id);
    expect(ids).toEqual(expect.arrayContaining(["111122223333", "444455556666"]));
    expect(accounts.filter((a) => ids.includes(a.account_id)).every((a) => a.demo)).toBe(true);
  });

  test("wizard: add Demo Sandbox (readonly) and verify it", async ({ page }) => {
    await page.goto("/app/aws-accounts");
    const wizard = page.getByTestId("account-wizard");
    await expect(wizard).toBeVisible();

    // Step 1: scope
    await wizard.getByTestId("account-scope-readonly").click();
    await wizard.getByTestId("wizard-next").click();

    // Step 2: CloudFormation snippet names the right role and has a copy button
    await expect(wizard).toContainText(/AzzyReadOnlyRole/);
    await expect(wizard.getByTestId("copy-snippet")).toBeVisible();
    await wizard.getByTestId("wizard-next").click();

    // Step 3: details + verify
    await wizard.getByTestId("account-name").fill("Demo Sandbox");
    await wizard.getByTestId("account-id").fill("123456789012");
    await wizard.getByTestId("account-role-arn").fill("arn:aws:iam::123456789012:role/AzzyReadOnlyRole");
    const [created] = await Promise.all([
      page.waitForResponse((r) => /\/api\/aws-accounts$/.test(r.url()) && r.request().method() === "POST"),
      wizard.getByTestId("account-submit").click(),
    ]);
    expect(created.status()).toBe(201);
    const account = (await created.json()) as { id: string; status: string };
    expect(account.status).toBe("pending");

    const row = page.locator(`[data-account-id="${account.id}"]`).or(page.getByTestId("account-row").filter({ hasText: "Demo Sandbox" })).first();
    await expect(row).toBeVisible();
    const [verified] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/aws-accounts/${account.id}/verify`) && r.request().method() === "POST"),
      row.getByTestId("account-verify").or(page.getByTestId("account-verify").first()).first().click(),
    ]);
    expect(verified.ok()).toBe(true);
    await expect(row.getByTestId("account-status")).toContainText(/verified/i, { timeout: 20_000 });

    const detail = (await apiGet<Array<{ id: string; status: string; permissions: Array<{ name: string; ok: boolean }> }>>(
      page.request,
      "/api/aws-accounts",
    )).find((a) => a.id === account.id);
    expect(detail?.status).toBe("verified");
    expect(detail?.permissions.some((p) => p.name === "ec2:DescribeInstances" && p.ok)).toBe(true);

    // Cleanup so the spec is re-runnable.
    const del = await page.request.delete(`/api/aws-accounts/${account.id}`);
    expect(del.ok()).toBe(true);
  });

  test("an account outside the demo range fails verification with a labelled STS error", async ({ page }) => {
    const res = await page.request.post("/api/aws-accounts", {
      data: {
        name: "Outside Range",
        account_id: "999988887777",
        role_arn: "arn:aws:iam::999988887777:role/AzzyAuditRole",
        external_id: "e2e-external-id",
        scope: "audit",
        regions: ["ap-south-1"],
        stage: "uat",
      },
    });
    expect(res.status()).toBe(201);
    const account = (await res.json()) as { id: string };
    const verify = await page.request.post(`/api/aws-accounts/${account.id}/verify`);
    expect(verify.ok()).toBe(true);
    const body = (await verify.json()) as { status: string; error: string | null };
    expect(body.status).toBe("failed");
    expect(body.error).toMatch(/AccessDenied|AssumeRole|not authorized/i);
    await page.request.delete(`/api/aws-accounts/${account.id}`);
  });
});
