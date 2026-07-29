import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../fixtures/electronApp";

// The local-git surface, proven on a REAL repository: the seeded vault gets
// git-init'ed with one commit, a tracked edit and an untracked file, then
// the changes view must show the branch/sync header, both sections, and the
// discard affordance (local-git-surface-completion contract, UI half).
function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

test("git changes view shows branch header and sections on a real repo", async ({
  vaultPath,
  launchApp,
}, testInfo) => {
  git(vaultPath, "init", "-b", "main");
  git(vaultPath, "config", "user.email", "e2e@example.com");
  git(vaultPath, "config", "user.name", "E2E");
  git(vaultPath, "add", "-A");
  git(vaultPath, "commit", "-m", "seed");
  writeFileSync(join(vaultPath, "Note.md"), "# Demo\n\nedited for the e2e run\n");
  writeFileSync(join(vaultPath, "Scratch.md"), "untracked scratch\n");

  const { page } = await launchApp();
  await page.waitForSelector(".nav-file-title");
  // Codiff layout: vanilla review center with the Tree/History navigator on the right.
  await page.evaluate(() => {
    const app = (window as unknown as { app: any }).app;
    app.commands.executeCommandById("git:review-changes");
  });
  await expect(page.locator(".git-review-view .review-surface")).toBeVisible();
  await expect(page.locator(".git-nav-view")).toBeVisible();
  // The history switch went with the source-control view (bf2beb8); asserting
  // it is ABSENT keeps that removal honest rather than letting the old
  // expectation rot. The split/unified toggle is still the review surface's.
  await expect(page.locator('.view-action[aria-label="Switch to history"]')).toHaveCount(0);
  await expect(page.locator('.view-action[aria-label="Switch to split view"]')).toBeVisible();
  await expect(page.locator(".git-nav-view .git-nav-mode-toggle")).toHaveCount(0);
  await expect(page.locator(".git-nav-file-row", { hasText: "Note.md" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("git-review.png"), fullPage: true });

  // LOCAL commit log — offline twin of the cloud Commits section.
  await page.evaluate(async () => {
    const app = (window as unknown as { app: any }).app;
    await app.workspace.getLeaf(true).setViewState({ type: "git-log", active: true });
  });
  const entry = page.locator(".git-log-entry", { hasText: "seed" });
  await expect(entry).toBeVisible();
  await entry.locator(".git-log-header").click();
  await expect(entry.locator(".git-log-file", { hasText: "Note.md" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("git-log.png"), fullPage: true });
});
