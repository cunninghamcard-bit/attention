import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { View, type ViewStateResult } from "../views/View";
import { UnknownView } from "../views/UnknownView";
import { MarkdownView } from "../views/MarkdownView";
import { EmptyView } from "../views/EmptyView";
import { Menu } from "../ui/Menu";
import { Platform } from "../platform/Platform";
import type { DragSource } from "../ui/drag/DragManager";
import type { WorkspaceLeaf } from "./WorkspaceLeaf";
import { WorkspaceSplit } from "./WorkspaceSplit";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { WorkspaceWindow } from "./WorkspaceWindow";

class NoHistoryView extends View {
  navigation = true;

  getViewType(): string {
    return "no-history-test";
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (result) result.history = false;
  }
}

class DeferredView extends View {
  static created = 0;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    DeferredView.created += 1;
  }

  getViewType(): string {
    return "deferred-test";
  }
}

class CloseOrderView extends View {
  parentDuringClose: HTMLElement | null | undefined;
  cleanupRanDuringClose = false;
  private cleanupRan = false;

  getViewType(): string {
    return "close-order-test";
  }

  async onOpen(): Promise<void> {
    this.register(() => {
      this.cleanupRan = true;
    });
  }

  async onClose(): Promise<void> {
    this.parentDuringClose = this.containerEl.parentElement;
    this.cleanupRanDuringClose = this.cleanupRan;
  }
}

class ThrowingStateView extends View {
  getViewType(): string {
    return "throwing-state-test";
  }

  async setState(): Promise<void> {
    throw new Error("setState failed");
  }
}

class ThrowingOpenView extends View {
  getViewType(): string {
    return "throwing-open-test";
  }

  async onOpen(): Promise<void> {
    throw new Error("open failed");
  }
}

class DoneCallbackView extends View {
  doneStarted = false;
  doneFinished = false;

  getViewType(): string {
    return "done-callback-test";
  }

  async setState(_state: unknown, result?: ViewStateResult): Promise<void> {
    (result as ViewStateResult & { done?: () => void }).done = () => {
      this.doneStarted = true;
      window.setTimeout(() => {
        this.doneFinished = true;
      }, 0);
    };
  }
}

class RebuildableView extends View {
  receivedState: unknown = null;

  getViewType(): string {
    return "rebuildable-test";
  }

  async setState(state: unknown): Promise<void> {
    this.receivedState = state;
  }

  getState(): Record<string, unknown> {
    return this.receivedState && typeof this.receivedState === "object" && !Array.isArray(this.receivedState)
      ? this.receivedState as Record<string, unknown>
      : {};
  }
}

class DynamicIconView extends View {
  getViewType(): string {
    return "dynamic-icon-test";
  }

  override getIcon(): string {
    return "lucide-duck";
  }
}

class PlainAcceptingView extends View {
  getViewType(): string {
    return "plain-accepting-test";
  }

  canAcceptExtension(_extension: string): boolean {
    return true;
  }
}

class HistoryRecordingView extends View {
  navigation = true;
  receivedState: unknown = null;

  getViewType(): string {
    return "history-recording-test";
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    this.receivedState = state;
    if (result) result.history = true;
  }

  getState(): Record<string, unknown> {
    return this.receivedState && typeof this.receivedState === "object" && !Array.isArray(this.receivedState)
      ? this.receivedState as Record<string, unknown>
      : {};
  }
}

class MenuCountingView extends View {
  tabMenus = 0;
  paneMenus = 0;

  getViewType(): string {
    return "menu-counting-test";
  }

  override onTabMenu(menu: Menu): void {
    this.tabMenus += 1;
    super.onTabMenu(menu);
  }

  override onPaneMenu(menu: Menu, source?: string): void {
    this.paneMenus += 1;
    super.onPaneMenu(menu, source);
  }
}

class AsyncCloseView extends View {
  closeStarted = false;
  closeFinished = false;
  resolveClose: (() => void) | null = null;
  private payload: Record<string, unknown> = {};

  getViewType(): string {
    return "async-close-test";
  }

  getDisplayText(): string {
    return "Async close";
  }

  async setState(state: unknown): Promise<void> {
    this.payload = state && typeof state === "object" && !Array.isArray(state) ? state as Record<string, unknown> : {};
  }

  getState(): Record<string, unknown> {
    return this.payload;
  }

  async onClose(): Promise<void> {
    this.closeStarted = true;
    await new Promise<void>((resolve) => {
      this.resolveClose = resolve;
    });
    this.closeFinished = true;
  }
}

class DetachOrderView extends View {
  leafConnectedDuringClose: boolean | null = null;
  leafParentDuringClose: WorkspaceLeaf["parent"] | undefined;

  getViewType(): string {
    return "detach-order-test";
  }

  async onClose(): Promise<void> {
    this.leafConnectedDuringClose = this.leaf.containerEl.isConnected;
    this.leafParentDuringClose = this.leaf.parent;
  }
}

class AsyncEmptyCloseView extends EmptyView {
  closeStarted = false;
  closeFinished = false;
  resolveClose: (() => void) | null = null;

  getViewType(): string {
    return "async-empty-close-test";
  }

  async onClose(): Promise<void> {
    this.closeStarted = true;
    await new Promise<void>((resolve) => {
      this.resolveClose = resolve;
    });
    this.closeFinished = true;
  }
}

describe("WorkspaceLeaf", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  it("lets views opt out of navigation history through ViewStateResult", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("no-history-test", (leaf) => new NoHistoryView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "no-history-test", state: { step: 1 }, active: true });
    await leaf.setViewState({ type: "no-history-test", state: { step: 2 }, active: true });

    expect(leaf.canGoBack()).toBe(false);
  });

  it("does not record history for popstate view state updates", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("history-recording-test", (leaf) => new HistoryRecordingView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "history-recording-test", state: { step: 1 }, active: true });
    await leaf.setViewState({
      type: "history-recording-test",
      state: { step: 2 },
      active: true,
      popstate: true,
    });

    expect(leaf.backHistory).toEqual([]);
  });

  it("deduplicates history with Obsidian's JSON view-state order semantics", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("history-recording-test", (leaf) => new HistoryRecordingView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "history-recording-test", state: { a: 1, b: 2 }, active: true });
    await leaf.setViewState({ type: "history-recording-test", state: { b: 2, a: 1 }, active: true });
    await leaf.setViewState({ type: "history-recording-test", state: { a: 1, b: 2 }, active: true });

    expect(leaf.backHistory).toHaveLength(2);
  });

  it("does not record history when materializing a same-type DeferredView", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("history-recording-test", (leaf) => new HistoryRecordingView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({
      type: "history-recording-test",
      state: { step: 1 },
      active: true,
      icon: "lucide-file",
      title: "Deferred history",
    });

    expect(leaf.isDeferred).toBe(true);

    await leaf.loadIfDeferred();

    expect(leaf.view).toBeInstanceOf(HistoryRecordingView);
    expect(leaf.backHistory).toEqual([]);
  });

  it("keeps deferred view state unloaded until loadIfDeferred is called", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("deferred-test", (leaf) => new DeferredView(leaf));
    const leaf = app.workspace.getLeaf("tab");
    DeferredView.created = 0;

    leaf.setDeferredViewState({ type: "deferred-test", state: { file: "Deferred.md" }, title: "Deferred" });

    expect(DeferredView.created).toBe(0);
    expect(leaf.getDisplayText()).toBe("Deferred");

    await leaf.loadIfDeferred();

    expect(DeferredView.created).toBe(1);
    expect(leaf.view?.getViewType()).toBe("deferred-test");
  });

  it("defers hidden registered views using Obsidian's visibility and title/icon contract", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("deferred-test", (leaf) => new DeferredView(leaf));
    const leaf = app.workspace.getLeaf("tab");
    DeferredView.created = 0;

    leaf.containerEl.hide();
    await leaf.setViewState({
      type: "deferred-test",
      state: { file: "Deferred.md" },
      icon: "lucide-file",
      title: "",
    });

    expect(DeferredView.created).toBe(0);
    expect(leaf.isDeferred).toBe(true);
    expect(leaf.view.getViewType()).toBe("deferred-test");

    await leaf.loadIfDeferred();

    expect(DeferredView.created).toBe(1);
  });

  it("does not defer hidden views without an icon", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("deferred-test", (leaf) => new DeferredView(leaf));
    const leaf = app.workspace.getLeaf("tab");
    DeferredView.created = 0;

    leaf.containerEl.hide();
    await leaf.setViewState({
      type: "deferred-test",
      state: { file: "Immediate.md" },
      title: "Immediate",
    });

    expect(DeferredView.created).toBe(1);
    expect(leaf.isDeferred).toBe(false);
  });

  it("loads a deferred active leaf when a visible non-stacked tab group updates", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    app.viewRegistry.registerView("deferred-test", (leaf) => new DeferredView(leaf));
    const leaf = app.workspace.getLeaf();
    const tabs = leaf.parent;
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected workspace tabs");
    DeferredView.created = 0;

    leaf.containerEl.hide();
    leaf.setDeferredViewState({
      type: "deferred-test",
      state: { file: "Deferred.md" },
      icon: "lucide-file",
      title: "Deferred",
    });

    expect(DeferredView.created).toBe(0);

    tabs.updateTabDisplay();
    await Promise.resolve();

    expect(DeferredView.created).toBe(1);
    expect(leaf.isDeferred).toBe(false);
  });

  it("preserves unknown view identity, icon, and state for unregistered view types", async () => {
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "missing-plugin-view", state: { answer: 42 }, active: true });

    expect(leaf.view).toBeInstanceOf(UnknownView);
    expect(leaf.view.getViewType()).toBe("missing-plugin-view");
    expect(leaf.view.getDisplayText()).toBe("missing-plugin-view");
    expect(leaf.view.getIcon()).toBe("lucide-ghost");
    expect(leaf.view.getState()).toEqual({ answer: 42 });
  });

  it("serializes view state icons from getIcon like Obsidian", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("dynamic-icon-test", (leaf) => new DynamicIconView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "dynamic-icon-test", active: true });

    expect(leaf.getViewState().icon).toBe("lucide-duck");
  });

  it("detaches and unloads a view before calling onClose", async () => {
    const app = new App(document.createElement("div"));
    let instance: CloseOrderView | null = null;
    app.viewRegistry.registerView("close-order-test", (leaf) => {
      instance = new CloseOrderView(leaf);
      return instance;
    });
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "close-order-test", active: true });
    await leaf.setViewState({ type: "empty", active: true });

    expect(instance?.parentDuringClose).toBeNull();
    expect(instance?.cleanupRanDuringClose).toBe(true);
  });

  it("resets the leaf container to its resize handle before opening the next view", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("close-order-test", (leaf) => new CloseOrderView(leaf));
    app.viewRegistry.registerView("rebuildable-test", (leaf) => new RebuildableView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "close-order-test", active: true });
    const staleEl = document.createElement("div");
    staleEl.className = "stale-view-node";
    leaf.containerEl.insertBefore(staleEl, leaf.containerEl.firstChild);

    await leaf.setViewState({ type: "rebuildable-test", active: true });

    expect(leaf.containerEl.contains(staleEl)).toBe(false);
    expect(leaf.containerEl.children.item(0)).toBe(leaf.resizeHandleEl);
    expect(leaf.containerEl.children.item(1)).toBe(leaf.view.containerEl);
    expect(leaf.view.containerEl.classList.contains("workspace-leaf-content")).toBe(true);
  });

  it("lets the tab close button click bubble like Obsidian", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const leaf = app.workspace.getLeaf();
    const tabClick = vi.fn();
    const detach = vi.spyOn(leaf, "detach").mockImplementation(() => {});
    leaf.tabHeaderEl.addEventListener("click", tabClick);

    const closeClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    leaf.tabHeaderCloseEl.dispatchEvent(closeClick);

    expect(detach).toHaveBeenCalledOnce();
    expect(tabClick).toHaveBeenCalledOnce();
    expect(closeClick.defaultPrevented).toBe(false);
    detach.mockRestore();
  });

  it("prevents middle-click default on mousedown, not auxclick", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const leaf = app.workspace.getLeaf();
    const detach = vi.spyOn(leaf, "detach").mockImplementation(() => {});

    const middleDown = new MouseEvent("mousedown", { button: 1, bubbles: true, cancelable: true });
    leaf.tabHeaderEl.dispatchEvent(middleDown);
    const middleAuxClick = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
    leaf.tabHeaderEl.dispatchEvent(middleAuxClick);

    expect(middleDown.defaultPrevented).toBe(true);
    expect(middleAuxClick.defaultPrevented).toBe(false);
    expect(detach).toHaveBeenCalledOnce();
    detach.mockRestore();
  });

  it("does not await EmptyView-family close before opening the next view", async () => {
    const app = new App(document.createElement("div"));
    let emptyInstance: AsyncEmptyCloseView | null = null;
    app.viewRegistry.registerView("async-empty-close-test", (leaf) => {
      emptyInstance = new AsyncEmptyCloseView(leaf);
      return emptyInstance;
    });
    app.viewRegistry.registerView("rebuildable-test", (leaf) => new RebuildableView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "async-empty-close-test", active: true });
    await leaf.setViewState({ type: "rebuildable-test", active: true });

    expect(emptyInstance?.closeStarted).toBe(true);
    expect(emptyInstance?.closeFinished).toBe(false);
    expect(leaf.view.getViewType()).toBe("rebuildable-test");

    emptyInstance?.resolveClose?.();
    await Promise.resolve();
    expect(emptyInstance?.closeFinished).toBe(true);
  });

  it("logs setState failures without rejecting the view state change", async () => {
    const app = new App(document.createElement("div"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    app.viewRegistry.registerView("throwing-state-test", (leaf) => new ThrowingStateView(leaf));
    const leaf = app.workspace.getLeaf();

    await expect(leaf.setViewState({ type: "throwing-state-test", active: true })).resolves.toBeUndefined();

    expect(leaf.view?.getViewType()).toBe("throwing-state-test");
    expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
  });

  it("logs open failures without rejecting the view state change", async () => {
    const app = new App(document.createElement("div"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    app.viewRegistry.registerView("throwing-open-test", (leaf) => new ThrowingOpenView(leaf));
    const leaf = app.workspace.getLeaf();

    await expect(leaf.setViewState({ type: "throwing-open-test", active: true })).resolves.toBeUndefined();

    expect(leaf.view?.getViewType()).toBe("throwing-open-test");
    expect(errorSpy).toHaveBeenCalledWith("Failed to open view", expect.any(Error));
  });

  it("does not await ViewStateResult done callbacks", async () => {
    const app = new App(document.createElement("div"));
    let instance: DoneCallbackView | null = null;
    app.viewRegistry.registerView("done-callback-test", (leaf) => {
      instance = new DoneCallbackView(leaf);
      return instance;
    });
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "done-callback-test", active: true });

    expect(instance?.doneStarted).toBe(true);
    expect(instance?.doneFinished).toBe(false);
  });

  it("limits hidden tab header menus to tab menu hooks", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    let instance: MenuCountingView | null = null;
    app.viewRegistry.registerView("menu-counting-test", (leaf) => {
      instance = new MenuCountingView(leaf);
      return instance;
    });
    const leaf = app.workspace.getLeaf();
    let leafMenuEvents = 0;
    app.workspace.on("leaf-menu", () => {
      leafMenuEvents += 1;
    });

    await leaf.setViewState({ type: "menu-counting-test", active: true });
    leaf.containerEl.style.display = "none";
    leaf.openTabHeaderMenu(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));

    expect(instance?.tabMenus).toBe(1);
    expect(instance?.paneMenus).toBe(0);
    expect(leafMenuEvents).toBe(0);

    leaf.containerEl.style.display = "";
    leaf.openTabHeaderMenu(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));

    expect(instance?.tabMenus).toBe(2);
    expect(instance?.paneMenus).toBe(1);
    expect(leafMenuEvents).toBe(1);
  });

  it("adds the phone tab title label before tab actions", async () => {
    const previousPhone = Platform.isPhone;
    Platform.isPhone = true;
    try {
      const app = new App(document.body.appendChild(document.createElement("div")));
      app.viewRegistry.registerView("rebuildable-test", (leaf) => new RebuildableView(leaf));
      const leaf = app.workspace.getLeaf();

      await leaf.setViewState({ type: "rebuildable-test", state: { value: 1 }, active: true });
      leaf.openTabHeaderMenu(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      await vi.waitFor(() => expect(document.body.querySelector(".menu")).toBeTruthy());

      const titleItem = document.body.querySelector<HTMLElement>(".menu-item[data-section='title']");
      expect(titleItem?.classList.contains("is-label")).toBe(true);
      expect(titleItem?.querySelector(".menu-item-title")?.classList.contains("u-muted")).toBe(true);
      expect(titleItem?.querySelector(".menu-item-icon svg")).not.toBeNull();
      expect(titleItem?.querySelector(".menu-item-title")?.textContent).toBe(leaf.getDisplayText());
    } finally {
      Platform.isPhone = previousPhone;
      document.body.querySelectorAll(".menu").forEach((el) => el.remove());
    }
  });

  it("collects grouped leaves by generated leaf.group rather than treating leaf ids as groups", () => {
    const app = new App(document.createElement("div"));
    const sourceLeaf = app.workspace.getLeaf();
    const groupedLeaf = app.workspace.splitActiveLeaf();

    expect(app.workspace.getGroupLeaves(sourceLeaf.id)).toEqual([]);

    groupedLeaf.setGroupMember(sourceLeaf);

    expect(sourceLeaf.group).toBeTruthy();
    expect(sourceLeaf.group).toBe(groupedLeaf.group);
    expect(sourceLeaf.group).toMatch(/^[0-9a-f]{16}$/);
    expect(sourceLeaf.group).not.toBe(sourceLeaf.id);
    expect(app.workspace.getGroupLeaves(sourceLeaf.group)).toEqual([sourceLeaf, groupedLeaf]);
  });

  it("ignores setGroupMember when the target leaf is itself", () => {
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();

    leaf.setGroupMember(leaf);

    expect(leaf.group).toBeNull();
  });

  it("only reuses a current view type for openFile when the view is a FileView", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("plain-accepting-test", (leaf) => new PlainAcceptingView(leaf));
    const file = await app.vault.create("Real Markdown.md", "real");
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "plain-accepting-test", active: true });
    await leaf.openFile(file, { active: true });

    expect(leaf.view).toBeInstanceOf(MarkdownView);
  });

  it("syncs grouped FileViews when sync is false and suppresses it when sync is true", async () => {
    const app = new App(document.createElement("div"));
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const third = await app.vault.create("Third.md", "third");
    const sourceLeaf = await app.workspace.openFile(first, { active: true });
    const groupedLeaf = app.workspace.getLeaf("tab");
    await groupedLeaf.openFile(second, { active: true });
    groupedLeaf.setGroupMember(sourceLeaf);

    await sourceLeaf.setViewState({ type: "markdown", state: { file: third.path, sync: false }, active: true });
    await vi.waitFor(() => {
      expect((groupedLeaf.view as { file?: { path: string } | null } | null)?.file?.path).toBe("Third.md");
    });

    await sourceLeaf.setViewState({ type: "markdown", state: { file: first.path, sync: true }, active: true });

    expect((groupedLeaf.view as { file?: { path: string } | null } | null)?.file?.path).toBe("Third.md");
  });

  it("rebuilds leaves when their view type is unregistered and registered again", async () => {
    const app = new App(document.createElement("div"));
    let restored: RebuildableView | null = null;
    app.viewRegistry.registerView("rebuildable-test", (leaf) => {
      restored = new RebuildableView(leaf);
      return restored;
    });
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "rebuildable-test", state: { value: 1 }, active: true });

    app.viewRegistry.unregisterView("rebuildable-test");
    await nextMacrotask();

    expect(leaf.view).toBeInstanceOf(UnknownView);
    expect(leaf.view?.getViewType()).toBe("rebuildable-test");

    app.viewRegistry.registerView("rebuildable-test", (nextLeaf) => {
      restored = new RebuildableView(nextLeaf);
      return restored;
    });
    await nextMacrotask();

    expect(leaf.view).toBeInstanceOf(RebuildableView);
    expect(restored?.receivedState).toEqual({ value: 1 });
  });

  it("records history when a file view changes files", async () => {
    const app = new App(document.createElement("div"));
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");

    const leaf = await app.workspace.openFile(first, { active: true });
    await app.workspace.openFile(second, { active: true });

    expect(leaf.canGoBack()).toBe(true);

    await leaf.goBack();

    expect((leaf.view as { file?: { path: string } | null } | null)?.file?.path).toBe("First.md");
  });

  it("separates history snapshots from navigation history recording", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("rebuildable-test", (leaf) => new RebuildableView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "rebuildable-test", state: { value: 1 }, active: true });

    expect(leaf.getHistoryState()?.state).toMatchObject({
      type: "rebuildable-test",
      state: { value: 1 },
    });

    leaf.history.pushState({ type: "empty", state: {} });

    expect(leaf.backHistory).toHaveLength(0);
  });

  it("keeps forward history tail-oriented like Obsidian history.go", async () => {
    const app = new App(document.createElement("div"));
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const third = await app.vault.create("Third.md", "third");

    const leaf = await app.workspace.openFile(first, { active: true });
    await app.workspace.openFile(second, { active: true });
    await app.workspace.openFile(third, { active: true });

    await leaf.history.go(-2);

    expect((leaf.view as { file?: { path: string } | null } | null)?.file?.path).toBe("First.md");
    expect(leaf.forwardHistory.map((entry) => (entry.state.state as { file?: string }).file)).toEqual(["Third.md", "Second.md"]);

    await leaf.history.go(1);

    expect((leaf.view as { file?: { path: string } | null } | null)?.file?.path).toBe("Second.md");
    expect(leaf.forwardHistory.map((entry) => (entry.state.state as { file?: string }).file)).toEqual(["Third.md"]);
    expect(leaf.backHistory.map((entry) => (entry.state.state as { file?: string }).file)).toEqual(["First.md"]);
  });

  it("opens link subpaths as ephemeral state", async () => {
    const app = new App(document.createElement("div"));
    const target = await app.vault.create("Target.md", "# Heading");
    const leaf = app.workspace.getLeaf();

    await leaf.openLinkText("Target#Heading", "", { active: true });

    expect((leaf.view as { file?: { path: string } | null } | null)?.file?.path).toBe(target.path);
    expect(leaf.view?.getEphemeralState()).toEqual({ subpath: "Heading", line: 0 });
  });

  it("detaches leaves without awaiting close and records undo history", async () => {
    const app = new App(document.createElement("div"));
    let instance: AsyncCloseView | null = null;
    app.viewRegistry.registerView("async-close-test", (leaf) => {
      instance = new AsyncCloseView(leaf);
      return instance;
    });
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "async-close-test", state: { saved: true }, active: true });
    leaf.detach();

    expect(leaf.view?.getViewType()).toBe("empty");
    expect(instance?.closeStarted).toBe(true);
    expect(instance?.closeFinished).toBe(false);
    expect(app.workspace.undoHistory[0]?.leafId).toBe(leaf.id);
    expect(app.workspace.undoHistory[0]?.state.type).toBe("async-close-test");
    expect(app.workspace.undoHistory[0]?.state.state).toEqual({ saved: true });

    instance?.resolveClose?.();
    await Promise.resolve();

    expect(instance?.closeFinished).toBe(true);
  });

  it("detaches the leaf workspace item before closing the old view", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    let instance: DetachOrderView | null = null;
    app.viewRegistry.registerView("detach-order-test", (leaf) => {
      instance = new DetachOrderView(leaf);
      return instance;
    });
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "detach-order-test", active: true });
    leaf.detach();

    expect(instance?.leafConnectedDuringClose).toBe(false);
    expect(instance?.leafParentDuringClose).toBeNull();
  });

  it("opens a single file or graph bookmark drop in the target leaf", async () => {
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();
    const bookmark = { type: "graph", title: "Graph", ctime: Date.now(), options: { showTags: true } };
    const opener = { openBookmarkInLeaf: vi.fn() };
    vi.spyOn(app.internalPlugins, "getEnabledPluginById").mockReturnValue(opener as never);
    const source = {
      type: "bookmarks",
      payload: null,
      elements: [],
      items: [{ item: bookmark }],
    } as DragSource & { type: "bookmarks"; items: Array<{ item: typeof bookmark }> };

    expect(leaf.handleDrop(new Event("dragover") as DragEvent, source, true)).toEqual({
      action: "Open in this tab",
      dropEffect: "move",
    });

    leaf.handleDrop(new Event("drop") as DragEvent, source, false);

    expect(app.workspace.activeLeaf).toBe(leaf);
    expect(opener.openBookmarkInLeaf).toHaveBeenCalledWith(bookmark, leaf, { active: true });
  });

  it("ignores multiple or non-openable bookmark drops on a leaf", () => {
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();
    const opener = { openBookmarkInLeaf: vi.fn() };
    vi.spyOn(app.internalPlugins, "getEnabledPluginById").mockReturnValue(opener as never);
    const multipleOpenableSource = {
      type: "bookmarks",
      payload: null,
      elements: [],
      items: [{ item: { type: "file", path: "A.md" } }, { item: { type: "graph" } }],
    } as DragSource & { type: "bookmarks"; items: Array<{ item: { type: string; path?: string } }> };
    const nonOpenableSource = {
      type: "bookmarks",
      payload: null,
      elements: [],
      items: [{ item: { type: "url", url: "https://example.com" } }],
    } as DragSource & { type: "bookmarks"; items: Array<{ item: { type: string; url?: string } }> };

    expect(leaf.handleDrop(new Event("dragover") as DragEvent, multipleOpenableSource, true)).toBeUndefined();
    expect(leaf.handleDrop(new Event("dragover") as DragEvent, nonOpenableSource, true)).toBeUndefined();
    expect(opener.openBookmarkInLeaf).not.toHaveBeenCalled();
  });

  it("restores a closed pane with its view state and leaf navigation history", async () => {
    const app = new App(document.createElement("div"));
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const leaf = await app.workspace.openFile(first, { active: true });
    await app.workspace.openFile(second, { active: true });

    leaf.detach();

    expect(app.workspace.undoHistory[0]?.leafHistory?.backHistory[0]?.state.state).toEqual(expect.objectContaining({ file: "First.md" }));
    expect(app.commands.findCommand("workspace:undo-close-pane")?.checkCallback?.(true)).toBe(true);

    await app.workspace.undoClosePane();

    const restored = app.workspace.activeLeaf;
    expect(restored?.id).toBe(leaf.id);
    expect((restored?.view as { file?: { path: string } | null } | null)?.file?.path).toBe("Second.md");
    expect(restored?.canGoBack()).toBe(true);

    await restored?.goBack();

    expect((restored?.view as { file?: { path: string } | null } | null)?.file?.path).toBe("First.md");
    expect(app.workspace.hasUndoHistory()).toBe(false);
  });

  it("updates closed pane state and leaf history when files are renamed", async () => {
    const app = new App(document.createElement("div"));
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const leaf = await app.workspace.openFile(first, { active: true });
    await app.workspace.openFile(second, { active: true });

    leaf.detach();
    await app.fileManager.renameFile(first, "First Renamed.md");
    await app.fileManager.renameFile(second, "Second Renamed.md");

    expect((app.workspace.undoHistory[0]?.state.state as { file?: string } | undefined)?.file).toBe("Second Renamed.md");
    expect(app.workspace.undoHistory[0]?.leafHistory?.backHistory[0]?.title).toBe("First Renamed");
    expect((app.workspace.undoHistory[0]?.leafHistory?.backHistory[0]?.state.state as { file?: string } | undefined)?.file).toBe("First Renamed.md");

    await app.workspace.undoClosePane();

    const restored = app.workspace.activeLeaf;
    expect((restored?.view as { file?: { path: string } | null } | null)?.file?.path).toBe("Second Renamed.md");

    await restored?.goBack();

    expect((restored?.view as { file?: { path: string } | null } | null)?.file?.path).toBe("First Renamed.md");
  });

  it("uses Obsidian close commands to unpin active tabs and close unpinned siblings", async () => {
    const app = new App(document.createElement("div"));
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const third = await app.vault.create("Third.md", "third");
    const firstLeaf = await app.workspace.openFile(first, { active: true });
    const secondLeaf = app.workspace.getLeaf("tab");
    await secondLeaf.openFile(second, { active: true });
    const thirdLeaf = app.workspace.getLeaf("tab");
    await thirdLeaf.openFile(third, { active: true });

    firstLeaf.setPinned(true);
    app.workspace.setActiveLeaf(firstLeaf);
    await app.commands.executeCommandById("workspace:close");

    expect(firstLeaf.pinned).toBe(false);
    expect(app.workspace.getLeafById(firstLeaf.id)).toBe(firstLeaf);
    expect(app.workspace.undoHistory.length).toBe(0);

    thirdLeaf.setPinned(true);
    app.workspace.setActiveLeaf(firstLeaf);

    expect(app.commands.findCommand("workspace:close-others")?.checkCallback?.(true)).toBe(true);

    await app.commands.executeCommandById("workspace:close-others");

    expect(app.workspace.getLeafById(firstLeaf.id)).toBe(firstLeaf);
    expect(app.workspace.getLeafById(secondLeaf.id)).toBeNull();
    expect(app.workspace.getLeafById(thirdLeaf.id)).toBe(thirdLeaf);
    expect(app.workspace.undoHistory.some((entry) => entry.leafId === secondLeaf.id && entry.state.type === "markdown")).toBe(true);
  });

  it("closes tab groups while preserving pinned leaves and supports closing others in the active tab group", async () => {
    const app = new App(document.createElement("div"));
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const third = await app.vault.create("Third.md", "third");
    const firstLeaf = await app.workspace.openFile(first, { active: true });
    const secondLeaf = app.workspace.getLeaf("tab");
    await secondLeaf.openFile(second, { active: true });
    const thirdLeaf = app.workspace.getLeaf("tab");
    await thirdLeaf.openFile(third, { active: true });
    thirdLeaf.setPinned(true);
    app.workspace.setActiveLeaf(firstLeaf);

    await app.commands.executeCommandById("workspace:close-others-tab-group");

    expect(app.workspace.getLeafById(firstLeaf.id)).toBe(firstLeaf);
    expect(app.workspace.getLeafById(secondLeaf.id)).toBeNull();
    expect(app.workspace.getLeafById(thirdLeaf.id)).toBe(thirdLeaf);

    await app.commands.executeCommandById("workspace:close-tab-group");

    expect(app.workspace.getLeafById(firstLeaf.id)).toBeNull();
    expect(app.workspace.getLeafById(thirdLeaf.id)).toBe(thirdLeaf);
    expect(thirdLeaf.pinned).toBe(true);
  });

  it("navigates tabs with next, previous, numbered, and last-tab commands", async () => {
    const app = new App(document.createElement("div"));
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const third = await app.vault.create("Third.md", "third");
    const firstLeaf = await app.workspace.openFile(first, { active: true });
    const secondLeaf = app.workspace.getLeaf("tab");
    await secondLeaf.openFile(second, { active: true });
    const thirdLeaf = app.workspace.getLeaf("tab");
    await thirdLeaf.openFile(third, { active: true });

    expect(app.commands.findCommand("workspace:goto-tab-4")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("workspace:goto-tab-9")).toBeUndefined();
    expect(app.commands.findCommand("workspace:goto-last-tab")?.checkCallback?.(true)).toBe(true);

    await app.commands.executeCommandById("workspace:goto-tab-1");
    expect(app.workspace.activeLeaf).toBe(firstLeaf);

    await app.commands.executeCommandById("workspace:previous-tab");
    expect(app.workspace.activeLeaf).toBe(thirdLeaf);

    await app.commands.executeCommandById("workspace:next-tab");
    expect(app.workspace.activeLeaf).toBe(firstLeaf);

    await app.commands.executeCommandById("workspace:goto-tab-2");
    expect(app.workspace.activeLeaf).toBe(secondLeaf);

    await app.commands.executeCommandById("workspace:goto-last-tab");
    expect(app.workspace.activeLeaf).toBe(thirdLeaf);
  });

  it("creates a new tab in the most recent tab group through the Obsidian command", async () => {
    const app = new App(document.createElement("div"));
    const before = app.workspace.activeLeaf?.parent?.children.length ?? 0;

    await app.commands.executeCommandById("workspace:new-tab");

    expect(app.workspace.activeLeaf?.view?.getViewType()).toBe("empty");
    expect(app.workspace.activeLeaf?.parent?.children.length).toBe(before + 1);
    expect(app.commands.findCommand("workspace:new-tab")?.hotkeys).toEqual([{ modifiers: ["Mod"], key: "T" }]);
  });

  it("opens and moves ItemViews into popout windows without using undo history", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Window.md", "window");
    const sourceLeaf = await app.workspace.openFile(file, { active: true });
    const originalRoot = sourceLeaf.getRoot();

    expect(app.commands.findCommand("workspace:open-in-new-window")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.findCommand("workspace:move-to-new-window")?.checkCallback?.(true)).toBe(true);

    const copiedLeaf = await app.workspace.openActiveLeafInNewWindow();

    expect(copiedLeaf).not.toBeNull();
    expect(copiedLeaf).not.toBe(sourceLeaf);
    expect(copiedLeaf?.getContainer()).toBeInstanceOf(WorkspaceWindow);
    expect(copiedLeaf?.getContainer().parent).toBe(app.workspace.floatingSplit);
    expect(sourceLeaf.getRoot()).toBe(originalRoot);
    expect((copiedLeaf?.view as { file?: { path: string } | null } | null)?.file?.path).toBe("Window.md");

    app.workspace.setActiveLeaf(sourceLeaf);
    const undoCount = app.workspace.undoHistory.length;
    const movedWindow = app.workspace.moveActiveLeafToNewWindow();

    expect(movedWindow).toBe(sourceLeaf.getContainer());
    expect(sourceLeaf.getContainer()).toBeInstanceOf(WorkspaceWindow);
    expect(sourceLeaf.getContainer().parent).toBe(app.workspace.floatingSplit);
    expect(app.workspace.activeLeaf).toBe(sourceLeaf);
    expect(app.workspace.undoHistory.length).toBe(undoCount);
  });

  it("creates and closes popout windows through workspace window commands", async () => {
    const app = new App(document.createElement("div"));

    await app.commands.executeCommandById("workspace:new-window");

    expect(app.workspace.activeLeaf?.getContainer()).toBeInstanceOf(WorkspaceWindow);
    expect(app.workspace.activeLeaf?.getContainer().parent).toBe(app.workspace.floatingSplit);
    expect(app.workspace.activeLeaf?.view?.getViewType()).toBe("empty");
    expect(app.workspace.floatingSplit.children.length).toBe(1);
    expect(app.workspace.floatingSplit.containerEl.classList.contains("is-popout-window")).toBe(true);
    expect(app.commands.findCommand("workspace:close-window")?.checkCallback?.(true)).toBe(true);

    await app.commands.executeCommandById("workspace:close-window");

    expect(app.workspace.floatingSplit.children.length).toBe(0);
    expect(app.workspace.floatingSplit.containerEl.classList.contains("is-popout-window")).toBe(false);
    expect(app.commands.findCommand("workspace:close-window")?.checkCallback?.(true)).toBe(false);
  });

  it("keeps floating popout state until the last workspace window closes", () => {
    const app = new App(document.createElement("div"));
    const firstLeaf = app.workspace.openPopoutLeaf();
    const secondLeaf = app.workspace.openPopoutLeaf();
    const firstWindow = firstLeaf.getContainer();
    const secondWindow = secondLeaf.getContainer();
    if (!(firstWindow instanceof WorkspaceWindow) || !(secondWindow instanceof WorkspaceWindow)) {
      throw new Error("Expected popout windows");
    }

    expect(app.workspace.floatingSplit.children).toHaveLength(2);
    expect(app.workspace.floatingSplit.containerEl.classList.contains("is-popout-window")).toBe(true);

    firstWindow.close();

    expect(app.workspace.floatingSplit.children).toEqual([secondWindow]);
    expect(app.workspace.floatingSplit.containerEl.classList.contains("is-popout-window")).toBe(true);

    secondWindow.close();

    expect(app.workspace.floatingSplit.children).toEqual([]);
    expect(app.workspace.floatingSplit.containerEl.classList.contains("is-popout-window")).toBe(false);
  });

  it("creates missing link targets beside the source file and opens them in source mode", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("newFileLocation", "current");
    await app.vault.createFolder("folder");
    const leaf = app.workspace.getLeaf();

    await leaf.openLinkText("Missing", "folder/source.md", { active: true });

    expect(app.vault.getFileByPath("folder/Missing.md")).not.toBeNull();
    expect((leaf.view as { file?: { path: string } | null; getMode?: () => string } | null)?.file?.path).toBe("folder/Missing.md");
    expect((leaf.view as { getMode?: () => string } | null)?.getMode?.()).toBe("source");
  });

  it("shows a notice and logs when opening a link target fails", async () => {
    const app = new App(document.createElement("div"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(app.fileManager, "createNewFile").mockRejectedValueOnce(new Error("cannot create target"));
    const leaf = app.workspace.getLeaf();

    await expect(leaf.openLinkText("Missing", "", { active: true })).resolves.toBeUndefined();

    expect(document.body.textContent).toContain("cannot create target");
    expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
  });

  it("opens dragged files and links in the current ItemView header drop target", async () => {
    const app = new App(document.createElement("div"));
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const leaf = await app.workspace.openFile(first, { active: true, state: { mode: "source" } });
    const view = leaf.view;
    if (!view || !("headerEl" in view) || !(view.headerEl instanceof HTMLElement)) throw new Error("Expected ItemView header");
    const dataTransfer = createDataTransfer();
    const source = app.dragManager.dragFile(createDragEvent("dragstart", dataTransfer), second, "test", [view.headerEl]);

    expect(dataTransfer.getData("text/plain")).toBe(app.getObsidianUrl(second));
    expect(dataTransfer.getData("text/uri-list")).toBe(app.getObsidianUrl(second));

    dispatchDragEvent(view.headerEl, "drop", dataTransfer);
    app.dragManager.setSource(source);
    dispatchDragEvent(view.headerEl, "drop", dataTransfer);
    await vi.waitFor(() => {
      expect((leaf.view as { file?: { path: string } | null } | null)?.file?.path).toBe("Second.md");
    });

    const openLinkText = vi.spyOn(leaf, "openLinkText").mockResolvedValue();
    const linkTransfer = createDataTransfer();
    const linkSource = app.dragManager.dragLink(createDragEvent("dragstart", linkTransfer), "Missing", "First.md", "test", [view.headerEl]);
    app.dragManager.setSource(linkSource);
    dispatchDragEvent(view.headerEl, "drop", linkTransfer);

    expect(openLinkText).toHaveBeenCalledWith("Missing", "First.md");
  });

  it("wraps mismatched split directions around the current tab group", () => {
    const app = new App(document.createElement("div"));

    app.workspace.splitActiveLeaf("horizontal");

    const child = app.workspace.rootSplit.children[0];
    expect(child).toBeInstanceOf(WorkspaceSplit);
    expect((child as WorkspaceSplit).direction).toBe("horizontal");
    expect((child as WorkspaceSplit).children.length).toBe(2);
  });

  it("emits file-open from active leaf changes and tracks recent active files", async () => {
    const app = new App(document.createElement("div"));
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const opened: Array<string | null> = [];
    app.workspace.on("file-open", (file: unknown) => {
      opened.push(file && typeof file === "object" && "path" in file ? String((file as { path: unknown }).path) : null);
    });
    app.workspace.markLayoutReady();

    const firstLeaf = await app.workspace.openFile(first, { active: true });
    await app.workspace.openFile(first, { active: true });
    const secondLeaf = await app.workspace.openFile(second, { active: false });

    await vi.waitFor(() => {
      expect(opened).toEqual(["First.md"]);
    });
    expect(app.workspace.recentFilePaths).toEqual([]);

    app.workspace.setActiveLeaf(secondLeaf);

    await vi.waitFor(() => {
      expect(opened).toEqual(["First.md", "Second.md"]);
    });
    expect(app.workspace.recentFilePaths).toEqual(["First.md"]);

    app.workspace.setActiveLeaf(firstLeaf);

    await vi.waitFor(() => {
      expect(opened).toEqual(["First.md", "Second.md", "First.md"]);
    });
    expect(app.workspace.recentFilePaths.slice(0, 2)).toEqual(["Second.md", "First.md"]);
  });

  it("runs onLayoutReady callbacks once and emits the initial active file after readiness", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Ready.md", "ready");
    const callbacks: string[] = [];
    const opened: Array<string | null> = [];
    app.workspace.onLayoutReady(() => callbacks.push("queued"));
    app.workspace.on("file-open", (openedFile: unknown) => {
      opened.push(openedFile && typeof openedFile === "object" && "path" in openedFile ? String((openedFile as { path: unknown }).path) : null);
    });

    await app.workspace.openFile(file, { active: true });
    expect(opened).toEqual([]);

    app.workspace.markLayoutReady();
    await vi.waitFor(() => expect(callbacks).toEqual(["queued"]));
    await vi.waitFor(() => expect(opened).toEqual(["Ready.md"]));

    await app.workspace.setLayout({});
    await nextMacrotask();

    expect(callbacks).toEqual(["queued"]);
  });

  it("does not emit the non-original view-state-change workspace event", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("State.md", "state");
    const triggered: string[] = [];
    const originalTrigger = app.workspace.trigger.bind(app.workspace);
    const trigger = vi.spyOn(app.workspace, "trigger").mockImplementation((name: string, ...args: unknown[]) => {
      triggered.push(name);
      originalTrigger(name, ...args);
    });

    const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) throw new Error("Expected MarkdownView");
    await view.setMode("preview");

    expect(trigger).toHaveBeenCalled();
    expect(triggered).not.toContain("view-state-change");
  });

  it("does not emit active leaf events for background file changes", async () => {
    const app = new App(document.createElement("div"));
    const first = await app.vault.create("Active.md", "active");
    const second = await app.vault.create("Background.md", "background");
    const activeLeafEvents: WorkspaceLeaf[] = [];
    app.workspace.on("active-leaf-change", (leaf: unknown) => {
      if (leaf) activeLeafEvents.push(leaf as WorkspaceLeaf);
    });
    app.workspace.markLayoutReady();
    const activeLeaf = await app.workspace.openFile(first, { active: true });
    await vi.waitFor(() => expect(activeLeafEvents.at(-1)).toBe(activeLeaf));
    activeLeafEvents.length = 0;

    await app.workspace.openFile(second, { active: false });
    await nextMacrotask();
    await nextMacrotask();

    expect(activeLeafEvents).toEqual([]);
    expect(app.workspace.activeLeaf).toBe(activeLeaf);
  });

  it("updates recent file paths on rename and exposes filtered recent file APIs", async () => {
    const app = new App(document.createElement("div"));
    const files = [
      await app.vault.create("One.md", ""),
      await app.vault.create("Two.canvas", ""),
      await app.vault.create("Three.png", ""),
      await app.vault.create("Four.pdf", ""),
    ];
    app.workspace.markLayoutReady();

    for (const file of files) app.workspace.recentFileTracker.collect(file);
    await app.fileManager.renameFile(files[0], "One Renamed.md");

    expect(app.workspace.recentFilePaths).toEqual(["Four.pdf", "Three.png", "Two.canvas", "One Renamed.md"]);
    expect(app.workspace.getRecentFiles()).toEqual(["Two.canvas", "One Renamed.md"]);
    expect(app.workspace.getLastOpenFiles()).toEqual(["Four.pdf", "Three.png", "Two.canvas", "One Renamed.md"]);
  });
});

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "uninitialized",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [] as unknown as string[],
    clearData: (format?: string) => {
      if (format) values.delete(format);
      else values.clear();
    },
    getData: (format: string) => values.get(format) ?? "",
    setData: (format: string, data: string) => {
      values.set(format, data);
    },
    setDragImage: () => {},
  } as unknown as DataTransfer;
}

function dispatchDragEvent(target: HTMLElement, type: string, dataTransfer: DataTransfer): void {
  target.dispatchEvent(createDragEvent(type, dataTransfer));
}

function createDragEvent(type: string, dataTransfer: DataTransfer): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { configurable: true, value: dataTransfer });
  return event;
}
