import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { getActiveDocument, resetActiveWindow } from "../dom/ActiveDocument";
import { desktopWorkspaceFileName, mobileWorkspaceFileName } from "./WorkspaceLayoutPersistence";
import { WorkspaceWindow } from "./WorkspaceWindow";
import { WorkspaceSidedock } from "./WorkspaceSidedock";
import { WorkspaceLeaf } from "./WorkspaceLeaf";
import { MobileDrawer } from "../mobile/MobileDrawer";

describe("WorkspaceLayoutPersistence", () => {
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
    document.body.classList.remove("is-mobile");
  });

  afterEach(() => {
    document.body.classList.remove("is-mobile");
    resetActiveWindow();
  });

  it("saves desktop workspace layout through the vault config directory", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;

    const layout = await app.workspaceLayouts.saveCurrentLayout();

    expect(app.workspaceLayouts.fileName).toBe(desktopWorkspaceFileName);
    expect(app.workspaceLayouts.getWorkspaceFilePath()).toBe(`${app.vault.configDir}/${desktopWorkspaceFileName}`);
    await expect(app.vault.readJson(app.workspaceLayouts.getWorkspaceFilePath())).resolves.toEqual(layout);
  });

  it("keeps workspace saveLayout void and swallows write failures", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;

    await expect(app.workspace.saveLayout()).resolves.toBeUndefined();

    vi.spyOn(app.workspaceLayouts, "writeWorkspaceFile").mockRejectedValueOnce(new Error("disk full"));

    await expect(app.workspace.saveLayout()).resolves.toBeUndefined();
  });

  it("does not emit a non-original layout-saved event when saving workspace layout", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const trigger = vi.spyOn(app.workspace, "trigger");

    await app.workspaceLayouts.saveCurrentLayout();

    expect(trigger.mock.calls.map(([name]) => name)).not.toContain("layout-saved");
  });

  it("exposes Obsidian's deserializeLayout entry point for layout nodes", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;

    const item = await app.workspace.deserializeLayout({ id: "restored-leaf", type: "leaf", state: { type: "empty" } });

    expect(item).toBeInstanceOf(WorkspaceLeaf);
    expect(item?.id).toBe("restored-leaf");
  });

  it("uses workspace-mobile.json for mobile workspace layout", async () => {
    document.body.classList.add("is-mobile");
    const app = new App(document.createElement("div"));
    await app.ready;

    const layout = await app.workspaceLayouts.saveCurrentLayout();

    expect(app.workspaceLayouts.fileName).toBe(mobileWorkspaceFileName);
    expect(app.workspace.leftSplit).toBeInstanceOf(MobileDrawer);
    expect(app.workspace.rightSplit).toBeInstanceOf(MobileDrawer);
    expect(app.dom.workspaceEl.children.item(0)).toBe(app.workspace.leftSplit.containerEl);
    expect(app.dom.workspaceEl.children.item(1)).toBe(app.workspace.rootSplit.containerEl);
    expect(app.dom.workspaceEl.children.item(2)).toBe(app.workspace.rightSplit.containerEl);
    expect([...app.dom.workspaceEl.children]).not.toContain(app.workspace.leftRibbon.containerEl);
    expect(layout.left).toEqual(expect.objectContaining({ type: "mobile-drawer", currentTab: 0 }));
    expect(layout.left.type).toBe("mobile-drawer");
    if (layout.left.type !== "mobile-drawer") throw new Error("Expected mobile drawer layout");
    expect(layout.left.children.map((child) => child.type)).toEqual(["leaf", "leaf"]);
    expect(layout.right).toEqual(expect.objectContaining({ type: "mobile-drawer", currentTab: 0 }));
    await expect(app.vault.readJson(`${app.vault.configDir}/${mobileWorkspaceFileName}`)).resolves.toEqual(layout);
    await expect(app.vault.readJson(`${app.vault.configDir}/${desktopWorkspaceFileName}`)).resolves.toBeNull();
  });

  it("restores mobile drawer layout nodes only in mobile runtime", async () => {
    document.body.classList.add("is-mobile");
    const app = new App(document.createElement("div"));
    await app.ready;

    await app.workspace.setLayout({
      left: {
        id: "left-drawer",
        type: "mobile-drawer",
        currentTab: 0,
        pinned: true,
        children: [{ id: "drawer-leaf", type: "leaf", state: { type: "empty" } }],
      },
    });

    expect(app.workspace.leftSplit).toBeInstanceOf(MobileDrawer);
    const drawer = app.workspace.leftSplit as MobileDrawer;
    expect(drawer.id).toBe("left-drawer");
    expect(drawer.currentTab).toBe(0);
    expect(drawer.isPinned).toBe(true);
    expect(drawer.children[0]?.id).toBe("drawer-leaf");
    expect(drawer.children.every((child) => child instanceof WorkspaceLeaf)).toBe(true);
    expect(drawer.innerEl.children.item(0)).toBe(app.workspace.leftRibbon.containerEl);
    expect(app.workspace.leftRibbon.containerEl.classList.contains("workspace-ribbon")).toBe(false);
    expect(app.workspace.leftRibbon.containerEl.classList.contains("workspace-drawer-ribbon")).toBe(true);
    expect(app.workspace.leftRibbon.containerEl.classList.contains("side-dock-ribbon")).toBe(true);
    expect(app.workspace.getLayout().left).toEqual(expect.objectContaining({
      id: "left-drawer",
      type: "mobile-drawer",
      currentTab: 0,
      pinned: true,
    }));
  });

  it("creates mobile side leaves directly inside drawers without wrapping tabs", async () => {
    document.body.classList.add("is-mobile");
    const app = new App(document.createElement("div"));
    await app.ready;

    const leaf = app.workspace.getLeftLeaf();
    const drawer = app.workspace.leftSplit;
    if (!(drawer instanceof MobileDrawer)) throw new Error("Expected mobile drawer");

    expect(leaf).toBeInstanceOf(WorkspaceLeaf);
    expect(drawer.children.at(-1)).toBe(leaf);
    drawer.selectTabIndex(drawer.children.indexOf(leaf));
    expect(drawer.activeTabContentEl.children.item(0)).toBe(leaf.containerEl);
  });

  it("ignores mobile drawer layout nodes on desktop", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;

    await app.workspace.setLayout({
      left: {
        id: "left-drawer",
        type: "mobile-drawer",
        currentTab: 0,
        pinned: true,
        children: [{ id: "drawer-leaf", type: "leaf", state: { type: "empty" } }],
      },
    });

    expect(app.workspace.leftSplit).toBeInstanceOf(WorkspaceSidedock);
    expect(app.workspace.getLeafById("drawer-leaf")).toBeNull();
    expect(app.workspace.getLayout().left).toEqual(expect.objectContaining({ type: "split" }));
  });

  it("restores workspace layout from the vault workspace file", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const layout = app.workspaceLayouts.serializer.serialize(app.workspace);
    const trigger = vi.spyOn(app.workspace, "trigger");
    await app.vault.writeJson(app.workspaceLayouts.getWorkspaceFilePath(), layout);

    await expect(app.workspaceLayouts.restoreSavedLayout()).resolves.toEqual(layout);
    expect(app.workspaceLayouts.getLastSavedLayout()).toEqual(layout);
    expect(trigger.mock.calls.map(([name]) => name)).not.toContain("layout-restored");
  });

  it("keeps lastOpenFiles out of getLayout but appends them when saving the workspace file", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    app.workspace.recentFilePaths = ["Recent.md"];

    expect(app.workspace.getLayout()).not.toHaveProperty("lastOpenFiles");

    const saved = await app.workspaceLayouts.saveCurrentLayout();

    expect(saved.lastOpenFiles).toEqual(["Recent.md"]);
    await expect(app.vault.readJson(app.workspaceLayouts.getWorkspaceFilePath())).resolves.toEqual(saved);
  });

  it("opens the most recent file when restoring a layout without a main split", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const file = await app.vault.create("Recent.md", "# Recent");

    await app.workspaceLayouts.writeWorkspaceFile({ lastOpenFiles: [file.path] });
    await app.workspace.loadLayout();

    expect(app.workspace.getActiveFile()).toBe(file);
  });

  it("persists sidedock width and restores it through setLayout", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    if (!(app.workspace.leftSplit instanceof WorkspaceSidedock)) throw new Error("Expected desktop sidedock");
    Object.defineProperty(app.workspace.containerEl, "clientWidth", {
      configurable: true,
      value: 1000,
    });

    app.workspace.leftSplit.setSize(320);
    app.workspace.leftSplit.expand();
    const layout = await app.workspaceLayouts.saveCurrentLayout();

    expect(layout.left).toEqual(expect.objectContaining({ width: 320 }));
    expect(layout.left).not.toHaveProperty("collapsed");

    app.workspace.leftSplit.setSize(220);
    app.workspace.leftSplit.collapse();
    await app.workspace.setLayout(layout);

    expect(app.workspace.leftSplit.width).toBe(320);
    expect(app.workspace.leftSplit.containerEl.style.width).toBe("320px");
    expect(app.workspace.leftSplit.collapsed).toBe(false);
  });

  it("persists left ribbon hidden items using Obsidian's hiddenItems order", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    app.workspace.leftRibbon.addRibbonIcon("lucide-a", "Action A", () => {}, "a");
    app.workspace.leftRibbon.addRibbonIcon("lucide-b", "Action B", () => {}, "b");

    app.workspace.leftRibbon.load({ hiddenItems: { b: true, a: false } });

    const serialized = app.workspace.leftRibbon.serialize() as { hiddenItems: Record<string, boolean> };
    const keys = Object.keys(serialized.hiddenItems);
    expect(keys.indexOf("b")).toBeLessThan(keys.indexOf("a"));
    expect(serialized.hiddenItems.b).toBe(true);
    expect(serialized.hiddenItems.a).toBe(false);
    const actions = [...app.workspace.leftRibbon.actionsEl?.children ?? []] as HTMLElement[];
    const visibleActions = actions.filter((el) => el.style.display !== "none").map((el) => el.getAttribute("aria-label"));
    const hiddenActions = actions.filter((el) => el.style.display === "none").map((el) => el.getAttribute("aria-label"));
    expect(visibleActions).toContain("Action A");
    expect(hiddenActions).toContain("Action B");
    const layoutKeys = Object.keys((app.workspace.getLayout()["left-ribbon"] as { hiddenItems: Record<string, boolean> }).hiddenItems);
    expect(layoutKeys.indexOf("b")).toBeLessThan(layoutKeys.indexOf("a"));
    expect(app.workspace.getLayout()).not.toHaveProperty("right-ribbon");
  });

  it("restores floating windows and serializes their window bounds", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const popoutDocument = document.implementation.createHTMLDocument("Restored popout");
    const openedWindow = {
      ...window,
      document: popoutDocument,
      navigator: window.navigator,
      location: window.location,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      focus: () => {},
      close: () => {},
      closed: false,
      screenX: 10,
      screenY: 20,
      outerWidth: 800,
      outerHeight: 600,
      open: window.open.bind(window),
      getComputedStyle: window.getComputedStyle.bind(window),
    } as unknown as Window;
    const openCalls: string[] = [];
    const originalOpen = window.open;
    Object.defineProperty(window, "open", {
      configurable: true,
      value: (url: string, target: string, features: string) => {
        openCalls.push(`${url}|${target}|${features}`);
        return openedWindow;
      },
    });

    try {
      await app.workspace.setLayout({
        floating: {
          id: "floating",
          type: "floating",
          children: [
            { id: "ignored-tabs", type: "tabs", children: [] },
            {
              id: "window-a",
              type: "window",
              x: 10,
              y: 20,
              width: 800,
              height: 600,
              maximize: true,
              zoom: 1.25,
              children: [{ id: "floating-leaf", type: "leaf", state: { type: "empty" } }],
            },
          ],
        },
      });
    } finally {
      Object.defineProperty(window, "open", { configurable: true, value: originalOpen });
    }

    const floating = app.workspace.getLayout().floating;
    const restoredWindow = app.workspace.floatingSplit.children[0];

    expect(openCalls[0]).toContain("about:blank|_blank|popup");
    expect(openCalls[0]).toContain("x=10");
    expect(openCalls[0]).toContain("y=20");
    expect(openCalls[0]).toContain("width=800");
    expect(openCalls[0]).toContain("height=600");
    expect(restoredWindow).toBeInstanceOf(WorkspaceWindow);
    expect((restoredWindow as WorkspaceWindow).win).toBe(openedWindow);
    expect(popoutDocument.head.querySelector("base")?.href).toBe(window.location.href);
    expect(floating).toEqual(expect.objectContaining({ id: "floating", type: "floating" }));
    expect(floating?.type).toBe("floating");
    if (floating?.type !== "floating") throw new Error("Expected floating layout");
    expect(floating.children).toHaveLength(1);
    const windowNode = floating.children[0];
    expect(windowNode).toEqual(expect.objectContaining({
      id: "window-a",
      type: "window",
      direction: "vertical",
      x: 10,
      y: 20,
      width: 800,
      height: 600,
      maximize: true,
      zoom: 1.25,
    }));
    expect(windowNode).not.toHaveProperty("size");
    expect(windowNode.type).toBe("window");
    if (windowNode.type !== "window") throw new Error("Expected window layout");
    expect(windowNode.children[0]?.type).toBe("tabs");
  });

  it("updates floating window size on resize and closes empty popout windows", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    await app.workspace.setLayout({
      floating: {
        id: "floating",
        type: "floating",
        children: [{
          id: "window-a",
          type: "window",
          children: [{ id: "floating-leaf", type: "leaf", state: { type: "empty" } }],
        }],
      },
    });
    const popout = app.workspace.floatingSplit.children[0];
    if (!(popout instanceof WorkspaceWindow)) throw new Error("Expected workspace window");
    const saveLayout = vi.spyOn(app.workspace, "requestSaveLayout");
    const closed: WorkspaceWindow[] = [];
    app.workspace.on<[WorkspaceWindow]>("window-close", (win) => closed.push(win));
    const popoutWindow = popout.win as Window & {
      electronWindow?: {
        isMaximized: () => boolean;
        isMinimized: () => boolean;
        isFullScreen: () => boolean;
        getBounds: () => { x: number; y: number; width: number; height: number };
      };
    };
    const previousElectronWindow = popoutWindow.electronWindow;
    Object.defineProperty(window, "screenX", { configurable: true, value: 30 });
    Object.defineProperty(window, "screenY", { configurable: true, value: 40 });
    Object.defineProperty(window, "outerWidth", { configurable: true, value: 900 });
    Object.defineProperty(window, "outerHeight", { configurable: true, value: 700 });

    try {
      window.dispatchEvent(new Event("resize"));

      expect(popout.x).toBe(30);
      expect(popout.y).toBe(40);
      expect(popout.width).toBe(900);
      expect(popout.height).toBe(700);

      popoutWindow.electronWindow = {
        isMaximized: () => false,
        isMinimized: () => false,
        isFullScreen: () => false,
        getBounds: () => ({ x: 130, y: 140, width: 1900, height: 1700 }),
      };

      window.dispatchEvent(new Event("resize"));

      expect(popout.x).toBe(130);
      expect(popout.y).toBe(140);
      expect(popout.width).toBe(1900);
      expect(popout.height).toBe(1700);
      expect(saveLayout).toHaveBeenCalled();

      for (const child of [...popout.children]) child.detach();

      expect(app.workspace.floatingSplit.children).not.toContain(popout);
      expect(closed).toEqual([popout]);
    } finally {
      popoutWindow.electronWindow = previousElectronWindow;
      saveLayout.mockRestore();
    }
  });

  it("sets active document on popout focus and resets it when the active popout closes", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    await app.workspace.setLayout({
      floating: {
        id: "floating",
        type: "floating",
        children: [{
          id: "window-a",
          type: "window",
          children: [{ id: "floating-leaf", type: "leaf", state: { type: "empty" } }],
        }],
      },
    });
    const popout = app.workspace.floatingSplit.children[0];
    if (!(popout instanceof WorkspaceWindow)) throw new Error("Expected workspace window");

    popout.win.dispatchEvent(new Event("focus"));

    expect(getActiveDocument()).toBe(popout.doc);

    window.dispatchEvent(new Event("focus"));

    expect(getActiveDocument()).toBe(document);

    popout.win.dispatchEvent(new Event("focus"));

    expect(getActiveDocument()).toBe(popout.doc);

    popout.close();

    expect(getActiveDocument()).toBe(document);
  });

  it("debounces workspace save requests and exposes cancel and run controls", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    app.workspace.requestSaveLayout.cancel();
    const save = vi.spyOn(app.workspace, "saveLayout");
    vi.useFakeTimers();
    try {
      expect(app.workspace.requestSaveLayout.run()).toBeUndefined();
      expect(save).not.toHaveBeenCalled();

      (app.workspace as unknown as { _layoutReady: boolean })._layoutReady = false;
      app.workspace.requestSaveLayout();

      await vi.advanceTimersByTimeAsync(500);
      app.workspace.requestSaveLayout();
      await vi.advanceTimersByTimeAsync(499);
      expect(save).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledOnce();

      app.workspace.requestSaveLayout();
      app.workspace.requestSaveLayout.cancel();
      await vi.advanceTimersByTimeAsync(1000);
      expect(save).toHaveBeenCalledOnce();

      app.workspace.requestSaveLayout();
      await app.workspace.requestSaveLayout.run();
      expect(save).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      save.mockRestore();
    }
  });
});
