import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import { GitCommitView, GitHubWorkspaceView, openCommitDetail, openGitHubWorkspace } from "@web/builtin/github/GitHubWorkspace";
import type { ElectronGitApi, GitExecResult } from "@web/builtin/git/GitService";
import type { HttpResponse, HttpTransport } from "@web/builtin/github/GitHubClient";
import { writeGithubPrPrefs } from "@web/builtin/github/prefs";

function json(data: unknown, status = 200): HttpResponse {
  return { status, text: JSON.stringify(data), json: data };
}

function fakeGit(): ElectronGitApi {
  return {
    available: true,
    async exec(args: string[]): Promise<GitExecResult> {
      if (args[0] === "rev-parse") return { code: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "remote") return { code: 0, stdout: "https://github.com/coder/ghostty-web.git\n", stderr: "" };
      if (args[0] === "status") return { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

function installMocks(app: App): void {
  app.secretStorage.setSecret("github-token", "tok");
  app.github.transportFactory = (): HttpTransport => async ({ url, method, headers }) => {
    const path = url.replace(/^https:\/\/api\.github\.com/, "");
    const verb = method ?? "GET";
    if (verb === "GET" && path === "/user") return json({ login: "cunninghamcard-bit", avatar_url: "", name: "Card" });
    if (verb === "GET" && path === "/repos/coder/ghostty-web") return json({ default_branch: "main" });
    if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/branches")) {
      return json([{ name: "main", protected: true, commit: { sha: "aaa1111" } }]);
    }
    if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/commits?") && !path.includes("/commits/")) {
      return json([{
        sha: "deadbeef01234567",
        html_url: "",
        author: { login: "cunninghamcard-bit", avatar_url: "", html_url: "" },
        commit: {
          message: "fix: powerline\n\nbody",
          author: { name: "Card", date: "2026-07-11T00:00:00Z" },
          committer: { date: "2026-07-11T00:00:00Z" },
        },
      }]);
    }
    if (verb === "GET" && path.startsWith("/repos/coder/ghostty-web/commits/deadbeef")) {
      if (headers?.Accept?.includes("diff")) return { status: 200, text: "diff --git a/x b/x\n", json: null };
      return json({
        sha: "deadbeef01234567",
        html_url: "https://github.com/coder/ghostty-web/commit/deadbeef",
        author: { login: "cunninghamcard-bit", avatar_url: "", html_url: "" },
        commit: {
          message: "fix: powerline\n\nDetails",
          author: { name: "Card", date: "2026-07-11T00:00:00Z" },
          committer: { name: "Card", date: "2026-07-11T00:00:00Z" },
          verification: { verified: true, reason: "valid" },
        },
        parents: [{ sha: "parent000", html_url: "" }],
        stats: { additions: 10, deletions: 1, total: 11 },
        files: [{ filename: "lib/renderer.ts", status: "modified", additions: 10, deletions: 1, patch: "@@ -1 +1 @@\n-a\n+b\n" }],
      });
    }
    if (path.includes("/check-runs")) return json({ check_runs: [] });
    if (path.endsWith("/status")) return json({ state: "success" });
    return json({ message: `unmocked ${verb} ${path}` }, 404);
  };
}

async function until(cond: () => boolean, what: string): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > 4000) throw new Error(`timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function makeApp(): Promise<App> {
  const app = new App(document.createElement("div"));
  app.git.bridgeFactory = () => fakeGit();
  (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/vault";
  await app.ready;
  writeGithubPrPrefs({ owner: "coder", repo: "ghostty-web", filter: "open" });
  app.github.setRepository({ owner: "coder", repo: "ghostty-web" });
  app.github.invalidate();
  installMocks(app);
  return app;
}

describe("GitHub workspace commits", () => {
  it("opens commits section and lists commits", async () => {
    const app = await makeApp();
    await openGitHubWorkspace(app, { section: "commits", owner: "coder", repo: "ghostty-web" });
    const view = app.workspace.getLeavesOfType(GitHubWorkspaceView.VIEW_TYPE)[0].view as GitHubWorkspaceView;
    await until(() => view.contentEl.textContent?.includes("fix: powerline") === true, "commit row");
    expect(view.contentEl.textContent).toContain("Commits");
    expect(view.contentEl.textContent).toContain("coder/ghostty-web");
  });

  it("opens commit detail with files", async () => {
    const app = await makeApp();
    await openCommitDetail(app, "deadbeef01234567", { owner: "coder", repo: "ghostty-web" });
    const view = app.workspace.getLeavesOfType(GitCommitView.VIEW_TYPE)[0].view as GitCommitView;
    await until(() => view.contentEl.querySelector(".gh-page-title") !== null, "title");
    expect(view.contentEl.querySelector(".gh-page-title")!.textContent).toContain("powerline");
    await until(() => view.contentEl.textContent?.includes("lib/renderer.ts") === true, "file");
    expect(view.contentEl.textContent).toMatch(/\+10/);
  });
});
