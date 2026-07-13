import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import type { ElectronGitApi, GitExecResult, GitLogEntry } from "@web/builtin/git/GitService";
import { GitNavView, openGitNav } from "@web/builtin/git/review/GitNavView";
import type { ReviewFileSummary } from "@web/builtin/git/reviewSession";

const FILES: ReviewFileSummary[] = [
  { path: "src/a.ts", status: "modified", additions: 1, deletions: 2 },
  { path: "src/lib/b.ts", status: "modified", additions: 2, deletions: 0 },
];

function fakeBridge(): ElectronGitApi {
  return {
    available: true,
    async exec(args: string[]): Promise<GitExecResult> {
      if (args[0] === "log") {
        return {
          code: 0,
          stdout: "aaa\x1faaa\x1fAda\x1f2026-07-13T00:00:00Z\x1fseed\n",
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

async function createApp(): Promise<App> {
  const app = new App(document.createElement("div"));
  app.git.bridgeFactory = () => fakeBridge();
  (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/fake/vault";
  await app.ready;
  return app;
}

async function openNav(app: App): Promise<GitNavView> {
  await openGitNav(app);
  return app.workspace.getLeavesOfType(GitNavView.VIEW_TYPE)[0].view as GitNavView;
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > 3000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

afterEach(() => vi.restoreAllMocks());

describe("GitNavView", () => {
  it("has no in-sidebar mode toggle (it lives in the center)", async () => {
    const view = await openNav(await createApp());
    expect(view.contentEl.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(view.contentEl.querySelector(".git-nav-header")).toBeNull();
    expect(view.contentEl.textContent).not.toMatch(/Walkthrough/i);
    expect(view.contentEl.querySelector(".git-nav-search.search-input-container")).not.toBeNull();
    expect(
      view.contentEl.querySelector(".git-nav-search .search-input-clear-button"),
    ).not.toBeNull();
  });

  it("selecting a history commit sets commit source", async () => {
    const app = await createApp();
    const nav = await openNav(app);
    app.git.reviewSession.setMode("history");
    await until(
      () => nav.contentEl.querySelectorAll(".git-nav-history-entry").length >= 2,
      "history rows",
    );
    const rows = [...nav.contentEl.querySelectorAll<HTMLButtonElement>(".git-nav-history-entry")];
    const workingTree = rows.find((row) => row.textContent?.includes("Uncommitted changes"));
    const commit = rows.find((row) => row.textContent?.includes("seed"));
    expect(commit?.querySelector(".git-nav-history-meta")?.children).toHaveLength(2);
    commit?.click();
    expect(app.git.reviewSession.source).toMatchObject({ kind: "commit", ref: "aaa" });
    workingTree?.click();
    expect(app.git.reviewSession.source).toEqual({ kind: "working-tree" });
  });

  it("selecting a tree path requests center scroll", async () => {
    const app = await createApp();
    app.git.reviewSession.publishFiles(FILES);
    const nav = await openNav(app);
    const file = [...nav.contentEl.querySelectorAll<HTMLButtonElement>(".git-nav-file-row")].find(
      (row) => row.textContent?.includes("a.ts"),
    );
    file?.click();
    file?.click();
    expect(app.git.reviewSession.selectedPath).toBe("src/a.ts");
    expect(app.git.reviewSession.pathActivationSeq).toBe(2);
  });

  it("keeps the tree free of selection controls", async () => {
    const app = await createApp();
    app.git.reviewSession.publishFiles(FILES);
    const nav = await openNav(app);
    expect(nav.contentEl.querySelectorAll(".git-nav-file-row")).toHaveLength(2);
    expect(nav.contentEl.querySelectorAll('.git-nav-tree input[type="checkbox"]')).toHaveLength(0);
    expect(nav.contentEl.querySelectorAll(".git-nav-tree .git-check")).toHaveLength(0);
    expect(nav.contentEl.querySelector(".git-nav-commit-open")).toBeNull();
  });

  it("shows icon stats and git status without a status dot", async () => {
    const app = await createApp();
    app.git.reviewSession.publishFiles(FILES);
    const nav = await openNav(app);
    const icon = nav.contentEl.querySelector(
      '[data-path="src/a.ts"] .git-nav-file-icon',
    ) as HTMLElement;
    expect(icon?.dataset.iconToken).toBe("typescript");
    expect(icon?.querySelector("svg")?.dataset.iconToken).toBe("typescript");
    const row = nav.contentEl.querySelector('[data-path="src/a.ts"]') as HTMLElement;
    expect(row.querySelector(".git-nav-file-stat")?.textContent).toBe("+1−2");
    expect(row.querySelector(".git-nav-file-status")?.textContent).toBe("M");
    expect(row.querySelector(".git-nav-status-dot")).toBeNull();
  });

  it("updates tree selection without rebuilding rows", async () => {
    const app = await createApp();
    app.git.reviewSession.publishFiles(FILES);
    const nav = await openNav(app);
    const row = nav.contentEl.querySelector('[data-path="src/a.ts"]') as HTMLElement;
    app.git.reviewSession.selectPath("src/a.ts");
    expect(nav.contentEl.contains(row)).toBe(true);
    expect(row.classList).toContain("is-selected");
    app.git.reviewSession.selectPath("src/lib/b.ts");
    expect(nav.contentEl.contains(row)).toBe(true);
    expect(row.classList).not.toContain("is-selected");
  });

  it("mutes viewed files in the nav tree", async () => {
    const app = await createApp();
    app.git.reviewSession.publishFiles(FILES);
    const nav = await openNav(app);
    app.git.reviewSession.publishViewed(["src/a.ts"]);
    expect(nav.contentEl.querySelector('[data-path="src/a.ts"]')?.classList).toContain("is-viewed");
    expect(nav.contentEl.querySelector('[data-path="src/lib/b.ts"]')?.classList).not.toContain(
      "is-viewed",
    );
  });

  it("formats history dates relatively", async () => {
    const now = Date.parse("2026-07-13T12:00:00Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const app = await createApp();
    vi.spyOn(app.git, "log").mockResolvedValue([
      {
        hash: "aaa",
        shortHash: "aaa",
        author: "Ada",
        date: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
        subject: "seed",
      },
    ]);
    const nav = await openNav(app);
    app.git.reviewSession.setMode("history");
    await until(
      () => nav.contentEl.querySelector(".git-nav-history-entry.with-metadata") !== null,
      "commit history row",
    );
    expect(
      nav.contentEl.querySelector(".git-nav-history-meta")?.lastElementChild?.textContent,
    ).toBe("2h ago");
  });

  it("suppresses history load-more while filtering", async () => {
    const app = await createApp();
    const entries: GitLogEntry[] = Array.from({ length: 50 }, (_, index) => ({
      hash: `hash-${index}`,
      shortHash: `h${index}`,
      author: "Ada",
      date: "2026-07-13T00:00:00Z",
      subject: `commit ${index}`,
    }));
    const log = vi.spyOn(app.git, "log").mockResolvedValue(entries);
    const nav = await openNav(app);
    app.git.reviewSession.setMode("history");
    await until(() => !nav.contentEl.textContent?.includes("Loading history…"), "history load");
    expect(log).toHaveBeenCalledTimes(1);

    const filter = nav.contentEl.querySelector(".git-nav-search input") as HTMLInputElement;
    filter.value = "commit";
    filter.dispatchEvent(new Event("input", { bubbles: true }));
    nav.contentEl.querySelector(".git-nav-history")?.dispatchEvent(new Event("scroll"));
    await Promise.resolve();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("opens the review center when activating from the nav", async () => {
    const app = await createApp();
    const nav = await openNav(app);
    app.git.reviewSession.publishFiles(FILES);
    await until(
      () => nav.contentEl.querySelectorAll(".git-nav-file-row").length === 2,
      "tree rows",
    );
    expect(app.workspace.getLeavesOfType("git-review")).toHaveLength(0);
    nav.contentEl.querySelector<HTMLButtonElement>(".git-nav-file-row")?.click();
    await until(
      () => app.workspace.getLeavesOfType("git-review").length === 1,
      "review center leaf",
    );
    expect(app.workspace.getLeavesOfType("git-review")).toHaveLength(1);
  });
});
