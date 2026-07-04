import { describe, expect, it } from "vitest";
import { App } from "../app/App";
import { DiffView, openGitDiff } from "../views/DiffView";
import type { ElectronGitApi, GitExecResult } from "./GitService";

function fakeGit(headFiles: Record<string, string>, isRepo = true): ElectronGitApi & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    available: true,
    calls,
    async exec(args: string[]): Promise<GitExecResult> {
      calls.push(args);
      if (args[0] === "rev-parse") return { code: 0, stdout: isRepo ? "true\n" : "false\n", stderr: "" };
      if (args[0] === "show") {
        const path = args[1].replace(/^(HEAD|:0|v1\.0):/, "");
        if (path in headFiles) return { code: 0, stdout: headFiles[path], stderr: "" };
        return { code: 128, stdout: "", stderr: `fatal: path '${path}' does not exist in 'HEAD'` };
      }
      if (args[0] === "status") return { code: 0, stdout: " M agent.ts\n?? new.ts\n", stderr: "" };
      if (args[0] === "add" || args[0] === "restore") return { code: 0, stdout: "", stderr: "" };
      if (args[0] === "commit") return args[2] === "fail me"
        ? { code: 1, stdout: "", stderr: "nothing to commit" }
        : { code: 0, stdout: "[main abc123] ok", stderr: "" };
      if (args[0] === "log") return { code: 0, stdout: "aaa111\x1faaa\x1fCard\x1f2026-07-01T00:00:00+08:00\x1ffirst commit\nbbb222\x1fbbb\x1fCard\x1f2026-07-02T00:00:00+08:00\x1fsecond commit\n", stderr: "" };
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

  it("renders file history and diffs a historical version", async () => {
    const { GitHistoryView, openFileHistory } = await import("../builtin/GitHistoryView");
    const app = await appWithGit({ "agent.ts": "historic content\n" });
    await app.vault.create("agent.ts", "current content\n");

    await openFileHistory(app, "agent.ts");
    const view = app.workspace.getLeavesOfType("git-history")[0].view as InstanceType<typeof GitHistoryView>;
    await new Promise((resolve) => setTimeout(resolve, 50));

    const subjects = [...view.contentEl.querySelectorAll(".git-history-subject")].map((el) => el.textContent);
    expect(subjects).toEqual(["first commit", "second commit"]);

    const diffButton = [...view.contentEl.querySelectorAll(".git-history-action")].find((el) => el.textContent === "Diff vs working") as HTMLButtonElement;
    diffButton.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const diffLeaf = app.workspace.getLeavesOfType("diff")[0];
    expect(diffLeaf).toBeDefined();
    expect((diffLeaf.view as unknown as { getChunkCount(): number }).getChunkCount()).toBe(1);
  });

  it("diffs untracked files against empty", async () => {
    const app = await appWithGit({});
    const file = await app.vault.create("fresh.ts", "all new\n");

    const leaf = await openGitDiff(app, file);
    const view = leaf!.view as DiffView;

    expect(view.getChunkCount()).toBe(1);
  });
});
