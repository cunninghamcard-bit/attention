import { execFileSync } from "node:child_process";
import { expect, test } from "../fixtures/electronApp";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

// Obsidian collapses a tree item by easing its children box's measured height
// to zero and only THEN detaching it; we used to set `hidden` in the same
// frame. A snap shows only the endpoints, so the check is that a partly-closed
// state exists on the way. The commit log is the surface under test because it
// toggles a persistent TreeItem — the views that rebuild their tree on every
// toggle have no element left to animate.
test("a tree item eases its children closed instead of snapping", async ({
  vaultPath,
  launchApp,
}) => {
  git(vaultPath, "init", "-b", "main");
  git(vaultPath, "config", "user.email", "e2e@example.com");
  git(vaultPath, "config", "user.name", "E2E");
  git(vaultPath, "add", "-A");
  git(vaultPath, "commit", "-m", "seed");

  const { page } = await launchApp();
  await page.waitForSelector(".nav-file-title");
  await page.evaluate(async () => {
    const app = (window as unknown as { app: any }).app;
    await app.workspace.getLeaf("tab").setViewState({ type: "git-log", active: true });
  });
  await page.waitForSelector(".git-log-header", { timeout: 30_000 });

  const header = page.locator(".git-log-header").first();
  const detail = () =>
    page.evaluate(() => {
      const el = document.querySelector(".git-log-detail") as HTMLElement | null;
      return el ? Math.round(el.getBoundingClientRect().height) : -1;
    });

  // Collapsed to begin with: the children box is detached, not merely hidden.
  expect(await detail()).toBe(-1);

  await header.click();
  await page.waitForTimeout(600);
  const openHeight = await detail();
  expect(openHeight).toBeGreaterThan(0);

  await header.click();
  const heights: number[] = [];
  for (let index = 0; index < 10; index++) {
    heights.push(await detail());
    await page.waitForTimeout(20);
  }
  expect(heights.filter((h) => h > 0 && h < openHeight).length).toBeGreaterThan(0);

  await page.waitForTimeout(400);
  expect(await detail()).toBe(-1);
});

// The file explorer used to rebuild its whole tree on every fold, so the row
// being folded was destroyed before it could animate. Folding in place is what
// makes the shared TreeItem animation reach the surface users actually touch.
test("a file explorer folder folds in place instead of rebuilding the tree", async ({
  launchApp,
}) => {
  const { page } = await launchApp();
  await page.waitForSelector(".nav-file-title");

  // Target the seeded mount's folder explicitly — the workspace tree also
  // holds Home, whose collapsed state is not the one under test.
  const childrenHeight = () =>
    page.evaluate(() => {
      const title = document.querySelector('.nav-folder-title[data-path="vault"]');
      const el = title
        ?.closest(".nav-folder")
        ?.querySelector(":scope > .nav-folder-children") as HTMLElement | null;
      return el ? Math.round(el.getBoundingClientRect().height) : -1;
    });

  const openHeight = await childrenHeight();
  expect(openHeight).toBeGreaterThan(0);

  // The boot burst (replica load, mount announces, Welcome render) can hold
  // the main thread; animation progress is wall-clock, so a blocked renderer
  // snaps through the ease. Fold only once frames flow again.
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let last = performance.now();
      let calm = 0;
      const tick = () => {
        const now = performance.now();
        calm = now - last < 30 ? calm + 1 : 0;
        last = now;
        if (calm >= 5) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });

  // The row identity must SURVIVE the fold — that is the structural claim.
  // Heights are sampled per frame IN PAGE: the fold eases over ~140ms, and
  // evaluate round-trips can miss that whole window on a busy renderer.
  const heights = await page.evaluate(async () => {
    const title = document.querySelector('.nav-folder-title[data-path="vault"]') as HTMLElement;
    title.dataset.identityProbe = "kept";
    const samples: number[] = [];
    let sampling = true;
    const sample = () => {
      const el = title
        .closest(".nav-folder")
        ?.querySelector(":scope > .nav-folder-children") as HTMLElement | null;
      samples.push(el ? Math.round(el.getBoundingClientRect().height) : -1);
      if (sampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    title.click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    sampling = false;
    return samples;
  });
  expect(heights.filter((h) => h > 0 && h < openHeight).length).toBeGreaterThan(0);

  await page.waitForTimeout(400);
  expect(await childrenHeight()).toBe(-1);
  expect(
    await page.evaluate(
      () =>
        (document.querySelector('.nav-folder-title[data-path="vault"]') as HTMLElement).dataset
          .identityProbe,
    ),
  ).toBe("kept");
});
