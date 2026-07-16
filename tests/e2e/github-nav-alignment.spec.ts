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
  await page.route("**/api.github.com/user/orgs**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ login: "acme-org", avatar_url: "", description: null }]),
    }),
  );
});

async function openDock(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.locator(".workspace")).toBeVisible();
  // Drive the ribbon rather than the hotkey: `Mod` resolves per platform, and
  // the subject here is the dock's geometry, not the keymap.
  await page.locator('[aria-label="Open command palette"]').click();
  await page.locator(".prompt-input").fill("GitHub");
  await page.locator(".suggestion-item").filter({ hasText: "Open GitHub" }).first().click();
  return page.locator('.workspace-leaf-content[data-type="github-nav"]');
}

const leftEdgesOf = (locator: import("@playwright/test").Locator) =>
  locator.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left));

test("github dock header icons sit on the tree's icon column", async ({ page }) => {
  const dock = await openDock(page);
  const headerIcons = dock.locator(".nav-header .nav-action-button svg.svg-icon");
  const treeIcons = dock.locator(".github-nav-body .tree-item-icon-inline svg.svg-icon");
  await expect(headerIcons.first()).toBeVisible();
  await expect(treeIcons.first()).toBeVisible();

  const header = await leftEdgesOf(headerIcons);
  const tree = await leftEdgesOf(treeIcons);

  expect(header.length).toBe(4);
  expect(tree.length).toBeGreaterThan(0);
  // The rows agree with each other…
  expect(new Set(tree).size).toBe(1);
  // …and the header's column starts on the same line. The switcher's remaining
  // icons run rightwards from there, so only the first shares the column.
  expect(header[0]).toBeCloseTo(tree[0], 0);
});

/** The owner's actual requirement was never a number — it was "like the file
 * explorer". So measure it against the file explorer, in the same window, and
 * let the host be the assertion.
 *
 * This is what caught the second half of the bug: the columns can agree with
 * each other while both sit 20px right of every other dock, because this view
 * used to cancel the host's reclaim of the empty collapse gutter. */
test("the dock's rows start where the file explorer's do", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".workspace")).toBeVisible();

  // The e2e vault is empty; make one real row to measure the host against.
  await page.locator('[aria-label="New note"]').first().click();
  const explorer = page.locator('.workspace-leaf-content[data-type="file-explorer"]');
  await expect(explorer.locator(".tree-item-self").first()).toBeVisible();
  const explorerText = await explorer
    .locator(".tree-item-inner")
    .first()
    .evaluate((el) => el.getBoundingClientRect().left);

  const dock = await openDock(page);
  await expect(dock.locator(".tree-item-self").first()).toBeVisible();
  const dockText = await dock
    .locator(".tree-item-inner")
    .first()
    .evaluate((el) => el.getBoundingClientRect().left);

  // Within a pixel: the explorer spends the gutter on a folder's chevron, this
  // dock spends it on a row icon — the same column either way.
  expect(Math.abs(dockText - explorerText)).toBeLessThanOrEqual(2);
});

/** Every section is drawn by the same `item()` helper, so in principle one
 * measurement covers them all — but "same code path" is an argument, and the
 * column being off by 18px was also an argument that read fine. Measure the
 * other section instead, including its selected row: the owner suspected the
 * highlight/gutter override behind the row icons, and a selected row is exactly
 * where that override applies. */
test("organizations rows hold the same column, selected or not", async ({ page }) => {
  const dock = await openDock(page);
  await dock.locator('[aria-label="Organizations"]').click();

  const orgRow = dock.locator(".github-nav-body .tree-item-self").first();
  await expect(orgRow).toBeVisible();

  const headerIcons = dock.locator(".nav-header .nav-action-button svg.svg-icon");
  const treeIcons = dock.locator(".github-nav-body .tree-item-icon-inline svg.svg-icon");
  const header = await leftEdgesOf(headerIcons);

  expect(await leftEdgesOf(treeIcons)).toEqual(
    Array.from({ length: (await treeIcons.count()) as number }, () => header[0]),
  );

  // Select a row: `.is-active` paints the highlight, and if the icon sat outside
  // the row's padding box the background would clip it — the bug the owner
  // remembered. The column must not move, and the highlight must contain it.
  await orgRow.click();
  await expect(orgRow).toHaveClass(/is-active/);

  const afterSelect = await leftEdgesOf(treeIcons);
  expect(afterSelect[0]).toBeCloseTo(header[0], 0);

  const contained = await orgRow.evaluate((row) => {
    const icon = row.querySelector(".tree-item-icon-inline");
    if (!icon) return null;
    const r = row.getBoundingClientRect();
    const i = icon.getBoundingClientRect();
    return i.left >= r.left && i.right <= r.right;
  });
  expect(contained).toBe(true);
});
