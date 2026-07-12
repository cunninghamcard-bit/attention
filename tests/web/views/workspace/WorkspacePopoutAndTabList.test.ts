import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import type { DragSource } from "@web/ui/drag/DragManager";
import type { TFile } from "@web/vault/TAbstractFile";
import { installPopoutBodyClassSync } from "@web/app/BodyClasses";
import { Platform } from "@web/platform/Platform";
import { WorkspaceLeaf } from "@web/views/workspace/WorkspaceLeaf";
import { WorkspaceTabs } from "@web/views/workspace/WorkspaceTabs";
import { WorkspaceWindow } from "@web/views/workspace/WorkspaceWindow";

function installBrowserStubs(): void {
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
}

function setMetric(el: HTMLElement, name: "clientWidth" | "offsetWidth", value: number): void {
  Object.defineProperty(el, name, { configurable: true, value });
}

function forceShown(el: HTMLElement): void {
  Object.defineProperty(el, "isShown", { configurable: true, value: () => true });
}

function setRect(el: HTMLElement, rect: Partial<DOMRect>): void {
  const value = new DOMRect(rect.x ?? 0, rect.y ?? 0, rect.width ?? 0, rect.height ?? 20);
  Object.defineProperty(value, "right", { configurable: true, value: value.x + value.width });
  Object.defineProperty(value, "bottom", { configurable: true, value: value.y + value.height });
  Object.defineProperty(el, "getBoundingClientRect", { configurable: true, value: () => value });
}

function createDataTransfer(): DataTransfer {
  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [] as unknown as string[],
    clearData: () => {},
    getData: () => "",
    setData: () => {},
    setDragImage: () => {},
  } as unknown as DataTransfer;
}

function createDragEvent(type: string, dataTransfer: DataTransfer, clientX: number): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { configurable: true, value: dataTransfer });
  Object.defineProperty(event, "clientX", { configurable: true, value: clientX });
  return event;
}

function setDragSource(app: App, source: Record<string, unknown> & { type: string }): void {
  app.dragManager.setSource({ payload: null, elements: [], ...source } as DragSource);
}

function viewFile(leaf: WorkspaceLeaf): TFile | null {
  return (leaf.view as unknown as { file?: TFile | null }).file ?? null;
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("Obsidian popout and tab list DOM", () => {
  beforeEach(() => {
    document.body.className = "";
    document.body.replaceChildren();
    installBrowserStubs();
  });

  it("keeps floating split as a logical container outside the desktop workspace DOM", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;

    expect(app.workspace.floatingSplit.autoManageDOM).toBe(false);
    expect(app.workspace.containerEl.children).toHaveLength(5);
    expect(Array.from(app.workspace.containerEl.children)).not.toContain(
      app.workspace.floatingSplit.containerEl,
    );
  });

  it("builds popout windows with their own app-container root", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const popout = new WorkspaceWindow(app.workspace, window);

    expect(popout.appContainerEl.parentElement).toBe(document.body);
    expect(popout.frameDom.titleBarEl.parentElement).toBe(document.body);
    expect(popout.frameDom.titleBarEl.nextElementSibling).toBe(popout.appContainerEl);
    expect(document.body.classList.contains("is-popout-window")).toBe(true);
    expect(document.body.classList.contains("is-frameless")).toBe(true);
    expect(popout.appContainerEl.className).toBe("app-container");
    expect(popout.horizontalMainContainerEl.parentElement).toBe(popout.appContainerEl);
    expect(popout.horizontalMainContainerEl.className).toBe("horizontal-main-container");
    expect(popout.workspaceEl.parentElement).toBe(popout.horizontalMainContainerEl);
    expect(popout.workspaceEl.className).toBe("workspace");
    expect(popout.workspaceEl.firstElementChild).toBe(popout.containerEl);
    expect(popout.containerEl.classList.contains("workspace-window")).toBe(true);
    expect(popout.containerEl.classList.contains("mod-root")).toBe(true);
    expect(popout.statusBarEl).toBeNull();

    popout.close();
    expect(document.body.contains(popout.appContainerEl)).toBe(false);
    expect(document.body.contains(popout.frameDom.titleBarEl)).toBe(false);
  });

  it("syncs main body class and style changes into popout bodies while preserving local window state", async () => {
    const popoutDoc = document.implementation.createHTMLDocument("Popout");
    document.body.className = "theme-light obsidian-app mod-macos show-ribbon show-view-header";
    document.body.style.setProperty("--accent-h", "240");
    popoutDoc.body.className = "is-frameless is-focused is-hidden-frameless is-popout-window";
    popoutDoc.body.style.setProperty("--zoom-factor", "1.5");

    const cleanup = installPopoutBodyClassSync(document.body, popoutDoc.body);
    try {
      expect(popoutDoc.body.classList.contains("theme-light")).toBe(true);
      expect(popoutDoc.body.classList.contains("is-popout-window")).toBe(true);
      expect(popoutDoc.body.classList.contains("is-focused")).toBe(true);
      expect(popoutDoc.body.style.getPropertyValue("--accent-h")).toBe("240");
      expect(popoutDoc.body.style.getPropertyValue("--zoom-factor")).toBe("1.5");

      document.body.classList.remove("theme-light", "show-ribbon");
      document.body.classList.add("theme-dark");
      document.body.style.setProperty("--accent-h", "120");
      await nextMacrotask();

      expect(popoutDoc.body.classList.contains("theme-dark")).toBe(true);
      expect(popoutDoc.body.classList.contains("theme-light")).toBe(false);
      expect(popoutDoc.body.classList.contains("show-ribbon")).toBe(false);
      expect(popoutDoc.body.classList.contains("is-popout-window")).toBe(true);
      expect(popoutDoc.body.classList.contains("is-focused")).toBe(true);
      expect(popoutDoc.body.style.getPropertyValue("--accent-h")).toBe("120");
      expect(popoutDoc.body.style.getPropertyValue("--zoom-factor")).toBe("1.5");
    } finally {
      cleanup();
    }
  });

  it("opens the original tab-list menu contract from the tab header", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const first = tabs.children[0];
    if (!(first instanceof WorkspaceLeaf)) throw new Error("Expected first leaf");
    const second = new WorkspaceLeaf(app.workspace);
    tabs.appendChild(second, false);
    tabs.selectTabIndex(0, false);

    tabs.tabListIconEl.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );

    const menu = document.body.querySelector<HTMLElement>(".menu.mod-tab-list");
    expect(menu).not.toBeNull();
    expect(tabs.tabListIconEl.classList.contains("has-active-menu")).toBe(true);
    const titles = Array.from(menu?.querySelectorAll<HTMLElement>(".menu-item-title") ?? []).map(
      (el) => el.textContent,
    );
    expect(titles).toContain("Stack tabs");
    expect(titles).toContain("Close all");
    expect(titles.filter((title) => title === "New tab").length).toBeGreaterThanOrEqual(2);
    expect(
      menu?.querySelector<HTMLElement>(".menu-item.mod-checked .menu-item-title")?.textContent,
    ).toBe(first.getDisplayText());
    expect(menu?.querySelector(".menu-item-icon svg.lucide-layers")).not.toBeNull();
  });

  it("reparents tab headers and leaf containers for stacked tab groups", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const first = tabs.children[0];
    if (!(first instanceof WorkspaceLeaf)) throw new Error("Expected first leaf");
    const second = new WorkspaceLeaf(app.workspace);
    tabs.appendChild(second, false);
    tabs.selectTabIndex(0, false);

    expect(tabs.tabHeaderEls).toEqual([first.tabHeaderEl, second.tabHeaderEl]);
    expect(Array.from(tabs.tabsInnerEl.children)).toEqual([first.tabHeaderEl, second.tabHeaderEl]);
    expect(Array.from(tabs.tabsContainerEl.children)).toEqual([
      first.containerEl,
      second.containerEl,
    ]);

    tabs.setStacked(true, false);

    expect(tabs.containerEl.classList.contains("mod-stacked")).toBe(true);
    expect(Array.from(tabs.tabsInnerEl.children)).toEqual([]);
    expect(Array.from(tabs.tabsContainerEl.children)).toEqual([
      first.tabHeaderEl,
      first.containerEl,
      second.tabHeaderEl,
      second.containerEl,
    ]);

    tabs.setStacked(false, false);

    expect(tabs.containerEl.classList.contains("mod-stacked")).toBe(false);
    expect(Array.from(tabs.tabsInnerEl.children)).toEqual([first.tabHeaderEl, second.tabHeaderEl]);
    expect(Array.from(tabs.tabsContainerEl.children)).toEqual([
      first.containerEl,
      second.containerEl,
    ]);
  });

  it("throws Desktop-only when opening a popout on a non-desktop platform (real V0)", () => {
    const app = new App(document.createElement("div"));
    const descriptor = Object.getOwnPropertyDescriptor(Platform, "isDesktopApp");
    try {
      Object.defineProperty(Platform, "isDesktopApp", { configurable: true, value: false });
      expect(() => app.workspace.openPopout()).toThrow("Desktop-only feature.");
      const leaf = new WorkspaceLeaf(app.workspace);
      expect(() => app.workspace.moveLeafToPopout(leaf)).toThrow("Desktop-only feature.");
    } finally {
      if (descriptor) Object.defineProperty(Platform, "isDesktopApp", descriptor);
    }
  });

  it("does not enable stacked tabs when the platform disallows it", () => {
    const app = new App(document.createElement("div"));
    const tabs = new WorkspaceTabs(app.workspace);
    const descriptor = Object.getOwnPropertyDescriptor(Platform, "canStackTabs");
    try {
      Object.defineProperty(Platform, "canStackTabs", { configurable: true, value: false });
      tabs.setStacked(true, false);
      expect(tabs.isStacked).toBe(false);
      expect(tabs.containerEl.classList.contains("mod-stacked")).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(Platform, "canStackTabs", descriptor);
    }
  });

  it("creates a tab group from an existing leaf through the official helper", () => {
    const app = new App(document.createElement("div"));
    const leaf = new WorkspaceLeaf(app.workspace);

    const tabs = WorkspaceTabs.createFrom(app.workspace, leaf);

    expect(tabs.children).toEqual([leaf]);
    expect(leaf.parent).toBe(tabs);
    expect(tabs.tabsContainerEl.contains(leaf.containerEl)).toBe(true);
  });

  it("activates a tab header click outside selectTabIndex itself", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const first = tabs.children[0];
    if (!(first instanceof WorkspaceLeaf)) throw new Error("Expected first leaf");
    const second = new WorkspaceLeaf(app.workspace);
    tabs.appendChild(second, false);
    app.workspace.setActiveLeaf(first);
    const setActiveLeaf = vi.spyOn(app.workspace, "setActiveLeaf");

    second.tabHeaderEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(tabs.currentTab).toBe(1);
    expect(app.workspace.activeLeaf).toBe(second);
    expect(setActiveLeaf).toHaveBeenCalledWith(second, { focus: true });

    tabs.removeChild(second);
    tabs.insertChild(1, second, false);
    app.workspace.setActiveLeaf(first);
    setActiveLeaf.mockClear();
    second.tabHeaderEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(setActiveLeaf).toHaveBeenCalledOnce();
    expect(setActiveLeaf).toHaveBeenCalledWith(second, { focus: true });
  });

  it("loads deferred leaves when tab headers are stacked with leaf containers", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const first = tabs.children[0];
    if (!(first instanceof WorkspaceLeaf)) throw new Error("Expected first leaf");
    const second = new WorkspaceLeaf(app.workspace);
    tabs.appendChild(second, false);
    tabs.selectTabIndex(0, false);
    const firstLoad = vi.spyOn(first, "loadIfDeferred").mockResolvedValue(undefined);
    const secondLoad = vi.spyOn(second, "loadIfDeferred").mockResolvedValue(undefined);

    tabs.setStacked(true, false);

    expect(firstLoad).toHaveBeenCalled();
    expect(secondLoad).toHaveBeenCalled();
    firstLoad.mockRestore();
    secondLoad.mockRestore();
  });

  it("applies Obsidian's visible non-stacked active tab post-step", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const sideLeaf = app.workspace.getLeftLeaf();
    if (!sideLeaf) throw new Error("Expected side leaf");
    const tabs = sideLeaf.parent;
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected side tabs");
    const second = new WorkspaceLeaf(app.workspace);
    tabs.appendChild(second, false);
    const secondIndex = tabs.children.indexOf(second);
    tabs.selectTabIndex(Math.max(0, secondIndex - 1), false);
    forceShown(tabs.containerEl);
    setMetric(second.tabHeaderEl, "clientWidth", 44);
    const load = vi.spyOn(second, "loadIfDeferred").mockResolvedValue(undefined);

    tabs.selectTabIndex(secondIndex, false);

    expect(tabs.tabsInnerEl.scrollLeft).toBe(44 * secondIndex);
    expect(tabs.tabsInnerEl.style.getPropertyValue("--animation-dur")).toBe("250ms");
    expect(load).toHaveBeenCalledOnce();
    load.mockRestore();
  });

  it("matches Obsidian's macOS tab-strip double-click window action", async () => {
    const previousMacOS = Platform.isMacOS;
    const previousDesktopApp = Platform.isDesktopApp;
    const win = window as Window & {
      electronWindow?: {
        isMaximizable: () => boolean;
        isMaximized: () => boolean;
        minimize: () => void;
        maximize: () => void;
        unmaximize: () => void;
      };
      electron?: {
        remote: {
          systemPreferences: {
            getUserDefault: () => string;
          };
        };
      };
    };
    const previousElectronWindow = win.electronWindow;
    const previousElectron = win.electron;
    let maximized = false;
    const getUserDefault = vi.fn(() => "Maximize");
    const electronWindow = {
      isMaximizable: vi.fn(() => true),
      isMaximized: vi.fn(() => maximized),
      minimize: vi.fn(),
      maximize: vi.fn(() => {
        maximized = true;
      }),
      unmaximize: vi.fn(() => {
        maximized = false;
      }),
    };
    Platform.isMacOS = true;
    Platform.isDesktopApp = true;
    win.electronWindow = electronWindow;
    win.electron = { remote: { systemPreferences: { getUserDefault } } };
    try {
      const app = new App(document.createElement("div"));
      await app.ready;
      const tabs = app.workspace.rootSplit.children[0];
      if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");

      tabs.tabHeaderContainerEl.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, button: 0 }),
      );
      tabs.tabHeaderContainerEl.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, button: 0 }),
      );

      expect(getUserDefault).toHaveBeenCalledWith("AppleActionOnDoubleClick", "string");
      expect(electronWindow.maximize).toHaveBeenCalledOnce();
      expect(electronWindow.unmaximize).toHaveBeenCalledOnce();

      const sideLeaf = app.workspace.getLeftLeaf();
      if (!sideLeaf) throw new Error("Expected side leaf");
      sideLeaf.tabHeaderEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));

      expect(electronWindow.maximize).toHaveBeenCalledOnce();
      expect(electronWindow.unmaximize).toHaveBeenCalledOnce();
    } finally {
      Platform.isMacOS = previousMacOS;
      Platform.isDesktopApp = previousDesktopApp;
      win.electronWindow = previousElectronWindow;
      win.electron = previousElectron;
    }
  });

  it("animates non-stacked tab header insertions and removals with width and opacity", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    forceShown(tabs.tabsInnerEl);
    const animations: Array<{
      target: HTMLElement;
      keyframes: Keyframe[];
      options: KeyframeAnimationOptions;
    }> = [];
    const originalAnimate = HTMLElement.prototype.animate;
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value(
        this: HTMLElement,
        keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
        options?: number | KeyframeAnimationOptions,
      ) {
        animations.push({
          target: this,
          keyframes: keyframes as Keyframe[],
          options: options as KeyframeAnimationOptions,
        });
        return { addEventListener: () => {} } as unknown as Animation;
      },
    });
    try {
      const second = new WorkspaceLeaf(app.workspace);
      setMetric(second.tabHeaderEl, "clientWidth", 88);

      tabs.appendChild(second, false);

      expect(animations[0]?.target).toBe(second.tabHeaderEl);
      expect(animations[0]?.keyframes).toEqual([
        { width: "0px", opacity: "0" },
        { width: "88px", opacity: "1" },
      ]);
      expect(animations[0]?.options.duration).toBe(200);

      animations.length = 0;
      second.detach();
      app.workspace.updateLayout();

      expect(animations[0]?.target).not.toBe(second.tabHeaderEl);
      expect(animations[0]?.target.className).toBe(second.tabHeaderEl.className);
      expect(animations[0]?.keyframes).toEqual([
        { width: "88px", opacity: "1" },
        { width: "0px", opacity: "0" },
      ]);
      expect(animations[0]?.options.duration).toBe(200);
    } finally {
      if (originalAnimate) {
        Object.defineProperty(HTMLElement.prototype, "animate", {
          configurable: true,
          value: originalAnimate,
        });
      } else {
        delete (HTMLElement.prototype as Partial<typeof HTMLElement.prototype>).animate;
      }
    }
  });

  it("computes Obsidian sliding tab styles and hides offscreen stacked leaves", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const first = tabs.children[0];
    if (!(first instanceof WorkspaceLeaf)) throw new Error("Expected first leaf");
    const second = new WorkspaceLeaf(app.workspace);
    tabs.appendChild(second, false);
    tabs.selectTabIndex(0, false);

    setMetric(tabs.tabsContainerEl, "clientWidth", 500);
    setMetric(first.tabHeaderEl, "offsetWidth", 40);
    setMetric(second.tabHeaderEl, "offsetWidth", 60);
    setMetric(first.containerEl, "offsetWidth", 100);
    setMetric(second.containerEl, "offsetWidth", 100);

    tabs.setStacked(true, false);

    expect(first.tabHeaderEl.style.left).toBe("0px");
    expect(first.tabHeaderEl.style.right).toBe("60px");
    expect(first.containerEl.style.left).toBe("40px");
    expect(first.containerEl.style.minWidth).toBe("200px");
    expect(first.containerEl.style.maxWidth).toBe("400px");
    expect(second.tabHeaderEl.style.left).toBe("40px");
    expect(second.tabHeaderEl.style.right).toBe("0px");
    expect(second.containerEl.style.left).toBe("100px");

    setMetric(tabs.tabsContainerEl, "clientWidth", 120);
    tabs.tabsContainerEl.scrollLeft = 0;
    tabs.onContainerScroll();

    expect(first.containerEl.classList.contains("is-hidden")).toBe(false);
    expect(second.containerEl.classList.contains("is-hidden")).toBe(true);
  });

  it("clears stacked active leaf hidden state after updating tab display", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const first = tabs.children[0];
    if (!(first instanceof WorkspaceLeaf)) throw new Error("Expected first leaf");
    const second = new WorkspaceLeaf(app.workspace);
    tabs.appendChild(second, false);
    tabs.selectTabIndex(0, false);
    tabs.setStacked(true, false);
    second.containerEl.classList.add("is-hidden");
    const seenDuringUpdate: boolean[] = [];
    const originalUpdateTabDisplay = tabs.updateTabDisplay.bind(tabs);
    const updateSpy = vi.spyOn(tabs, "updateTabDisplay").mockImplementation(() => {
      seenDuringUpdate.push(second.containerEl.classList.contains("is-hidden"));
      originalUpdateTabDisplay();
    });

    tabs.selectTabIndex(1, false);

    expect(seenDuringUpdate).toEqual([true]);
    expect(second.containerEl.classList.contains("is-hidden")).toBe(false);
    expect(updateSpy).toHaveBeenCalledOnce();
    updateSpy.mockRestore();
  });

  it("locks tab widths before closing non-last headers and unlocks before closing the last header", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const first = tabs.children[0];
    if (!(first instanceof WorkspaceLeaf)) throw new Error("Expected first leaf");
    const second = new WorkspaceLeaf(app.workspace);
    tabs.appendChild(second, false);
    forceShown(tabs.tabHeaderContainerEl);
    setMetric(first.tabHeaderEl, "clientWidth", 72);
    setMetric(second.tabHeaderEl, "clientWidth", 88);

    first.tabHeaderCloseEl.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(tabs.hasLockedTabWidths).toBe(true);
    expect(second.tabHeaderEl.style.width).toBe("88px");

    second.tabHeaderCloseEl.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(tabs.hasLockedTabWidths).toBe(false);
    expect(second.tabHeaderEl.style.width).toBe("");
  });

  it("opens single file drops into the hovered tab header when dropped in the center zone", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const first = tabs.children[0];
    if (!(first instanceof WorkspaceLeaf)) throw new Error("Expected first leaf");
    const second = new WorkspaceLeaf(app.workspace);
    tabs.appendChild(second, false);
    const secondFile = await app.vault.create("Second.md", "second");
    const droppedFile = await app.vault.create("Dropped.md", "dropped");
    await second.openFile(secondFile, { active: true });
    setRect(first.tabHeaderEl, { x: 0, width: 80, height: 24 });
    setRect(second.tabHeaderEl, { x: 100, width: 80, height: 24 });
    setDragSource(app, { type: "file", file: droppedFile });
    const dataTransfer = createDataTransfer();

    tabs.tabHeaderContainerEl.dispatchEvent(createDragEvent("dragover", dataTransfer, 140));
    expect(second.tabHeaderEl.classList.contains("is-highlighted")).toBe(true);
    expect(dataTransfer.dropEffect).toBe("move");

    tabs.tabHeaderContainerEl.dispatchEvent(createDragEvent("drop", dataTransfer, 140));
    await nextMacrotask();

    expect(tabs.children).toEqual([first, second]);
    expect(viewFile(second)).toBe(droppedFile);
    expect(app.workspace.activeLeaf).toBe(second);
  });

  it("computes tab insert and dropped indexes with original center-zone thresholds", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const first = tabs.children[0];
    if (!(first instanceof WorkspaceLeaf)) throw new Error("Expected first leaf");
    setRect(tabs.tabHeaderContainerEl, { x: 10, y: 2, width: 200, height: 24 });
    setRect(first.tabHeaderEl, { x: 0, y: 4, width: 100, height: 20 });

    expect(tabs.getTabInsertLocation(25)).toMatchObject({ index: 0, droppedIndex: null });
    expect(tabs.getTabInsertLocation(26)).toMatchObject({ index: 0, droppedIndex: 0 });
    expect(tabs.getTabInsertLocation(74)).toMatchObject({ index: 1, droppedIndex: 0 });
    expect(tabs.getTabInsertLocation(75)).toMatchObject({ index: 1, droppedIndex: null });

    const emptyTabs = new WorkspaceTabs(app.workspace);
    setRect(emptyTabs.tabHeaderContainerEl, { x: 10, y: 2, width: 200, height: 24 });
    const emptyLocation = emptyTabs.getTabInsertLocation(50);
    expect(emptyLocation.index).toBe(0);
    expect(emptyLocation.droppedIndex).toBeNull();
    expect(emptyLocation.rect?.x).toBe(5);
  });

  it("inserts multiple dropped files as new tabs and activates the last inserted leaf", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const first = tabs.children[0];
    if (!(first instanceof WorkspaceLeaf)) throw new Error("Expected first leaf");
    const alpha = await app.vault.create("Alpha.md", "alpha");
    const beta = await app.vault.create("Beta.md", "beta");
    setRect(tabs.tabHeaderContainerEl, { x: 0, width: 200, height: 24 });
    setRect(first.tabHeaderEl, { x: 0, width: 80, height: 24 });
    setDragSource(app, { type: "files", files: [alpha, beta] });

    tabs.tabHeaderContainerEl.dispatchEvent(createDragEvent("drop", createDataTransfer(), 95));
    await nextMacrotask();

    expect(tabs.children).toHaveLength(3);
    const insertedAlpha = tabs.children[1];
    const insertedBeta = tabs.children[2];
    if (!(insertedAlpha instanceof WorkspaceLeaf) || !(insertedBeta instanceof WorkspaceLeaf))
      throw new Error("Expected inserted leaves");
    expect(viewFile(insertedAlpha)).toBe(alpha);
    expect(viewFile(insertedBeta)).toBe(beta);
    expect(app.workspace.activeLeaf).toBe(insertedBeta);
  });

  it("opens single bookmark drops into the hovered tab header center zone", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const first = tabs.children[0];
    if (!(first instanceof WorkspaceLeaf)) throw new Error("Expected first leaf");
    const second = new WorkspaceLeaf(app.workspace);
    tabs.appendChild(second, false);
    const opened: Array<{ item: unknown; leaf: WorkspaceLeaf; active?: boolean }> = [];
    Object.defineProperty(app.internalPlugins, "getEnabledPluginById", {
      configurable: true,
      value: (id: string) =>
        id === "bookmarks"
          ? {
              openItemInLeaf: (
                item: unknown,
                leaf: WorkspaceLeaf,
                openState: { active?: boolean } = {},
              ) => {
                opened.push({ item, leaf, active: openState.active });
              },
            }
          : null,
    });
    setRect(first.tabHeaderEl, { x: 0, width: 80, height: 24 });
    setRect(second.tabHeaderEl, { x: 100, width: 80, height: 24 });
    const bookmark = { type: "file", path: "Dropped.md" };
    setDragSource(app, { type: "bookmarks", items: [{ item: bookmark }] });
    const dataTransfer = createDataTransfer();

    tabs.tabHeaderContainerEl.dispatchEvent(createDragEvent("dragover", dataTransfer, 140));
    expect(second.tabHeaderEl.classList.contains("is-highlighted")).toBe(true);
    expect(dataTransfer.dropEffect).toBe("move");

    tabs.tabHeaderContainerEl.dispatchEvent(createDragEvent("drop", dataTransfer, 140));

    expect(tabs.children).toEqual([first, second]);
    expect(opened).toEqual([{ item: bookmark, leaf: second, active: true }]);
    expect(app.workspace.activeLeaf).toBe(second);
  });

  it("creates a new tab for a single centered bookmark drop when the target tab cannot navigate", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const first = tabs.children[0];
    if (!(first instanceof WorkspaceLeaf)) throw new Error("Expected first leaf");
    const second = new WorkspaceLeaf(app.workspace);
    tabs.appendChild(second, false);
    second.setPinned(true);
    const opened: Array<{ item: unknown; leaf: WorkspaceLeaf; active?: boolean }> = [];
    Object.defineProperty(app.internalPlugins, "getEnabledPluginById", {
      configurable: true,
      value: (id: string) =>
        id === "bookmarks"
          ? {
              openItemInLeaf: (
                item: unknown,
                leaf: WorkspaceLeaf,
                openState: { active?: boolean } = {},
              ) => {
                opened.push({ item, leaf, active: openState.active });
              },
            }
          : null,
    });
    setRect(first.tabHeaderEl, { x: 0, width: 80, height: 24 });
    setRect(second.tabHeaderEl, { x: 100, width: 80, height: 24 });
    const bookmark = { type: "file", path: "PinnedTarget.md" };
    setDragSource(app, { type: "bookmarks", items: [{ item: bookmark }] });
    const dataTransfer = createDataTransfer();

    tabs.tabHeaderContainerEl.dispatchEvent(createDragEvent("dragover", dataTransfer, 140));
    expect(second.tabHeaderEl.classList.contains("is-highlighted")).toBe(false);
    expect(dataTransfer.dropEffect).toBe("copy");

    tabs.tabHeaderContainerEl.dispatchEvent(createDragEvent("drop", dataTransfer, 140));
    await nextMacrotask();

    expect(tabs.children).toHaveLength(3);
    expect(tabs.children[2]).toBe(second);
    const inserted = tabs.children[1];
    expect(inserted).toBeInstanceOf(WorkspaceLeaf);
    expect(opened).toEqual([{ item: bookmark, leaf: inserted as WorkspaceLeaf, active: true }]);
    expect(app.workspace.activeLeaf).toBe(inserted);
  });

  it("rejects multiple centered bookmark drops instead of opening them in one existing tab", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const first = tabs.children[0];
    if (!(first instanceof WorkspaceLeaf)) throw new Error("Expected first leaf");
    const opened: unknown[] = [];
    Object.defineProperty(app.internalPlugins, "getEnabledPluginById", {
      configurable: true,
      value: (id: string) =>
        id === "bookmarks"
          ? {
              openItemInLeaf: (...args: unknown[]) => {
                opened.push(args);
              },
            }
          : null,
    });
    setRect(first.tabHeaderEl, { x: 0, width: 80, height: 24 });
    setDragSource(app, {
      type: "bookmarks",
      items: [
        { item: { type: "file", path: "One.md" } },
        { item: { type: "file", path: "Two.md" } },
      ],
    });
    const dataTransfer = createDataTransfer();

    tabs.tabHeaderContainerEl.dispatchEvent(createDragEvent("dragover", dataTransfer, 40));
    expect(dataTransfer.dropEffect).toBe("none");

    tabs.tabHeaderContainerEl.dispatchEvent(createDragEvent("drop", dataTransfer, 40));
    await nextMacrotask();

    expect(tabs.children).toEqual([first]);
    expect(opened).toEqual([]);
  });

  it("marks top tab groups for frameless titlebar spacing", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const rootTabs = app.workspace.rootSplit.children[0];
    if (!(rootTabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const leftLeaf = app.workspace.getLeftLeaf();
    const rightLeaf = app.workspace.getRightLeaf();
    const leftTabs = leftLeaf.parent;
    const rightTabs = rightLeaf.parent;
    if (!(leftTabs instanceof WorkspaceTabs) || !(rightTabs instanceof WorkspaceTabs))
      throw new Error("Expected sidedock tabs");
    const popout = new WorkspaceWindow(app.workspace, window);
    app.workspace.floatingSplit.appendChild(popout);
    const popoutTabs = new WorkspaceTabs(app.workspace);
    popoutTabs.appendChild(new WorkspaceLeaf(app.workspace), false);
    popout.appendChild(popoutTabs);

    app.workspace.updateFrameless();

    expect(rootTabs.containerEl.classList.contains("mod-top")).toBe(true);
    expect(leftTabs.containerEl.classList.contains("mod-top")).toBe(true);
    expect(leftTabs.containerEl.classList.contains("mod-top-left-space")).toBe(true);
    expect(rightTabs.containerEl.classList.contains("mod-top")).toBe(true);
    expect(rightTabs.containerEl.classList.contains("mod-top-right-space")).toBe(true);
    expect(popoutTabs.containerEl.classList.contains("mod-top")).toBe(true);
    expect(popoutTabs.containerEl.classList.contains("mod-top-left-space")).toBe(true);
    expect(popoutTabs.containerEl.classList.contains("mod-top-right-space")).toBe(true);

    popout.close();
  });
});
