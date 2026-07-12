import { describe, expect, it } from "vitest";
import { App } from "../app/App";
import { openPrDetail, openPrList, PrDetailView, PrListView } from "./GitPrViews";
import type { ElectronGitApi, GitExecResult } from "../git/GitService";
import type { HttpResponse, HttpTransport } from "../github/GitHubClient";
import type { PrDetail, PrSummary } from "../github/types";

const SUMMARY: PrSummary = {
  number: 7,
  title: "Add agent relations",
  state: "open",
  isDraft: false,
  author: { login: "card", avatarUrl: "", url: "" },
  headRefName: "feat/relations",
  baseRefName: "main",
  updatedAt: "2026-07-01T00:00:00Z",
  createdAt: "2026-06-01T00:00:00Z",
  url: "https://github.com/x/y/pull/7",
  labels: [{ name: "feat", color: "0e8a16", description: null }],
  reviewDecision: null,
  additions: 3,
  deletions: 1,
  changedFiles: 1,
  ciState: "success",
};

const DETAIL: PrDetail = {
  ...SUMMARY,
  body: "Links agents together.",
  headRefOid: "abc",
  mergeable: true,
  mergeStateStatus: "clean",
  comments: [{ id: "1", author: { login: "reviewer", avatarUrl: "", url: "" }, body: "Looks solid", createdAt: "2026-07-02T00:00:00Z", updatedAt: "2026-07-02T00:00:00Z", url: "" }],
  reviews: [{ id: "2", author: { login: "reviewer", avatarUrl: "", url: "" }, state: "APPROVED", body: "LGTM", submittedAt: "2026-07-02T00:00:00Z", url: "" }],
  reviewComments: [],
  commits: [{ sha: "abcdef0", shortSha: "abcdef0", messageHeadline: "feat: links", message: "feat: links", author: { login: "card", avatarUrl: "", url: "" }, committedDate: "2026-07-01T00:00:00Z", url: "", ciState: null }],
  files: [{ path: "agent.ts", previousPath: null, status: "modified", additions: 3, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new" }],
  checks: [{ name: "ci", status: "completed", conclusion: "success", detailsUrl: null, startedAt: null, completedAt: null }],
  requestedReviewers: [],
  assignees: [],
  milestone: null,
};

function fakeGitBridge(isRepo = true): ElectronGitApi {
  return {
    available: true,
    async exec(args: string[]): Promise<GitExecResult> {
      if (args[0] === "rev-parse") return { code: 0, stdout: isRepo ? "true\n" : "false\n", stderr: "" };
      if (args[0] === "remote" && args[1] === "get-url") {
        return isRepo
          ? { code: 0, stdout: "https://github.com/x/y.git\n", stderr: "" }
          : { code: 1, stdout: "", stderr: "missing" };
      }
      if (args[0] === "status") return { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

function installGithubMocks(app: App, options: {
  authed?: boolean;
  list?: PrSummary[];
  detail?: PrDetail;
  submitCalls?: string[];
} = {}): void {
  const authed = options.authed ?? true;
  const list = options.list ?? [SUMMARY];
  const detail = options.detail ?? DETAIL;
  const submitCalls = options.submitCalls ?? [];

  if (authed) app.secretStorage.setSecret("github-token", "test-token");

  app.github.transportFactory = (): HttpTransport => async ({ url, method, body }) => {
    const path = url.replace(/^https:\/\/api\.github\.com/, "");
    const verb = method ?? "GET";

    if (verb === "GET" && path === "/user") {
      return json(authed ? { login: "card", avatar_url: "", name: "Card" } : null, authed ? 200 : 401);
    }
    if (verb === "GET" && path.startsWith("/repos/x/y/pulls?") && !path.includes("/pulls/")) {
      return json(list);
    }
    if (verb === "GET" && path === "/repos/x/y/pulls/7") {
      if (url.includes("application/vnd.github.v3.diff") || false) return { status: 200, text: "diff --git a/agent.ts b/agent.ts\n", json: null };
      return json(rawPullFromDetail(detail));
    }
    // Accept header path for diff — our client uses separate accept, same URL
    if (verb === "GET" && path === "/repos/x/y/pulls/7" && body === undefined) {
      // handled above
    }
    if (verb === "GET" && path.startsWith("/repos/x/y/issues/7/comments")) return json(detail.comments.map((c, i) => ({ id: i + 1, user: { login: c.author.login }, body: c.body, created_at: c.createdAt, updated_at: c.updatedAt, html_url: "" })));
    if (verb === "GET" && path.startsWith("/repos/x/y/pulls/7/reviews")) return json(detail.reviews.map((r, i) => ({ id: i + 10, user: { login: r.author.login }, state: r.state, body: r.body, submitted_at: r.submittedAt, html_url: "" })));
    if (verb === "GET" && path.startsWith("/repos/x/y/pulls/7/comments")) return json([]);
    if (verb === "GET" && path.startsWith("/repos/x/y/pulls/7/commits")) return json(detail.commits.map((c) => ({ sha: c.sha, html_url: c.url, author: { login: c.author.login }, commit: { message: c.message, author: { date: c.committedDate }, committer: { date: c.committedDate } } })));
    if (verb === "GET" && path.startsWith("/repos/x/y/pulls/7/files")) return json(detail.files.map((f) => ({ filename: f.path, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch })));
    if (verb === "GET" && path.includes("/check-runs")) return json({ check_runs: detail.checks.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion })) });
    if (verb === "POST" && path === "/repos/x/y/pulls/7/reviews") {
      submitCalls.push(JSON.parse(body ?? "{}").event);
      return json({ id: 1 }, 200);
    }
    if (verb === "POST" && path === "/repos/x/y/issues/7/comments") {
      submitCalls.push("comment");
      return json({ id: 1 }, 201);
    }
    return json({ message: `unmocked ${verb} ${path}` }, 404);
  };

  // Diff endpoint uses Accept header; client still hits same path — return text for non-json Accept via transport reading.
  // Override getPullRequestDiff by patching after client uses transport: when Accept is diff, GitHubClient passes accept option.
  // Our mock above returns JSON for pulls/7 — fix by inspecting headers in a richer mock:
  app.github.transportFactory = (): HttpTransport => async ({ url, method, body, headers }) => {
    const path = url.replace(/^https:\/\/api\.github\.com/, "");
    const verb = method ?? "GET";
    if (verb === "GET" && path === "/user") return json(authed ? { login: "card", avatar_url: "", name: "Card" } : null, authed ? 200 : 401);
    if (verb === "GET" && path.startsWith("/repos/x/y/pulls?") && path.includes("state=")) return json(list.map(rawPullFromDetail));
    if (verb === "GET" && path === "/repos/x/y/pulls/7") {
      if (headers?.Accept?.includes("diff")) return { status: 200, text: "diff --git a/agent.ts b/agent.ts\n--- a/agent.ts\n+++ b/agent.ts\n@@ -1 +1 @@\n-old\n+new\n", json: null };
      return json(rawPullFromDetail(detail));
    }
    if (verb === "GET" && path.startsWith("/repos/x/y/issues/7/comments")) return json(detail.comments.map((c, i) => ({ id: i + 1, user: { login: c.author.login }, body: c.body, created_at: c.createdAt, updated_at: c.updatedAt, html_url: "" })));
    if (verb === "GET" && path.startsWith("/repos/x/y/pulls/7/reviews")) return json(detail.reviews.map((r, i) => ({ id: i + 10, user: { login: r.author.login }, state: r.state, body: r.body, submitted_at: r.submittedAt, html_url: "" })));
    if (verb === "GET" && path.startsWith("/repos/x/y/pulls/7/comments")) return json([]);
    if (verb === "GET" && path.startsWith("/repos/x/y/pulls/7/commits")) return json(detail.commits.map((c) => ({ sha: c.sha, html_url: c.url, author: { login: c.author.login }, commit: { message: c.message, author: { date: c.committedDate }, committer: { date: c.committedDate } } })));
    if (verb === "GET" && path.startsWith("/repos/x/y/pulls/7/files")) return json(detail.files.map((f) => ({ filename: f.path, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch })));
    if (verb === "GET" && path.includes("/check-runs")) return json({ check_runs: detail.checks.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion })) });
    if (verb === "POST" && path === "/repos/x/y/pulls/7/reviews") {
      submitCalls.push(JSON.parse(body ?? "{}").event);
      return json({ id: 1 }, 200);
    }
    if (verb === "POST" && path === "/repos/x/y/issues/7/comments") {
      submitCalls.push("comment");
      return json({ id: 1 }, 201);
    }
    return json({ message: `unmocked ${verb} ${path}` }, 404);
  };
}

function rawPullFromDetail(detail: PrSummary | PrDetail) {
  return {
    number: detail.number,
    title: detail.title,
    state: detail.state === "merged" ? "closed" : detail.state,
    merged: detail.state === "merged",
    draft: detail.isDraft,
    body: "body" in detail ? detail.body : "",
    user: { login: detail.author.login, avatar_url: detail.author.avatarUrl, html_url: detail.author.url },
    head: { ref: detail.headRefName, sha: "body" in detail ? detail.headRefOid : "abc" },
    base: { ref: detail.baseRefName },
    html_url: detail.url,
    created_at: detail.createdAt,
    updated_at: detail.updatedAt,
    labels: detail.labels.map((l) => ({ name: l.name, color: l.color, description: l.description })),
    additions: detail.additions,
    deletions: detail.deletions,
    changed_files: detail.changedFiles,
    mergeable: "mergeable" in detail ? detail.mergeable : true,
    requested_reviewers: "requestedReviewers" in detail ? detail.requestedReviewers.map((a) => ({ login: a.login })) : [],
    assignees: "assignees" in detail ? detail.assignees.map((a) => ({ login: a.login })) : [],
    milestone: null,
  };
}

function json(data: unknown, status = 200): HttpResponse {
  return { status, text: data == null ? "" : JSON.stringify(data), json: data };
}

async function appWithGit(isRepo = true): Promise<App> {
  const app = new App(document.createElement("div"));
  app.git.bridgeFactory = () => fakeGitBridge(isRepo);
  (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/fake/vault";
  await app.ready;
  app.github.invalidate();
  return app;
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > 4000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("PR views (cloud GitHub)", () => {
  it("lists pull requests and opens the detail surface on click", async () => {
    const app = await appWithGit();
    installGithubMocks(app);
    await openPrList(app);
    const listView = app.workspace.getLeavesOfType(PrListView.VIEW_TYPE)[0].view as PrListView;

    await until(() => listView.contentEl.querySelector(".git-pr-row-title") !== null, "PR row");
    expect(listView.contentEl.querySelector(".git-pr-row-title")!.textContent).toBe("Add agent relations");
    expect(listView.contentEl.querySelector(".git-pr-row-meta")!.textContent).toContain("feat/relations → main");

    (listView.contentEl.querySelector(".git-pr-row") as HTMLElement).click();
    await until(() => app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE).length > 0, "detail leaf");
  });

  it("renders conversation and approves via the GitHub API", async () => {
    const submitCalls: string[] = [];
    const app = await appWithGit();
    installGithubMocks(app, { submitCalls });
    await openPrDetail(app, 7);
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;

    await until(() => view.contentEl.querySelector(".git-pr-title") !== null, "PR title");
    expect(view.contentEl.querySelector(".git-pr-title")!.textContent).toContain("Add agent relations");
    await until(() => view.contentEl.textContent!.includes("Looks solid"), "comment body");
    await until(() => view.contentEl.textContent!.includes("LGTM"), "review body");

    (view.contentEl.querySelector(".git-pr-action.mod-approve") as HTMLButtonElement).click();
    await until(() => submitCalls.includes("APPROVE"), "approve call");
  });

  it("shows a sign-in panel when no token is stored", async () => {
    const app = await appWithGit();
    installGithubMocks(app, { authed: false });
    app.github.clearToken();
    app.github.invalidate();
    await openPrList(app);
    const listView = app.workspace.getLeavesOfType(PrListView.VIEW_TYPE)[0].view as PrListView;

    await until(() => listView.contentEl.querySelector(".git-pr-signin") !== null, "sign-in panel");
    expect(listView.contentEl.textContent).toContain("Connect GitHub");
    expect(listView.contentEl.textContent).not.toContain("gh auth login");
  });

  it("explains when the vault is not a git repository", async () => {
    const app = await appWithGit(false);
    await openPrList(app);
    const listView = app.workspace.getLeavesOfType(PrListView.VIEW_TYPE)[0].view as PrListView;

    await until(() => listView.contentEl.querySelector(".git-pr-empty-state") !== null, "no-repo hint");
    expect(listView.contentEl.textContent).toMatch(/No GitHub repository|git clone/i);
  });
});
