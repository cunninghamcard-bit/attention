import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { GitHubDetailView } from "@web/builtin/github/GitHubDetailView";
import { GitHubRepoView } from "@web/builtin/github/GitHubRepoView";
import { openGitHubDetail, openRepo } from "@web/builtin/github/open";
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

  it("sends the milestone link through the shared system-browser exit", () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("electron", { shell: { openExternal } });
    const host = document.createElement("div");
    renderMetaStrip(host, { milestone: ISSUE.milestone });
    const link = host.querySelector(".github-meta-milestone") as HTMLAnchorElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(openExternal).toHaveBeenCalledWith(ISSUE.milestone!.url);
    // A bare target=_blank would let the anchor navigate itself, bypassing the
    // one exit every other GitHub link uses.
    expect(event.defaultPrevented).toBe(true);
    expect(link.getAttribute("target")).toBeNull();
  });

  it("creates an issue from the repo Issues section and opens the new issue", async () => {
    const app = await boot();
    vi.spyOn(app.github, "listIssues").mockResolvedValue([]);
    const create = vi
      .spyOn(app.github, "createIssue")
      .mockResolvedValue({ number: 99, url: "https://github.com/acme/attention/issues/99" });
    const created: IssueDetail = { ...ISSUE, number: 99, title: "Created from modal" };
    const getIssue = vi.spyOn(app.github, "getIssue").mockResolvedValue(created);

    await openRepo(app, "acme", "attention", "issues");
    const repoView = app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0]
      ?.view as GitHubRepoView;
    await until(
      () => repoView.contentEl.querySelector(".github-new-issue") !== null,
      "New issue button",
    );
    (repoView.contentEl.querySelector(".github-new-issue") as HTMLButtonElement).click();

    await until(
      () => document.querySelector(".github-create-issue-title") !== null,
      "create issue modal",
    );
    const title = document.querySelector(".github-create-issue-title") as HTMLInputElement;
    const body = document.querySelector(".github-create-issue-body") as HTMLTextAreaElement;
    title.value = "Created from modal";
    title.dispatchEvent(new Event("input"));
    body.value = "Reported by the reviewer";
    body.dispatchEvent(new Event("input"));
    const submit = [...document.querySelectorAll(".github-create-issue-actions button")].find(
      (el) => (el.textContent ?? "").includes("Create issue"),
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    submit.click();

    await until(() => create.mock.calls.length > 0, "createIssue call");
    expect(create).toHaveBeenCalledWith(
      { title: "Created from modal", body: "Reported by the reviewer" },
      { owner: "acme", repo: "attention", host: "github.com" },
    );

    await until(
      () => app.workspace.getLeavesOfType(GitHubDetailView.VIEW_TYPE).length > 0,
      "new issue detail leaf",
    );
    await until(() => getIssue.mock.calls.length > 0, "detail load");
    expect(getIssue).toHaveBeenCalledWith(99, {
      owner: "acme",
      repo: "attention",
      host: "github.com",
    });
  });
});
