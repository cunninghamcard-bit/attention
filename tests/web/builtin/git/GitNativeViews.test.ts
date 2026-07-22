import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { GitChangesView } from "@web/builtin/git/GitChangesView";
import { GitLogView } from "@web/builtin/git/GitLogView";
import type { ElectronGitApi, GitExecResult } from "@web/builtin/git/GitService";

const renderedDiffs = vi.hoisted(() => [] as HTMLElement[]);

vi.mock("@pierre/diffs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pierre/diffs")>();
  class FakeFileDiff {
    render(options: { containerWrapper: HTMLElement }): void {
      options.containerWrapper.dataset.diff = "rendered";
      renderedDiffs.push(options.containerWrapper);
    }
    cleanUp(): void {}
    setThemeType(): void {}
  }
  return { ...actual, FileDiff: FakeFileDiff };
});

interface FakeBridge extends ElectronGitApi {
  repo: boolean;
  statusText: string;
  logText: string;
  detailLoads: number;
}

function bridge(
  options: Partial<Pick<FakeBridge, "repo" | "statusText" | "logText">> = {},
): FakeBridge {
  return {
    available: true,
    repo: options.repo ?? true,
    statusText: options.statusText ?? "",
    logText: options.logText ?? "",
    detailLoads: 0,
    gravatarUrl: (email: string) => `https://www.gravatar.com/avatar/${email}`,
    async exec(args: string[]): Promise<GitExecResult> {
      if (args[0] === "rev-parse" && args.includes("--is-inside-work-tree")) {
        return { code: this.repo ? 0 : 1, stdout: this.repo ? "true\n" : "", stderr: "" };
      }
      if (args[0] === "rev-parse" && args.includes("--abbrev-ref")) {
        return { code: 0, stdout: "main\n", stderr: "" };
      }
      if (args[0] === "rev-list") return { code: 1, stdout: "", stderr: "no upstream" };
      if (args[0] === "status") return { code: 0, stdout: this.statusText, stderr: "" };
      if (args[0] === "log") return { code: 0, stdout: this.logText, stderr: "" };
      if (args[0] === "show" && args.includes("--name-status")) {
        this.detailLoads += 1;
        return { code: 0, stdout: "M\tsrc/agent.ts\n", stderr: "" };
      }
      if (args[0] === "show" && args.includes("--numstat")) {
        return { code: 0, stdout: "3\t2\tsrc/agent.ts\n", stderr: "" };
      }
      if (args[0] === "show") return { code: 0, stdout: "contents\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

async function appWithBridge(fake: FakeBridge): Promise<App> {
  const app = new App(document.createElement("div"));
  app.git.bridgeFactory = () => fake;
  (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/fake/vault";
  await app.ready;
  return app;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

beforeEach(() => renderedDiffs.splice(0));

describe("native Git views", () => {
  it("nests Git Changes files under collapsible sections", async () => {
    const fake = bridge({ statusText: "M  staged.ts\n M working.ts\n" });
    const app = await appWithBridge(fake);
    await app.vault.create("staged.ts", "staged\n");
    await app.vault.create("working.ts", "working\n");
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: GitChangesView.VIEW_TYPE, active: true });
    const view = leaf.view as GitChangesView;
    await settle();

    // Sections are collapsible TreeItem parents with a native collapse chevron.
    const sections = view.contentEl.querySelectorAll(
      ".git-changes-section-item.tree-item.nav-folder",
    );
    expect(sections).toHaveLength(2);
    expect(
      view.contentEl.querySelectorAll(".git-changes-section.tree-item-self.mod-collapsible"),
    ).toHaveLength(2);
    expect(
      view.contentEl.querySelectorAll(".git-changes-section .nav-folder-collapse-indicator"),
    ).toHaveLength(2);

    // Each file row is nested inside its section's tree-item-children box.
    expect(
      view.contentEl.querySelectorAll(
        ".git-changes-section-item > .tree-item-children > .git-changes-file.tree-item.nav-file",
      ),
    ).toHaveLength(2);
    expect(view.contentEl.querySelectorAll(".git-changes-file-header.tree-item-self")).toHaveLength(
      2,
    );
    expect(view.contentEl.querySelectorAll(".git-changes-file .file-type-icon")).toHaveLength(2);
    expect(
      view.contentEl.querySelectorAll(".git-changes-file-status.tree-item-flair"),
    ).toHaveLength(2);
    expect(view.contentEl.querySelectorAll(".git-changes-stage.clickable-icon")).toHaveLength(2);
    expect(renderedDiffs).toHaveLength(2);

    // Clicking a section header toggles its nested files (collapse state).
    const section = sections[0];
    const header = section.querySelector(".git-changes-section") as HTMLElement;
    const children = section.querySelector(":scope > .tree-item-children") as HTMLElement;
    expect(children.hidden).toBe(false);
    header.click();
    expect(children.hidden).toBe(true);
  });

  it("preserves Git Changes unavailable and empty states", async () => {
    const fake = bridge();
    const app = await appWithBridge(fake);
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: GitChangesView.VIEW_TYPE, active: true });
    const view = leaf.view as GitChangesView;
    await settle();
    expect(view.contentEl.querySelector(".empty-state")?.textContent).toContain(
      "Working tree clean",
    );
    expect(view.contentEl.querySelector(".git-changes-file")).toBeNull();

    fake.repo = false;
    await view.refresh();
    expect(view.contentEl.querySelector(".empty-state")?.textContent).toContain(
      "not a git repository",
    );
    expect((view.contentEl.querySelector(".git-header-row") as HTMLElement).style.display).toBe(
      "none",
    );
  });

  it("renders Git commit avatars with initial fallback", async () => {
    const fake = bridge({
      logText:
        "abc123\u001fabc123\u001fCard\u001fcard@example.com\u001f2026-07-01T00:00:00Z\u001fNative rows\n",
    });
    const app = await appWithBridge(fake);
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: GitLogView.VIEW_TYPE, active: true });
    const view = leaf.view as GitLogView;
    await settle();

    const commit = view.contentEl.querySelector(".git-log-entry.tree-item.nav-folder");
    const header = commit?.querySelector(".git-log-header.tree-item-self") as HTMLElement;
    expect(header).not.toBeNull();
    const avatar = header.querySelector(".git-avatar") as HTMLElement;
    const author = header.querySelector(".git-commit-author") as HTMLElement;
    const image = avatar.querySelector(".git-avatar-image") as HTMLImageElement;
    expect(image.src).toBe("https://www.gravatar.com/avatar/card@example.com");
    expect(author.childNodes[1]?.textContent).toBe("Card");
    expect(header.querySelector(".git-log-meta")?.textContent).toContain("Card · abc123 ·");
    image.dispatchEvent(new Event("error"));
    expect(avatar.querySelector(".git-avatar-image")).toBeNull();
    expect(avatar.querySelector(".git-avatar-fallback")?.textContent).toBe("C");
    expect((commit!.querySelector(".git-log-detail") as HTMLElement).hidden).toBe(true);
    header.click();
    await settle();
    // The changed file is a FILE (nav-file-title), collapsible to its diff — so a
    // theme's file-row treatment reaches it; the commit above stays nav-folder.
    const file = commit?.querySelector(".git-log-file.tree-item-self.nav-file-title");
    expect(file).not.toBeNull();
    expect(file?.querySelector(".nav-folder-collapse-indicator")).not.toBeNull();
    expect(file?.querySelector(".file-type-icon")).not.toBeNull();
    expect(file?.querySelector(".git-log-file-stats")?.textContent).toContain("+3  −2");
  });

  it("preserves Commit Log lazy and empty behavior", async () => {
    const fake = bridge({
      logText:
        "abc123\u001fabc123\u001fCard\u001fcard@example.com\u001f2026-07-01T00:00:00Z\u001fLazy detail\n",
    });
    const app = await appWithBridge(fake);
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: GitLogView.VIEW_TYPE, active: true });
    const view = leaf.view as GitLogView;
    await settle();
    const header = view.contentEl.querySelector(".git-log-header") as HTMLElement;
    expect(fake.detailLoads).toBe(0);
    header.click();
    await settle();
    header.click();
    header.click();
    await settle();
    expect(fake.detailLoads).toBe(1);

    fake.logText = "";
    await view.refresh();
    expect(view.contentEl.querySelector(".empty-state")?.textContent).toBe("No commits yet.");
  });
});
