import { expect, test, type Page } from "@playwright/test";
import { MOBILE_TABS, MORE_ROUTES, PORTAL_ROUTES, type PortalRoute } from "../lib/helpers";

// 390x844 touch viewport (mobile project only): 5-tab bar (Home, Office, Tasks, Approvals, More),
// the More sheet reaches every other page, each page has an h1, the office still scrolls.

function tabBar(page: Page) {
  return page.getByTestId("tab-bar").or(page.locator('nav[aria-label="Primary"]:visible')).first();
}

function tab(page: Page, route: PortalRoute) {
  return page.getByTestId(`nav-${route}-mobile`).or(page.getByTestId(`nav-${route}`)).locator("visible=true").first();
}

async function openMore(page: Page) {
  const more = page.getByTestId("tab-more");
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByTestId("more-sheet")).toBeVisible();
}

async function expectPage(page: Page, route: PortalRoute) {
  const expected = PORTAL_ROUTES[route];
  await expect(page).toHaveURL(new RegExp(`${expected.replace(/\//g, "\\/")}(\\/|\\?.*)?$`));
  await expect(page.locator("h1").first(), `h1 on ${route}`).toBeVisible({ timeout: 20_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `horizontal overflow on ${route}`).toBeLessThanOrEqual(2);
}

test.describe("mobile (390x844)", () => {
  test("bottom tab bar has five tabs and is pinned to the bottom", async ({ page }) => {
    await page.goto("/app");
    const bar = tabBar(page);
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport).toBeTruthy();
    if (box && viewport) {
      expect(box.y + box.height).toBeGreaterThanOrEqual(viewport.height - 2);
      expect(box.width).toBeGreaterThanOrEqual(viewport.width * 0.9);
    }
    for (const route of MOBILE_TABS) await expect(tab(page, route), `tab ${route}`).toBeVisible();
    await expect(page.getByTestId("tab-more")).toBeVisible();
    await expect(bar.getByRole("link").or(bar.getByRole("button"))).toHaveCount(5);
  });

  test("the four direct tabs open their pages", async ({ page }) => {
    await page.goto("/app");
    for (const route of MOBILE_TABS) {
      await tab(page, route).click();
      await expectPage(page, route);
    }
  });

  test("the More sheet reaches every remaining page", async ({ page }) => {
    await page.goto("/app");
    for (const route of MORE_ROUTES) {
      await openMore(page);
      await page.getByTestId("more-sheet").getByTestId(`nav-${route}-mobile`).click();
      await expectPage(page, route);
    }
  });

  test("the office renders (canvas or fallback) and the page still scrolls", async ({ page }) => {
    await page.goto("/app/office");
    await expect(page.getByTestId("office-canvas").or(page.getByTestId("office-fallback")).first()).toBeVisible({
      timeout: 30_000,
    });
    // Mode chips are reachable without touching the 3D scene.
    for (const mode of ["overview", "focus", "collaboration", "execution", "monitoring"]) {
      await expect(page.getByTestId(`office-mode-${mode}`)).toBeVisible();
    }
    const scrollable = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return el.scrollHeight > el.clientHeight + 10;
    });
    test.skip(!scrollable, "office page fits the viewport; nothing to scroll");
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" as ScrollBehavior }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(page.getByTestId("call-meeting")).toBeVisible();
    await expect(page.getByTestId("simulate-incident")).toBeVisible();
  });

  test("approvals and chat are usable with touch", async ({ page }) => {
    await page.goto("/app/approvals");
    await expect(page.locator("h1").first()).toBeVisible();
    const cards = page.getByTestId("approval-card");
    if ((await cards.count()) > 0) {
      await expect(cards.first().getByTestId("approve-btn")).toBeVisible();
      await expect(cards.first().getByTestId("reject-btn")).toBeVisible();
    }
    await page.goto("/app/agents/jimmy");
    await expect(page.getByTestId("chat-input")).toBeVisible();
    await expect(page.getByTestId("chat-send")).toBeVisible();
    await expect(page.getByTestId("footer-credit")).toBeAttached();
  });
});
