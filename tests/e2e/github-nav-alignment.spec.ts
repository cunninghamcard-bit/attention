import { expect, test } from "@playwright/test";

/** The GitHub dock's header icons and the tree icons beneath them must share
 * one vertical line.
 *
 * This lives in e2e rather than beside the other GitHub tests because jsdom has
 * no layout engine: every unit test in this repo would pass on a dock whose
 * columns are 18px apart, which is exactly what shipped three times while the
 * fix was reasoned out of the stylesheet instead of measured. Chromium computes
 * the cascade for real, so `getBoundingClientRect()` can answer the question
 * the owner was actually asking. */

const SECRET_KEY = "obsidian-reconstructed-secret-storage";

/** The dock hides its tree behind auth — `bootstrap()` renders the sign-in card
 * unless `getAuth()` returns a login, and a sign-in card has no tree to measure.
 * Seed a token before boot and answer `/user`; the Pull requests section (the
 * default) draws its rows from a static table, so nothing else needs faking. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    SECRET_KEY,
    JSON.stringify({ "github-token": "e2e-token" }),
  ] as const);
  await page.route("**/api.github.com/user", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ login: "e2e-user", avatar_url: "", name: "E2E User" }),
    }),
  );
});

test("github dock header icons sit on the tree's icon column", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".workspace")).toBeVisible();

  // Drive the ribbon rather than the hotkey: `Mod` resolves per platform, and
  // the subject here is the dock's geometry, not the keymap.
  await page.locator('[aria-label="Open command palette"]').click();
  await page.locator(".prompt-input").fill("GitHub");
  await page.locator(".suggestion-item").filter({ hasText: "Open GitHub" }).first().click();

  const dock = page.locator('.workspace-leaf-content[data-type="github-nav"]');
  const headerIcons = dock.locator(".nav-header .nav-action-button svg.svg-icon");
  const treeIcons = dock.locator(".github-nav-body .tree-item-icon-inline svg.svg-icon");
  await expect(headerIcons.first()).toBeVisible();
  await expect(treeIcons.first()).toBeVisible();

  const leftEdges = (locator: typeof headerIcons) =>
    locator.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left));

  const header = await leftEdges(headerIcons);
  const tree = await leftEdges(treeIcons);

  expect(header.length).toBe(4);
  expect(tree.length).toBeGreaterThan(0);
  // The rows agree with each other…
  expect(new Set(tree).size).toBe(1);
  // …and the header's column starts on the same line. The switcher's remaining
  // icons run rightwards from there, so only the first shares the column.
  expect(header[0]).toBeCloseTo(tree[0], 0);
});
