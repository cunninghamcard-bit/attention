import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { Platform } from "@web/platform/Platform";
import { GitCommitView } from "@web/builtin/github/GitCommitView";
import { openCommitDetail } from "@web/builtin/github/open";
import type { CommitDetail } from "@web/builtin/github/types";

const ACTOR = { login: "ada", avatarUrl: "", url: "" };

const COMMIT: CommitDetail = {
  sha: "deadbeef0000000000000000000000000000cafe",
  shortSha: "deadbee",
  headline: "fix: powerline",
  message: "fix: powerline",
  author: ACTOR,
  authorName: "Ada",
  committer: ACTOR,
  committedDate: "2026-07-01T00:00:00Z",
  authoredDate: "2026-07-01T00:00:00Z",
  url: "https://github.com/acme/attention/commit/deadbee",
  parents: [{ sha: "parent00000000000000000000000000000000ff", shortSha: "parent0", url: "" }],
  stats: { additions: 1, deletions: 0, total: 1 },
  files: [],
  verification: null,
  ciState: null,
  checks: [],
};

describe("GitHub commit detail (#5)", () => {
  let root: HTMLElement;

  afterEach(() => {
    root?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  async function boot(): Promise<App> {
    root = document.createElement("div");
    document.body.appendChild(root);
    const app = new App(root);
    await app.ready;
    vi.spyOn(app.github, "getAuth").mockResolvedValue({
      hasToken: true,
      login: "ada",
      avatarUrl: null,
      name: "Ada",
    });
    vi.spyOn(app.github, "getCommit").mockResolvedValue(COMMIT);
    vi.spyOn(app.github, "getCommitDiff").mockResolvedValue("");
    return app;
  }

  async function until(predicate: () => boolean, label: string, ms = 1500): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > ms) throw new Error(`timed out waiting for ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  function parentLink(app: App): HTMLButtonElement {
    const view = app.workspace.getLeavesOfType(GitCommitView.VIEW_TYPE)[0].view as GitCommitView;
    return [...view.contentEl.querySelectorAll(".gh-linkish")].find(
      (el) => el.textContent === "parent0",
    ) as HTMLButtonElement;
  }

  async function openCommit(app: App): Promise<void> {
    await openCommitDetail(app, "acme", "attention", COMMIT.sha);
    await until(() => parentLink(app) !== undefined, "parent link");
  }

  it("sends the commit's Open on GitHub through the shared exit", async () => {
    const app = await boot();
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const windowOpen = vi.fn();
    vi.stubGlobal("electron", { shell: { openExternal } });
    vi.stubGlobal("open", windowOpen);
    await openCommit(app);

    const view = app.workspace.getLeavesOfType(GitCommitView.VIEW_TYPE)[0].view as GitCommitView;
    const open = [...view.contentEl.querySelectorAll(".gh-linkish")].find(
      (el) => el.textContent === "Open on GitHub",
    ) as HTMLButtonElement;
    open.click();

    expect(openExternal).toHaveBeenCalledWith(COMMIT.url);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  // The shared linkButton must keep handing the click event to its callback:
  // this row reads isModEvent, so losing the event would silently downgrade
  // cmd/ctrl-activate into a plain same-leaf walk.
  it("walks its own leaf when a parent sha is activated plainly", async () => {
    const app = await boot();
    await openCommit(app);
    parentLink(app).click();
    await until(
      () =>
        (app.workspace.getLeavesOfType(GitCommitView.VIEW_TYPE)[0].view as GitCommitView).getState()
          .sha === COMMIT.parents[0].sha,
      "same leaf retargeted to parent",
    );
    expect(app.workspace.getLeavesOfType(GitCommitView.VIEW_TYPE)).toHaveLength(1);
  });

  it("forks a second tab from a modified parent sha activation", async () => {
    const app = await boot();
    await openCommit(app);
    parentLink(app).dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        [Platform.isMacOS ? "metaKey" : "ctrlKey"]: true,
      }),
    );
    await until(
      () => app.workspace.getLeavesOfType(GitCommitView.VIEW_TYPE).length === 2,
      "second commit tab",
    );
  });
});
