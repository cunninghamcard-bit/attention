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
});

async function readProjectFile(path: string): Promise<string> {
  const fs = (await import(fileSystemSpecifier)) as {
    readFileSync(path: string, encoding: "utf8"): string;
  };
  return fs.readFileSync(path, "utf8");
}
