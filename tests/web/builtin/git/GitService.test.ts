import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import { DiffView, openGitDiff } from "@web/views/DiffView";
import type { ElectronGitApi, GitExecResult } from "@web/builtin/git/GitService";

const FAKE_PR = {
  number: 7,
  title: "Add agent relations",
  author: { login: "card" },
  headRefName: "feat/relations",
  baseRefName: "main",
  state: "OPEN",
  isDraft: false,
  reviewDecision: "REVIEW_REQUIRED",
  updatedAt: "2026-07-01T00:00:00Z",
  url: "https://github.com/x/y/pull/7",
};

function fakeGit(
  headFiles: Record<string, string>,
  isRepo = true,
): ElectronGitApi & { calls: string[][]; ghCalls: string[][]; ghInputs: (string | undefined)[] } {
  const calls: string[][] = [];
  const ghCalls: string[][] = [];
  const ghInputs: (string | undefined)[] = [];
  return {
    available: true,
    calls,
    ghCalls,
    ghInputs,
    async execGh(args: string[], _cwd: string, input?: string): Promise<GitExecResult> {
      ghCalls.push(args);
      ghInputs.push(input);
      if (args[0] === "api") return { code: 0, stdout: "{}", stderr: "" };
      if (args[0] === "auth") return { code: 0, stdout: "Logged in", stderr: "" };
      if (args[1] === "list") return { code: 0, stdout: JSON.stringify([FAKE_PR]), stderr: "" };
      if (args[1] === "view")
        return {
          code: 0,
          stdout: JSON.stringify({
            ...FAKE_PR,
            body: "Links agents together.",
            additions: 10,
            deletions: 2,
            files: [{ path: "agent.ts", additions: 10, deletions: 2 }],
            comments: [
              { author: { login: "reviewer" }, body: "LGTM", createdAt: "2026-07-02T00:00:00Z" },
            ],
          }),
          stderr: "",
        };
      if (args[1] === "diff")
        return { code: 0, stdout: "diff --git a/agent.ts b/agent.ts\n", stderr: "" };
      if (args[1] === "checkout" || args[1] === "comment" || args[1] === "review")
        return { code: 0, stdout: "", stderr: "" };
      if (args[1] === "create")
        return { code: 0, stdout: "https://github.com/x/y/pull/8\n", stderr: "" };
      return { code: 1, stdout: "", stderr: "unknown gh command" };
    },
    async exec(args: string[]): Promise<GitExecResult> {
      calls.push(args);
      if (args[0] === "rev-parse")
        return { code: 0, stdout: isRepo ? "true\n" : "false\n", stderr: "" };
      if (args[0] === "show" && args.includes("--name-status")) {
        return { code: 0, stdout: "M\tagent.ts\nR100\told.ts\tnew.ts\n", stderr: "" };
      }
      if (args[0] === "show" && args.includes("--numstat")) {
        return { code: 0, stdout: "5\t0\tagent.ts\n", stderr: "" };
      }
      if (args[0] === "show") {
        const path = args[1].replace(/^(HEAD|:0|v1\.0):/, "");
        if (path in headFiles) return { code: 0, stdout: headFiles[path], stderr: "" };
        return { code: 128, stdout: "", stderr: `fatal: path '${path}' does not exist in 'HEAD'` };
      }
      if (args[0] === "status") return { code: 0, stdout: " M agent.ts\n?? new.ts\n", stderr: "" };
      if (args[0] === "add" || args[0] === "restore") return { code: 0, stdout: "", stderr: "" };
      if (args[0] === "commit")
        return args[2] === "fail me"
          ? { code: 1, stdout: "", stderr: "nothing to commit" }
          : { code: 0, stdout: "[main abc123] ok", stderr: "" };
      if (args[0] === "log")
        return {
          code: 0,
          stdout:
            "aaa111\x1faaa\x1fCard\x1f2026-07-01T00:00:00+08:00\x1ffirst commit\nbbb222\x1fbbb\x1fCard\x1f2026-07-02T00:00:00+08:00\x1fsecond commit\n",
          stderr: "",
        };
      if (args[0] === "reset") return { code: 0, stdout: "", stderr: "" };
      if (args[0] === "diff" && args.includes("--numstat"))
        return { code: 0, stdout: "3\t1\tagent.ts\n0\t2\tsrc/old name.ts\n", stderr: "" };
      return { code: 1, stdout: "", stderr: "unknown" };
    },
  };
}

function appWithGit(headFiles: Record<string, string>): Promise<App> {
  const app = new App(document.createElement("div"));
  app.git.bridgeFactory = () => fakeGit(headFiles);
  // In-memory vaults have no base path; fake one so the service engages.
  (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/fake/vault";
  return app.ready.then(() => app);
}

describe("GitService", () => {
  it("reads the HEAD version of a tracked file", async () => {
    const app = await appWithGit({ "agent.ts": "old content\n" });
    const file = await app.vault.create("agent.ts", "new content\n");
    await expect(app.git.readHeadFile(file.path)).resolves.toBe("old content\n");
  });

  it("returns null for untracked files and parses status", async () => {
    const app = await appWithGit({});
    const file = await app.vault.create("new.ts", "brand new\n");
    await expect(app.git.readHeadFile(file.path)).resolves.toBeNull();
    await expect(app.git.status()).resolves.toEqual([
      { status: " M", path: "agent.ts" },
      { status: "??", path: "new.ts" },
    ]);
  });

  it("is unavailable in browser mode (no bridge, no base path)", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    expect(app.git.isAvailable()).toBe(false);
    const file = await app.vault.create("x.ts", "content\n");
    await expect(openGitDiff(app, file)).resolves.toBeNull();
  });

  it("opens the git diff of a modified file against HEAD", async () => {
    const app = await appWithGit({ "agent.ts": "line one\nline two\n" });
    const file = await app.vault.create("agent.ts", "line one\nline CHANGED\n");

    const leaf = await openGitDiff(app, file);
    const view = leaf!.view as DiffView;

    expect(view).toBeInstanceOf(DiffView);
    expect(view.getChunkCount()).toBe(1);
    view.rejectAll();
    expect(view.getViewData()).toContain("line two");
  });

  it("stages, unstages and commits through the bridge", async () => {
    const app = new App(document.createElement("div"));
    const bridge = fakeGit({});
    app.git.bridgeFactory = () => bridge;
    (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/fake/vault";
    await app.ready;

    await expect(app.git.stage(["a.ts", "b.ts"])).resolves.toBe(true);
    await expect(app.git.unstage(["a.ts"])).resolves.toBe(true);
    await expect(app.git.commit("feat: works")).resolves.toBeNull();
    await expect(app.git.commit("fail me")).resolves.toContain("nothing to commit");
    expect(bridge.calls).toContainEqual(["add", "--", "a.ts", "b.ts"]);
    expect(bridge.calls).toContainEqual(["restore", "--staged", "--", "a.ts"]);
    expect(bridge.calls).toContainEqual(["commit", "-m", "feat: works"]);
  });

  it("parses the log format and reads files at arbitrary refs", async () => {
    const app = await appWithGit({ "agent.ts": "tagged content\n" });

    const log = await app.git.log("agent.ts");
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ shortHash: "aaa", author: "Card", subject: "first commit" });
    await expect(app.git.readFileAt("v1.0", "agent.ts")).resolves.toBe("tagged content\n");
  });

  it("renders File History with native rows and actions", async () => {
    const { GitHistoryView, openFileHistory } = await import("@web/builtin/git/GitHistoryView");
    const app = await appWithGit({ "agent.ts": "historic content\n" });
    await app.vault.create("agent.ts", "current content\n");

    await openFileHistory(app, "agent.ts");
    const view = app.workspace.getLeavesOfType("git-history")[0].view as InstanceType<
      typeof GitHistoryView
    >;
    await new Promise((resolve) => setTimeout(resolve, 50));

    const subjects = [...view.contentEl.querySelectorAll(".git-history-subject")].map(
      (el) => el.textContent,
    );
    expect(subjects).toEqual(["first commit", "second commit"]);
    expect(view.contentEl.querySelectorAll(".git-history-entry.tree-item")).toHaveLength(2);
    expect(view.contentEl.querySelectorAll(".git-history-row.tree-item-self")).toHaveLength(2);
    expect(view.contentEl.querySelectorAll(".git-history-action.clickable-icon")).toHaveLength(6);

    const diffButton = view.contentEl.querySelector(
      '.git-history-action[aria-label="Diff vs working"]',
    ) as HTMLButtonElement;
    diffButton.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const diffLeaf = app.workspace.getLeavesOfType("diff")[0];
    expect(diffLeaf).toBeDefined();
    expect((diffLeaf.view as unknown as { getChunkCount(): number }).getChunkCount()).toBe(1);
  });

  it("lists, views and acts on PRs through the gh bridge", async () => {
    const app = new App(document.createElement("div"));
    const bridge = fakeGit({});
    app.git.bridgeFactory = () => bridge;
    (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/fake/vault";
    await app.ready;

    await expect(app.git.ghAvailable()).resolves.toBe(true);
    const prs = await app.git.prList();
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({
      number: 7,
      title: "Add agent relations",
      author: "card",
      headRefName: "feat/relations",
    });

    const detail = await app.git.prView(7);
    expect(detail).toMatchObject({ body: "Links agents together.", additions: 10 });
    expect(detail!.files).toEqual([{ path: "agent.ts", additions: 10, deletions: 2 }]);
    expect(detail!.comments).toEqual([
      { author: "reviewer", body: "LGTM", createdAt: "2026-07-02T00:00:00Z" },
    ]);

    await expect(app.git.prDiff(7)).resolves.toContain("diff --git");
    await expect(app.git.prCheckout(7)).resolves.toBeNull();
    await expect(app.git.prComment(7, "nice")).resolves.toBeNull();
    await expect(app.git.prReview(7, "approve", "ship it")).resolves.toBeNull();
    await expect(app.git.prCreate("t", "b")).resolves.toEqual({
      url: "https://github.com/x/y/pull/8",
    });
    expect(bridge.ghCalls).toContainEqual(["pr", "checkout", "7"]);
    expect(bridge.ghCalls).toContainEqual(["pr", "review", "7", "--approve", "--body", "ship it"]);
  });

  it("reports gh unavailable when the bridge lacks execGh", async () => {
    const app = new App(document.createElement("div"));
    const bridge = fakeGit({});
    delete (bridge as { execGh?: unknown }).execGh;
    app.git.bridgeFactory = () => bridge;
    (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/fake/vault";
    await app.ready;

    await expect(app.git.ghAvailable()).resolves.toBe(false);
    await expect(app.git.prList()).resolves.toEqual([]);
    await expect(app.git.prCheckout(1)).resolves.toBe("gh is not available");
  });

  it("parses numstat, commit file lists and resets the index", async () => {
    const app = await appWithGit({});

    await expect(app.git.numstat()).resolves.toEqual([
      { path: "agent.ts", additions: 3, deletions: 1 },
      { path: "src/old name.ts", additions: 0, deletions: 2 },
    ]);
    await expect(app.git.numstat("abc123")).resolves.toEqual([
      { path: "agent.ts", additions: 5, deletions: 0 },
    ]);
    await expect(app.git.changedFilesIn("abc123")).resolves.toEqual([
      { status: "M", path: "agent.ts" },
      { status: "R", path: "new.ts" },
    ]);
    await expect(app.git.unstageAll()).resolves.toBe(true);
  });

  it("posts inline comments and batched reviews through gh api with stdin payloads", async () => {
    const app = new App(document.createElement("div"));
    const bridge = fakeGit({});
    app.git.bridgeFactory = () => bridge;
    (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/fake/vault";
    await app.ready;

    await expect(
      app.git.prAddInlineComment(7, "headsha", {
        path: "agent.ts",
        line: 12,
        side: "additions",
        body: "why sync?",
      }),
    ).resolves.toBeNull();
    await expect(
      app.git.prSubmitReview(7, "REQUEST_CHANGES", "needs work", [
        { path: "agent.ts", line: 12, side: "deletions", body: "old path" },
      ]),
    ).resolves.toBeNull();
    // GitHub requires a body for a comment-less REQUEST_CHANGES; it gets defaulted.
    await expect(app.git.prSubmitReview(7, "REQUEST_CHANGES", "", [])).resolves.toBeNull();

    const apiCalls = bridge.ghCalls.filter((call) => call[0] === "api");
    expect(apiCalls[0]).toEqual([
      "api",
      "-X",
      "POST",
      "repos/{owner}/{repo}/pulls/7/comments",
      "--input",
      "-",
    ]);
    expect(apiCalls[1]).toEqual([
      "api",
      "-X",
      "POST",
      "repos/{owner}/{repo}/pulls/7/reviews",
      "--input",
      "-",
    ]);
    const single = JSON.parse(bridge.ghInputs.find((input) => input?.includes("commit_id"))!);
    expect(single).toMatchObject({
      body: "why sync?",
      commit_id: "headsha",
      path: "agent.ts",
      line: 12,
      side: "RIGHT",
    });
    const inputs = bridge.ghInputs.filter(Boolean) as string[];
    const withComment = JSON.parse(inputs[1]);
    expect(withComment).toMatchObject({ event: "REQUEST_CHANGES", body: "needs work" });
    expect(withComment.comments[0]).toMatchObject({ path: "agent.ts", line: 12, side: "LEFT" });
    expect(JSON.parse(inputs[2])).toMatchObject({ body: "Requesting changes." });
  });

  it("diffs untracked files against empty", async () => {
    const app = await appWithGit({});
    const file = await app.vault.create("fresh.ts", "all new\n");

    const leaf = await openGitDiff(app, file);
    const view = leaf!.view as DiffView;

    expect(view.getChunkCount()).toBe(1);
  });
});

// --- Branch, sync and worktree verb families (local-git-surface-completion)

interface Scripted {
  bridge: ElectronGitApi;
  calls: string[][];
}

/** Bridge whose responses are matched by argument prefix, recording every call. */
function scriptedGit(script: Array<[string[], GitExecResult]>): Scripted {
  const calls: string[][] = [];
  return {
    calls,
    bridge: {
      available: true,
      async exec(args: string[]): Promise<GitExecResult> {
        calls.push(args);
        for (const [prefix, result] of script)
          if (prefix.every((part, i) => args[i] === part)) return result;
        return { code: 0, stdout: "", stderr: "" };
      },
    },
  };
}

async function appWithScriptedGit(script: Array<[string[], GitExecResult]>) {
  const app = new App(document.createElement("div"));
  const scripted = scriptedGit(script);
  app.git.bridgeFactory = () => scripted.bridge;
  (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/fake/vault";
  await app.ready;
  return { app, calls: scripted.calls };
}

const ok = (stdout = ""): GitExecResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string, code = 1): GitExecResult => ({ code, stdout: "", stderr });

describe("GitService sync verbs", () => {
  it("reports branch and divergence", async () => {
    const { app } = await appWithScriptedGit([
      [["rev-parse", "--abbrev-ref", "HEAD"], ok("main\n")],
      [["rev-list", "--left-right", "--count"], ok("2\t1\n")],
    ]);
    await expect(app.git.currentBranch()).resolves.toBe("main");
    await expect(app.git.aheadBehind()).resolves.toEqual({ ahead: 1, behind: 2 });
  });

  it("pull fast-forwards and push sets upstream when missing", async () => {
    const { app, calls } = await appWithScriptedGit([
      [["pull"], ok()],
      [["push", "-u"], ok()],
      [
        ["push"],
        fail(
          "fatal: The current branch feature has no upstream branch.\nTo push... use --set-upstream",
        ),
      ],
      [["rev-parse", "--abbrev-ref", "HEAD"], ok("feature\n")],
    ]);
    await expect(app.git.pull()).resolves.toBeNull();
    expect(calls.find((c) => c[0] === "pull")).toEqual(["pull", "--ff-only"]);
    await expect(app.git.push()).resolves.toBeNull();
    expect(calls.at(-1)).toEqual(["push", "-u", "origin", "feature"]);
  });

  it("surfaces sync failures as error text", async () => {
    const { app } = await appWithScriptedGit([
      [["pull"], fail("fatal: Not possible to fast-forward, aborting.")],
    ]);
    await expect(app.git.pull()).resolves.toContain("Not possible to fast-forward");
  });
});

describe("GitService branch verbs", () => {
  it("lists switches and creates branches", async () => {
    const { app, calls } = await appWithScriptedGit([
      [["for-each-ref"], ok("*main\n feature\n")],
      [["switch", "-c"], ok()],
      [["switch"], ok()],
    ]);
    await expect(app.git.branches()).resolves.toEqual([
      { name: "main", current: true },
      { name: "feature", current: false },
    ]);
    await expect(app.git.switchBranch("feature")).resolves.toBeNull();
    expect(calls.at(-1)).toEqual(["switch", "feature"]);
    await expect(app.git.createBranch("hotfix")).resolves.toBeNull();
    expect(calls.at(-1)).toEqual(["switch", "-c", "hotfix"]);
  });

  it("propagates switch failure text", async () => {
    const { app } = await appWithScriptedGit([
      [["switch"], fail("error: pathspec 'nope' did not match any known refs")],
    ]);
    await expect(app.git.switchBranch("nope")).resolves.toContain("did not match");
  });
});

describe("GitService worktree verbs", () => {
  it("discards tracked edits and deletes untracked files", async () => {
    const { app, calls } = await appWithScriptedGit([]);
    await expect(
      app.git.discard([
        { path: "notes/edited.md", status: " M" },
        { path: "scratch/new.md", status: "??" },
      ]),
    ).resolves.toBe(true);
    expect(calls).toContainEqual(["restore", "--worktree", "--", "notes/edited.md"]);
    expect(calls).toContainEqual(["clean", "-f", "--", "scratch/new.md"]);
  });

  it("amends the previous commit", async () => {
    const { app, calls } = await appWithScriptedGit([[["commit"], ok()]]);
    let fired = "";
    app.workspace.on("git-commit", (message: string) => (fired = message));
    await expect(app.git.commit("fix: typo", { amend: true })).resolves.toBeNull();
    expect(calls.at(-1)).toEqual(["commit", "--amend", "-m", "fix: typo"]);
    expect(fired).toBe("fix: typo");
  });

  it("returns amend failure text", async () => {
    const { app } = await appWithScriptedGit([
      [["commit"], fail("fatal: You have nothing to amend.")],
    ]);
    await expect(app.git.commit("x", { amend: true })).resolves.toContain("nothing to amend");
  });
});
