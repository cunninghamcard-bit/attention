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
