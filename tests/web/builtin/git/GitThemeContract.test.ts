import { describe, expect, it } from "vitest";

const fileSystemSpecifier = "node:fs";

describe("local Git theme contract", () => {
  it("bridges Obsidian theme tokens into git diff hosts", async () => {
    const source = await readProjectFile("src/renderer/styles/product/git-review.css");

    for (const selector of [
      ".git-review-view diffs-container",
      ".git-changes-view diffs-container",
      ".git-log-view diffs-container",
    ]) {
      expect(source).toContain(selector);
    }
    for (const declaration of [
      "--diffs-light-bg: var(--background-primary)",
      "--diffs-dark-bg: var(--background-primary)",
      "--diffs-light: var(--text-normal)",
      "--diffs-dark: var(--text-normal)",
      "--diffs-bg-context-gutter-override: var(--background-secondary)",
      "--diffs-fg-number-override: var(--text-faint)",
      "--diffs-addition-color: var(--color-green)",
      "--diffs-deletion-color: var(--color-red)",
      "--diffs-font-family: var(--font-monospace)",
      "--diffs-header-font-family: var(--font-interface)",
    ]) {
      expect(source).toContain(declaration);
    }
  });

  it("keeps local git chrome free of literal palette colors", async () => {
    const source = (
      await Promise.all([
        readProjectFile("src/renderer/styles/product/git-changes.css"),
        readProjectFile("src/renderer/styles/product/git-review.css"),
      ])
    ).join("\n");

    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(source).not.toMatch(/primary theme/i);
  });

  it("refreshes mounted file diffs on css-change", async () => {
    for (const path of [
      "src/renderer/builtin/git/GitChangesView.ts",
      "src/renderer/builtin/git/GitLogView.ts",
    ]) {
      const source = await readProjectFile(path);
      expect(source).toContain('workspace.on("css-change"');
      expect(source).toContain("diff.setThemeType(themeType)");
    }
  });

  it("contains Git styling to native primitives", async () => {
    const [changes, history, log, nav, review, changeStyles, reviewStyles] = await Promise.all([
      readProjectFile("src/renderer/builtin/git/GitChangesView.ts"),
      readProjectFile("src/renderer/builtin/git/GitHistoryView.ts"),
      readProjectFile("src/renderer/builtin/git/GitLogView.ts"),
      readProjectFile("src/renderer/builtin/git/review/GitNavView.ts"),
      readProjectFile("src/renderer/builtin/git/review/ReviewSurface.ts"),
      readProjectFile("src/renderer/styles/product/git-changes.css"),
      readProjectFile("src/renderer/styles/product/git-review.css"),
    ]);

    expect(changes).toContain("tree-item-self nav-file-title tappable is-clickable");
    expect(history).toContain("tree-item-self git-history-row");
    expect(log).toContain("tree-item-self nav-folder-title tappable is-clickable");
    expect(log).toContain("tree-item-self nav-file-title tappable is-clickable");
    expect(nav).toContain("tree-item-self nav-folder-title tappable is-clickable");
    expect(nav).toContain("tree-item-self nav-file-title tappable is-clickable");
    expect(nav).toContain("tree-item-self git-nav-history-entry is-clickable");
    expect(nav).not.toContain("style.paddingLeft");
    expect(review).toContain("tree-item-self review-card-header is-clickable");
    expect(review).toContain("new SearchComponent(searchRow)");
    expect(review).toContain("tree-item-self nav-file-title tappable is-clickable review-file-row");
    expect(review).toContain("clickable-icon review-viewed");
    expect(review).not.toContain("review-status-dot");
    expect(changeStyles).not.toMatch(
      /\.git-(changes-file|history-entry|log-entry)\s*\{[^}]*border/s,
    );
    for (const selector of [
      ".git-nav .git-nav-folder-row",
      ".git-nav .git-nav-file-row",
      ".git-nav .git-nav-history-entry",
      ".review-card-header {",
      ".review-sidebar .review-file-row",
      ".review-status-dot",
      ".review-commit-",
    ]) {
      expect(reviewStyles).not.toContain(selector);
    }
  });
});

async function readProjectFile(path: string): Promise<string> {
  const fs = (await import(fileSystemSpecifier)) as {
    readFileSync(path: string, encoding: "utf8"): string;
  };
  return fs.readFileSync(path, "utf8");
}
