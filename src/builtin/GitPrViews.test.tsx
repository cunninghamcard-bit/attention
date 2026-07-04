import { describe, expect, it } from "vitest";
import { App } from "../app/App";
import { openPrDetail, openPrList, PrDetailView, PrListView } from "./GitPrViews";
import type { ElectronGitApi, GitExecResult } from "../git/GitService";

const PR = {
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

function fakeBridge(ghAuthed = true, isRepo = true): ElectronGitApi & { ghCalls: string[][] } {
  const ghCalls: string[][] = [];
  return {
    available: true,
    ghCalls,
    async exec(args: string[]): Promise<GitExecResult> {
      if (args[0] === "rev-parse") return { code: 0, stdout: isRepo ? "true\n" : "false\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    async execGh(args: string[]): Promise<GitExecResult> {
      ghCalls.push(args);
      if (args[0] === "auth") return { code: ghAuthed ? 0 : 1, stdout: "", stderr: ghAuthed ? "" : "not logged in" };
      if (args[1] === "list") return { code: 0, stdout: JSON.stringify([PR]), stderr: "" };
      if (args[1] === "view") return {
        code: 0,
        stdout: JSON.stringify({
          ...PR,
          body: "Links agents together.",
          additions: 3,
          deletions: 1,
          files: [{ path: "agent.ts", additions: 3, deletions: 1 }],
          comments: [{ author: { login: "reviewer" }, body: "Looks solid", createdAt: "2026-07-02T00:00:00Z" }],
        }),
        stderr: "",
      };
      if (args[1] === "diff") return {
        code: 0,
        stdout: "diff --git a/agent.ts b/agent.ts\nindex 111..222 100644\n--- a/agent.ts\n+++ b/agent.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n",
        stderr: "",
      };
      if (args[1] === "review" || args[1] === "comment") return { code: 0, stdout: "", stderr: "" };
      return { code: 1, stdout: "", stderr: "unknown" };
    },
  };
}

async function appWithGh(bridge: ElectronGitApi): Promise<App> {
  const app = new App(document.createElement("div"));
  app.git.bridgeFactory = () => bridge;
  (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/fake/vault";
  await app.ready;
  return app;
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > 3000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("PR views", () => {
  it("lists pull requests and opens the review surface on click", async () => {
    const app = await appWithGh(fakeBridge());
    await openPrList(app);
    const listView = app.workspace.getLeavesOfType(PrListView.VIEW_TYPE)[0].view as PrListView;

    await until(() => listView.contentEl.querySelector(".git-pr-row-title") !== null, "PR row");
    expect(listView.contentEl.querySelector(".git-pr-row-title")!.textContent).toBe("Add agent relations");
    expect(listView.contentEl.querySelector(".git-pr-row-meta")!.textContent).toContain("feat/relations → main");

    (listView.contentEl.querySelector(".git-pr-row") as HTMLElement).click();
    await until(() => app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE).length > 0, "detail leaf");
  });

  it("renders the review surface and approves through gh", async () => {
    const bridge = fakeBridge();
    const app = await appWithGh(bridge);
    await openPrDetail(app, 7);
    const view = app.workspace.getLeavesOfType(PrDetailView.VIEW_TYPE)[0].view as PrDetailView;

    await until(() => view.contentEl.querySelector(".git-pr-title") !== null, "PR title");
    expect(view.contentEl.querySelector(".git-pr-title")!.textContent).toContain("Add agent relations");
    await until(() => view.contentEl.querySelectorAll(".git-pr-comment").length === 2, "description + comment cards");
    expect(view.contentEl.textContent).toContain("Looks solid");

    (view.contentEl.querySelector(".git-pr-action.mod-approve") as HTMLButtonElement).click();
    await until(() => bridge.ghCalls.some((call) => call[1] === "review"), "review call");
    expect(bridge.ghCalls).toContainEqual(["pr", "review", "7", "--approve"]);
  });

  it("explains when the GitHub CLI is missing or signed out", async () => {
    const app = await appWithGh(fakeBridge(false));
    await openPrList(app);
    const listView = app.workspace.getLeavesOfType(PrListView.VIEW_TYPE)[0].view as PrListView;

    await until(() => listView.contentEl.querySelector(".git-pr-empty") !== null, "unavailable hint");
    expect(listView.contentEl.querySelector(".git-pr-empty")!.textContent).toContain("gh auth login");
  });

  it("explains when the vault is not a git repository", async () => {
    const app = await appWithGh(fakeBridge(true, false));
    await openPrList(app);
    const listView = app.workspace.getLeavesOfType(PrListView.VIEW_TYPE)[0].view as PrListView;

    await until(() => listView.contentEl.querySelector(".git-pr-empty") !== null, "no-repo hint");
    expect(listView.contentEl.querySelector(".git-pr-empty")!.textContent).toContain("not a git repository");
  });
});
