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
  await page.evaluate(async () => {
    const app = (window as unknown as { app: any }).app;
    await app.workspace.getLeaf(true).setViewState({ type: "git-changes", active: true });
  });

  const header = page.locator(".git-header-row");
  await expect(header).toBeVisible();
  await expect(header.locator(".git-branch-pill")).toContainText("main");
  await expect(header.locator(".git-sync-button")).toHaveCount(3);

  await expect(page.locator(".git-changes-section", { hasText: "Changes" })).toBeVisible();
  await expect(page.locator(".git-changes-file-name", { hasText: "Note.md" })).toBeVisible();
  await expect(page.locator(".git-changes-file-name", { hasText: "Scratch.md" })).toBeVisible();
  await expect(page.locator(".git-changes-discard").first()).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("git-changes.png"), fullPage: true });
});
