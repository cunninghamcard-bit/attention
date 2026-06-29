import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { View, type ViewState } from "../views/View";
import { MarkdownView } from "../views/MarkdownView";
import { DeferredView } from "../views/DeferredView";
import { Menu } from "../ui/Menu";
import { Tasks } from "../app/QuitEvent";
import { WorkspaceWindow } from "./WorkspaceWindow";
import type { OpenViewState } from "./Workspace";

class PlainView extends View {
  resizeCount = 0;
  private ephemeral: unknown = {};

  getViewType(): string {
    return "plain-public-api-test";
  }

  override onResize(): void {
    this.resizeCount += 1;
  }

  override setEphemeralState(state: unknown): void {
    this.ephemeral = state;
  }

  override getEphemeralState(): unknown {
    return this.ephemeral;
  }
}

class StatefulView extends View {
  private payload: Record<string, unknown> = {};

  getViewType(): string {
    return "stateful-public-api-test";
  }

  override async setState(state: unknown): Promise<void> {
    this.payload = state && typeof state === "object" && !Array.isArray(state) ? state as Record<string, unknown> : {};
  }

  override getState(): Record<string, unknown> {
    return this.payload;
  }
}

class NavigablePlainView extends View {
  override navigation = true;

  getViewType(): string {
    return "navigable-public-api-test";
  }
}

describe("Workspace public API parity", () => {
  beforeEach(() => {
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  it("returns the most recently active file when the current view is not a FileView", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("plain-public-api-test", (leaf) => new PlainView(leaf));
    const file = await app.vault.create("Active.md", "active");
    const laterFile = await app.vault.create("Later.md", "later");
    const opened: string[] = [];
    app.workspace.on("file-open", (openedFile: unknown) => {
      if (openedFile && typeof openedFile === "object" && "path" in openedFile) opened.push(String((openedFile as { path: unknown }).path));
    });

    await app.workspace.openFile(file, { active: true });
    await new Promise((resolve) => setTimeout(resolve, 1));
    await app.workspace.openFile(laterFile, { active: true, mode: "tab" });
    app.workspace.markLayoutReady();
    await vi.waitFor(() => expect(opened).toEqual(["Later.md"]));

    const plainLeaf = app.workspace.getLeaf("tab");
    await plainLeaf.setViewState({ type: "plain-public-api-test", active: true });

    expect(app.workspace.getActiveFile()).toBe(laterFile);
  });

  it("does not fall back to an older file when the active navigable view is not a FileView", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("navigable-public-api-test", (leaf) => new NavigablePlainView(leaf));
    const file = await app.vault.create("Previous active.md", "previous");
    await app.workspace.openFile(file, { active: true });

    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: "navigable-public-api-test", active: true });

    expect(app.workspace.getActiveFile()).toBeNull();
  });

  it("exposes Workspace.layoutReady as the public readiness field", async () => {
    const app = new App(document.createElement("div"));
    const callbacks: string[] = [];

    expect(app.workspace.layoutReady).toBe(false);
    app.workspace.onLayoutReady(() => callbacks.push("queued"));
    app.workspace.markLayoutReady();

    expect(app.workspace.layoutReady).toBe(true);
    expect(callbacks).toEqual([]);
    await app.workspace.waitForLayoutReadyCallbacks();
    expect(callbacks).toEqual(["queued"]);

    app.workspace.onLayoutReady(() => callbacks.push("immediate"));
    expect(callbacks).toEqual(["queued", "immediate"]);
  });

  it("exposes activeEditor as MarkdownFileInfo", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Editor.md", "editor");
    const leaf = await app.workspace.openFile(file, { active: true });
    const view = leaf.view as MarkdownView;
    const activeEditor = app.workspace.activeEditor;

    expect(activeEditor?.app).toBe(app);
    expect(activeEditor?.file).toBe(file);
    expect(activeEditor?.editor).toBe(view.editor);
    expect(activeEditor?.hoverPopover).toBeNull();
  });

  it("registers operator function display configs by id like Obsidian", () => {
    const app = new App(document.createElement("div"));
    const first = [{ funcName: "contains", display: "contains", inverseDisplay: "does not contain" }];
    const replacement = [{ funcName: "matches", display: "matches", inverseDisplay: "does not match" }];

    expect(Object.keys(app.workspace.operatorFuncConfigs)).toEqual([]);

    app.workspace.registerOperatorFuncConfigs("bases", first);

    expect(app.workspace.operatorFuncConfigs.bases).toBe(first);

    app.workspace.registerOperatorFuncConfigs("bases", replacement);

    expect(app.workspace.operatorFuncConfigs.bases).toBe(replacement);

    app.workspace.unregisterOperatorFuncConfigs("bases");

    expect(app.workspace.operatorFuncConfigs.bases).toBeUndefined();
  });

  it("keeps workspace protocol handler registration atomic and scoped", async () => {
    const app = new App(document.createElement("div"));
    const first = vi.fn();
    const second = vi.fn();
    const external = vi.fn();

    app.workspace.registerObsidianProtocolHandler("plugin-action", first);

    expect(() => app.workspace.registerObsidianProtocolHandler("plugin-action", second)).toThrow(
      'Action "plugin-action" is already registered as a handler.',
    );

    await expect(app.uriRouter.handleUri("obsidian://plugin-action?source=first")).resolves.toBe(true);
    expect(first).toHaveBeenCalledWith({ action: "plugin-action", source: "first" });
    expect(second).not.toHaveBeenCalled();

    app.workspace.unregisterObsidianProtocolHandler("plugin-action", second);
    await expect(app.uriRouter.handleUri("obsidian://plugin-action?source=still-first")).resolves.toBe(true);
    expect(first).toHaveBeenLastCalledWith({ action: "plugin-action", source: "still-first" });

    app.uriRouter.registerAction("external-action", external);
    app.workspace.unregisterObsidianProtocolHandler("external-action");

    await expect(app.uriRouter.handleUri("obsidian://external-action?ok=true")).resolves.toBe(true);
    expect(external).toHaveBeenCalledTimes(1);

    app.workspace.unregisterObsidianProtocolHandler("plugin-action", first);
    await expect(app.uriRouter.handleUri("obsidian://plugin-action")).resolves.toBe(false);
  });

  it("keeps View.getState as the view payload and lets WorkspaceLeaf wrap it", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("stateful-public-api-test", (leaf) => new StatefulView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "stateful-public-api-test", state: { answer: 42 }, active: true });

    expect(leaf.view.getState()).toEqual({ answer: 42 });
    expect(leaf.getViewState()).toMatchObject({
      type: "stateful-public-api-test",
      state: { answer: 42 },
    });
    expect(leaf.getViewState()).not.toHaveProperty("group");
    expect(leaf.getViewState()).not.toHaveProperty("pinned");

    await leaf.setViewState(leaf.getViewState(), { focus: true }, { history: false });

    expect(leaf.view.getState()).toEqual({ answer: 42 });
    expect(leaf.getViewState().state).toEqual({ answer: 42 });
    leaf.setPinned(true, { layout: false });
    expect(leaf.getViewState()).toMatchObject({ pinned: true });
  });

  it("keeps public ViewState aligned with Obsidian's plugin-facing shape", () => {
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();
    const state = {
      type: "stateful-public-api-test",
      state: { answer: 42 },
      active: true,
      pinned: false,
      group: leaf,
    } satisfies ViewState;

    expect(state.group).toBe(leaf);
  });

  it("returns MarkdownView state as payload while leaf view state wraps type and state", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Markdown state.md", "state");
    const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;

    expect(view.getState()).toMatchObject({ file: "Markdown state.md", mode: "source", source: false });
    expect(leaf.getViewState()).toMatchObject({
      type: "markdown",
      state: { file: "Markdown state.md", mode: "source", source: false },
    });
  });

  it("accepts the official OpenViewState shape on WorkspaceLeaf.openFile", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Open state.md", "state");
    const leaf = app.workspace.getLeaf();
    const openState = {
      active: true,
      state: { mode: "source" },
      eState: { line: 0 },
    } satisfies OpenViewState;

    await leaf.openFile(file, openState);

    expect(leaf.getViewState()).toMatchObject({
      type: "markdown",
      state: { file: "Open state.md", mode: "source" },
    });
    expect(leaf.getEphemeralState()).toMatchObject({ line: 0 });
  });

  it("returns the most recent visible leaf and falls back within the searched scope", () => {
    const app = new App(document.createElement("div"));
    const first = app.workspace.getLeaf();
    const second = app.workspace.getLeaf("tab");
    first.activeTime = 1;
    second.activeTime = 2;

    second.containerEl.hide();

    expect(app.workspace.getMostRecentLeaf()).toBe(first);

    first.containerEl.hide();

    expect(app.workspace.getMostRecentLeaf()).toBe(first);
  });

  it("delegates splitLeafOrActive(null) through splitActiveLeaf like Obsidian", () => {
    const app = new App(document.createElement("div"));
    const splitActiveLeaf = vi.spyOn(app.workspace, "splitActiveLeaf");

    const leaf = app.workspace.splitLeafOrActive(null);

    expect(splitActiveLeaf).toHaveBeenCalledWith("vertical", undefined);
    expect(leaf).toBe(splitActiveLeaf.mock.results[0]?.value);
  });

  it("exposes Obsidian workspace event overload payloads", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Events.md", "events");
    const leaf = await app.workspace.openFile(file, { active: true });
    const view = leaf.view as MarkdownView;
    const seen: string[] = [];

    app.workspace.on("file-menu", (menu, menuFile, source, menuLeaf) => {
      menu.addSeparator();
      seen.push(`file-menu:${menuFile.path}:${source}:${menuLeaf === leaf}`);
    });
    app.workspace.on("files-menu", (menu, files, source, menuLeaf) => {
      menu.addSeparator();
      seen.push(`files-menu:${files.length}:${source}:${menuLeaf === leaf}`);
    });
    app.workspace.on("url-menu", (menu, url) => {
      menu.addSeparator();
      seen.push(`url-menu:${url}`);
    });
    app.workspace.on("quick-preview", (previewFile, data) => {
      seen.push(`quick-preview:${previewFile.path}:${data}`);
    });
    app.workspace.on("editor-change", (editor, info) => {
      seen.push(`editor-change:${editor.getValue()}:${info.hoverPopover === null}`);
    });
    app.workspace.on("window-open", (workspaceWindow, popoutWindow) => {
      seen.push(`window-open:${workspaceWindow instanceof WorkspaceWindow}:${popoutWindow === window}`);
    });
    app.workspace.on("window-close", (workspaceWindow, popoutWindow) => {
      seen.push(`window-close:${workspaceWindow instanceof WorkspaceWindow}:${popoutWindow === window}`);
    });
    app.workspace.on("css-change", () => {
      seen.push("css-change");
    });
    app.workspace.on("quit", (tasks) => {
      tasks.addPromise(Promise.resolve("quit-task"));
      seen.push("quit");
    });

    app.workspace.trigger("file-menu", new Menu(), file, "command", leaf);
    app.workspace.trigger("files-menu", new Menu(), [file], "file-explorer-context-menu", leaf);
    app.workspace.trigger("url-menu", new Menu(), "https://example.com");
    app.workspace.trigger("css-change");
    view.selectRange(view.editor.getValue().length, view.editor.getValue().length);
    view.insertText("!");
    const popoutLeaf = app.workspace.openPopoutLeaf();
    const workspaceWindow = popoutLeaf.getContainer();
    if (!(workspaceWindow instanceof WorkspaceWindow)) throw new Error("Expected popout window");
    workspaceWindow.close();
    const quitEvent = new Tasks();
    app.workspace.trigger("quit", quitEvent);

    expect(await quitEvent.promise()).toEqual(["quit-task"]);
    expect(seen).toContain("file-menu:Events.md:command:true");
    expect(seen).toContain("files-menu:1:file-explorer-context-menu:true");
    expect(seen).toContain("url-menu:https://example.com");
    expect(seen).toContain("css-change");
    expect(seen).toContain("editor-change:events!:true");
    expect(seen).toContain("quick-preview:Events.md:events!");
    expect(seen).toContain("window-open:true:true");
    expect(seen).toContain("window-close:true:true");
    expect(seen).toContain("quit");
  });

  it("emits pinned and group changes from WorkspaceLeaf without workspace rebroadcasts", () => {
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();
    const pinned: boolean[] = [];
    const groups: string[] = [];
    const workspacePinned: unknown[] = [];
    const workspaceGroups: unknown[] = [];

    leaf.on("pinned-change", (value) => pinned.push(value));
    leaf.on("group-change", (value) => groups.push(value));
    app.workspace.on("pinned-change", (value) => workspacePinned.push(value));
    app.workspace.on("group-change", (value) => workspaceGroups.push(value));

    expect(leaf.setPinned(true)).toBeUndefined();
    expect(leaf.setGroup("linked-pane")).toBeUndefined();

    expect(pinned).toEqual([true]);
    expect(groups).toEqual(["linked-pane"]);
    expect(workspacePinned).toEqual([]);
    expect(workspaceGroups).toEqual([]);
  });

  it("exposes official WorkspaceLeaf deferred, hover popover, and resize hooks", async () => {
    const app = new App(document.createElement("div"));
    let instance: PlainView | null = null;
    app.viewRegistry.registerView("plain-public-api-test", (leaf) => {
      instance = new PlainView(leaf);
      return instance;
    });
    const leaf = app.workspace.getLeaf();

    expect(leaf.view.getViewType()).toBe("empty");
    expect(leaf.hoverPopover).toBeNull();
    expect(leaf.isDeferred).toBe(false);

    leaf.setDeferredViewState({
      type: "plain-public-api-test",
      state: {},
      icon: "lucide-file",
      title: "Deferred plain",
    }, { line: 1 });

    expect(leaf.isDeferred).toBe(true);
    expect(leaf.getEphemeralState()).toEqual({ line: 1 });

    leaf.setEphemeralState({ line: 2, focus: true });

    expect(leaf.getEphemeralState()).toEqual({ line: 2, focus: true });

    await leaf.loadIfDeferred();

    expect(leaf.isDeferred).toBe(false);
    expect(leaf.getEphemeralState()).toEqual({ line: 2, focus: true });
    leaf.onResize();
    expect(instance?.resizeCount).toBe(1);
  });

  it("creates a leaf in a split parent at the requested index", () => {
    const app = new App(document.createElement("div"));
    const originalFirst = app.workspace.rootSplit.children[0];

    const inserted = app.workspace.createLeafInParent(app.workspace.rootSplit, 0);

    expect(inserted.parent).toBe(app.workspace.rootSplit);
    expect(app.workspace.rootSplit.children[0]).toBe(inserted);
    expect(app.workspace.rootSplit.children[1]).toBe(originalFirst);
    expect(app.workspace.activeLeaf).toBe(inserted);
  });

  it("includes deferred placeholder views in getLeavesOfType", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("plain-public-api-test", (leaf) => new PlainView(leaf));
    const leaf = app.workspace.getLeaf();

    leaf.setDeferredViewState({
      type: "plain-public-api-test",
      state: {},
      icon: "lucide-file",
      title: "Deferred plain",
    });

    expect(leaf.isDeferred).toBe(true);
    expect(app.workspace.getLeavesOfType("plain-public-api-test")).toEqual([leaf]);

    const sideLeaf = await app.workspace.ensureSideLeaf("plain-public-api-test", "right", { reveal: false });

    expect(sideLeaf).toBe(leaf);
    expect(leaf.isDeferred).toBe(true);
    expect(app.workspace.getLeavesOfType("plain-public-api-test")).toEqual([leaf]);
  });

  it("does not materialize deferred leaves on view registry rebuild events", async () => {
    const app = new App(document.createElement("div"));
    let created = 0;
    app.viewRegistry.registerView("plain-public-api-test", (leaf) => {
      created += 1;
      return new PlainView(leaf);
    });
    const leaf = app.workspace.getLeaf();

    leaf.setDeferredViewState({
      type: "plain-public-api-test",
      state: { answer: 42 },
      icon: "lucide-file",
      title: "Deferred plain",
    });

    expect(leaf.view).toBeInstanceOf(DeferredView);
    expect(created).toBe(0);

    app.viewRegistry.unregisterView("plain-public-api-test");

    expect(leaf.view).toBeInstanceOf(DeferredView);
    expect(leaf.isDeferred).toBe(true);
    expect(created).toBe(0);

    app.viewRegistry.registerView("plain-public-api-test", (nextLeaf) => {
      created += 1;
      return new PlainView(nextLeaf);
    });

    expect(leaf.view).toBeInstanceOf(DeferredView);
    expect(leaf.isDeferred).toBe(true);
    expect(created).toBe(0);
  });

  it("prepares side leaves without revealing the sidedock when reveal is false", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("quiet-side-test", (leaf) => new PlainView(leaf));
    app.workspace.rightSplit.collapse();

    const sideLeaf = await app.workspace.ensureSideLeaf("quiet-side-test", "right", { reveal: false });

    expect(sideLeaf.getRoot()).toBe(app.workspace.rightSplit);
    expect(app.workspace.rightSplit.collapsed).toBe(true);
    expect(app.workspace.containerEl.classList.contains("is-right-sidedock-open")).toBe(false);
  });

  it("duplicates leaves into tab, split, and popout targets while preserving view state", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Duplicate.md", "# duplicate");
    const source = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });

    const tabDuplicate = await app.workspace.duplicateLeaf(source, "tab");
    expect(tabDuplicate).not.toBe(source);
    expect(tabDuplicate.parent).toBe(source.parent);
    expect((tabDuplicate.getViewState().state as { file?: string }).file).toBe("Duplicate.md");

    const splitDuplicate = await app.workspace.duplicateLeaf(source, "horizontal");
    expect(splitDuplicate).not.toBe(source);
    expect(splitDuplicate.getRoot()).toBe(app.workspace.rootSplit);
    expect((splitDuplicate.getViewState().state as { file?: string }).file).toBe("Duplicate.md");

    const windowDuplicate = await app.workspace.duplicateLeaf(source, "window");
    expect(windowDuplicate).not.toBe(source);
    expect(windowDuplicate.getRoot()).toBe(app.workspace.floatingSplit);
    expect(app.workspace.activeLeaf).toBe(windowDuplicate);
    expect((windowDuplicate.getViewState().state as { file?: string }).file).toBe("Duplicate.md");
  });

  it("duplicates leaves with focused ephemeral state", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("plain-public-api-test", (leaf) => new PlainView(leaf));
    const source = app.workspace.getLeaf();
    await source.setViewState({ type: "plain-public-api-test", active: true });
    source.setEphemeralState({ scroll: 42 });

    const duplicate = await app.workspace.duplicateLeaf(source, "tab");

    expect(duplicate.getEphemeralState()).toEqual({ scroll: 42, focus: true });
  });

  it("duplicates tab targets into the current tab group rather than the source parent", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    try {
      const app = new App(container);
      const sourceFile = await app.vault.create("Duplicate source.md", "source");
      const activeFile = await app.vault.create("Duplicate active.md", "active");
      const source = await app.workspace.openFile(sourceFile, { active: true });
      const sourceParent = source.parent;
      const sourceSibling = app.workspace.getLeaf("tab");
      await sourceSibling.openFile(activeFile, { active: true });
      const activeSplitLeaf = app.workspace.splitActiveLeaf("vertical");
      source.activeTime = 1;
      sourceSibling.activeTime = 2;
      activeSplitLeaf.activeTime = 3;
      app.workspace.setActiveLeaf(activeSplitLeaf);

      const duplicate = await app.workspace.duplicateLeaf(source, "tab");

      expect(duplicate.parent).toBe(activeSplitLeaf.parent);
      expect(duplicate.parent).not.toBe(sourceParent);
      expect((duplicate.getViewState().state as { file?: string }).file).toBe("Duplicate source.md");
    } finally {
      container.remove();
    }
  });

  it("normalizes duplicate leaf pane aliases like Obsidian", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Duplicate aliases.md", "aliases");
    const source = await app.workspace.openFile(file, { active: true });
    const sourceParent = source.parent;

    const trueDuplicate = await app.workspace.duplicateLeaf(source, true);

    expect(trueDuplicate.parent).toBe(sourceParent);
    expect((trueDuplicate.getViewState().state as { file?: string }).file).toBe("Duplicate aliases.md");

    const splitDuplicate = await app.workspace.duplicateLeaf(source, "split");

    expect(splitDuplicate.parent).not.toBe(sourceParent);
    expect(splitDuplicate.getRoot()).toBe(app.workspace.rootSplit);
    expect((splitDuplicate.getViewState().state as { file?: string }).file).toBe("Duplicate aliases.md");
  });

  it("keeps splitLeafOrActive group-neutral until setViewState links the new leaf", async () => {
    const app = new App(document.createElement("div"));
    const sourceFile = await app.vault.create("Split linked source.md", "source");
    const linkedFile = await app.vault.create("Split linked target.md", "target");
    const source = await app.workspace.openFile(sourceFile, { active: true });
    const grouped = app.workspace.getLeaf("tab");
    await grouped.openFile(linkedFile, { active: true, group: source });

    expect(source.group).toBeTruthy();
    expect(grouped.group).toBe(source.group);

    const split = app.workspace.splitLeafOrActive(source, "vertical");

    expect(split.group).toBeNull();

    await split.setViewState({ type: "empty", active: true, group: source });

    expect(split.group).toBe(source.group);
  });

  it("moves a leaf to a popout and returns the WorkspaceWindow with init data", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Move.md", "move");
    const source = await app.workspace.openFile(file, { active: true });
    Object.defineProperty(source.containerEl, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 420, height: 360, top: 0, left: 0, right: 420, bottom: 360, toJSON: () => ({}) }),
    });

    const workspaceWindow = app.workspace.moveLeafToPopout(source, { x: 10, y: 20, size: { width: 640, height: 480 } });

    expect(workspaceWindow).toBe(source.getContainer());
    expect(workspaceWindow.parent).toBe(app.workspace.floatingSplit);
    expect(workspaceWindow.x).toBe(10);
    expect(workspaceWindow.y).toBe(20);
    expect(workspaceWindow.size).toEqual({ x: 10, y: 20, width: 640, height: 480 });
    expect(source.getContainer()).toBeInstanceOf(WorkspaceWindow);
    expect(app.workspace.activeLeaf).toBe(source);
  });

  it("keeps openPopoutLeaf passive and returns undefined when moving non-ItemViews", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("plain-public-api-test", (leaf) => new PlainView(leaf));
    const source = app.workspace.getLeaf();
    await source.setViewState({ type: "plain-public-api-test", active: true });
    app.workspace.setActiveLeaf(source);

    const popoutLeaf = app.workspace.openPopoutLeaf();

    expect(app.workspace.activeLeaf).toBe(source);
    expect(popoutLeaf.getContainer()).toBeInstanceOf(WorkspaceWindow);
    expect(app.workspace.moveLeafToPopout(source)).toBeUndefined();
    expect(source.getRoot()).toBe(app.workspace.rootSplit);
  });

  it("defaults moveLeafToPopout size and zoom from the source leaf", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Move defaults.md", "move");
    const source = await app.workspace.openFile(file, { active: true });
    Object.defineProperty(source.containerEl, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ x: 4, y: 5, width: 420, height: 360, top: 5, left: 4, right: 424, bottom: 365, toJSON: () => ({}) }),
    });
    Object.defineProperty(source.containerEl.ownerDocument.defaultView ?? window, "electron", {
      configurable: true,
      value: { webFrame: { getZoomLevel: () => 1.25 } },
    });

    const workspaceWindow = app.workspace.moveLeafToPopout(source);

    expect(workspaceWindow?.size).toEqual({ x: 4, y: 5, width: 420, height: 360 });
    expect(workspaceWindow?.width).toBe(420);
    expect(workspaceWindow?.height).toBe(360);
    expect(workspaceWindow?.zoom).toBe(1.25);
    const layout = app.workspace.getLayout().floating;
    expect(layout?.type).toBe("floating");
    if (layout?.type !== "floating") throw new Error("Expected floating layout");
    const windowNode = layout.children[0];
    expect(windowNode).toEqual(expect.objectContaining({ type: "window", zoom: 1.25 }));
    expect(windowNode).toHaveProperty("width");
    expect(windowNode).toHaveProperty("height");
    expect(windowNode).not.toHaveProperty("size");
  });

  it("opens popouts through window.open when available and initializes the new window document", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const popoutDocument = document.implementation.createHTMLDocument("Popout");
    const openedWindow = {
      ...window,
      document: popoutDocument,
      navigator: window.navigator,
      location: window.location,
      addEventListener: () => {},
      removeEventListener: () => {},
      focus: () => {},
      closed: false,
      screenX: 0,
      screenY: 0,
      outerWidth: 640,
      outerHeight: 480,
      open: window.open.bind(window),
      getComputedStyle: window.getComputedStyle.bind(window),
    } as unknown as Window;
    const calls: string[] = [];
    const originalOpen = window.open;
    Object.defineProperty(window, "open", {
      configurable: true,
      value: (url: string, target: string, features: string) => {
        calls.push(`${url}|${target}|${features}`);
        return openedWindow;
      },
    });
    try {
      const workspaceWindow = app.workspace.openPopout({ x: 10, y: 20, size: { width: 320, height: 500 } });

      expect(workspaceWindow.win).toBe(openedWindow);
      expect(calls[0]).toContain("about:blank|_blank|popup");
      expect(calls[0]).toContain("x=10");
      expect(calls[0]).toContain("y=20");
      expect(calls[0]).toContain("width=600");
      expect(calls[0]).toContain("height=600");
      expect(popoutDocument.head.querySelector("base")?.href).toBe(window.location.href);
      expect((openedWindow as Window & { app?: App }).app).toBe(app);
    } finally {
      Object.defineProperty(window, "open", { configurable: true, value: originalOpen });
    }
  });

  it("duplicates leaf history without sharing history arrays", async () => {
    const app = new App(document.createElement("div"));
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const source = await app.workspace.openFile(first, { active: true });
    await source.openFile(second, { active: true });

    const duplicate = await app.workspace.duplicateLeaf(source, "tab");

    expect(duplicate.history.backHistory).not.toBe(source.history.backHistory);
    expect(duplicate.history.backHistory.length).toBe(1);
    expect(duplicate.canGoBack()).toBe(true);
    await duplicate.history.back();
    expect((duplicate.getViewState().state as { file?: string }).file).toBe("First.md");
    expect((source.getViewState().state as { file?: string }).file).toBe("Second.md");
  });
});
