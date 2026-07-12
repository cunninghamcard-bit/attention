import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { WorkspaceLeaf } from "@web/views/workspace/WorkspaceLeaf";
import { WorkspaceSplit } from "@web/views/workspace/WorkspaceSplit";
import { WorkspaceTabs } from "@web/views/workspace/WorkspaceTabs";

// The navigation batch is not yet wired into the App constructor (glue lands
// after all lanes); register it explicitly against a real in-memory app.
function bareApp(): App {
  const app = new App(document.createElement("div"));
  return app;
}

async function seededApp(): Promise<App> {
  const app = bareApp();
  await app.vault.create("Note.md", "# Note\nbody");
  await app.vault.create("Folder/Sub.md", "sub");
  return app;
}

function leafCount(app: App): number {
  let count = 0;
  app.workspace.iterateAllLeaves(() => {
    count += 1;
  });
  return count;
}

// A fresh App boots with one tabs group holding an empty leaf; drop it when a
// test needs a truly leafless workspace.
function clearRootSplit(app: App): void {
  const root = app.workspace.rootSplit;
  while (root.children.length > 0) root.removeChild(root.children[0]);
}

beforeEach(() => {
  Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("random", () => {
  it("opens a random note and echoes the resolved path", async () => {
    const app = bareApp();
    await app.vault.create("Note.md", "# Note\nbody");
    expect(await app.cli.handleCli(["random"])).toBe("Opened: Note.md");
    expect(app.workspace.getActiveFile()?.path).toBe("Note.md");
  });

  it("limits to folder= as a recursive path prefix, trailing slash optional", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["random", "folder=Folder"])).toBe("Opened: Folder/Sub.md");
    expect(await app.cli.handleCli(["random", "folder=Folder/"])).toBe("Opened: Folder/Sub.md");
    // Prefix match is on the raw path with "/" appended: "Fold" matches nothing.
    expect(await app.cli.handleCli(["random", "folder=Fold"])).toBe("No markdown files found.");
  });

  it("returns the soft-failure string on an empty vault", async () => {
    const app = bareApp();
    expect(await app.cli.handleCli(["random"])).toBe("No markdown files found.");
  });

  it("newtab opens in a new leaf", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["random", "folder=Folder"]);
    expect(leafCount(app)).toBe(1);
    const out = await app.cli.handleCli(["random", "newtab"]);
    expect(out).toMatch(/^Opened: (Note\.md|Folder\/Sub\.md)$/);
    expect(leafCount(app)).toBe(2);
  });
});

describe("random:read", () => {
  it("returns path, blank line, then the raw body — no tab opened", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["random:read", "folder=Folder"])).toBe("Folder/Sub.md\n\nsub");
    // No UI mutation: nothing opened, nothing focused.
    expect(app.workspace.getActiveFile()).toBeNull();
    expect(await app.cli.handleCli(["tabs"])).toBe("[empty] New tab");
  });

  it("returns the soft-failure string on an empty folder", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["random:read", "folder=Nope"])).toBe(
      "No markdown files found.",
    );
  });
});

describe("reload", () => {
  it("returns Reloading... and schedules the reload instead of firing it inline", async () => {
    vi.useFakeTimers();
    const app = bareApp();
    // Settle the async core-plugin enables first — their layout timers must
    // not land between the baseline capture and the reload call.
    await app.corePluginsReady;
    await Promise.resolve();
    const pending = vi.getTimerCount();
    expect(await app.cli.handleCli(["reload"])).toBe("Reloading...");
    // The reload is deferred so the reply is delivered first.
    expect(vi.getTimerCount()).toBe(pending + 1);
  });
});

describe("tabs", () => {
  it("returns an empty string when no leaves exist", async () => {
    const app = bareApp();
    clearRootSplit(app);
    expect(await app.cli.handleCli(["tabs"])).toBe("");
  });

  it("lists [viewType] displayText per leaf, TAB + leaf id with ids", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["random", "folder=Folder"]);
    expect(await app.cli.handleCli(["tabs"])).toBe("[markdown] Sub");

    const leafIds: string[] = [];
    app.workspace.iterateAllLeaves((leaf) => {
      leafIds.push(leaf.id);
    });
    expect(await app.cli.handleCli(["tabs", "ids"])).toBe(`[markdown] Sub\t${leafIds[0]}`);
  });
});

describe("recents", () => {
  it("returns No recent files. when empty, but total returns 0", async () => {
    const app = bareApp();
    expect(await app.cli.handleCli(["recents"])).toBe("No recent files.");
    expect(await app.cli.handleCli(["recents", "total"])).toBe("0");
  });

  it("lists paths most recent first; total counts them", async () => {
    const app = bareApp();
    app.workspace.recentFileTracker.collect({ path: "A.md" });
    app.workspace.recentFileTracker.collect({ path: "B.md" });
    expect(await app.cli.handleCli(["recents"])).toBe("B.md\nA.md");
    expect(await app.cli.handleCli(["recents", "total"])).toBe("2");
  });
});

describe("tab:open", () => {
  it("opens a new empty tab by default", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["random"]);
    expect(await app.cli.handleCli(["tab:open"])).toBe("Opened new tab");
    expect(leafCount(app)).toBe(2);
  });

  it("file= opens the file and echoes the flag string verbatim", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["random", "folder=Folder"]);
    expect(await app.cli.handleCli(["tab:open", "file=Note.md"])).toBe("Opened: Note.md");
    expect(app.workspace.getActiveFile()?.path).toBe("Note.md");
  });

  it("file= beats view= when both are given", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["random", "folder=Folder"]);
    expect(await app.cli.handleCli(["tab:open", "file=Note.md", "view=graph"])).toBe(
      "Opened: Note.md",
    );
  });

  it("view= sets the view state without validating the type", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["random"]);
    expect(await app.cli.handleCli(["tab:open", "view=some-unregistered-view"])).toBe(
      "Opened view: some-unregistered-view",
    );
  });

  it("throws the not-found string for a missing file — and still leaves the orphan tab", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["random"]);
    const before = leafCount(app);
    await expect(app.cli.handleCli(["tab:open", "file=Nope.md"])).rejects.toBe(
      'File "Nope.md" not found.',
    );
    // Real gotcha: the leaf is created before file validation.
    expect(leafCount(app)).toBe(before + 1);
  });

  it("throws the folder string when file= points at a folder", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["random"]);
    await expect(app.cli.handleCli(["tab:open", "file=Folder"])).rejects.toBe(
      '"Folder" is a folder, not a file.',
    );
  });

  it("group= targets the matching tab group; unknown ids throw", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["random"]);
    const tabs = app.workspace.rootSplit.children[0] as WorkspaceTabs;
    expect(await app.cli.handleCli(["tab:open", `group=${tabs.id}`])).toBe("Opened new tab");
    expect(tabs.children).toHaveLength(2);

    await expect(app.cli.handleCli(["tab:open", "group=zzz"])).rejects.toBe(
      'Tab group "zzz" not found. Use "workspace ids=true" to list tab group IDs.',
    );
  });
});

describe("workspace", () => {
  it("always prints main/left/right root lines, omitting empty floating", async () => {
    const app = bareApp();
    clearRootSplit(app);
    expect(await app.cli.handleCli(["workspace"])).toBe("main\nleft\nright");
  });

  it("renders the ascii tree of leaves under their containers", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["random"]);
    expect(await app.cli.handleCli(["workspace"])).toMatch(
      /^main\n└── tabs\n {4}└── \[markdown\] (Note|Sub)\nleft\nright$/,
    );
  });

  it("ids decorates every item with a parenthesized id", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["random", "folder=Folder"]);
    const workspace = app.workspace;
    const tabs = workspace.rootSplit.children[0] as WorkspaceTabs;
    const leaf = tabs.children[0] as WorkspaceLeaf;
    expect(await app.cli.handleCli(["workspace", "ids"])).toBe(
      `main (${workspace.rootSplit.id})\n└── tabs (${tabs.id})\n    └── [markdown] Sub (${leaf.id})\nleft (${workspace.leftSplit.id})\nright (${workspace.rightSplit.id})`,
    );
  });

  it("labels splits as type:direction and indents with │ under non-last ancestors", async () => {
    const app = bareApp();
    clearRootSplit(app);
    const split = new WorkspaceSplit(app.workspace, "horizontal");
    app.workspace.rootSplit.appendChild(split);
    const tabs1 = new WorkspaceTabs(app.workspace);
    const tabs2 = new WorkspaceTabs(app.workspace);
    split.appendChild(tabs1);
    split.appendChild(tabs2);
    tabs1.appendChild(new WorkspaceLeaf(app.workspace));

    expect(await app.cli.handleCli(["workspace"])).toBe(
      "main\n└── split:horizontal\n    ├── tabs\n    │   └── [empty] New tab\n    └── tabs\nleft\nright",
    );
  });

  it("includes the floating section only when it has children", async () => {
    const app = bareApp();
    clearRootSplit(app);
    app.workspace.floatingSplit.appendChild(new WorkspaceTabs(app.workspace));
    expect(await app.cli.handleCli(["workspace"])).toBe("main\nleft\nright\nfloating\n└── tabs");
  });
});
