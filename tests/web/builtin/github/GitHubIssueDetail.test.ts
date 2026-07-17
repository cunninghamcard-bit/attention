import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { GitHubDetailView } from "@web/builtin/github/GitHubDetailView";
import { GitHubRepoView } from "@web/builtin/github/GitHubRepoView";
import { openGitHubDetail, openRepo } from "@web/builtin/github/open";
import type { IssueDetail } from "@web/builtin/github/types";
import { renderMetaStrip } from "@web/builtin/github/widgets";
import { getFileTypeInfo } from "@web/ui/FileTypeIcon";

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
  timeline: [
    {
      kind: "comment",
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

  it("carries the state chip, number and created/updated meta in the header", async () => {
    const app = await boot();
    vi.spyOn(app.github, "getIssue").mockResolvedValue(ISSUE);
    await openGitHubDetail(app, { kind: "issue", number: 42, owner: "acme", repo: "attention" });
    const view = app.workspace.getLeavesOfType(GitHubDetailView.VIEW_TYPE)[0]
      ?.view as GitHubDetailView;
    await until(() => view.contentEl.querySelector(".gh-detail-head") !== null, "header");

    const head = view.contentEl.querySelector(".gh-detail-head") as HTMLElement;
    expect(head.querySelector(".gh-chip")!.textContent).toBe("open");
    expect(head.textContent).toContain("#42");
    // The contract asks for both dates, not just the opening one.
    expect(head.textContent).toContain("opened");
    expect(head.textContent).toContain("updated");
  });

  it("renders assignees, labels, milestone and participants in the meta column", async () => {
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
    await until(() => view.contentEl.querySelector(".gh-issue-meta") !== null, "meta column");
    const column = view.contentEl.querySelector(".gh-issue-meta")!.textContent ?? "";
    expect(column).toContain("Assignees");
    expect(column).toContain("bob");
    expect(column).toContain("Labels");
    expect(column).toContain("bug");
    expect(column).toContain("ux");
    expect(column).toContain("Milestone");
    expect(column).toContain("v1");
    expect(column).toContain("Participants");
    expect(view.contentEl.querySelector(".github-meta-strip")).toBeNull();
    // Close/Reopen is a header action (owner's round-5 call), so the column
    // carries meta only.
    expect(column).not.toContain("Close issue");
  });

  it("derives participants from the author and the people who commented", async () => {
    const app = await boot();
    // grace comments first and ada (the author) comments after, so the author
    // can only lead this list by being seeded — not by falling out of the
    // comment order. ada commenting twice must not double her.
    vi.spyOn(app.github, "getIssue").mockResolvedValue({
      ...ISSUE,
      timeline: [
        {
          kind: "comment",
          id: "c1",
          author: { login: "grace", avatarUrl: "", url: "" },
          body: "first",
          createdAt: "2026-07-02T00:10:00Z",
          updatedAt: "",
          url: "",
        },
        ISSUE.timeline[0],
        {
          kind: "comment",
          id: "c3",
          author: ACTOR,
          body: "again",
          createdAt: "2026-07-02T02:00:00Z",
          updatedAt: "",
          url: "",
        },
      ],
    });
    await openGitHubDetail(app, { kind: "issue", number: 42, owner: "acme", repo: "attention" });
    const view = app.workspace.getLeavesOfType(GitHubDetailView.VIEW_TYPE)[0]
      ?.view as GitHubDetailView;
    await until(() => view.contentEl.querySelector(".gh-issue-meta") !== null, "meta column");

    const logins = [...view.contentEl.querySelectorAll(".gh-meta-section")]
      .find((s) => (s.textContent ?? "").startsWith("Participants"))!
      .querySelectorAll(".github-meta-person-login");
    // Author first, then commenters, each once. bob is only an assignee, so
    // REST cannot see him as a participant at all.
    expect([...logins].map((el) => el.textContent)).toEqual(["ada", "grace"]);
  });

  function headerAction(view: GitHubDetailView, label: string): HTMLElement | null {
    return view.headerEl.querySelector(`.view-action[aria-label="${label}"]`);
  }

  /** The glyph a header action actually drew, not whether it drew one.
   *
   * `setIcon` is silent about a name it cannot resolve: it leaves the button
   * empty and returns null. So an aria-label assertion passes on a blank
   * button, which is how Close issue shipped with no icon at all. */
  function actionGlyph(view: GitHubDetailView, label: string): string {
    return headerAction(view, label)?.querySelector("svg")?.getAttribute("class") ?? "";
  }

  it("closes an issue from the header action and reloads", async () => {
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
    await until(() => headerAction(view, "Close issue") !== null, "close action");
    (headerAction(view, "Close issue") as HTMLElement).click();

    await until(() => headerAction(view, "Reopen issue") !== null, "reopened action");
    expect(update).toHaveBeenCalledWith(42, "closed", {
      owner: "acme",
      repo: "attention",
      host: "github.com",
    });
    expect(getIssue).toHaveBeenCalledTimes(2);
    // addAction prepends a new button each call: the reload must not leave the
    // stale Close beside the new Reopen.
    expect(headerAction(view, "Close issue")).toBeNull();
    expect(view.headerEl.querySelectorAll('.view-action[aria-label$="issue"]')).toHaveLength(1);
  });

  // Each state's button must carry its own glyph. An icon-existence check
  // cannot see the two swapped — both names would resolve and both would draw —
  // so this names the glyph each state is supposed to show.
  it("gives each issue state its own header glyph", async () => {
    const app = await boot();
    const closed: IssueDetail = { ...ISSUE, state: "closed", closedAt: "2026-07-03T00:00:00Z" };
    const getIssue = vi
      .spyOn(app.github, "getIssue")
      .mockResolvedValueOnce(ISSUE)
      .mockResolvedValueOnce(closed);
    vi.spyOn(app.github, "updateIssueState").mockResolvedValue(null);
    await openGitHubDetail(app, { kind: "issue", number: 42, owner: "acme", repo: "attention" });
    const view = app.workspace.getLeavesOfType(GitHubDetailView.VIEW_TYPE)[0]
      ?.view as GitHubDetailView;

    // Open is the state nearly every issue is in, and the one whose glyph was
    // missing: the button users see most often is the one that drew nothing.
    await until(() => headerAction(view, "Close issue") !== null, "close action");
    expect(actionGlyph(view, "Close issue")).toContain("lucide-circle-check");

    (headerAction(view, "Close issue") as HTMLElement).click();
    await until(() => headerAction(view, "Reopen issue") !== null, "reopened action");
    expect(actionGlyph(view, "Reopen issue")).toContain("lucide-circle-dot");
    expect(getIssue).toHaveBeenCalledTimes(2);
  });

  // The other direction: a toggle hardcoded to "closed" still passes the close
  // test above, so reopen needs its own assertion on the state it sends.
  it("reopens a closed issue from the header action", async () => {
    const app = await boot();
    const closed: IssueDetail = { ...ISSUE, state: "closed", closedAt: "2026-07-03T00:00:00Z" };
    vi.spyOn(app.github, "getIssue").mockResolvedValue(closed);
    const update = vi.spyOn(app.github, "updateIssueState").mockResolvedValue(null);
    await openGitHubDetail(app, { kind: "issue", number: 42, owner: "acme", repo: "attention" });
    const view = app.workspace.getLeavesOfType(GitHubDetailView.VIEW_TYPE)[0]
      ?.view as GitHubDetailView;
    await until(() => headerAction(view, "Reopen issue") !== null, "reopen action");
    (headerAction(view, "Reopen issue") as HTMLElement).click();

    await until(() => update.mock.calls.length > 0, "updateIssueState call");
    expect(update).toHaveBeenCalledWith(42, "open", {
      owner: "acme",
      repo: "attention",
      host: "github.com",
    });
  });

  // Write operations guard their own re-entry: a second activation inside the
  // round trip must not create a second resource. The mock keeps a real
  // latency window (two sync clicks are caught either way — both handlers run
  // before any microtask — but the window mirrors production timing).
  it("posts one comment however fast the button is clicked twice", async () => {
    const app = await boot();
    vi.spyOn(app.github, "getIssue").mockResolvedValue(ISSUE);
    const create = vi
      .spyOn(app.github, "createIssueComment")
      .mockImplementation(() => new Promise((r) => setTimeout(() => r(null), 50)));
    await openGitHubDetail(app, { kind: "issue", number: 42, owner: "acme", repo: "attention" });
    const view = app.workspace.getLeavesOfType(GitHubDetailView.VIEW_TYPE)[0]
      ?.view as GitHubDetailView;
    await until(() => view.contentEl.querySelector(".gh-composer textarea") !== null, "composer");
    const ta = view.contentEl.querySelector(".gh-composer textarea") as HTMLTextAreaElement;
    const btn = view.contentEl.querySelector(".gh-composer .mod-cta") as HTMLButtonElement;
    ta.value = "hello";
    // Assigning value alone does not fire the listener that enables the button.
    ta.dispatchEvent(new Event("input"));
    // A forever-disabled button also "posts once" — that green would be empty.
    expect(btn.disabled).toBe(false);

    btn.click();
    btn.click();
    await until(() => create.mock.calls.length > 0, "first post");
    await new Promise((r) => setTimeout(r, 120));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("sends one state change however fast Close is clicked twice", async () => {
    const app = await boot();
    vi.spyOn(app.github, "getIssue").mockResolvedValue(ISSUE);
    const update = vi
      .spyOn(app.github, "updateIssueState")
      .mockImplementation(() => new Promise((r) => setTimeout(() => r(null), 50)));
    await openGitHubDetail(app, { kind: "issue", number: 42, owner: "acme", repo: "attention" });
    const view = app.workspace.getLeavesOfType(GitHubDetailView.VIEW_TYPE)[0]
      ?.view as GitHubDetailView;
    await until(() => headerAction(view, "Close issue") !== null, "close action");
    const close = headerAction(view, "Close issue") as HTMLElement;
    close.click();
    close.click();
    await until(() => update.mock.calls.length > 0, "first state change");
    await new Promise((r) => setTimeout(r, 120));
    expect(update).toHaveBeenCalledTimes(1);
  });

  // A remote file is still a file: the tab names its type through the host's
  // own resolver, like every other place in the app that lists one. Asserting
  // the resolver's answer rather than a literal is deliberate — a hardcoded
  // "lucide-file" cannot produce a per-language icon, so it cannot pass.
  it("names a file tab by its type, not a generic page", async () => {
    const app = await boot();
    vi.spyOn(app.github, "getFileContent").mockResolvedValue({
      path: "src/main.ts",
      name: "main.ts",
      sha: "abc",
      size: 1,
      encoding: "utf-8",
      text: "const a = 1;",
      htmlUrl: "",
      downloadUrl: null,
    });
    await openGitHubDetail(app, {
      kind: "file",
      path: "src/main.ts",
      ref: "main",
      owner: "acme",
      repo: "attention",
    });
    const view = app.workspace.getLeavesOfType(GitHubDetailView.VIEW_TYPE)[0]
      ?.view as GitHubDetailView;
    await until(() => view.contentEl.querySelector(".gh-preview-header") !== null, "file preview");

    expect(view.getIcon()).toBe(getFileTypeInfo("src/main.ts").icon);
    expect(view.getIcon()).not.toBe("lucide-file");
  });

  it("keeps the state action off runs and files", async () => {
    const app = await boot();
    vi.spyOn(app.github, "getIssue").mockResolvedValue(ISSUE);
    vi.spyOn(app.github, "getFileContent").mockResolvedValue({
      path: "src/main.ts",
      name: "main.ts",
      sha: "abc",
      size: 1,
      encoding: "utf-8",
      text: "x",
      htmlUrl: "",
      downloadUrl: null,
    });
    await openGitHubDetail(app, { kind: "issue", number: 42, owner: "acme", repo: "attention" });
    const view = app.workspace.getLeavesOfType(GitHubDetailView.VIEW_TYPE)[0]
      ?.view as GitHubDetailView;
    await until(() => headerAction(view, "Close issue") !== null, "close action");

    // The same leaf re-targeted at a file has no state to toggle.
    await openGitHubDetail(app, {
      kind: "file",
      path: "src/main.ts",
      ref: "main",
      owner: "acme",
      repo: "attention",
    });
    await until(() => view.contentEl.querySelector(".gh-preview-header") !== null, "file preview");
    expect(headerAction(view, "Close issue")).toBeNull();
  });

  it("interleaves comments and events in one timeline", async () => {
    const app = await boot();
    vi.spyOn(app.github, "getIssue").mockResolvedValue({
      ...ISSUE,
      timeline: [
        {
          kind: "event",
          id: "e1",
          event: "labeled",
          actor: { login: "grace", avatarUrl: "", url: "" },
          createdAt: "2026-07-02T00:30:00Z",
          label: { name: "bug", color: "d73a4a", description: null },
          assignee: null,
          milestone: null,
          rename: null,
        },
        ISSUE.timeline[0],
        {
          kind: "event",
          id: "e2",
          event: "closed",
          actor: { login: "grace", avatarUrl: "", url: "" },
          createdAt: "2026-07-02T02:00:00Z",
          label: null,
          assignee: null,
          milestone: null,
          rename: null,
        },
        {
          // GitHub emits plenty the issue body never shows; an unknown event
          // must be skipped, not printed as a bare name.
          kind: "event",
          id: "e3",
          event: "subscribed",
          actor: { login: "grace", avatarUrl: "", url: "" },
          createdAt: "2026-07-02T03:00:00Z",
          label: null,
          assignee: null,
          milestone: null,
          rename: null,
        },
      ],
    });
    await openGitHubDetail(app, { kind: "issue", number: 42, owner: "acme", repo: "attention" });
    const view = app.workspace.getLeavesOfType(GitHubDetailView.VIEW_TYPE)[0]
      ?.view as GitHubDetailView;
    await until(() => view.contentEl.querySelector(".gh-timeline-event") !== null, "timeline");

    const main = view.contentEl.querySelector(".gh-issue-main") as HTMLElement;
    const rows = [...main.querySelectorAll(".gh-card, .gh-timeline-event")].map(
      (el) => el.textContent ?? "",
    );
    // Body card first, then the run in order: event, comment, event.
    expect(rows[1]).toContain("added the bug label");
    expect(rows[2]).toContain("Looks good");
    expect(rows[3]).toContain("closed this");
    expect(main.textContent).not.toContain("subscribed");
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

  it("sends the file preview's Open on GitHub through the shared exit", async () => {
    const app = await boot();
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const windowOpen = vi.fn();
    vi.stubGlobal("electron", { shell: { openExternal } });
    vi.stubGlobal("open", windowOpen);
    vi.spyOn(app.github, "getFileContent").mockResolvedValue({
      path: "src/main.ts",
      name: "main.ts",
      sha: "abc123",
      size: 12,
      encoding: "utf-8",
      text: "const a = 1;",
      htmlUrl: "https://github.com/acme/attention/blob/main/src/main.ts",
      downloadUrl: null,
    });

    await openGitHubDetail(app, {
      kind: "file",
      path: "src/main.ts",
      ref: "main",
      owner: "acme",
      repo: "attention",
    });
    const view = app.workspace.getLeavesOfType(GitHubDetailView.VIEW_TYPE)[0]
      ?.view as GitHubDetailView;
    await until(() => view.contentEl.querySelector(".gh-linkish") !== null, "Open on GitHub");
    (view.contentEl.querySelector(".gh-linkish") as HTMLButtonElement).click();

    expect(openExternal).toHaveBeenCalledWith(
      "https://github.com/acme/attention/blob/main/src/main.ts",
    );
    // window.open is the bypass this fix removed; the Electron shell is the only exit.
    expect(windowOpen).not.toHaveBeenCalled();
  });
});
