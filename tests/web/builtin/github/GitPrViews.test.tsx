import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { PrDetailView } from "@web/builtin/github/GitPrViews";
import { GitHubNavView } from "@web/builtin/github/GitHubNavView";
import { GitHubRepoView } from "@web/builtin/github/GitHubRepoView";
import { openGitHubNav, openPrDetail, openRepo } from "@web/builtin/github/open";
import type { ElectronGitApi, GitExecResult } from "@web/builtin/git/GitService";
import type { HttpResponse, HttpTransport } from "@web/builtin/github/GitHubClient";
import type { PrDetail, PrSummary } from "@web/builtin/github/types";
import { writeGithubPrPrefs } from "@web/builtin/github/prefs";

afterEach(() => vi.unstubAllGlobals());

// jsdom lacks ResizeObserver; the shared ReviewSurface's pierre CodeView needs
// it. Real desktop/web runtimes provide it natively.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

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
  commits: [
    {
      sha: "deadbeef01",
      shortSha: "deadbee",
      messageHeadline: "fix: powerline",
      message: "fix: powerline",
      author: { login: "cunninghamcard-bit", avatarUrl: "", url: "" },
      committedDate: "2026-07-11T10:00:00Z",
      url: "",
      ciState: null,
    },
  ],
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
      if (args[0] === "rev-parse")
        return { code: 0, stdout: isRepo ? "true\n" : "false\n", stderr: "" };
      if (args[0] === "remote" && args[1] === "get-url") {
        return isRepo
          ? {
              code: 0,
              stdout: "https://github.com/coder/ghostty-web.git\n",
              stderr: "",
            }
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

function installGithubMocks(
  app: App,
  options: {
    authed?: boolean;
    list?: PrSummary[];
    detail?: PrDetail;
    submitCalls?: string[];
  } = {},
): void {
  const authed = options.authed ?? true;
  const list = options.list ?? [SUMMARY];
  const detail = options.detail ?? DETAIL;
  const submitCalls = options.submitCalls ?? [];
  if (authed) app.secretStorage.setSecret("github-token", "test-token");

  app.github.transportFactory =
    (): HttpTransport =>
    async ({ url, method, body, headers }) => {
      const path = url.replace(/^https:\/\/api\.github\.com/, "");
      const verb = method ?? "GET";
      if (verb === "GET" && path === "/user") {
        return json(
          authed ? { login: "cunninghamcard-bit", avatar_url: "", name: "Card" } : null,
          authed ? 200 : 401,
        );
      }
      if (verb === "GET" && path.startsWith("/user/orgs")) {
        return json([{ login: "acme-corp", avatar_url: "", description: "Acme" }]);
      }
      if (verb === "GET" && path.startsWith("/user/repos")) {
        return json([
          {
            name: "ghostty-web",
            full_name: "coder/ghostty-web",
            private: false,
            description: "web",
            open_issues_count: 1,
            owner: { login: "coder" },
          },
          {
            name: "along",
            full_name: "cunninghamcard-bit/along",
            private: false,
            description: "along",
            open_issues_count: 0,
            owner: { login: "cunninghamcard-bit" },
          },
        ]);
      }
      if (
        verb === "GET" &&
        path.startsWith("/repos/coder/ghostty-web/pulls?") &&
        path.includes("state=")
      ) {
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
      if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/issues/185/comments"))
        return json([]);
      if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/pulls/185/reviews"))
        return json([]);
      if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/pulls/185/comments"))
        return json([]);
      if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/pulls/185/commits")) {
        return json(
          detail.commits.map((c) => ({
            sha: c.sha,
            html_url: c.url,
            author: { login: c.author.login },
            commit: {
              message: c.message,
              author: { date: c.committedDate },
              committer: { date: c.committedDate },
            },
          })),
        );
      }
      if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/pulls/185/files")) {
        return json(
          detail.files.map((f) => ({
            filename: f.path,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch,
          })),
        );
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
    user: {
      login: detail.author.login,
      avatar_url: detail.author.avatarUrl,
      html_url: detail.author.url,
    },
    head: {
      ref: detail.headRefName,
      sha: "body" in detail ? detail.headRefOid : "deadbeef",
    },
    base: { ref: detail.baseRefName },
    html_url: detail.url,
    created_at: detail.createdAt,
    updated_at: detail.updatedAt,
    labels: detail.labels.map((l) => ({
      name: l.name,
      color: l.color,
      description: l.description,
    })),
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

function navOf(app: App): GitHubNavView {
  return app.workspace.getLeavesOfType(GitHubNavView.VIEW_TYPE)[0].view as GitHubNavView;
}

describe("PR views (cloud, ghostty-web calibrated)", () => {
  it("lists pull requests in a repository tab", async () => {
    const app = await appWithGit();
    installGithubMocks(app);
    await openRepo(app, "coder", "ghostty-web", "pulls");
    const view = app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0].view as GitHubRepoView;

    await until(() => view.contentEl.querySelector(".github-row") !== null, "PR row");
    expect(view.contentEl.textContent).toContain("Powerline");
    expect(view.contentEl.textContent).toContain("fix/powerline-vector-glyphs");

    (view.contentEl.querySelector(".github-row") as HTMLElement).click();
    await until(
      () => app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE).length > 0,
      "detail leaf",
    );
  });

  it("renders PR metadata and files through the review surface", async () => {
    const app = await appWithGit();
    installGithubMocks(app);
    await openPrDetail(app, "coder", "ghostty-web", 185);
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;

    await until(() => view.contentEl.querySelector(".git-pr-title") !== null, "title");
    expect(view.contentEl.querySelector(".git-pr-title")!.textContent).toContain("Powerline");
    await until(() => view.contentEl.querySelector(".review-sidebar") !== null, "review surface");
    expect(view.contentEl.textContent).toContain("lib/renderer.ts");
    expect(view.contentEl.textContent).toContain("lib/renderer.test.ts");
    expect(view.contentEl.textContent).toMatch(/\+103/);
  });

  it("approves through the GitHub API", async () => {
    const submitCalls: string[] = [];
    const app = await appWithGit();
    installGithubMocks(app, { submitCalls });
    await openPrDetail(app, "coder", "ghostty-web", 185);
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;

    await until(() => view.contentEl.querySelector(".git-pr-title") !== null, "title");
    // switch to conversation for review bar
    const convTab = [...view.contentEl.querySelectorAll(".git-pr-tab")].find((el) =>
      el.textContent?.includes("Conversation"),
    ) as HTMLButtonElement;
    convTab?.click();
    await until(
      () => view.contentEl.querySelector(".git-pr-action.mod-approve") !== null,
      "approve",
    );
    (view.contentEl.querySelector(".git-pr-action.mod-approve") as HTMLButtonElement).click();
    await until(() => submitCalls.includes("APPROVE"), "approve call");
  });

  it("opens browser device login from the signed-out view", async () => {
    const openExternal = vi.fn(async () => {});
    vi.stubGlobal("electron", { shell: { openExternal } });
    const app = await appWithGit();
    installGithubMocks(app, { authed: false });
    app.github.clearToken();
    app.github.oauthClientId = "test-client-id";
    vi.spyOn(app.github, "startDeviceLogin").mockResolvedValue({
      clientId: "test-client-id",
      deviceCode: "device-code",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      verificationUriComplete: "https://github.com/login/device/authorize",
      expiresIn: 900,
      interval: 5,
    });
    vi.spyOn(app.github, "completeDeviceLogin").mockReturnValue(new Promise(() => {}));
    app.github.invalidate();
    await openGitHubNav(app);
    const nav = navOf(app);
    await until(() => nav.contentEl.querySelector(".git-pr-signin") !== null, "sign-in");
    expect(nav.contentEl.textContent).toContain("Connect GitHub");
    const login = [...nav.contentEl.querySelectorAll("button")].find(
      (element) => element.textContent === "Login with GitHub",
    ) as HTMLButtonElement;
    expect(login.disabled).toBe(false);
    login.click();
    await until(() => nav.contentEl.textContent?.includes("ABCD-EFGH") ?? false, "device code");
    const connect = [...nav.contentEl.querySelectorAll("button")].find(
      (element) => element.textContent === "Copy code and open GitHub",
    ) as HTMLButtonElement;
    connect.click();
    expect(openExternal).toHaveBeenCalledWith("https://github.com/login/device");
    const fallback = [...nav.contentEl.querySelectorAll("button")].find(
      (element) => element.textContent === "Login with personal GitHub token",
    ) as HTMLButtonElement;
    fallback.click();
    expect(login.hidden).toBe(true);
    expect(nav.contentEl.querySelector<HTMLElement>(".git-pr-device-state")?.hidden).toBe(true);
    fallback.click();
    expect(login.hidden).toBe(false);
    expect(nav.contentEl.querySelector<HTMLElement>(".git-pr-device-state")?.hidden).toBe(false);
  });

  it("keeps personal-token login available without an OAuth client ID", async () => {
    const app = await appWithGit();
    installGithubMocks(app, { authed: false });
    app.github.clearToken();
    app.github.oauthClientId = "";
    app.github.invalidate();
    await openGitHubNav(app);
    const nav = navOf(app);
    await until(() => nav.contentEl.querySelector(".git-pr-signin") !== null, "sign-in");

    const login = [...nav.contentEl.querySelectorAll("button")].find(
      (element) => element.textContent === "Login with GitHub",
    ) as HTMLButtonElement;
    expect(login.disabled).toBe(true);
    expect(nav.contentEl.textContent).toContain(
      "GitHub browser login is not configured in this build.",
    );

    const fallback = [...nav.contentEl.querySelectorAll("button")].find(
      (element) => element.textContent === "Login with personal GitHub token",
    ) as HTMLButtonElement;
    fallback.click();
    expect(login.hidden).toBe(true);
    expect(nav.contentEl.querySelector('input[type="password"]')).not.toBeNull();
  });
});
