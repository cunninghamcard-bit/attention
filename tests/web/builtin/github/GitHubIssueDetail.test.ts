import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { GitHubDetailView } from "@web/builtin/github/GitHubDetailView";
import { openGitHubDetail } from "@web/builtin/github/open";
import type { IssueDetail } from "@web/builtin/github/types";
import { renderMetaStrip } from "@web/builtin/github/widgets";

const ACTOR = { login: "ada", avatarUrl: "", url: "" };

const ISSUE: IssueDetail = {
  number: 42,
  title: "Wire issue meta strip",
  state: "open",
  author: ACTOR,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-02T00:00:00Z",
  url: "https://github.com/acme/attention/issues/42",
  labels: [
    { name: "bug", color: "d73a4a", description: "Something broken" },
    { name: "ux", color: "0e8a16", description: null },
  ],
  comments: 1,
  isPullRequest: false,
  body: "Body text",
  assignees: [{ login: "bob", avatarUrl: "", url: "" }],
  milestone: { title: "v1", url: "https://github.com/acme/attention/milestone/1" },
  commentsList: [
    {
      id: "1",
      author: ACTOR,
      body: "Looks good",
      createdAt: "2026-07-02T01:00:00Z",
      updatedAt: "2026-07-02T01:00:00Z",
      url: "",
    },
  ],
  closedAt: null,
};

describe("GitHub issue detail (#5)", () => {
  let root: HTMLElement;

  afterEach(() => {
    root?.remove();
    vi.restoreAllMocks();
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
    vi.spyOn(app.github, "resolveRepository").mockResolvedValue({
      owner: "acme",
      repo: "attention",
      host: "github.com",
    });
    return app;
  }

  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function until(predicate: () => boolean, label: string, ms = 1500): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > ms) throw new Error(`timed out waiting for ${label}`);
      await settle();
    }
  }

  it("renders labels, assignees and milestone from issue detail", async () => {
    const app = await boot();
    vi.spyOn(app.github, "getIssue").mockResolvedValue(ISSUE);
    await openGitHubDetail(app, {
      kind: "issue",
      number: 42,
      owner: "acme",
      repo: "attention",
    });
    const view = app.workspace.getLeavesOfType(GitHubDetailView.VIEW_TYPE)[0]
      ?.view as GitHubDetailView;
    await until(() => view.contentEl.querySelector(".github-meta-strip") !== null, "meta strip");
    const text = view.contentEl.textContent ?? "";
    expect(text).toContain("bug");
    expect(text).toContain("ux");
    expect(text).toContain("bob");
    expect(text).toContain("v1");
    expect(text).toContain("Close issue");
  });

  it("closes an issue through updateIssueState and reloads", async () => {
    const app = await boot();
    const closed: IssueDetail = {
      ...ISSUE,
      state: "closed",
      closedAt: "2026-07-03T00:00:00Z",
    };
    const getIssue = vi
      .spyOn(app.github, "getIssue")
      .mockResolvedValueOnce(ISSUE)
      .mockResolvedValueOnce(closed);
    const update = vi.spyOn(app.github, "updateIssueState").mockResolvedValue(null);
    await openGitHubDetail(app, {
      kind: "issue",
      number: 42,
      owner: "acme",
      repo: "attention",
    });
    const view = app.workspace.getLeavesOfType(GitHubDetailView.VIEW_TYPE)[0]
      ?.view as GitHubDetailView;
    await until(() => (view.contentEl.textContent ?? "").includes("Close issue"), "close button");
    const button = [...view.contentEl.querySelectorAll("button")].find((el) =>
      (el.textContent ?? "").includes("Close issue"),
    ) as HTMLButtonElement;
    button.click();
    await until(() => (view.contentEl.textContent ?? "").includes("Reopen issue"), "reopened UI");
    expect(update).toHaveBeenCalledWith(42, "closed", {
      owner: "acme",
      repo: "attention",
      host: "github.com",
    });
    expect(getIssue).toHaveBeenCalledTimes(2);
  });

  it("renderMetaStrip is a no-op when there is no meta", () => {
    const host = document.createElement("div");
    expect(renderMetaStrip(host, {})).toBeNull();
    expect(host.childElementCount).toBe(0);
  });
});
