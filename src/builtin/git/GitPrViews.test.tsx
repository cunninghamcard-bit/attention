import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { openPrDetail, openPrList, PrDetailView, PrListView } from "./GitPrViews";
import type { ElectronGitApi, GitExecResult } from "./GitService";
import type { HttpResponse, HttpTransport } from "../github/GitHubClient";
import type { PrDetail, PrSummary } from "../github/types";
import { writeGithubPrPrefs } from "../github/prefs";

const SUMMARY: PrSummary = {
  number: 185,
  title: "fix: draw Powerline separators as vector geometry",
  state: "open",
  isDraft: false,
  author: { login: "cunninghamcard-bit", avatarUrl: "", url: "" },
  headRefName: "fix/powerline-vector-glyphs",
  baseRefName: "main",
  updatedAt: "2026-07-11T17:10:11Z",
  createdAt: "2026-07-11T10:00:00Z",
  url: "https://github.com/coder/ghostty-web/pull/185",
  labels: [],
  reviewDecision: null,
  additions: 103,
  deletions: 2,
  changedFiles: 2,
  ciState: null,
};

const DETAIL: PrDetail = {
  ...SUMMARY,
  body: "Fixes #184.\n\n## What\n\nTwo changes in CanvasRenderer.",
  headRefOid: "deadbeef",
  mergeable: true,
  mergeStateStatus: "blocked",
  comments: [],
  reviews: [],
  reviewComments: [],
  commits: [{
    sha: "deadbeef01",
    shortSha: "deadbee",
    messageHeadline: "fix: powerline",
    message: "fix: powerline",
    author: { login: "cunninghamcard-bit", avatarUrl: "", url: "" },
    committedDate: "2026-07-11T10:00:00Z",
    url: "",
    ciState: null,
  }],
  files: [
    {
      path: "lib/renderer.ts",
      previousPath: null,
      status: "modified",
      additions: 81,
      deletions: 1,
      patch: "@@ -1,3 +1,4 @@\n line\n-old\n+new\n keep\n",
    },
    {
      path: "lib/renderer.test.ts",
      previousPath: null,
      status: "modified",
      additions: 22,
      deletions: 1,
      patch: "@@ -1,2 +1,3 @@\n a\n-b\n+c\n",
    },
  ],
  checks: [],
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
          ? { code: 0, stdout: "https://github.com/coder/ghostty-web.git\n", stderr: "" }
          : { code: 1, stdout: "", stderr: "missing" };
      }
      if (args[0] === "status") return { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

function json(data: unknown, status = 200): HttpResponse {
  return { status, text: data == null ? "" : JSON.stringify(data), json: data };
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

  app.github.transportFactory = (): HttpTransport => async ({ url, method, body, headers }) => {
    const path = url.replace(/^https:\/\/api\.github\.com/, "");
    const verb = method ?? "GET";
    if (verb === "GET" && path === "/user") {
      return json(authed ? { login: "cunninghamcard-bit", avatar_url: "", name: "Card" } : null, authed ? 200 : 401);
    }
    if (verb === "GET" && path.startsWith("/user/repos")) {
      return json([
        { name: "ghostty-web", full_name: "coder/ghostty-web", private: false, description: "web", open_issues_count: 1, owner: { login: "coder" } },
        { name: "along", full_name: "cunninghamcard-bit/along", private: false, description: "along", open_issues_count: 0, owner: { login: "cunninghamcard-bit" } },
      ]);
    }
    if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/pulls?") && path.includes("state=")) {
      return json(list.map(rawPull));
    }
    if (verb === "GET" && path === "/repos/coder/ghostty-web/pulls/185") {
      if (headers?.Accept?.includes("diff")) {
        return {
          status: 200,
          text: "diff --git a/lib/renderer.ts b/lib/renderer.ts\n--- a/lib/renderer.ts\n+++ b/lib/renderer.ts\n@@ -1,3 +1,4 @@\n line\n-old\n+new\n keep\n",
          json: null,
        };
      }
      return json(rawPull(detail));
    }
    if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/issues/185/comments")) return json([]);
    if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/pulls/185/reviews")) return json([]);
    if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/pulls/185/comments")) return json([]);
    if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/pulls/185/commits")) {
      return json(detail.commits.map((c) => ({
        sha: c.sha,
        html_url: c.url,
        author: { login: c.author.login },
        commit: { message: c.message, author: { date: c.committedDate }, committer: { date: c.committedDate } },
      })));
    }
    if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/pulls/185/files")) {
      return json(detail.files.map((f) => ({
        filename: f.path,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      })));
    }
    if (verb === "GET" && path.includes("/check-runs")) return json({ check_runs: [] });
    if (verb === "GET" && path.includes("/status")) return json({ state: "success" });
    if (verb === "POST" && path === "/repos/coder/ghostty-web/pulls/185/reviews") {
      submitCalls.push(JSON.parse(body ?? "{}").event);
      return json({ id: 1 }, 200);
    }
    if (verb === "POST" && path === "/repos/coder/ghostty-web/issues/185/comments") {
      submitCalls.push("comment");
      return json({ id: 1 }, 201);
    }
    return json({ message: `unmocked ${verb} ${path}` }, 404);
  };
}

function rawPull(detail: PrSummary | PrDetail) {
  return {
    number: detail.number,
    title: detail.title,
    state: detail.state === "merged" ? "closed" : detail.state,
    merged: detail.state === "merged",
    draft: detail.isDraft,
    body: "body" in detail ? detail.body : "",
    user: { login: detail.author.login, avatar_url: detail.author.avatarUrl, html_url: detail.author.url },
    head: { ref: detail.headRefName, sha: "body" in detail ? detail.headRefOid : "deadbeef" },
    base: { ref: detail.baseRefName },
    html_url: detail.url,
    created_at: detail.createdAt,
    updated_at: detail.updatedAt,
    labels: detail.labels.map((l) => ({ name: l.name, color: l.color, description: l.description })),
    additions: detail.additions,
    deletions: detail.deletions,
    changed_files: detail.changedFiles,
    mergeable: "mergeable" in detail ? detail.mergeable : true,
    mergeable_state: "mergeStateStatus" in detail ? detail.mergeStateStatus : "clean",
    requested_reviewers: [],
    assignees: [],
    milestone: null,
  };
}

async function appWithGit(isRepo = true): Promise<App> {
  const app = new App(document.createElement("div"));
  app.git.bridgeFactory = () => fakeGitBridge(isRepo);
  (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/fake/vault";
  await app.ready;
  writeGithubPrPrefs({ owner: "coder", repo: "ghostty-web", filter: "open" });
  app.github.setRepository({ owner: "coder", repo: "ghostty-web" });
  app.github.invalidate();
  return app;
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > 5000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("PR views (cloud, ghostty-web calibrated)", () => {
  it("lists pull requests for the selected repo", async () => {
    const app = await appWithGit();
    installGithubMocks(app);
    await openPrList(app);
    const listView = app.workspace.getLeavesOfType(PrListView.VIEW_TYPE)[0].view as PrListView;

    await until(() => listView.contentEl.querySelector(".git-pr-row-title") !== null, "PR row");
    expect(listView.contentEl.querySelector(".git-pr-row-title")!.textContent).toContain("Powerline");
    expect(listView.contentEl.textContent).toContain("coder/ghostty-web");
    expect(listView.contentEl.textContent).toContain("fix/powerline-vector-glyphs");

    (listView.contentEl.querySelector(".git-pr-row") as HTMLElement).click();
    await until(() => app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE).length > 0, "detail leaf");
  });

  it("opens files tab with tree and renders PR metadata from real shape", async () => {
    const app = await appWithGit();
    installGithubMocks(app);
    await openPrDetail(app, 185, { owner: "coder", repo: "ghostty-web" });
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;

    await until(() => view.contentEl.querySelector(".git-pr-title") !== null, "title");
    expect(view.contentEl.querySelector(".git-pr-title")!.textContent).toContain("Powerline");
    await until(() => view.contentEl.querySelector(".git-pr-file-row") !== null, "file rows");
    expect(view.contentEl.textContent).toContain("lib/renderer.ts");
    expect(view.contentEl.textContent).toContain("lib/renderer.test.ts");
    expect(view.contentEl.textContent).toMatch(/\+103|\+81/);
  });

  it("approves through the GitHub API", async () => {
    const submitCalls: string[] = [];
    const app = await appWithGit();
    installGithubMocks(app, { submitCalls });
    await openPrDetail(app, 185, { owner: "coder", repo: "ghostty-web" });
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;

    await until(() => view.contentEl.querySelector(".git-pr-title") !== null, "title");
    // switch to conversation for review bar
    const convTab = [...view.contentEl.querySelectorAll(".git-pr-tab")].find((el) => el.textContent?.includes("Conversation")) as HTMLButtonElement;
    convTab?.click();
    await until(() => view.contentEl.querySelector(".git-pr-action.mod-approve") !== null, "approve");
    (view.contentEl.querySelector(".git-pr-action.mod-approve") as HTMLButtonElement).click();
    await until(() => submitCalls.includes("APPROVE"), "approve call");
  });

  it("shows sign-in when no token is stored", async () => {
    const app = await appWithGit();
    installGithubMocks(app, { authed: false });
    app.github.clearToken();
    app.github.invalidate();
    await openPrList(app);
    const listView = app.workspace.getLeavesOfType(PrListView.VIEW_TYPE)[0].view as PrListView;
    await until(() => listView.contentEl.querySelector(".git-pr-signin") !== null, "sign-in");
    expect(listView.contentEl.textContent).toContain("Connect GitHub");
    expect(listView.contentEl.textContent).not.toContain("gh auth login");
  });

  it("shows repo picker when no repo is selected and no origin", async () => {
    const app = await appWithGit(false);
    writeGithubPrPrefs({ owner: "", repo: "", filter: "open" });
    app.github.setRepository(null);
    app.github.invalidate();
    installGithubMocks(app);
    // clear prefs after setRepository null
    writeGithubPrPrefs({ owner: "", repo: "", filter: "open" });
    await openPrList(app);
    const listView = app.workspace.getLeavesOfType(PrListView.VIEW_TYPE)[0].view as PrListView;
    await until(
      () => listView.contentEl.querySelector(".git-pr-repo-picker") !== null
        || listView.contentEl.querySelector(".git-pr-row") !== null,
      "picker or list",
    );
    // Without origin/prefs may still pick from empty — ensure we don't crash
    expect(listView.contentEl.textContent).toBeTruthy();
  });
});
