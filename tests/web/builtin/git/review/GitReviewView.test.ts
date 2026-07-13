import { describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import type { ElectronGitApi, GitExecResult } from "@web/builtin/git/GitService";

interface FakeCodeViewHandle {
  scrollCalls: Array<{ id: string }>;
  themeTypes: string[];
  emitScroll(scrollTop: number, tops: Record<string, number>): void;
}

const codeViews = vi.hoisted(() => [] as FakeCodeViewHandle[]);

vi.mock("@pierre/diffs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pierre/diffs")>();
  type Item = { id: string; annotations?: unknown[]; fileDiff?: unknown };
  type Options = {
    themeType?: string;
    renderCustomHeader?: (metadata: unknown, context: { item: Item }) => Element | null;
    renderGutterUtility?: (
      getLine: () => { lineNumber: number; side: "additions" },
      context: { item: Item },
    ) => Element | null;
    renderAnnotation?: (annotation: unknown, context: { item: Item }) => Element | undefined;
  };
  class FakeCodeView implements FakeCodeViewHandle {
    scrollCalls: Array<{ id: string }> = [];
    themeTypes: string[] = [];
    private root: HTMLElement | null = null;
    private items: Item[] = [];
    private options: Options;
    private scrollTop = 0;
    private tops: Record<string, number> = {};
    private listener: ((scrollTop: number, viewer: FakeCodeView) => void) | null = null;

    constructor(options: Options = {}) {
      this.options = options;
      if (options.themeType) this.themeTypes.push(options.themeType);
      codeViews.push(this);
    }

    setup(root: HTMLElement): void {
      this.root = root;
    }

    setOptions(options: Options): void {
      this.options = options;
      if (options.themeType) this.themeTypes.push(options.themeType);
    }

    setItems(items: Item[]): void {
      this.items = items;
    }

    render(): void {
      if (!this.root) return;
      this.root.empty();
      for (const item of this.items) {
        const card = document.createElement("div");
        card.dataset.item = item.id;
        const context = { item };
        const header = this.options.renderCustomHeader?.(item.fileDiff, context);
        if (header) card.append(header);
        const gutter = document.createElement("div");
        gutter.dataset.gutter = item.id;
        const utility = this.options.renderGutterUtility?.(
          () => ({ lineNumber: 5, side: "additions" }),
          context,
        );
        if (utility) gutter.append(utility);
        card.append(gutter);
        for (const annotation of item.annotations ?? []) {
          const element = this.options.renderAnnotation?.(annotation, context);
          if (element) card.append(element);
        }
        this.root.append(card);
      }
    }

    scrollTo(target: { id: string }): void {
      this.scrollCalls.push(target);
    }

    subscribeToScroll(listener: (scrollTop: number, viewer: FakeCodeView) => void): () => void {
      this.listener = listener;
      return () => (this.listener = null);
    }

    getScrollTop(): number {
      return this.scrollTop;
    }

    getTopForItem(id: string): number | undefined {
      return this.tops[id];
    }

    emitScroll(scrollTop: number, tops: Record<string, number>): void {
      this.scrollTop = scrollTop;
      this.tops = tops;
      this.listener?.(scrollTop, this);
    }

    cleanUp(): void {
      this.root?.empty();
    }
  }
  return { ...actual, CodeView: FakeCodeView };
});

import { GitReviewView, openGitReview } from "@web/builtin/git/review/GitReviewView";
import { readViewed } from "@web/builtin/git/review/reviewModel";

function fakeBridge(options: { numstat?: string } = {}): ElectronGitApi & {
  calls: string[][];
  available: boolean;
} {
  const calls: string[][] = [];
  return {
    available: true,
    calls,
    async exec(args: string[]): Promise<GitExecResult> {
      calls.push(args);
      if (args[0] === "rev-parse") return { code: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "status")
        return { code: 0, stdout: " M agent.ts\n?? notes.md\n", stderr: "" };
      if (args[0] === "diff" && args.includes("--numstat"))
        return { code: 0, stdout: options.numstat ?? "3\t1\tagent.ts\n", stderr: "" };
      if (args[0] === "show" && args[1] === "HEAD:agent.ts")
        return { code: 0, stdout: "line one\nline two\n", stderr: "" };
      if (args[0] === "show") return { code: 128, stdout: "", stderr: "fatal: bad object" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

async function reviewApp(options: { numstat?: string } = {}): Promise<{
  app: App;
  bridge: ReturnType<typeof fakeBridge>;
}> {
  const app = new App(document.createElement("div"));
  const bridge = fakeBridge(options);
  app.git.bridgeFactory = () => bridge;
  (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/fake/vault";
  await app.ready;
  await app.vault.create("agent.ts", "line one\nline CHANGED\n");
  await app.vault.create("notes.md", "brand new\n");
  return { app, bridge };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > 3000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("GitReviewView", () => {
  it("opens git-nav on the right beside git-review", async () => {
    const { app } = await reviewApp();
    await openGitReview(app);
    const review = app.workspace.getLeavesOfType(GitReviewView.VIEW_TYPE)[0];
    const nav = app.workspace.getLeavesOfType("git-nav")[0];
    expect(review).toBeTruthy();
    expect(nav.getRoot()).toBe(app.workspace.rightSplit);
  });

  it("offers only Tree and History modes", async () => {
    const { app } = await reviewApp();
    await openGitReview(app);
    const view = app.workspace.getLeavesOfType(GitReviewView.VIEW_TYPE)[0].view as GitReviewView;
    const nav = view.actionsEl.querySelector(
      '[aria-label="Switch to history"]',
    ) as HTMLButtonElement;
    expect(app.git.reviewSession.mode).toBe("tree");
    nav.click();
    expect(app.git.reviewSession.mode).toBe("history");
    expect(view.contentEl.textContent).not.toMatch(/Walkthrough/i);
  });

  it("keeps the local review view only", async () => {
    const { app } = await reviewApp();
    await openGitReview(app);
    const view = app.workspace.getLeavesOfType(GitReviewView.VIEW_TYPE)[0].view as GitReviewView;
    await until(() => view.contentEl.querySelectorAll(".review-card-header").length === 2, "cards");
    expect(view.contentEl.querySelector(".review-card-actions .review-card-action")).toBeNull();
    expect(view.contentEl.textContent).not.toMatch(/\b(Open|Edit)\b/);
    expect(view.contentEl.querySelector(".review-add-comment")).toBeNull();
  });

  it("puts both mode switches in the leaf header", async () => {
    const { app } = await reviewApp();
    await openGitReview(app);
    const view = app.workspace.getLeavesOfType(GitReviewView.VIEW_TYPE)[0].view as GitReviewView;
    const labels = [...view.actionsEl.querySelectorAll(".view-action")].map((el) =>
      el.getAttribute("aria-label"),
    );
    expect(labels).toContain("Switch to history");
    expect(labels).toContain("Switch to split view");
    // The surface renders no internal toolbar when the header owns controls.
    expect(view.contentEl.querySelector(".review-toolbar-toggle")).toBeNull();
  });

  it("uses the vanilla code view core in the review surface", async () => {
    codeViews.length = 0;
    const { app } = await reviewApp();
    await openGitReview(app);
    const view = app.workspace.getLeavesOfType(GitReviewView.VIEW_TYPE)[0].view as GitReviewView;
    await until(() => view.contentEl.querySelectorAll("[data-item]").length === 2, "diff cards");

    expect(codeViews).toHaveLength(1);
    expect(view.contentEl.querySelector(".review-surface.is-nav-external")).not.toBeNull();
    expect(app.workspace.getLeavesOfType("git-nav")[0].getRoot()).toBe(app.workspace.rightSplit);
  });

  it("refreshes mounted review diffs when the theme changes", async () => {
    codeViews.length = 0;
    const { app } = await reviewApp();
    app.appearance.setBaseTheme("obsidian");
    await openGitReview(app);
    await until(() => codeViews.length === 1, "code view");

    const mounted = codeViews[0];
    expect(mounted.themeTypes.at(-1)).toBe("dark");
    app.appearance.setBaseTheme("moonstone");

    expect(codeViews[0]).toBe(mounted);
    expect(mounted.themeTypes.at(-1)).toBe("light");
  });

  it("keeps file paths on center diff cards", async () => {
    const { app } = await reviewApp();
    await openGitReview(app);
    const view = app.workspace.getLeavesOfType(GitReviewView.VIEW_TYPE)[0].view as GitReviewView;
    await until(() => view.contentEl.querySelectorAll(".review-card-path").length === 2, "paths");
    expect(
      [...view.contentEl.querySelectorAll(".review-card-path")].map((el) => el.textContent),
    ).toEqual(["agent.ts", "notes.md"]);
  });

  it("updates nav selection while scrolling the code view", async () => {
    codeViews.length = 0;
    const { app } = await reviewApp();
    await openGitReview(app);
    await until(() => codeViews.length === 1, "code view");
    codeViews[0].emitScroll(100, { "agent.ts": 0, "notes.md": 100 });
    expect(app.git.reviewSession.selectedPath).toBe("notes.md");
  });

  it("re-selecting the active file scrolls the code view again", async () => {
    codeViews.length = 0;
    const { app } = await reviewApp();
    await openGitReview(app);
    await until(() => codeViews.length === 1, "code view");
    codeViews[0].scrollCalls.length = 0;
    app.git.reviewSession.activatePath("agent.ts");
    app.git.reviewSession.activatePath("agent.ts");
    expect(codeViews[0].scrollCalls.map((call) => call.id)).toEqual(["agent.ts", "agent.ts"]);
  });

  it("clears nav files when the review is blocked", async () => {
    const { app, bridge } = await reviewApp();
    app.git.reviewSession.publishFiles([
      { path: "stale.ts", status: "modified", additions: 1, deletions: 0 },
    ]);
    bridge.available = false;
    await openGitReview(app);
    await until(() => app.git.reviewSession.files.length === 0, "nav clear");
    expect(app.git.reviewSession.selectedPath).toBeNull();
  });

  it("falls back to symmetric line counts", async () => {
    const { app } = await reviewApp({ numstat: "" });
    await openGitReview(app);
    await until(() => app.git.reviewSession.files.length === 2, "file summaries");
    expect(app.git.reviewSession.files.find((file) => file.path === "agent.ts")).toMatchObject({
      additions: 2,
      deletions: 2,
    });
  });

  it("publishes viewed files to the nav and persists their fingerprint", async () => {
    const { app } = await reviewApp();
    await openGitReview(app);
    const view = app.workspace.getLeavesOfType(GitReviewView.VIEW_TYPE)[0].view as GitReviewView;
    await until(
      () => view.contentEl.querySelectorAll(".review-viewed .git-check").length === 2,
      "viewed controls",
    );
    (view.contentEl.querySelector(".review-viewed") as HTMLButtonElement).click();
    await until(() => app.git.reviewSession.viewedPaths.has("agent.ts"), "viewed publication");
    expect(Object.keys(readViewed("/fake/vault"))).toEqual(["agent.ts"]);
  });

  it("loads review file contents concurrently", async () => {
    const pending: Array<() => void> = [];
    let showsInFlight = 0;
    const bridge: ElectronGitApi = {
      available: true,
      async exec(args: string[]): Promise<GitExecResult> {
        if (args[0] === "rev-parse") return { code: 0, stdout: "true\n", stderr: "" };
        if (args[0] === "status") return { code: 0, stdout: " M a.md\n M b.md\n", stderr: "" };
        if (args[0] === "diff" && args.includes("--numstat"))
          return { code: 0, stdout: "1\t0\ta.md\n1\t0\tb.md\n", stderr: "" };
        if (args[0] === "show") {
          showsInFlight += 1;
          await new Promise<void>((resolve) => pending.push(resolve));
          return { code: 0, stdout: "old\n", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const app = new App(document.createElement("div"));
    app.git.bridgeFactory = () => bridge;
    (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/fake/vault";
    await app.ready;
    await app.vault.create("a.md", "new\n");
    await app.vault.create("b.md", "new\n");
    void app.workspace.getLeaf(true).setViewState({ type: "git-review", active: true });
    await until(() => showsInFlight === 2, "both HEAD reads issued before any resolve");
    expect(pending).toHaveLength(2);
    for (const release of pending) release();
  });
});
