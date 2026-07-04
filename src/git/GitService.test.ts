import { describe, expect, it } from "vitest";
import { App } from "../app/App";
import { DiffView, openGitDiff } from "../views/DiffView";
import type { ElectronGitApi, GitExecResult } from "./GitService";

function fakeGit(headFiles: Record<string, string>, isRepo = true): ElectronGitApi {
  return {
    available: true,
    async exec(args: string[]): Promise<GitExecResult> {
      if (args[0] === "rev-parse") return { code: 0, stdout: isRepo ? "true\n" : "false\n", stderr: "" };
      if (args[0] === "show") {
        const path = args[1].replace(/^HEAD:/, "");
        if (path in headFiles) return { code: 0, stdout: headFiles[path], stderr: "" };
        return { code: 128, stdout: "", stderr: `fatal: path '${path}' does not exist in 'HEAD'` };
      }
      if (args[0] === "status") return { code: 0, stdout: " M agent.ts\n?? new.ts\n", stderr: "" };
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
    await expect(app.git.readHeadFile(file)).resolves.toBe("old content\n");
  });

  it("returns null for untracked files and parses status", async () => {
    const app = await appWithGit({});
    const file = await app.vault.create("new.ts", "brand new\n");
    await expect(app.git.readHeadFile(file)).resolves.toBeNull();
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

  it("diffs untracked files against empty", async () => {
    const app = await appWithGit({});
    const file = await app.vault.create("fresh.ts", "all new\n");

    const leaf = await openGitDiff(app, file);
    const view = leaf!.view as DiffView;

    expect(view.getChunkCount()).toBe(1);
  });
});
