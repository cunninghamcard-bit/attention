import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { Platform } from "@web/platform/Platform";
import { GitCommitView } from "@web/builtin/github/GitCommitView";
import { GitHubListView } from "@web/builtin/github/GitHubListView";
import { GitHubNavView } from "@web/builtin/github/GitHubNavView";
import { GitHubDetailView } from "@web/builtin/github/GitHubDetailView";
import { GitHubRepoView } from "@web/builtin/github/GitHubRepoView";
import { PrDetailView } from "@web/builtin/github/GitPrViews";
import { Notice } from "@web/ui/Notice";
import {
  openGitHubNav,
  openInbox,
  openPrDetail,
  openQueryList,
  openRepo,
} from "@web/builtin/github/open";
import type {
  CommitDetail,
  CommitSummary,
  GitHubSearchItem,
  NotificationItem,
  PrDetail,
  PrFileChange,
  IssueDetail,
  PrSummary,
  RepoContentItem,
} from "@web/builtin/github/types";

// jsdom lacks ResizeObserver; the shared ReviewSurface's pierre CodeView needs
// it. Real desktop/web runtimes provide it natively.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

const ACTOR = { login: "ada", avatarUrl: "", url: "" };
const FILE: PrFileChange = {
  path: "src/a.ts",
  previousPath: null,
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: "@@ -1 +1 @@\n-old\n+new",
};

function searchItems(kind: "pr" | "issue"): GitHubSearchItem[] {
  return [
    {
      owner: "coder",
      repo: "ghostty-web",
      number: 185,
      title: "Fix Powerline separators",
      state: "open",
      isDraft: false,
      isPullRequest: kind === "pr",
      author: ACTOR,
      createdAt: "2026-07-11T00:00:00Z",
      updatedAt: "2026-07-15T00:00:00Z",
      url: "",
      labels: [],
      comments: 3,
    },
    {
      owner: "octo",
      repo: "notes",
      number: 42,
      title: "Oh My GitHub layout",
      state: "open",
      isDraft: false,
      isPullRequest: kind === "pr",
      author: { ...ACTOR, login: "grace" },
      createdAt: "2026-07-14T00:00:00Z",
      updatedAt: "2026-07-14T00:00:00Z",
      url: "",
      labels: [],
      comments: 0,
    },
  ];
}

const PRS: PrSummary[] = [
  {
    number: 7,
    title: "Repo PR one",
    state: "open",
    isDraft: false,
    author: ACTOR,
    headRefName: "one",
    baseRefName: "main",
    updatedAt: "2026-07-15T00:00:00Z",
    createdAt: "2026-07-14T00:00:00Z",
    url: "",
    labels: [],
    reviewDecision: null,
    additions: 3,
    deletions: 1,
    changedFiles: 1,
    ciState: "success",
  },
  {
    number: 6,
    title: "Repo PR two",
    state: "open",
    isDraft: false,
    author: { ...ACTOR, login: "grace" },
    headRefName: "two",
    baseRefName: "main",
    updatedAt: "2026-07-14T00:00:00Z",
    createdAt: "2026-07-13T00:00:00Z",
    url: "",
    labels: [],
    reviewDecision: null,
    additions: 4,
    deletions: 0,
    changedFiles: 1,
    ciState: null,
  },
];

const PR_DETAIL: PrDetail = {
  ...PRS[0],
  body: "body",
  headRefOid: "abc123",
  mergeable: true,
  mergeStateStatus: "clean",
  comments: [],
  reviews: [],
  reviewComments: [],
  commits: [],
  files: [FILE],
  checks: [],
  requestedReviewers: [],
  assignees: [],
  milestone: null,
};

const COMMIT_SUMMARY: CommitSummary = {
  sha: "deadbeef01234567",
  shortSha: "deadbee",
  headline: "repo commit",
  message: "repo commit",
  author: ACTOR,
  authorName: "Ada",
  committedDate: "2026-07-15T00:00:00Z",
  url: "",
};

const COMMIT_DETAIL: CommitDetail = {
  sha: "deadbeef01234567",
  shortSha: "deadbee",
  headline: "repo commit",
  message: "repo commit\n\nbody",
  author: ACTOR,
  authorName: "Ada",
  committer: ACTOR,
  committedDate: "2026-07-15T00:00:00Z",
  authoredDate: "2026-07-15T00:00:00Z",
  url: "",
  parents: [],
  stats: { additions: 1, deletions: 1, total: 2 },
  files: [{ ...FILE }],
  verification: null,
  ciState: null,
  checks: [],
};

const NOTIFICATIONS: NotificationItem[] = [
  {
    id: "n1",
    unread: true,
    reason: "mention",
    updatedAt: "2026-07-15T00:00:00Z",
    title: "Inbox issue notification",
    type: "Issue",
    url: "https://api.github.com/repos/octo/notes/issues/42",
    repository: "octo/notes",
    owner: "octo",
    repo: "notes",
    subjectUrl: "https://api.github.com/repos/octo/notes/issues/42",
    repositoryHtmlUrl: "https://github.com/octo/notes",
  },
];

async function createApp(opts?: { authed?: boolean }): Promise<App> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const app = new App(root);
  await app.ready;
  vi.spyOn(app.github, "getAuth").mockResolvedValue(
    opts?.authed === false
      ? { hasToken: false, login: null, avatarUrl: null, name: null }
      : { hasToken: true, login: "ada", avatarUrl: null, name: "Ada" },
  );
  vi.spyOn(app.github, "searchInvolvement").mockImplementation(async (kind) => searchItems(kind));
  vi.spyOn(app.github, "listUserRepositories").mockResolvedValue([
    {
      owner: "octo",
      repo: "notes",
      fullName: "octo/notes",
      private: false,
      description: "",
      openIssues: 0,
    },
  ]);
  vi.spyOn(app.github, "listUserOrganizations").mockResolvedValue([
    { login: "acme-corp", avatarUrl: "", description: "Acme" },
  ]);
  vi.spyOn(app.github, "listOrgRepositories").mockResolvedValue([
    {
      owner: "acme-corp",
      repo: "platform",
      fullName: "acme-corp/platform",
      private: false,
      description: "Platform",
      openIssues: 1,
    },
  ]);
  vi.spyOn(app.github, "listPullRequests").mockResolvedValue(PRS);
  vi.spyOn(app.github, "getPullRequest").mockImplementation(async (number: number) => ({
    ...PR_DETAIL,
    number,
    title: number === 7 ? "Repo PR one" : "Repo PR two",
  }));
  vi.spyOn(app.github, "getPullRequestDiff").mockResolvedValue("");
  vi.spyOn(app.github, "getDefaultBranch").mockResolvedValue("main");
  vi.spyOn(app.github, "listBranches").mockResolvedValue([
    { name: "main", protected: true, commitSha: "aaa1111" },
  ]);
  vi.spyOn(app.github, "listCommits").mockResolvedValue({
    items: [COMMIT_SUMMARY],
    page: 1,
    perPage: 30,
    hasNextPage: false,
    hasPreviousPage: false,
    ref: "main",
  });
  vi.spyOn(app.github, "getCommit").mockResolvedValue(COMMIT_DETAIL);
  vi.spyOn(app.github, "getCommitDiff").mockResolvedValue("");
  vi.spyOn(app.github, "listIssues").mockResolvedValue([]);
  vi.spyOn(app.github, "listWorkflowRuns").mockResolvedValue([]);
  vi.spyOn(app.github, "listNotifications").mockImplementation(async () =>
    NOTIFICATIONS.map((item) => ({ ...item })),
  );
  vi.spyOn(app.github, "markNotificationRead").mockResolvedValue(undefined);
  return app;
}

function nav(app: App): GitHubNavView {
  return app.workspace.getLeavesOfType(GitHubNavView.VIEW_TYPE)[0].view as GitHubNavView;
}

function countLeaves(app: App): number {
  let count = 0;
  app.workspace.iterateAllLeaves(() => {
    count += 1;
  });
  return count;
}

// `setViewState` drops re-entrant calls (`if (this.working) return`), and the
// view's state flips inside `setState` — i.e. before that guard clears. A click
// fired the instant getState() changes would be swallowed, so let the in-flight
// transition finish first.
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

async function until(condition: () => boolean, what: string): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > 4000) throw new Error(`timeout: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  } satisfies Storage);
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

afterEach(() => vi.unstubAllGlobals());

describe("GitHub native navigation (A+B)", () => {
  it("docks the github navigator in the left split", async () => {
    const app = await createApp();
    await openGitHubNav(app);
    const leaves = app.workspace.getLeavesOfType(GitHubNavView.VIEW_TYPE);
    expect(leaves).toHaveLength(1);
    expect(app.workspace.leftSplit.containerEl.contains(leaves[0].containerEl)).toBe(true);
    expect(app.workspace.getLeavesOfType("github-workspace")).toHaveLength(0);
  });

  it("shows a connect prompt when unauthenticated", async () => {
    const app = await createApp({ authed: false });
    await openGitHubNav(app);
    const view = nav(app);
    await until(() => view.contentEl.querySelector(".git-pr-signin") !== null, "sign-in prompt");
    expect(view.contentEl.querySelector(".github-nav-item")).toBeNull();
  });

  const section = (view: GitHubNavView, label: string): HTMLElement =>
    view.contentEl.querySelector(`.nav-header [aria-label="${label}"]`) as HTMLElement;

  it("renders four header sections without a repo picker", async () => {
    const app = await createApp();
    await openGitHubNav(app);
    const view = nav(app);
    await until(
      () => view.contentEl.querySelector('[data-key="query:pr:review-requested"]') !== null,
      "pr queries",
    );
    for (const label of ["Inbox", "Pull requests", "Issues", "Organizations"])
      expect(section(view, label)).not.toBeNull();
    // Owner's calls: a section reloads when activated, and Search left the
    // sidebar altogether — it lives on the github:search command now.
    expect(section(view, "Search")).toBeNull();
    expect(view.contentEl.querySelector('[data-key="search"]')).toBeNull();
    // Default body = the pull-request queries.
    const text = view.contentEl.textContent ?? "";
    expect(text).toContain("Created by me");
    expect(text).toContain("Needs review");
    // Navigated by participation: no repo picker, no Repositories group, no repo dump, no Refresh.
    expect(section(view, "Open repository")).toBeNull();
    expect(section(view, "Refresh")).toBeNull();
    expect(view.contentEl.querySelector('[data-key^="repo:"]')).toBeNull();
  });

  it("switches nav sections from the header icons", async () => {
    const app = await createApp();
    await openGitHubNav(app);
    const view = nav(app);
    await until(
      () => view.contentEl.querySelector('[data-key="query:pr:review-requested"]') !== null,
      "pr queries",
    );
    const before = countLeaves(app);
    section(view, "Issues").click();
    await until(
      () => view.contentEl.querySelector('[data-key="query:issue:created"]') !== null,
      "issue queries",
    );
    // The same leaf swapped its body: PR queries gone, no leaf minted.
    expect(view.contentEl.querySelector('[data-key="query:pr:review-requested"]')).toBeNull();
    expect(countLeaves(app)).toBe(before);
  });

  it("opens the inbox from the nav header icon", async () => {
    const app = await createApp();
    await openGitHubNav(app);
    const view = nav(app);
    await until(
      () => view.contentEl.querySelector('[data-key="query:pr:review-requested"]') !== null,
      "pr queries",
    );
    section(view, "Inbox").click();
    const list = (): GitHubListView =>
      app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0]?.view as GitHubListView;
    await until(() => list()?.getDisplayText() === "Inbox", "inbox list");
    expect(list().getState().kind).toBe("notifications");
    // Inbox is an entry, not a body state: the dock keeps its section and never
    // carries notification rows — the badge is its whole inbox presence.
    expect(view.contentEl.querySelector('[data-key="query:pr:review-requested"]')).not.toBeNull();
    expect(view.contentEl.querySelector('[data-key^="notification:"]')).toBeNull();
    await until(
      () => section(view, "Inbox").querySelector(".github-nav-badge")?.textContent === "1",
      "unread badge",
    );
  });

  it("lists the signed-in user before organizations", async () => {
    const app = await createApp();
    await openGitHubNav(app);
    const view = nav(app);
    section(view, "Organizations").click();
    await until(
      () => view.contentEl.querySelector('[data-key="org:acme-corp"]') !== null,
      "org rows",
    );
    // Order matters: you come first, joined organizations follow.
    const logins = [...view.contentEl.querySelectorAll("[data-key^='org:']")].map(
      (el) => (el as HTMLElement).dataset.key,
    );
    expect(logins).toEqual(["org:ada", "org:acme-corp"]);
    expect(view.contentEl.textContent).not.toContain("No organizations.");
  });

  it("resolves your own row through the user endpoint, not the org endpoint", async () => {
    const app = await createApp();
    // `/orgs/{login}/repos` 404s for a person — and with no organizations your
    // own row is the only one there, so this branch is the common path.
    const orgRepos = vi.spyOn(app.github, "listOrgRepositories");
    const userRepos = vi.spyOn(app.github, "listUserRepositories");
    vi.spyOn(app.github, "listUserOrganizations").mockResolvedValue([]);
    await openGitHubNav(app);
    const view = nav(app);
    section(view, "Organizations").click();
    await until(() => view.contentEl.querySelector('[data-key="org:ada"]') !== null, "self row");
    (view.contentEl.querySelector('[data-key="org:ada"]') as HTMLElement).click();
    await until(() => userRepos.mock.calls.length > 0, "user repositories fetched");
    expect(orgRepos).not.toHaveBeenCalled();
  });

  it("drops a late organizations reply after the section changed", async () => {
    const app = await createApp();
    let release: (
      v: { login: string; avatarUrl: string; description: string }[],
    ) => void = () => {};
    vi.spyOn(app.github, "listUserOrganizations").mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    await openGitHubNav(app);
    const view = nav(app);
    section(view, "Organizations").click();
    // Leave before the reply lands, then let it land.
    section(view, "Pull requests").click();
    await until(
      () => view.contentEl.querySelector('[data-key="query:pr:review-requested"]') !== null,
      "pr queries",
    );
    release([{ login: "acme-corp", avatarUrl: "", description: "Acme" }]);
    await settle();
    // The body element is shared across sections, so a stale fill would land here.
    expect(view.contentEl.querySelector("[data-key^='org:']")).toBeNull();
    expect(view.contentEl.querySelector('[data-key="query:pr:review-requested"]')).not.toBeNull();
  });

  // The profile tab replaces this door in the github-profile goal; until then
  // an organization opens its repository list.
  it("opens an organization center list of repositories", async () => {
    const app = await createApp();
    await openGitHubNav(app);
    const view = nav(app);
    section(view, "Organizations").click();
    await until(
      () => view.contentEl.querySelector('[data-key="org:acme-corp"]') !== null,
      "org row",
    );
    (view.contentEl.querySelector('[data-key="org:acme-corp"]') as HTMLElement).click();
    const list = (): GitHubListView =>
      app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0]?.view as GitHubListView;
    await until(
      () => list()?.contentEl.textContent?.includes("platform") === true,
      "org repo list",
    );
    expect(list().getDisplayText()).toBe("acme-corp");
  });

  it("opens a cross-repo query list tab", async () => {
    const app = await createApp();
    await openGitHubNav(app);
    const view = nav(app);
    await until(
      () => view.contentEl.querySelector('[data-key="query:pr:review-requested"]') !== null,
      "nav tree",
    );
    (view.contentEl.querySelector('[data-key="query:pr:review-requested"]') as HTMLElement).click();
    const list = (): GitHubListView =>
      app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0]?.view as GitHubListView;
    await until(() => list()?.contentEl.querySelector(".github-repo-chip") !== null, "list rows");
    // Cross-repo: rows carry their own repository.
    const chips = [...list().contentEl.querySelectorAll(".github-repo-chip")].map(
      (el) => el.textContent,
    );
    expect(chips).toContain("coder/ghostty-web");
    expect(chips).toContain("octo/notes");
  });

  it("opens issue detail from an inbox row", async () => {
    const app = await createApp();
    vi.spyOn(app.github, "getIssue").mockResolvedValue({
      number: 42,
      title: "Inbox issue notification",
      state: "open",
      author: ACTOR,
      createdAt: "2026-07-14T00:00:00Z",
      updatedAt: "2026-07-15T00:00:00Z",
      url: "",
      labels: [],
      comments: 0,
      isPullRequest: false,
      body: "issue body",
      assignees: [],
      milestone: null,
      commentsList: [],
      closedAt: null,
    } satisfies IssueDetail);
    const opened: string[] = [];
    vi.stubGlobal("open", (url: string) => {
      opened.push(url);
      return null;
    });
    await openInbox(app);
    const list = (): GitHubListView =>
      app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0]?.view as GitHubListView;
    await until(() => list()?.contentEl.querySelector(".github-row") !== null, "inbox rows");
    (list().contentEl.querySelector(".github-row") as HTMLElement).click();
    // We can render an issue, so it opens in-app — Oh My GitHub's first branch.
    const detail = (): HTMLElement | undefined =>
      (app.workspace.getLeavesOfType("github-detail")[0]?.view as GitHubDetailView | undefined)
        ?.contentEl;
    await until(
      () => detail()?.textContent?.includes("Inbox issue notification") === true,
      "issue detail rendered",
    );
    expect(opened).toEqual([]);
  });

  it("opens the browser from an inbox row", async () => {
    const app = await createApp();
    vi.spyOn(app.github, "listNotifications").mockResolvedValue([
      {
        ...NOTIFICATIONS[0],
        id: "c1",
        title: "A commit notification",
        type: "Commit",
        url: "https://api.github.com/repos/octo/notes/commits/deadbeef",
        subjectUrl: "https://api.github.com/repos/octo/notes/commits/deadbeef",
      },
    ]);
    const opened: string[] = [];
    vi.stubGlobal("open", (url: string) => {
      opened.push(url);
      return null;
    });
    await openInbox(app);
    const list = (): GitHubListView =>
      app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0]?.view as GitHubListView;
    await until(() => list()?.contentEl.querySelector(".github-row") !== null, "inbox rows");
    (list().contentEl.querySelector(".github-row") as HTMLElement).click();
    await settle();
    // No commit-notification view exists in-app: go to the real page.
    expect(opened).toEqual(["https://github.com/octo/notes/commit/deadbeef"]);
    expect(app.workspace.getLeavesOfType("github-detail")).toHaveLength(0);
    expect(app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)).toHaveLength(0);
  });

  it("opens the repository web page for unmappable subjects", async () => {
    const app = await createApp();
    vi.spyOn(app.github, "listNotifications").mockResolvedValue([
      {
        ...NOTIFICATIONS[0],
        id: "d1",
        title: "A new discussion",
        type: "Discussion",
        url: null,
        subjectUrl: null,
      },
    ]);
    const opened: string[] = [];
    vi.stubGlobal("open", (url: string) => {
      opened.push(url);
      return null;
    });
    await openInbox(app);
    const list = (): GitHubListView =>
      app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0]?.view as GitHubListView;
    await until(() => list()?.contentEl.querySelector(".github-row") !== null, "inbox rows");
    (list().contentEl.querySelector(".github-row") as HTMLElement).click();
    await settle();
    // The payload's own repository page — not an invented URL, not a repo tab.
    expect(opened).toEqual(["https://github.com/octo/notes"]);
    expect(app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)).toHaveLength(0);
    expect(app.workspace.getLeavesOfType("github-detail")).toHaveLength(0);
  });

  it("retargets the detail leaf while the first request is pending", async () => {
    const app = await createApp();
    let releaseFirst: (v: PrDetail) => void = () => {};
    vi.spyOn(app.github, "getPullRequest").mockImplementation((number: number) =>
      number === 7
        ? new Promise<PrDetail>((resolve) => {
            releaseFirst = resolve;
          })
        : Promise.resolve({ ...PR_DETAIL, number, title: "Repo PR two" }),
    );
    await openPrDetail(app, "octo", "notes", 7);
    // Second activation lands while the first fetch is still in flight.
    await openPrDetail(app, "octo", "notes", 6);
    releaseFirst({ ...PR_DETAIL, number: 7, title: "Repo PR one" });
    await settle();
    const detail = (): PrDetailView =>
      app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;
    // The last activation wins — in the state, in the session, and on screen.
    expect(detail().getState().number).toBe(6);
    expect(app.github.session.selection).toMatchObject({
      kind: "pr",
      number: 6,
    });
    await until(
      () => detail().contentEl.textContent?.includes("Repo PR two") === true,
      "second pull request rendered",
    );
    expect(detail().contentEl.textContent).not.toContain("Repo PR one");
  });

  it("resets transient state when the repo leaf is retargeted", async () => {
    const app = await createApp();
    const contents = vi
      .spyOn(app.github, "listContents")
      .mockResolvedValue([
        { name: "src", path: "src", type: "dir", size: 0, sha: "", url: "" },
      ] as RepoContentItem[]);
    vi.spyOn(app.github, "getDefaultBranch").mockImplementation(async (repo) =>
      repo?.repo === "platform" ? "trunk" : "main",
    );
    await openRepo(app, "octo", "notes", "files");
    const repo = (): GitHubRepoView =>
      app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0].view as GitHubRepoView;
    await until(() => repo().contentEl.querySelector(".github-row") !== null, "file rows");
    // Walk into a subdirectory: this parks a repo-scoped cursor on the leaf.
    (repo().contentEl.querySelector(".github-row") as HTMLElement).click();
    await until(() => contents.mock.calls.some((call) => call[0] === "src"), "subdirectory");
    contents.mockClear();

    // Same leaf, different repository.
    await openRepo(app, "acme-corp", "platform", "files");
    await until(() => contents.mock.calls.length > 0, "second repository files");
    const [path, ref, ref3] = contents.mock.calls[0];
    // Carrying these over would query the new repo with the old repo's cursor —
    // wrong data, not merely a stale view.
    expect(path).toBe("");
    expect(ref).toBe("trunk");
    expect(ref3).toMatchObject({ owner: "acme-corp", repo: "platform" });
    expect(app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)).toHaveLength(1);
    expect(app.github.session.target).toMatchObject({
      owner: "acme-corp",
      repo: "platform",
    });
  });

  it("walks repo sub-view switches with the native back control", async () => {
    const app = await createApp();
    await openRepo(app, "octo", "notes", "overview");
    const repo = (): GitHubRepoView =>
      app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0].view as GitHubRepoView;
    await until(() => repo().headerEl.querySelector(".github-repo-nav") !== null, "repo header");
    const segment = (label: string): HTMLElement =>
      repo().headerEl.querySelector(
        `.github-segmented-control-item[aria-label="${label}"]`,
      ) as HTMLElement;

    segment("Commits").click();
    await until(() => repo().getState().section === "commits", "commits sub-view");
    const leaf = app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0];
    // Sub-views are destinations: back returns to Overview, not out of the repo.
    leaf.history.back();
    await until(() => repo().getState().section === "overview", "back to overview");
    expect(app.github.session.target).toMatchObject({ section: "overview" });
    leaf.history.forward();
    await until(() => repo().getState().section === "commits", "forward to commits");
    expect(app.github.session.target).toMatchObject({ section: "commits" });
    expect(app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)).toHaveLength(1);
  });

  it("forks a second detail leaf from a modified center-row activation", async () => {
    const app = await createApp();
    await openRepo(app, "octo", "notes", "pulls");
    const repo = (): GitHubRepoView =>
      app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0].view as GitHubRepoView;
    await until(() => repo().contentEl.querySelector(".github-row") !== null, "pull request rows");
    const rows = (): HTMLElement[] => [
      ...repo().contentEl.querySelectorAll<HTMLElement>(".github-row"),
    ];
    rows()[0].click();
    await until(
      () => app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE).length === 1,
      "first detail leaf",
    );
    await settle();
    // Center rows must honour cmd/ctrl-activate too — not just the sidebar.
    rows()[1].dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        [Platform.isMacOS ? "metaKey" : "ctrlKey"]: true,
      }),
    );
    await until(
      () => app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE).length === 2,
      "second detail leaf",
    );
  });

  it("drops a late organizations reply after the body was rewritten", async () => {
    const app = await createApp();
    let releaseOrgs: (
      v: { login: string; avatarUrl: string; description: string }[],
    ) => void = () => {};
    vi.spyOn(app.github, "listUserOrganizations").mockReturnValue(
      new Promise((resolve) => {
        releaseOrgs = resolve;
      }),
    );
    await openGitHubNav(app);
    const view = nav(app);
    section(view, "Organizations").click();

    // Switch away before the orgs reply lands — body epoch must drop the stale fill.
    section(view, "Pull requests").click();
    await until(
      () => view.contentEl.querySelector('[data-key="query:pr:review-requested"]') !== null,
      "back to pr queries",
    );

    releaseOrgs([{ login: "acme-corp", avatarUrl: "", description: "Acme" }]);
    await settle();
    expect(view.contentEl.querySelector('[data-key="org:acme-corp"]')).toBeNull();
    expect(view.contentEl.querySelector('[data-key="query:pr:review-requested"]')).not.toBeNull();
  });

  it("opens a target from the github search suggest modal", async () => {
    const app = await createApp();
    await openGitHubNav(app);
    const view = nav(app);
    await until(
      () => view.contentEl.querySelector('[data-key="query:pr:review-requested"]') !== null,
      "pr queries",
    );
    app.commands.findCommand("github:search")?.callback?.();
    const modalEl = () => document.body.querySelector(".prompt") as HTMLElement | null;
    await until(() => modalEl() !== null, "search modal");
    // Wait for listUserRepositories to fill suggestions (octo/notes from createApp).
    await until(
      () => (modalEl()?.textContent ?? "").includes("octo/notes"),
      "repo suggestions loaded",
    );
    const input = modalEl()!.querySelector(".prompt-input") as HTMLInputElement;
    input.value = "notes";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    const suggestion = [...modalEl()!.querySelectorAll(".suggestion-item")].find((el) =>
      (el.textContent ?? "").includes("octo/notes"),
    ) as HTMLElement | undefined;
    expect(suggestion).toBeTruthy();
    suggestion!.click();
    await until(() => {
      const leaf = app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0];
      const state = leaf?.view?.getState?.() as { owner?: string; repo?: string } | undefined;
      return state?.owner === "octo" && state?.repo === "notes";
    }, "repo leaf from search");
  });

  it("switches sub-views on its own leaf when a second repo tab is open", async () => {
    const app = await createApp();
    await openRepo(app, "octo", "notes", "overview");
    // cmd-activate forked a second repo tab; its header must drive itself.
    await openRepo(app, "acme-corp", "platform", "overview", "tab");
    const leaves = () => app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE);
    await until(() => leaves().length === 2, "two repo tabs");
    const second = leaves()[1].view as GitHubRepoView;
    await until(() => second.headerEl.querySelector(".github-repo-nav") !== null, "second header");
    const commits = second.headerEl.querySelector(
      '.github-segmented-control-item[aria-label="Commits"]',
    ) as HTMLElement;

    commits.click();
    await until(() => second.getState().section === "commits", "second tab on commits");
    // The first tab must not have been driven from another tab's header.
    expect((leaves()[0].view as GitHubRepoView).getState()).toMatchObject({
      owner: "octo",
      repo: "notes",
      section: "overview",
    });
    expect(leaves()).toHaveLength(2);
  });

  it("navigates from an inbox row without waiting on mark-read", async () => {
    const app = await createApp();
    // Mark-read never settles: navigation must not be gated behind it.
    vi.spyOn(app.github, "markNotificationRead").mockReturnValue(new Promise(() => {}));
    await openInbox(app);
    const list = (): GitHubListView =>
      app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0]?.view as GitHubListView;
    await until(
      () => list()?.contentEl.textContent?.includes("Inbox issue notification") === true,
      "inbox rows",
    );
    (list().contentEl.querySelector(".github-row") as HTMLElement).click();
    await until(
      () => app.workspace.getLeavesOfType("github-detail").length === 1,
      "navigated despite pending mark-read",
    );
  });

  it("keeps a notification unread when mark-read fails", async () => {
    const app = await createApp();
    // The service reports failure by *returning* a message, never by rejecting.
    vi.spyOn(app.github, "markNotificationRead").mockResolvedValue("Not signed in");
    await openInbox(app);
    const list = (): GitHubListView =>
      app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0]?.view as GitHubListView;
    await until(() => list()?.contentEl.querySelector(".github-row") !== null, "inbox rows");
    (list().contentEl.querySelector(".github-row") as HTMLElement).click();
    await until(() => app.workspace.getLeavesOfType("github-detail").length === 1, "navigated");
    await settle();
    // Navigation still happens; the unread flag must not claim a write landed.
    expect(list().contentEl.querySelector(".github-row.is-unread")).not.toBeNull();
  });

  it("refreshes the github views from the command", async () => {
    const app = await createApp();
    await openGitHubNav(app);
    const view = nav(app);
    // Put the dock on a section that actually fetches, or "did the dock
    // reload?" cannot be observed at all.
    section(view, "Organizations").click();
    await until(() => view.contentEl.querySelector('[data-key="org:acme-corp"]') !== null, "orgs");
    await openQueryList(app, "pr", "review-requested");
    await until(() => listOf(app)?.getState().query === "review-requested", "list open");

    const search = vi.spyOn(app.github, "searchInvolvement");
    const orgs = vi.spyOn(app.github, "listUserOrganizations");
    search.mockClear();
    orgs.mockClear();
    const command = app.commands.findCommand("github:refresh");
    expect(command).toBeTruthy();
    command?.callback?.();

    // The headers carry no Refresh button, so the command must reach both the
    // active tab and the dock — each proven by a real fetch, not by DOM truthiness.
    await until(() => search.mock.calls.length > 0, "active list refetched");
    await until(() => orgs.mock.calls.length > 0, "dock refetched");
  });

  it("refreshes an active detail tab from the command", async () => {
    const app = await createApp();
    await openPrDetail(app, "octo", "notes", 7);
    const detail = vi.spyOn(app.github, "getPullRequest");
    await until(
      () => app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE).length === 1,
      "detail open",
    );
    detail.mockClear();
    app.commands.findCommand("github:refresh")?.callback?.();
    // A detail tab has no header button either — the command is its only reload.
    await until(() => detail.mock.calls.length > 0, "detail refetched");
  });

  it("highlights the activated row when two repos share a number", async () => {
    const app = await createApp();
    // The same PR number in two repositories — the cross-repo case this list exists for.
    const collide = searchItems("pr").map((item, i) => ({ ...item, number: 42, title: `PR ${i}` }));
    vi.spyOn(app.github, "searchInvolvement").mockResolvedValue(collide);
    await openQueryList(app, "pr", "review-requested");
    const list = (): GitHubListView =>
      app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0].view as GitHubListView;
    await until(() => list().contentEl.querySelectorAll(".github-row").length === 2, "two rows");
    const rows = (): HTMLElement[] => [
      ...list().contentEl.querySelectorAll<HTMLElement>(".github-row"),
    ];
    rows()[1].click();
    await until(
      () => app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE).length === 1,
      "detail open",
    );
    await settle();
    const active = list().contentEl.querySelectorAll(".github-row.is-active");
    expect(active).toHaveLength(1);
    // The second row is octo/notes#42 — not coder/ghostty-web#42.
    expect((active[0] as HTMLElement).dataset.key).toBe("pr:octo/notes#42");
  });

  it("highlights only the source repo when two repo tabs share a file path", async () => {
    const app = await createApp();
    vi.spyOn(app.github, "listContents").mockResolvedValue([
      { name: "README.md", path: "README.md", type: "file", size: 1, sha: "", url: "" },
    ] as RepoContentItem[]);
    await openRepo(app, "octo", "notes", "files");
    await openRepo(app, "acme-corp", "platform", "files", "tab");
    const tabs = () => app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE);
    await until(() => tabs().length === 2, "two repo tabs");
    const view = (i: number): GitHubRepoView => tabs()[i].view as GitHubRepoView;
    await until(
      () =>
        view(0).contentEl.querySelector(".github-row") !== null &&
        view(1).contentEl.querySelector(".github-row") !== null,
      "file rows in both",
    );
    // Open README.md from the *second* tab; both repos have that path.
    (view(1).contentEl.querySelector(".github-row") as HTMLElement).click();
    await settle();
    expect(view(1).contentEl.querySelectorAll(".github-row.is-active")).toHaveLength(1);
    expect(view(0).contentEl.querySelectorAll(".github-row.is-active")).toHaveLength(0);
  });

  /** Types into the real filter box, the way a user does. Unit-testing the
   * filter language proves the language; only this proves the box is wired to
   * it — deleting the onChange left every language test green. */
  const typeFilter = (view: GitHubListView, value: string): void => {
    const input = view.contentEl.querySelector(
      '.github-list-controls input[aria-label="Filter"]',
    ) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event("input"));
  };

  it("filters the inbox through a typed qualifier", async () => {
    const app = await createApp();
    vi.spyOn(app.github, "listNotifications").mockResolvedValue([
      { ...NOTIFICATIONS[0], id: "m1", title: "Mentioned one", reason: "mention" },
      { ...NOTIFICATIONS[0], id: "a1", title: "Assigned one", reason: "assign" },
    ]);
    await openInbox(app);
    const list = (): GitHubListView =>
      app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0].view as GitHubListView;
    await until(() => list().contentEl.querySelectorAll(".github-row").length === 2, "rows");

    typeFilter(list(), "reason:assign");
    await until(() => list().contentEl.querySelectorAll(".github-row").length === 1, "narrowed");
    expect(list().contentEl.textContent).toContain("Assigned one");
    expect(list().contentEl.textContent).not.toContain("Mentioned one");

    typeFilter(list(), "");
    await until(() => list().contentEl.querySelectorAll(".github-row").length === 2, "restored");
  });

  it("refetches the inbox when is:all changes the requested set", async () => {
    const app = await createApp();
    const fetches = vi.spyOn(app.github, "listNotifications");
    await openInbox(app);
    const list = (): GitHubListView =>
      app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0].view as GitHubListView;
    await until(() => list().contentEl.querySelector(".github-row") !== null, "rows");
    fetches.mockClear();

    // `is:` is the one qualifier that changes what the server is asked for.
    typeFilter(list(), "is:all");
    await until(() => fetches.mock.calls.length > 0, "refetched");
    expect(fetches.mock.calls[0][0]).toMatchObject({ all: true });
  });

  it("filters a query list through a typed qualifier", async () => {
    const app = await createApp();
    vi.spyOn(app.github, "searchInvolvement").mockResolvedValue([
      { ...searchItems("pr")[0], number: 1, title: "Open one", state: "open" },
      { ...searchItems("pr")[1], number: 2, title: "Closed one", state: "closed" },
    ]);
    await openQueryList(app, "pr", "review-requested");
    const list = (): GitHubListView =>
      app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0].view as GitHubListView;
    await until(() => list().contentEl.querySelectorAll(".github-row").length === 2, "rows");

    typeFilter(list(), "state:closed");
    await until(() => list().contentEl.querySelectorAll(".github-row").length === 1, "narrowed");
    expect(list().contentEl.textContent).toContain("Closed one");
  });

  const listOf = (app: App): GitHubListView =>
    app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0]?.view as GitHubListView;

  it("drives its own leaf from a second list tab header", async () => {
    const app = await createApp();
    await openQueryList(app, "pr", "review-requested");
    // A deliberate second list tab, exactly as cmd-activate produces.
    await openQueryList(app, "pr", "created", "tab");
    const leaves = () => app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE);
    await until(() => leaves().length === 2, "two list tabs");
    const second = leaves()[1].view as GitHubListView;
    await until(() => second.headerEl.querySelector(".github-list-nav") !== null, "second header");

    const segment = second.headerEl.querySelector(
      '.github-segmented-control-item[aria-label="Mentioned me"]',
    ) as HTMLElement;
    segment.click();
    await until(() => second.getState().query === "mentioned", "second tab re-targeted");
    // The first tab must not be driven from another tab's header.
    expect((leaves()[0].view as GitHubListView).getState().query).toBe("review-requested");
    expect(leaves()).toHaveLength(2);
  });

  it("does not clobber a re-targeted list when a pending mark-read lands", async () => {
    const app = await createApp();
    let settleRead: (v: string | null) => void = () => {};
    vi.spyOn(app.github, "markNotificationRead").mockReturnValue(
      new Promise((resolve) => {
        settleRead = resolve;
      }),
    );
    await openInbox(app);
    const list = (): GitHubListView =>
      app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0].view as GitHubListView;
    await until(() => list().contentEl.querySelector(".github-row") !== null, "inbox rows");
    // This row is mappable: activating it jumps to the browser.
    vi.stubGlobal("open", () => null);
    (list().contentEl.querySelector(".github-row") as HTMLElement).click();

    // Re-target this leaf while the PATCH is still in flight, and hold the new
    // query in its loading state.
    let settleSearch: (v: GitHubSearchItem[]) => void = () => {};
    vi.spyOn(app.github, "searchInvolvement").mockReturnValue(
      new Promise((resolve) => {
        settleSearch = resolve;
      }),
    );
    await openQueryList(app, "pr", "created");
    await until(() => list().getState().kind === "pr", "re-targeted to a query");
    await until(
      () => list().contentEl.textContent?.includes("Loading") === true,
      "query is loading",
    );

    // The PATCH lands late: it must not repaint this leaf with inbox data.
    settleRead(null);
    await settle();
    expect(list().contentEl.textContent).toContain("Loading");
    expect(list().contentEl.querySelector(".github-row")).toBeNull();

    settleSearch(searchItems("pr"));
    await until(() => list().contentEl.querySelector(".github-repo-chip") !== null, "query rows");
  });

  it("forks a second tab from a modified file row activation", async () => {
    const app = await createApp();
    vi.spyOn(app.github, "listContents").mockResolvedValue([
      { name: "a.ts", path: "a.ts", type: "file", size: 1, sha: "", url: "" },
      { name: "b.ts", path: "b.ts", type: "file", size: 1, sha: "", url: "" },
    ] as RepoContentItem[]);
    vi.spyOn(app.github, "getFileContent").mockResolvedValue({
      path: "a.ts",
      size: 1,
      text: "x",
      isBinary: false,
      htmlUrl: "",
    } as never);
    await openRepo(app, "octo", "notes", "files");
    const repo = (): GitHubRepoView =>
      app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0].view as GitHubRepoView;
    await until(() => repo().contentEl.querySelectorAll(".github-row").length === 2, "file rows");
    const rows = (): HTMLElement[] => [
      ...repo().contentEl.querySelectorAll<HTMLElement>(".github-row"),
    ];
    rows()[0].click();
    await until(() => app.workspace.getLeavesOfType("github-detail").length === 1, "first file");
    await settle();
    rows()[1].dispatchEvent(
      new MouseEvent("click", { bubbles: true, [Platform.isMacOS ? "metaKey" : "ctrlKey"]: true }),
    );
    await until(
      () => app.workspace.getLeavesOfType("github-detail").length === 2,
      "second file tab",
    );
  });

  it("forks a second tab from a modified pull-request commit row activation", async () => {
    const app = await createApp();
    // The shared PR fixture carries no commits; this case needs rows to click.
    vi.spyOn(app.github, "getPullRequest").mockResolvedValue({
      ...PR_DETAIL,
      commits: [
        {
          sha: "aaa1111deadbeef",
          shortSha: "aaa1111",
          messageHeadline: "first commit",
          message: "first commit",
          author: ACTOR,
          committedDate: "2026-07-14T00:00:00Z",
          url: "",
          ciState: null,
        },
      ],
    });
    await openPrDetail(app, "octo", "notes", 7);
    const detail = (): PrDetailView =>
      app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;
    await until(() => detail().contentEl.querySelector(".git-pr-tab") !== null, "detail tabs");
    const commitsTab = [...detail().contentEl.querySelectorAll(".git-pr-tab")].find((el) =>
      el.textContent?.toLowerCase().startsWith("commits"),
    ) as HTMLElement;
    expect(commitsTab).toBeDefined();
    commitsTab.click();
    await until(
      () => detail().contentEl.querySelector(".git-pr-commit-row") !== null,
      "commit rows",
    );
    const row = detail().contentEl.querySelector(".git-pr-commit-row") as HTMLElement;
    row.click();
    await until(
      () => app.workspace.getLeavesOfType(GitCommitView.VIEW_TYPE).length === 1,
      "commit",
    );
    await settle();
    row.dispatchEvent(
      new MouseEvent("click", { bubbles: true, [Platform.isMacOS ? "metaKey" : "ctrlKey"]: true }),
    );
    await until(
      () => app.workspace.getLeavesOfType(GitCommitView.VIEW_TYPE).length === 2,
      "second commit tab",
    );
  });

  it("reuses one query list leaf across queries", async () => {
    const app = await createApp();
    await openGitHubNav(app);
    const view = nav(app);
    await until(
      () => view.contentEl.querySelector('[data-key="query:pr:review-requested"]') !== null,
      "pr queries",
    );
    const click = (key: string): void =>
      (view.contentEl.querySelector(`[data-key="${key}"]`) as HTMLElement).click();
    click("query:pr:review-requested");
    await until(() => listOf(app)?.getState().query === "review-requested", "needs review");
    await settle();
    click("query:pr:created");
    await until(() => listOf(app)?.getState().query === "created", "created by me");
    // One leaf, re-targeted in place — no tab per query.
    expect(app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)).toHaveLength(1);
  });

  it("switches the list query from its tab header", async () => {
    const app = await createApp();
    await openQueryList(app, "pr", "review-requested");
    await until(() => listOf(app)?.getState().query === "review-requested", "needs review");
    const before = countLeaves(app);
    const segment = listOf(app).headerEl.querySelector(
      '.github-segmented-control-item[aria-label="Created by me"]',
    ) as HTMLElement;
    expect(segment).not.toBeNull();
    segment.click();
    await until(() => listOf(app)?.getState().query === "created", "created by me");
    expect(countLeaves(app)).toBe(before);
  });

  it("walks list history with the native back control", async () => {
    const app = await createApp();
    await openGitHubNav(app);
    const view = nav(app);
    await until(
      () => view.contentEl.querySelector('[data-key="query:pr:review-requested"]') !== null,
      "pr queries",
    );
    const highlighted = (): string | undefined =>
      (view.contentEl.querySelector(".github-nav-row.is-active") as HTMLElement | null)?.dataset
        .key;
    await openQueryList(app, "pr", "review-requested");
    await until(() => listOf(app)?.getState().query === "review-requested", "needs review");
    await openQueryList(app, "pr", "created");
    await until(() => listOf(app)?.getState().query === "created", "created by me");

    const leaf = app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)[0];
    leaf.history.back();
    await until(() => listOf(app)?.getState().query === "review-requested", "back to needs review");
    // back()/forward() bypass open.ts entirely: session and sidebar highlight
    // must follow the rendered content, or they drift to the newer target.
    expect(app.github.session.target).toMatchObject({
      query: "review-requested",
    });
    expect(highlighted()).toBe("query:pr:review-requested");

    leaf.history.forward();
    await until(() => listOf(app)?.getState().query === "created", "forward to created by me");
    expect(app.github.session.target).toMatchObject({ query: "created" });
    expect(highlighted()).toBe("query:pr:created");
    expect(app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE)).toHaveLength(1);
  });

  it("opens a second list tab on modified activation", async () => {
    const app = await createApp();
    await openGitHubNav(app);
    const view = nav(app);
    await until(
      () => view.contentEl.querySelector('[data-key="query:pr:review-requested"]') !== null,
      "pr queries",
    );
    (view.contentEl.querySelector('[data-key="query:pr:review-requested"]') as HTMLElement).click();
    await until(() => app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE).length === 1, "list");
    await settle();
    // cmd/ctrl-activate is the only way a second tab appears. Mod is meta on
    // macOS and ctrl elsewhere — press whichever this platform means.
    (view.contentEl.querySelector('[data-key="query:pr:created"]') as HTMLElement).dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        [Platform.isMacOS ? "metaKey" : "ctrlKey"]: true,
      }),
    );
    await until(
      () => app.workspace.getLeavesOfType(GitHubListView.VIEW_TYPE).length === 2,
      "second list tab",
    );
  });

  it("switches repo sub-view in place without a new leaf", async () => {
    const app = await createApp();
    await openRepo(app, "octo", "notes", "overview");
    const repo = (): GitHubRepoView =>
      app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0].view as GitHubRepoView;
    await until(() => repo().headerEl.querySelector(".github-repo-nav") !== null, "repo header");
    const before = countLeaves(app);

    const commitsTab = repo().headerEl.querySelector(
      '.github-segmented-control-item[aria-label="Commits"]',
    ) as HTMLElement;
    commitsTab.click();
    await until(() => repo().contentEl.querySelector(".github-sha") !== null, "commit rows");

    expect(countLeaves(app)).toBe(before);
    expect(app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)).toHaveLength(1);
  });

  it("opens then reuses a single pull-request detail leaf", async () => {
    const app = await createApp();
    await openRepo(app, "octo", "notes", "pulls");
    const repo = (): GitHubRepoView =>
      app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0].view as GitHubRepoView;
    await until(() => repo().contentEl.querySelectorAll(".github-row").length >= 2, "pr rows");
    const detail = (): string =>
      (app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0]?.view as PrDetailView | undefined)
        ?.contentEl.textContent ?? "";
    const rows = repo().contentEl.querySelectorAll<HTMLElement>(".github-row");

    rows[0].click();
    await until(() => detail().includes("Repo PR one"), "first pr");
    rows[1].click();
    await until(() => detail().includes("Repo PR two"), "second pr");

    expect(app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)).toHaveLength(1);
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;
    expect(view.contentEl.querySelector(".review-sidebar")).not.toBeNull();
  });

  it("renders commit diff via the shared review surface", async () => {
    const app = await createApp();
    await openRepo(app, "octo", "notes", "commits");
    const repo = (): GitHubRepoView =>
      app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0].view as GitHubRepoView;
    await until(() => repo().contentEl.querySelector(".github-row") !== null, "commit rows");
    (repo().contentEl.querySelector(".github-row") as HTMLElement).click();
    const detail = (): GitCommitView =>
      app.workspace.getLeavesOfType(GitCommitView.VIEW_TYPE)[0].view as GitCommitView;
    await until(
      () => detail().contentEl.querySelector(".review-sidebar") !== null,
      "review surface",
    );
    expect(detail().contentEl.querySelector(".gh-file-tree")).toBeNull();
  });
});
