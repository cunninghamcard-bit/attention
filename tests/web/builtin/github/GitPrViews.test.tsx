import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { PrDetailView } from "@web/builtin/github/GitPrViews";
import { GitHubNavView } from "@web/builtin/github/GitHubNavView";
import { GitHubRepoView } from "@web/builtin/github/GitHubRepoView";
import { openGitHubNav, openPrDetail, openRepo } from "@web/builtin/github/open";
import type { ElectronGitApi, GitExecResult } from "@web/builtin/git/GitService";
import type { HttpResponse, HttpTransport } from "@web/builtin/github/GitHubClient";
import type { PrDetail, PrSummary } from "@web/builtin/github/types";
import { writeGitHubPrPrefs } from "@web/builtin/github/prefs";
import { openGitReview } from "@web/builtin/git/review/GitReviewView";
import { GitNavView } from "@web/builtin/git/review/GitNavView";

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

function installGitHubMocks(
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
        return json(
          detail.comments.map((comment) => ({
            id: comment.id,
            user: { login: comment.author.login, avatar_url: comment.author.avatarUrl },
            body: comment.body,
            created_at: comment.createdAt,
            updated_at: comment.updatedAt,
            html_url: comment.url,
          })),
        );
      if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/pulls/185/reviews"))
        return json(
          detail.reviews.map((review) => ({
            id: review.id,
            user: { login: review.author.login, avatar_url: review.author.avatarUrl },
            state: review.state,
            body: review.body,
            submitted_at: review.submittedAt,
            html_url: review.url,
          })),
        );
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
  writeGitHubPrPrefs({ owner: "coder", repo: "ghostty-web", filter: "open" });
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
    installGitHubMocks(app);
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
    installGitHubMocks(app);
    await openPrDetail(app, "coder", "ghostty-web", 185);
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;

    await until(() => view.contentEl.querySelector(".gh-page-title") !== null, "title");
    expect(view.contentEl.querySelector(".gh-page-title")!.textContent).toContain("Powerline");
    // The number rides the chip row, never the h1 — appended to the title it
    // wraps onto its own orphan line as soon as the title is long.
    expect(view.contentEl.querySelector(".gh-page-title")!.textContent).not.toContain("#185");
    expect(view.contentEl.querySelector(".gh-detail-title-row")!.textContent).toContain("#185");
    await until(() => view.contentEl.querySelector(".review-surface") !== null, "review surface");
    // The tree moved to the right dock (the git plugin's arrangement): the
    // surface runs nav-external, the files publish to the shared session for
    // the docked git-nav leaf, and the dock leaf is actually open.
    const surface = view.contentEl.querySelector(".review-surface") as HTMLElement;
    expect(surface.classList.contains("is-nav-external")).toBe(true);
    expect(app.git.reviewSession.source).toEqual({ kind: "cloud", title: "PR #185" });
    expect(app.git.reviewSession.files.map((file) => file.path)).toEqual([
      "lib/renderer.ts",
      "lib/renderer.test.ts",
    ]);
    // Re-query the leaf inside the predicate (a side leaf can open deferred
    // and swap its view object); the tree nests basenames under folder rows,
    // so the full path lives in data-path, not in text.
    await until(
      () => dockNav(app)?.contentEl.querySelector('[data-path="lib/renderer.ts"]') != null,
      "dock tree",
    );
    expect(view.contentEl.textContent).toMatch(/\+103/);
  });

  /** The docked git-nav leaf's live view — GitNavView once materialized. */
  function dockNav(app: App): GitNavView | null {
    const view = app.workspace.getLeavesOfType(GitNavView.VIEW_TYPE)[0]?.view;
    return view instanceof GitNavView ? view : null;
  }

  /** Opens the PR files tab far enough that the cloud dock bridge is live. */
  async function cloudDockedPr(): Promise<App> {
    const app = await appWithGit();
    installGitHubMocks(app);
    await openPrDetail(app, "coder", "ghostty-web", 185);
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;
    await until(() => view.contentEl.querySelector(".review-surface") !== null, "review surface");
    await until(
      () => app.workspace.getLeavesOfType(GitNavView.VIEW_TYPE).length > 0,
      "git-nav leaf",
    );
    return app;
  }

  // Without its cloud guard, the nav's self-load (it fires on source-change
  // whenever no git-review center exists — and a PR center is not one) asks
  // local git for files and publishes the answer, silently replacing the PR
  // list with the working tree.
  it("keeps the dock tree on the PR's files when the nav self-load path fires", async () => {
    const app = await cloudDockedPr();
    app.git.reviewSession.setSource({ kind: "cloud", title: "PR #185" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.git.reviewSession.files.map((file) => file.path)).toEqual([
      "lib/renderer.ts",
      "lib/renderer.test.ts",
    ]);
  });

  // The dock tree names what it navigates: a PR's files under the bare title
  // "Git" read as local changes. The title follows the source.
  it("titles the dock tree after the cloud review it is navigating", async () => {
    const app = await cloudDockedPr();
    await until(() => dockNav(app) !== null, "materialized nav");
    expect(dockNav(app)!.getDisplayText()).toBe("PR #185");
  });

  // Leaving the files tab detaches the center from the dock; the tree must
  // not stay behind as rows that activate nothing — a dead tree reads worse
  // than the honest empty state.
  it("clears the dock tree when the files tab is left", async () => {
    const app = await cloudDockedPr();
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;
    expect(app.git.reviewSession.files.length).toBeGreaterThan(0);
    headerTab(view, "Conversation")!.click();
    await until(() => app.git.reviewSession.files.length === 0, "cleared dock tree");
  });

  // Without its cloud guard, a tree click "ensures" a git-review center —
  // opening a local working-tree review on top of the PR the user is reading.
  it("keeps a cloud tree click inside the PR center", async () => {
    const app = await cloudDockedPr();
    await until(
      () => dockNav(app)?.contentEl.querySelector('[data-path="lib/renderer.ts"]') != null,
      "row",
    );
    (dockNav(app)!.contentEl.querySelector('[data-path="lib/renderer.ts"]') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.git.reviewSession.selectedPath).toBe("lib/renderer.ts");
    expect(app.workspace.getLeavesOfType("git-review").length).toBe(0);
  });

  // Without its cloud guard, the local git-review leaf reloads against the
  // cloud source (no local ref) and republishes local git's answer over the
  // cloud file list.
  it("leaves the local git review leaf alone when a cloud source arrives", async () => {
    const app = await appWithGit();
    installGitHubMocks(app);
    await openGitReview(app);
    await until(() => app.workspace.getLeavesOfType("git-review").length > 0, "git-review leaf");
    const session = app.git.reviewSession;
    session.setSource({ kind: "cloud", title: "PR #185" });
    session.publishFiles([{ path: "cloud.ts", status: "modified", additions: 1, deletions: 0 }]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(session.files.map((file) => file.path)).toEqual(["cloud.ts"]);
  });

  async function stateChipFor(detail: PrDetail): Promise<HTMLElement> {
    const app = await appWithGit();
    installGitHubMocks(app, { detail });
    await openPrDetail(app, "coder", "ghostty-web", 185);
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;
    await until(() => view.contentEl.querySelector(".gh-chip") !== null, "PR state chip");
    return view.contentEl.querySelector(".gh-chip") as HTMLElement;
  }

  it("shows an open PR's state chip in the detail header", async () => {
    const chip = await stateChipFor(DETAIL);
    expect(chip.textContent).toBe("open");
    expect(chip.classList.contains("mod-open")).toBe(true);
  });

  it("maps a merged PR to the merged state chip", async () => {
    const chip = await stateChipFor({ ...DETAIL, state: "merged" });
    expect(chip.textContent).toBe("merged");
    expect(chip.classList.contains("mod-merged")).toBe(true);
  });

  it("shows a draft PR as draft rather than open", async () => {
    const chip = await stateChipFor({ ...DETAIL, isDraft: true });
    expect(chip.textContent).toBe("draft");
    expect(chip.classList.contains("mod-draft")).toBe(true);
  });

  // GitHub leaves draft:true on a draft closed without merging. An
  // unconditional draft check reports "draft" and hides that it is closed.
  it("shows a closed draft PR as closed, not draft", async () => {
    const chip = await stateChipFor({ ...DETAIL, state: "closed", isDraft: true });
    expect(chip.textContent).toBe("closed");
    expect(chip.classList.contains("mod-closed")).toBe(true);
  });

  it("flairs a closed draft PR as closed in the repo list", async () => {
    const app = await appWithGit();
    installGitHubMocks(app, { list: [{ ...SUMMARY, state: "closed", isDraft: true }] });
    await openRepo(app, "coder", "ghostty-web", "pulls");
    const view = app.workspace.getLeavesOfType(GitHubRepoView.VIEW_TYPE)[0].view as GitHubRepoView;
    await until(() => view.contentEl.querySelector(".github-pr-state") !== null, "state flair");
    const flair = view.contentEl.querySelector(".github-pr-state") as HTMLElement;
    expect(flair.classList.contains("mod-closed")).toBe(true);
    expect(flair.classList.contains("mod-draft")).toBe(false);
  });

  /** The tab switcher lives in the real view-header now (icon buttons, labels
   * in aria/tooltip) — the repo view's pattern, not an in-body pill. */
  function headerTab(view: PrDetailView, label: string): HTMLButtonElement | null {
    return view.headerEl.querySelector(`.github-pr-nav [aria-label^="${label}"]`);
  }

  async function conversationOf(app: App): Promise<PrDetailView> {
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;
    await until(() => headerTab(view, "Conversation") !== null, "detail tabs");
    headerTab(view, "Conversation")!.click();
    await until(() => view.contentEl.querySelector(".gh-composer-actions") !== null, "actions");
    return view;
  }

  function actionByText(view: PrDetailView, text: string): HTMLButtonElement | undefined {
    return [...view.contentEl.querySelectorAll(".gh-composer-action")].find((el) =>
      (el.textContent ?? "").includes(text),
    ) as HTMLButtonElement | undefined;
  }

  /** Close/Reopen lives in the real view header now — the issue page's spot. */
  function headerAction(view: PrDetailView, label: string): HTMLElement | null {
    return view.headerEl.querySelector(`.view-action[aria-label="${label}"]`);
  }

  // No new client method: GitHub keeps PRs in the issues namespace, so the
  // issue state PATCH is what closes a pull request.
  it("closes a pull request through the issue state endpoint", async () => {
    const app = await appWithGit();
    installGitHubMocks(app);
    const update = vi.spyOn(app.github, "updateIssueState").mockResolvedValue(null);
    await openPrDetail(app, "coder", "ghostty-web", 185);
    const view = await conversationOf(app);

    headerAction(view, "Close pull request")!.click();
    await until(() => update.mock.calls.length > 0, "updateIssueState call");
    expect(update).toHaveBeenCalledWith(185, "closed", {
      owner: "coder",
      repo: "ghostty-web",
      host: "github.com",
    });
  });

  it("offers reopen on a closed pull request", async () => {
    const app = await appWithGit();
    installGitHubMocks(app, { detail: { ...DETAIL, state: "closed" } });
    const update = vi.spyOn(app.github, "updateIssueState").mockResolvedValue(null);
    await openPrDetail(app, "coder", "ghostty-web", 185);
    const view = await conversationOf(app);

    headerAction(view, "Reopen pull request")!.click();
    await until(() => update.mock.calls.length > 0, "updateIssueState call");
    expect(update).toHaveBeenCalledWith(185, "open", {
      owner: "coder",
      repo: "ghostty-web",
      host: "github.com",
    });
  });

  it("offers no state toggle on a merged pull request", async () => {
    const app = await appWithGit();
    installGitHubMocks(app, { detail: { ...DETAIL, state: "merged" } });
    await openPrDetail(app, "coder", "ghostty-web", 185);
    const view = await conversationOf(app);

    // Merged is terminal — neither action is on offer.
    expect(headerAction(view, "Close pull request")).toBeNull();
    expect(headerAction(view, "Reopen pull request")).toBeNull();
  });

  // Tabs are an in-memory redraw from the cached detail — switching must not
  // re-download the pull request. Wiring tabs through setViewState would make
  // every click a full refetch (setState loads unconditionally); this pins
  // the cheap path until tabs formally join history with a refetch gate.
  it("switches tabs without re-downloading the pull request", async () => {
    const app = await appWithGit();
    installGitHubMocks(app);
    const load = vi.spyOn(app.github, "getPullRequest");
    await openPrDetail(app, "coder", "ghostty-web", 185);
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;
    await until(() => headerTab(view, "Conversation") !== null, "detail tabs");
    const loadsAfterOpen = load.mock.calls.length;

    headerTab(view, "Conversation")!.click();
    headerTab(view, "Commits")!.click();
    headerTab(view, "Files changed")!.click();
    await until(() => view.contentEl.querySelector(".review-sidebar") !== null, "files tab back");
    expect(load.mock.calls.length).toBe(loadsAfterOpen);
  });

  // The conversation drew only the description before: the comments and
  // reviews sat unrendered in PrDetail. A comment becomes a card; a submitted
  // review becomes a card wearing its verdict chip.
  it("renders comments and review verdicts as conversation cards", async () => {
    const app = await appWithGit();
    installGitHubMocks(app, {
      detail: {
        ...DETAIL,
        comments: [
          {
            id: "c1",
            author: { login: "reviewer-a", avatarUrl: "", url: "" },
            body: "Looks close — one nit inline.",
            createdAt: "2026-07-11T11:00:00Z",
            updatedAt: "2026-07-11T11:00:00Z",
            url: "",
          },
        ],
        reviews: [
          {
            id: "r1",
            author: { login: "reviewer-b", avatarUrl: "", url: "" },
            state: "APPROVED",
            body: "Ship it.",
            submittedAt: "2026-07-11T12:00:00Z",
            url: "",
          },
        ],
      },
    });
    await openPrDetail(app, "coder", "ghostty-web", 185);
    const view = await conversationOf(app);

    // Card bodies land asynchronously — the markdown renderer fills them in.
    const cards = (): Element[] => [...view.contentEl.querySelectorAll(".gh-issue-main .gh-card")];
    await until(
      () => cards().some((card) => card.textContent?.includes("one nit inline")),
      "comment card",
    );
    await until(
      () => cards().some((card) => card.textContent?.includes("Ship it.")),
      "review card",
    );
    const reviewCard = cards().find((card) => card.textContent?.includes("Ship it."));
    expect(reviewCard!.querySelector(".gh-chip.mod-approved")?.textContent).toBe("approved");
  });

  it("approves through the GitHub API", async () => {
    const submitCalls: string[] = [];
    const app = await appWithGit();
    installGitHubMocks(app, { submitCalls });
    await openPrDetail(app, "coder", "ghostty-web", 185);
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;

    await until(() => headerTab(view, "Conversation") !== null, "detail tabs");
    headerTab(view, "Conversation")!.click();
    await until(() => actionByText(view, "Approve") !== undefined, "approve");
    actionByText(view, "Approve")!.click();
    await until(() => submitCalls.includes("APPROVE"), "approve call");
  });

  // Every write on this view is a POST that creates something, and GitHub keeps
  // both copies. The mock takes 50ms to stand in for a real round trip; that
  // delay is not what exposes the bug, though — two synchronous clicks both run
  // before any microtask, so the second lands mid-flight however fast the
  // request resolves. The delay is realism, not the mechanism.
  it("posts one comment when an impatient user clicks twice", async () => {
    const app = await appWithGit();
    installGitHubMocks(app);
    const create = vi
      .spyOn(app.github, "createComment")
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(null), 50)));
    await openPrDetail(app, "coder", "ghostty-web", 185);
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;

    await until(() => headerTab(view, "Conversation") !== null, "detail tabs");
    headerTab(view, "Conversation")!.click();
    await until(
      () => view.contentEl.querySelector(".gh-composer-action.mod-cta") !== null,
      "comment",
    );

    const input = view.contentEl.querySelector(".gh-composer textarea") as HTMLTextAreaElement;
    const comment = view.contentEl.querySelector(
      ".gh-composer-action.mod-cta",
    ) as HTMLButtonElement;
    input.value = "looks good";
    input.dispatchEvent(new Event("input"));
    // Proves the first click is a real click: a permanently disabled button
    // would also "post once", and that green would mean nothing.
    expect(comment.disabled).toBe(false);

    comment.click();
    comment.click();
    await until(() => create.mock.calls.length > 0, "comment call");
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(create).toHaveBeenCalledTimes(1);
  });

  // The review surface disables its footer while a submit is in flight, and a
  // pointer's second click lands on the redrawn disabled button — so clicking
  // the *current* button twice proves nothing about the operation. Holding the
  // reference from before the redraw is what asks the real question: can the
  // submit be entered twice at all?
  it("submits one review even when the click beats the redraw", async () => {
    const app = await appWithGit();
    installGitHubMocks(app);
    const submit = vi
      .spyOn(app.github, "submitReview")
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(null), 50)));
    await openPrDetail(app, "coder", "ghostty-web", 185);
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;

    await until(() => view.contentEl.querySelector(".review-sidebar") !== null, "review surface");
    await until(
      () => view.contentEl.querySelector(".review-action.mod-approve") !== null,
      "approve button",
    );
    const approve = view.contentEl.querySelector(".review-action.mod-approve") as HTMLButtonElement;
    // Not disabled to begin with: a button that could never fire would also
    // "submit once", and that green would mean nothing.
    expect(approve.disabled).toBe(false);

    approve.click();
    approve.click();
    await until(() => submit.mock.calls.length > 0, "review call");
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(submit).toHaveBeenCalledTimes(1);
  });

  // The review footer is the same shared composer the issue and PR
  // conversation pages use — the third box of the three. Typing must render a
  // live markdown preview, and Comment must gate on an empty body while
  // Approve stays available (an approval needs no summary).
  it("gives the review footer the shared composer with a live preview", async () => {
    const app = await appWithGit();
    installGitHubMocks(app);
    await openPrDetail(app, "coder", "ghostty-web", 185);
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;

    await until(
      () => view.contentEl.querySelector(".review-submit-bar .gh-composer textarea") !== null,
      "footer composer",
    );
    const ta = view.contentEl.querySelector(
      ".review-submit-bar .gh-composer textarea",
    ) as HTMLTextAreaElement;
    const preview = view.contentEl.querySelector(
      ".review-submit-bar .gh-composer-preview",
    ) as HTMLElement;
    const comment = [...view.contentEl.querySelectorAll(".gh-composer-action")].find((el) =>
      el.textContent?.includes("Comment"),
    ) as HTMLButtonElement;
    const approve = view.contentEl.querySelector(
      ".gh-composer-action.mod-approve",
    ) as HTMLButtonElement;
    expect(comment.disabled).toBe(true);
    expect(approve.disabled).toBe(false);

    ta.value = "**needs work**";
    ta.dispatchEvent(new Event("input"));
    expect(comment.disabled).toBe(false);
    await until(() => preview.querySelector("strong") !== null, "rendered preview");
    expect(preview.querySelector("strong")!.textContent).toBe("needs work");
  });

  it("opens browser device login from the signed-out view", async () => {
    const openExternal = vi.fn(async () => {});
    vi.stubGlobal("electron", { shell: { openExternal } });
    const app = await appWithGit();
    installGitHubMocks(app, { authed: false });
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
    installGitHubMocks(app, { authed: false });
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
