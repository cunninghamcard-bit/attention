import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { AppDom } from "../../app/AppDom";
import { MobileDrawer } from "../../platform/mobile/MobileDrawer";
import { ItemView } from "../ItemView";
import { WorkspaceLeaf } from "./WorkspaceLeaf";
import { WorkspaceSidedock } from "./WorkspaceSidedock";
import { WorkspaceTabs } from "./WorkspaceTabs";

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

describe("Obsidian workspace DOM structure", () => {
  beforeEach(() => {
    document.body.className = "";
    document.body.replaceChildren();
    installBrowserStubs();
  });

  it("builds the AppDom root using the original app-container contract", () => {
    const host = document.createElement("div");
    const dom = new AppDom(host);

    expect(document.body.classList.contains("obsidian-app")).toBe(false);
    expect(document.body.classList.contains("show-view-header")).toBe(false);
    expect(document.body.classList.contains("show-ribbon")).toBe(false);
    expect(host.children).toHaveLength(1);
    expect(dom.appContainerEl.parentElement).toBe(host);
    expect(dom.appContainerEl.className).toBe("app-container");
    expect(dom.horizontalMainContainerEl.parentElement).toBe(dom.appContainerEl);
    expect(dom.horizontalMainContainerEl.className).toBe("horizontal-main-container");
    expect(dom.workspaceEl.parentElement).toBe(dom.horizontalMainContainerEl);
    expect(dom.workspaceEl.className).toBe("workspace");
    expect(dom.statusBarEl.parentElement).toBe(dom.appContainerEl);
    expect(dom.statusBarEl.className).toBe("status-bar");
  });

  it("builds the Obsidian frame/titlebar and body classes from the app layer", async () => {
    const app = new App(document.body);
    await app.ready;

    expect(document.body.classList.contains("obsidian-app")).toBe(true);
    expect(document.body.classList.contains("is-frameless")).toBe(true);
    expect(document.body.classList.contains("is-hidden-frameless")).toBe(true);
    expect(document.body.classList.contains("show-view-header")).toBe(true);
    expect(document.body.classList.contains("show-ribbon")).toBe(true);
    expect(document.body.classList.contains("is-popout-window")).toBe(false);
    expect(document.body.querySelectorAll(":scope > .app-container")).toHaveLength(1);
    expect(app.windowManager.getActiveWindow()?.win).toBe(window);
    expect(app.windowManager.getActiveWindow()?.workspaceWindow).toBeNull();
    expect(["mod-macos", "mod-windows", "mod-linux"].some((cls) => document.body.classList.contains(cls))).toBe(true);
    expect(app.frameDom.titleBarEl.className).toBe("titlebar");
    expect(app.frameDom.titleBarInnerEl.parentElement).toBe(app.frameDom.titleBarEl);
    expect(app.frameDom.titleBarInnerEl.className).toBe("titlebar-inner");
    expect(app.frameDom.titleBarTextEl.className).toBe("titlebar-text");
    expect(app.frameDom.titleBarTextEl.textContent).toBe("Obsidian");
    expect(app.frameDom.leftButtonContainerEl.className).toBe("titlebar-button-container mod-left");
    expect(app.frameDom.rightButtonContainerEl.className).toBe("titlebar-button-container mod-right");
    expect(app.dom.appContainerEl.previousElementSibling).toBe(app.frameDom.titleBarEl);
  });

  it("syncs macOS traffic-light position from Obsidian frame CSS variables", async () => {
    const win = window as Window & {
      electronWindow?: {
        webContents: { getZoomFactor: () => number };
        isFullScreen: () => boolean;
        isMaximized: () => boolean;
        setTrafficLightPosition: (position: { x: number; y: number }) => void;
      };
      titlebarStyle?: string;
    };
    const previousElectronWindow = win.electronWindow;
    const previousTitlebarStyle = win.titlebarStyle;
    const setTrafficLightPosition = vi.fn();
    win.electronWindow = {
      webContents: { getZoomFactor: () => 1.5 },
      isFullScreen: () => true,
      isMaximized: () => true,
      setTrafficLightPosition,
    };
    win.titlebarStyle = "hidden";
    document.body.classList.add("mod-macos");
    document.body.style.setProperty("--traffic-lights-offset-x", "40px");
    document.body.style.setProperty("--traffic-lights-offset-y", "0px");
    try {
      const app = new App(document.body);
      await app.ready;
      app.frameDom.updateStatus();

      expect(document.body.classList.contains("is-fullscreen")).toBe(true);
      expect(document.body.classList.contains("is-maximized")).toBe(true);
      expect(document.body.style.getPropertyValue("--zoom-factor")).toBe("1.5");
      expect(setTrafficLightPosition).toHaveBeenLastCalledWith({ x: 24, y: 22 });
    } finally {
      win.electronWindow = previousElectronWindow;
      win.titlebarStyle = previousTitlebarStyle;
      document.body.style.removeProperty("--traffic-lights-offset-x");
      document.body.style.removeProperty("--traffic-lights-offset-y");
    }
  });

  it("wires non-macOS titlebar buttons to Electron window actions", async () => {
    const previousPlatform = window.navigator.platform;
    const win = window as Window & {
      electronWindow?: {
        minimizable: boolean;
        maximizable: boolean;
        closable: boolean;
        isMaximized: () => boolean;
        minimize: () => void;
        maximize: () => void;
        unmaximize: () => void;
        close: () => void;
      };
    };
    const previousElectronWindow = win.electronWindow;
    let maximized = false;
    const electronWindow = {
      minimizable: true,
      maximizable: true,
      closable: true,
      isMaximized: () => maximized,
      minimize: vi.fn(),
      maximize: vi.fn(() => {
        maximized = true;
      }),
      unmaximize: vi.fn(() => {
        maximized = false;
      }),
      close: vi.fn(),
    };
    Object.defineProperty(window.navigator, "platform", { configurable: true, value: "Win32" });
    win.electronWindow = electronWindow;
    try {
      const app = new App(document.createElement("div"));
      await app.ready;

      app.frameDom.rightButtonContainerEl.querySelector<HTMLElement>(".mod-minimize")?.click();
      app.frameDom.rightButtonContainerEl.querySelector<HTMLElement>(".mod-maximize")?.click();
      app.frameDom.rightButtonContainerEl.querySelector<HTMLElement>(".mod-maximize")?.click();
      app.frameDom.rightButtonContainerEl.querySelector<HTMLElement>(".mod-close")?.click();

      expect(electronWindow.minimize).toHaveBeenCalledOnce();
      expect(electronWindow.maximize).toHaveBeenCalledOnce();
      expect(electronWindow.unmaximize).toHaveBeenCalledOnce();
      expect(electronWindow.close).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window.navigator, "platform", { configurable: true, value: previousPlatform });
      win.electronWindow = previousElectronWindow;
    }
  });

  it("refreshes frameless state when the desktop window fullscreen state changes", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const updateFrameless = vi.spyOn(app.workspace, "updateFrameless");

    window.dispatchEvent(new Event("fullscreenchange"));

    expect(updateFrameless).toHaveBeenCalledOnce();
  });

  it("lays out the desktop workspace shell in Obsidian order", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const children = Array.from(app.workspace.containerEl.children);

    expect(children[0]).toBe(app.workspace.leftRibbon.containerEl);
    expect(children[1]).toBe(app.workspace.leftSplit.containerEl);
    expect(children[2]).toBe(app.workspace.rootSplit.containerEl);
    expect(children[3]).toBe(app.workspace.rightSplit.containerEl);
    expect(children[4]).toBe(app.workspace.rightRibbon.containerEl);
    expect(app.workspace.leftRibbon.containerEl.className).toContain("workspace-ribbon side-dock-ribbon");
    expect(app.workspace.leftSidebarToggleButtonEl.className).toBe("sidebar-toggle-button mod-left");
    expect(app.workspace.leftRibbon.containerEl.contains(app.workspace.leftSidebarToggleButtonEl)).toBe(false);
    const leftToggleParent = app.workspace.leftSidebarToggleButtonEl.parentElement;
    expect(leftToggleParent?.classList.contains("workspace-tab-header-container")).toBe(true);
    expect(leftToggleParent?.contains(app.workspace.leftSidebarToggleButtonEl)).toBe(true);
    expect(app.workspace.leftRibbon.containerEl.classList.contains("mod-left")).toBe(true);
    expect(app.workspace.leftRibbon.containerEl.querySelector(":scope > .side-dock-actions")).toBeTruthy();
    expect(app.workspace.leftRibbon.containerEl.querySelector(":scope > .side-dock-settings")).toBeTruthy();
    expect(app.workspace.rightRibbon.containerEl.classList.contains("mod-right")).toBe(true);
    expect(app.workspace.rightRibbon.containerEl.hasAttribute("hidden")).toBe(false);
    expect(app.workspace.rightSidebarToggleButtonEl.className).toBe("sidebar-toggle-button mod-right");
    expect(app.workspace.rightRibbon.containerEl.contains(app.workspace.rightSidebarToggleButtonEl)).toBe(false);
    expect(app.workspace.leftSplit.containerEl.classList.contains("workspace-split")).toBe(true);
    expect(app.workspace.leftSplit.containerEl.classList.contains("mod-sidedock")).toBe(true);
    expect(app.workspace.leftSplit.containerEl.classList.contains("mod-left-split")).toBe(true);
    expect(app.workspace.rightSplit.containerEl.classList.contains("mod-right-split")).toBe(true);
    expect(app.workspace.rootSplit.containerEl.classList.contains("mod-root")).toBe(true);
    expect(app.workspace.rootSplit.containerEl.firstElementChild).toBe(app.workspace.rootSplit.resizeHandleEl);
    expect(app.workspace.leftSplit.collapsed).toBe(false);
    expect(app.workspace.containerEl.classList.contains("is-left-sidedock-open")).toBe(true);
    expect(app.workspace.rightSplit.collapsed).toBe(true);
    expect(app.workspace.containerEl.classList.contains("is-right-sidedock-open")).toBe(false);
    expect(app.workspace.leftSplit.containerEl.querySelector(".workspace-sidedock-empty-state > p.u-muted")?.textContent).toBe("No views");
    const rightToggleParent = app.workspace.rightSidebarToggleButtonEl.parentElement;
    expect(rightToggleParent?.classList.contains("workspace-tab-header-container")).toBe(true);

    const leftSplit = app.workspace.leftSplit;
    if (!(leftSplit instanceof WorkspaceSidedock)) throw new Error("Expected desktop left sidedock");
    Object.defineProperty(app.workspace.containerEl, "clientWidth", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(leftSplit.containerEl, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 300, height: 500, x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 500, toJSON: () => ({}) }),
    });
    leftSplit.resizeHandleEl.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 300, bubbles: true, cancelable: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 360 }));
    window.dispatchEvent(new MouseEvent("mouseup"));

    expect(leftSplit.width).toBe(360);
    expect(leftSplit.containerEl.style.width).toBe("360px");

    leftSplit.collapse();
    expect(leftSplit.collapsed).toBe(true);
    expect(leftSplit.width).toBe(360);
    expect(leftSplit.serialize()).toEqual(expect.objectContaining({ width: 360, collapsed: true }));
    expect(leftSplit.containerEl.classList.contains("is-sidedock-collapsed")).toBe(true);
    expect(leftSplit.containerEl.style.width).toBe("0px");
    expect(leftSplit.containerEl.style.display).toBe("none");
    expect(leftSplit.resizeHandleEl.style.opacity).toBe("0");
    expect(app.workspace.containerEl.classList.contains("is-left-sidedock-open")).toBe(false);

    leftSplit.expand();
    expect(leftSplit.collapsed).toBe(false);
    expect(leftSplit.containerEl.classList.contains("is-sidedock-collapsed")).toBe(false);
    expect(leftSplit.containerEl.style.width).toBe("360px");
    expect(leftSplit.containerEl.style.display).toBe("");
    expect(leftSplit.resizeHandleEl.style.opacity).toBe("1");
    expect(app.workspace.containerEl.classList.contains("is-left-sidedock-open")).toBe(true);

    leftSplit.toggle();
    expect(leftSplit.collapsed).toBe(true);
    leftSplit.toggle();
    expect(leftSplit.collapsed).toBe(false);
  });

  it("focuses the most recent root leaf when collapsing the active sidedock", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const rootLeaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
    const leftSplit = app.workspace.leftSplit;
    if (!(leftSplit instanceof WorkspaceSidedock) || !rootLeaf) throw new Error("Expected desktop root and sidedock");
    const sideLeaf = app.workspace.getLeftLeaf();
    if (!sideLeaf) throw new Error("Expected side leaf");
    app.workspace.setActiveLeaf(sideLeaf);
    const setActiveLeaf = vi.spyOn(app.workspace, "setActiveLeaf");

    leftSplit.collapse();

    expect(setActiveLeaf).toHaveBeenCalledWith(rootLeaf, { focus: true });
    expect(app.workspace.activeLeaf).toBe(rootLeaf);
  });

  it("wires the desktop vault profile tooltip and context menu", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    await app.vault.createFolder("Folder");
    await app.vault.create("Folder/Note.md", "Body");
    (app.vault.adapter as { getBasePath?: () => string }).getBasePath = () => "/Users/example/Vault";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const showInFolder = vi.spyOn(app, "showInFolder").mockImplementation(() => undefined);
    const leftSplit = app.workspace.leftSplit;
    if (!(leftSplit instanceof WorkspaceSidedock)) throw new Error("Expected desktop left sidedock");
    const switcherEl = leftSplit.containerEl.querySelector<HTMLElement>(".workspace-drawer-vault-switcher");
    const nameEl = leftSplit.containerEl.querySelector<HTMLElement>(".workspace-drawer-vault-name");
    if (!switcherEl || !nameEl) throw new Error("Expected vault profile");

    switcherEl.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(nameEl.getAttribute("aria-label")).toContain("/Users/example/Vault");
    expect(nameEl.getAttribute("aria-label")).toContain("1 file, 1 folder");

    switcherEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 20 }));
    await vi.waitFor(() => expect(document.body.querySelector(".menu")).toBeTruthy());
    const menuTitles = Array.from(document.body.querySelectorAll<HTMLElement>(".menu-item-title"));
    const showTitle = menuTitles.find((el) => el.textContent === "Show in folder");
    const copyTitle = menuTitles.find((el) => el.textContent === "Copy path");
    if (!showTitle || !copyTitle) throw new Error("Expected vault profile menu items");

    showTitle.closest<HTMLElement>(".menu-item")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(showInFolder).toHaveBeenCalledWith("");

    switcherEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 20 }));
    await vi.waitFor(() => expect(document.body.querySelector(".menu")).toBeTruthy());
    const copyMenuTitle = Array.from(document.body.querySelectorAll<HTMLElement>(".menu-item-title")).find((el) => el.textContent === "Copy path");
    copyMenuTitle?.closest<HTMLElement>(".menu-item")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("/Users/example/Vault"));
  });

  it("clamps sidedock resizing to Obsidian's workspace-relative bounds", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const leftSplit = app.workspace.leftSplit;
    if (!(leftSplit instanceof WorkspaceSidedock)) throw new Error("Expected desktop left sidedock");
    Object.defineProperty(app.workspace.containerEl, "clientWidth", {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(leftSplit.containerEl, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 300, height: 500, x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 500, toJSON: () => ({}) }),
    });

    leftSplit.resizeHandleEl.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 300, bubbles: true, cancelable: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 900 }));
    window.dispatchEvent(new MouseEvent("mouseup"));

    expect(leftSplit.width).toBe(400);
    expect(leftSplit.containerEl.style.width).toBe("400px");
  });

  it("uses Obsidian right ribbon and sidedock empty-state visibility contracts", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const rightSplit = app.workspace.rightSplit;
    if (!(rightSplit instanceof WorkspaceSidedock)) throw new Error("Expected desktop right sidedock");
    for (const child of [...rightSplit.children]) rightSplit.removeChild(child);
    app.workspace.updateLayout();

    expect(rightSplit.emptyStateEl.style.display).toBe("");
    expect(rightSplit.containerEl.classList.contains("is-sidedock-collapsed")).toBe(true);
    expect(app.workspace.rightRibbon.containerEl.classList.contains("is-hidden")).toBe(true);
    expect(app.workspace.rightRibbon.containerEl.hasAttribute("hidden")).toBe(false);

    const rightLeaf = app.workspace.getRightLeaf();
    app.workspace.updateLayout();
    expect(rightLeaf.getRoot()).toBe(rightSplit);
    expect(rightSplit.emptyStateEl.style.display).toBe("none");
    expect(app.workspace.rightRibbon.containerEl.classList.contains("is-hidden")).toBe(false);
    expect(app.workspace.rightRibbon.containerEl.hasAttribute("hidden")).toBe(false);

    const children = [...rightSplit.children];
    for (const child of children) rightSplit.removeChild(child);
    app.workspace.updateLayout();

    expect(rightSplit.emptyStateEl.style.display).toBe("");
    expect(rightSplit.collapsed).toBe(true);
    expect(rightSplit.containerEl.style.display).toBe("none");
    expect(app.workspace.rightRibbon.containerEl.classList.contains("is-hidden")).toBe(true);
    expect(app.workspace.rightRibbon.containerEl.hasAttribute("hidden")).toBe(false);
  });

  it("keeps hidden ribbon actions in DOM order while toggling display", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const hiddenButton = app.workspace.leftRibbon.addRibbonIcon("lucide-star", "Hidden action", () => {}, "hidden-action");
    const visibleButton = app.workspace.leftRibbon.addRibbonIcon("lucide-search", "Visible action", () => {}, "visible-action");

    app.workspace.leftRibbon.load({ hiddenItems: { "hidden-action": true, "visible-action": false } });

    const actions = Array.from(app.workspace.leftRibbon.actionsEl?.children ?? []);
    expect(actions).toContain(hiddenButton);
    expect(actions).toContain(visibleButton);
    expect(actions.indexOf(hiddenButton)).toBeLessThan(actions.indexOf(visibleButton));
    expect(hiddenButton.hasAttribute("data-action")).toBe(false);
    expect(visibleButton.hasAttribute("data-action")).toBe(false);
    expect(hiddenButton.hidden).toBe(false);
    expect(hiddenButton.style.display).toBe("none");
    expect(visibleButton.style.display).toBe("");
  });

  it("opens the Obsidian ribbon context menu for hidden actions and hiding the ribbon", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const button = app.workspace.leftRibbon.addRibbonIcon("lucide-star", "Toggle action", () => {}, "toggle-action");

    app.workspace.leftRibbon.containerEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const actionItem = [...document.body.querySelectorAll<HTMLElement>(".menu-item")]
      .find((item) => item.textContent?.includes("Toggle action"));
    const hideRibbonItem = [...document.body.querySelectorAll<HTMLElement>(".menu-item")]
      .find((item) => item.textContent?.includes("Hide ribbon"));

    expect(actionItem?.classList.contains("mod-checked")).toBe(true);
    actionItem?.click();

    expect(button.style.display).toBe("none");
    expect((app.workspace.leftRibbon.serialize().hiddenItems as Record<string, boolean>)["toggle-action"]).toBe(true);

    hideRibbonItem?.click();

    expect(app.vault.getConfig("showRibbon")).toBe(false);
  });

  it("uses the original tabs, leaf, and item view node contract", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const leaf = tabs.children[0];
    if (!(leaf instanceof WorkspaceLeaf)) throw new Error("Expected root leaf");

    expect(tabs.containerEl.classList.contains("workspace-tabs")).toBe(true);
    expect(tabs.tabHeaderContainerEl.parentElement).toBe(tabs.containerEl);
    expect(tabs.tabsInnerEl.className).toBe("workspace-tab-header-container-inner");
    expect(tabs.newTabButtonEl.firstElementChild?.tagName).toBe("SPAN");
    expect(tabs.newTabButtonEl.firstElementChild?.classList.contains("clickable-icon")).toBe(true);
    const childCount = tabs.children.length;
    tabs.newTabButtonEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(tabs.children).toHaveLength(childCount);
    tabs.newTabButtonIconEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(tabs.children).toHaveLength(childCount + 1);
    expect(tabs.tabListEl.firstElementChild?.tagName).toBe("SPAN");
    expect(tabs.tabsContainerEl.parentElement).toBe(tabs.containerEl);

    expect(leaf.containerEl.classList.contains("workspace-leaf")).toBe(true);
    expect(leaf.tabHeaderEl.classList.contains("workspace-tab-header")).toBe(true);
    expect(leaf.tabHeaderEl.classList.contains("tappable")).toBe(true);
    expect(leaf.tabHeaderEl.firstElementChild?.className).toBe("workspace-tab-header-inner");
    expect(leaf.tabHeaderInnerIconEl.nextElementSibling).toBe(leaf.tabHeaderInnerTitleEl);
    expect(leaf.tabHeaderInnerTitleEl.nextElementSibling).toBe(leaf.tabHeaderStatusContainerEl);
    expect(leaf.tabHeaderStatusContainerEl.nextElementSibling).toBe(leaf.tabHeaderCloseEl);
    expect(leaf.tabHeaderCloseEl.className).toBe("workspace-tab-header-inner-close-button");

    const itemView = new ItemView(leaf);
    expect(itemView.containerEl.classList.contains("workspace-leaf-content")).toBe(true);
    expect(itemView.headerEl.className).toBe("view-header");
    expect(itemView.contentEl.className).toBe("view-content");
    expect(itemView.headerLeftEl.className).toBe("view-header-left");
    expect(itemView.navButtonsEl.className).toBe("view-header-nav-buttons");
    expect(itemView.backButtonEl.tagName).toBe("BUTTON");
    expect(itemView.backButtonEl.className).toBe("clickable-icon");
    expect(itemView.headerEl.children[0]).toBe(itemView.headerLeftEl);
    expect(itemView.headerEl.children[1]).toBe(itemView.titleContainerEl);
    expect(itemView.headerEl.children[2]).toBe(itemView.actionsEl);
    expect(itemView.titleContainerEl.parentElement).toBe(itemView.headerEl);
    expect(itemView.titleContainerEl.classList.contains("view-header-title-container")).toBe(true);
    expect(itemView.titleContainerEl.classList.contains("mod-at-start")).toBe(true);
    expect(itemView.titleContainerEl.classList.contains("mod-fade")).toBe(true);
    expect(itemView.actionsEl.className).toBe("view-actions");
    expect(itemView.moreOptionsButtonEl.tagName).toBe("BUTTON");
    expect(itemView.moreOptionsButtonEl.className).toBe("clickable-icon view-action");
    expect(itemView.moreOptionsButtonEl.firstElementChild?.classList.contains("lucide-more-vertical")).toBe(true);
  });

  it("resynchronizes the active tab group during layout updates", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const originalTabs = app.workspace.activeTabGroup;
    if (!(originalTabs instanceof WorkspaceTabs)) throw new Error("Expected original tabs");
    const nextTabs = new WorkspaceTabs(app.workspace);
    const nextLeaf = new WorkspaceLeaf(app.workspace);

    nextTabs.appendChild(nextLeaf, false);
    app.workspace.rootSplit.appendChild(nextTabs);
    originalTabs.containerEl.classList.add("mod-active");
    app.workspace.activeLeaf = nextLeaf;

    app.workspace.updateLayout();

    expect(app.workspace.activeTabGroup).toBe(nextTabs);
    expect(originalTabs.containerEl.classList.contains("mod-active")).toBe(false);
    expect(nextTabs.containerEl.classList.contains("mod-active")).toBe(true);
  });

  it("marks only mobile root parents as visible", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    document.body.classList.add("is-mobile");
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const leaf = tabs.children[0];
    if (!(leaf instanceof WorkspaceLeaf)) throw new Error("Expected root leaf");

    app.workspace.updateLayout();

    expect(app.workspace.rootSplit.containerEl.classList.contains("mod-visible")).toBe(true);
    expect(tabs.containerEl.classList.contains("mod-visible")).toBe(true);
    expect(leaf.containerEl.classList.contains("mod-visible")).toBe(false);
  });

  it("clears linked tab groups that only have one remaining leaf", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const leaf = tabs.children[0];
    if (!(leaf instanceof WorkspaceLeaf)) throw new Error("Expected root leaf");
    const linkedLeaf = new WorkspaceLeaf(app.workspace);

    tabs.appendChild(linkedLeaf, false);
    leaf.setGroup("linked-layout", { layout: false });
    linkedLeaf.setGroup("linked-layout", { layout: false });
    linkedLeaf.detach();

    app.workspace.updateLayout();

    expect(leaf.group).toBeNull();
  });

  it("repairs active leaf through updateLayout after removing the active tab", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const tabs = app.workspace.rootSplit.children[0];
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const first = tabs.children[0];
    if (!(first instanceof WorkspaceLeaf)) throw new Error("Expected root leaf");
    const second = new WorkspaceLeaf(app.workspace);

    tabs.appendChild(second);
    tabs.removeChild(second);

    expect(app.workspace.activeLeaf).toBe(second);

    app.workspace.updateLayout();

    expect(app.workspace.activeLeaf).toBe(first);
  });

  it("renders only the active mobile drawer child in the active content slot", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const drawer = new MobileDrawer(app.workspace, "right");
    const first = new WorkspaceLeaf(app.workspace);
    const second = new WorkspaceLeaf(app.workspace);

    drawer.appendChild(first);
    drawer.appendChild(second, false);

    expect(drawer.tabOptionsEl.parentElement).toBe(drawer.activeTabContainerEl);
    expect(drawer.activeTabHeaderEl.className).toBe("workspace-tab-header workspace-drawer-tab-select");
    expect(drawer.activeTabHeaderEl.getAttribute("data-ignore-swipe")).toBe("true");
    expect(drawer.activeTabHeaderInnerEl.className).toBe("workspace-tab-header-inner");
    expect(drawer.activeTabHeaderIconEl.className).toBe("workspace-tab-header-inner-icon");
    expect(drawer.activeTabHeaderTitleEl.className).toBe("workspace-tab-header-inner-title");
    expect(drawer.activeTabHeaderChevronEl.className).toBe("workspace-tab-header-inner-chevron");
    expect(drawer.activeTabContentEl.children).toHaveLength(1);
    expect(drawer.activeTabContentEl.firstElementChild).toBe(first.containerEl);
    expect(drawer.activeTabHeaderTitleEl.textContent).toBe(first.getDisplayText());
    expect(drawer.tabOptionsListEl.children.item(0)).toBe(first.tabHeaderEl);
    expect(first.tabHeaderEl.classList.contains("is-active")).toBe(true);
    expect(second.containerEl.parentElement).toBeNull();

    drawer.selectTabIndex(1);

    expect(drawer.activeTabContentEl.children).toHaveLength(1);
    expect(drawer.activeTabContentEl.firstElementChild).toBe(second.containerEl);
    expect(drawer.activeTabHeaderTitleEl.textContent).toBe(second.getDisplayText());
    expect(drawer.tabOptionsListEl.children.item(1)).toBe(second.tabHeaderEl);
    expect(second.tabHeaderEl.classList.contains("is-active")).toBe(true);
    expect(first.containerEl.parentElement).toBeNull();

    drawer.removeChild(second);
    drawer.recomputeChildrenDimensions();

    expect(drawer.activeTabContentEl.children).toHaveLength(1);
    expect(drawer.activeTabContentEl.firstElementChild).toBe(first.containerEl);
  });
});
