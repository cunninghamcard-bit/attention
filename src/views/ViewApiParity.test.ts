import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import type { TFile } from "../vault/TAbstractFile";
import { FileView } from "./FileView";
import { ItemView } from "./ItemView";
import { TextFileView } from "./TextFileView";
import { View } from "./View";
import { Menu } from "../ui/Menu";
import { Platform } from "../platform/Platform";

class BasicView extends View {
  getViewType(): string {
    return "basic-view-api";
  }

  getDisplayText(): string {
    return "Basic view";
  }
}

class SavingTextFileView extends TextFileView {
  saveCount = 0;

  getViewType(): string {
    return "saving-text-file-view-api";
  }

  override async save(clear?: boolean): Promise<void> {
    this.saveCount += 1;
    await super.save(clear);
  }
}

class LifecycleFileView extends FileView {
  events: string[] = [];

  getViewType(): string {
    return "lifecycle-file-view-api";
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.events.push(`load:${file.path}`);
  }

  override async onUnloadFile(file: TFile): Promise<void> {
    this.events.push(`unload:${file.path}`);
  }

  override async onRename(file: TFile, oldPath?: string): Promise<void> {
    this.events.push(`rename:${oldPath}->${file.path}`);
    await super.onRename(file, oldPath);
  }
}

class ActionItemView extends ItemView {
  groupChanges = 0;
  paneMenuSources: string[] = [];
  moreOptionsMenus = 0;

  getViewType(): string {
    return "action-item-view-api";
  }

  getDisplayText(): string {
    return "Action item";
  }

  override onGroupChange(): void {
    this.groupChanges += 1;
  }

  override onPaneMenu(menu: import("../ui/Menu").Menu, source?: string): void {
    this.paneMenuSources.push(source ?? "");
    super.onPaneMenu(menu, source);
  }

  override onMoreOptionsMenu(): void {
    this.moreOptionsMenus += 1;
  }
}

describe("View public API parity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
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

  it("allows the public View scope field to be cleared and exposes onResize", () => {
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();
    const view = new BasicView(leaf);

    expect(view.scope).not.toBeNull();
    view.scope = null;

    expect(view.scope).toBeNull();
    expect(() => view.onResize()).not.toThrow();
  });

  it("matches Obsidian side tooltip placement for sidebar views", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("basic-view-api", (leaf) => new BasicView(leaf));
    app.viewRegistry.registerView("action-item-view-api", (leaf) => new ActionItemView(leaf));

    const mainView = new BasicView(app.workspace.getLeaf());
    const leftLeaf = await app.workspace.ensureSideLeaf("basic-view-api", "left", { active: true, reveal: true });
    const rightLeaf = await app.workspace.ensureSideLeaf("action-item-view-api", "right", { active: true, reveal: true });

    expect(mainView.getSideTooltipPlacement()).toBeUndefined();
    expect(leftLeaf.view?.getSideTooltipPlacement()).toBe("right");
    expect(rightLeaf.view?.getSideTooltipPlacement()).toBe("left");
  });

  it("keeps base View state as an Obsidian-style no-op by default", async () => {
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();
    const view = new BasicView(leaf);

    await view.setState({ answer: 42 });

    expect(view.getState()).toEqual({});
  });

  it("exposes TextFileView data and public debounced requestSave", async () => {
    vi.useFakeTimers();
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();
    const view = new SavingTextFileView(leaf);

    view.setViewData("Alpha", true);
    expect(view.data).toBe("Alpha");

    view.data = "Beta";
    expect(view.getViewData()).toBe("Beta");

    view.requestSave();
    await vi.advanceTimersByTimeAsync(2000);

    expect(view.saveCount).toBe(1);
  });

  it("exposes FileView file lifecycle hooks including rename", async () => {
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();
    const view = new LifecycleFileView(leaf);
    const parent = document.createElement("div");
    const file = await app.vault.create("Folder/Original.md", "Body");

    await view.open(parent);
    await view.loadFile(file);
    await app.vault.rename(file, "Folder/Renamed.md");
    await view.loadFile(null);

    expect(view.events).toEqual([
      "load:Folder/Original.md",
      "rename:Folder/Original.md->Folder/Renamed.md",
      "unload:Folder/Renamed.md",
    ]);
    expect(view.getState()).toEqual({});
  });

  it("exposes FileView syncState and receiveSyncState like Obsidian", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("lifecycle-file-view-api", (leaf) => new LifecycleFileView(leaf));
    app.viewRegistry.registerExtensions(["sync"], "lifecycle-file-view-api");
    const sourceLeaf = app.workspace.getLeaf();
    const targetLeaf = app.workspace.getLeaf("tab");
    const file = await app.vault.create("Folder/Shared.sync", "Body");

    sourceLeaf.setGroup("file-view-sync");
    targetLeaf.setGroup("file-view-sync");
    await sourceLeaf.setViewState({ type: "lifecycle-file-view-api", state: { file: file.path }, active: true });
    await targetLeaf.setViewState({ type: "lifecycle-file-view-api", active: false });

    (sourceLeaf.view as LifecycleFileView).syncState();

    await vi.waitFor(() => {
      expect((targetLeaf.view as LifecycleFileView).file).toBe(file);
    });
  });

  it("renders FileView parent breadcrumbs into the ItemView title parent", async () => {
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();
    const view = new LifecycleFileView(leaf);
    const parent = document.createElement("div");
    const seenMenus: string[] = [];
    app.workspace.on("file-menu", (_menu, file, source, menuLeaf) => {
      seenMenus.push(`${file.path}:${source}:${menuLeaf === leaf}`);
    });
    const file = await app.vault.create("Folder/Sub/Original.md", "Body");

    await view.open(parent);
    await view.loadFile(file);

    expect([...view.titleParentEl.children].map((el) => `${el.className}:${el.textContent}`)).toEqual([
      "view-header-breadcrumb:Folder",
      "view-header-breadcrumb-separator:/",
      "view-header-breadcrumb:Sub",
      "view-header-breadcrumb-separator:/",
    ]);

    const subBreadcrumb = view.titleParentEl.children[2];
    expect(subBreadcrumb).toBeInstanceOf(HTMLElement);
    expect((subBreadcrumb as HTMLElement).draggable).toBe(true);

    subBreadcrumb.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));

    expect(seenMenus).toContain("Folder/Sub:file-explorer-context-menu:true");
    const menuTitles = Array.from(document.body.querySelectorAll<HTMLElement>(".menu-item-title")).map((el) => el.textContent);
    expect(menuTitles).toContain("New note");
    expect(menuTitles).not.toContain("New folder");
    expect(document.body.querySelector(".menu-item-icon svg.lucide-edit")).not.toBeNull();
  });

  it("keeps ItemView header actions and navigation state in sync", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("action-item-view-api", (leaf) => new ActionItemView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "action-item-view-api", active: true });
    const view = leaf.view as ActionItemView;
    const action = view.addAction("lucide-star", "Star", () => {});

    expect(view.actionsEl.firstElementChild).toBe(action);
    expect(action.getAttribute("aria-label")).toBe("Star");
    expect(action.hasAttribute("title")).toBe(false);
    expect(view.backButtonEl.getAttribute("aria-label")).toBe("Back");
    expect(view.backButtonEl.hasAttribute("title")).toBe(false);
    expect(view.backButtonEl.getAttribute("aria-disabled")).toBe("true");

    leaf.backHistory.push({ state: { type: "empty" } });
    app.workspace.trigger("history-change", leaf);
    leaf.trigger("history-change", leaf);

    expect(view.backButtonEl.getAttribute("aria-disabled")).toBe("false");

    leaf.setGroup("linked-view-test");

    expect(view.groupChanges).toBe(1);

    leaf.backHistory = [
      { title: "Older", icon: "lucide-file", state: { type: "empty" } },
      { title: "Closest", icon: "lucide-star", state: { type: "empty" } },
    ];
    leaf.forwardHistory = [
      { title: "Farther", icon: "lucide-file", state: { type: "empty" } },
      { title: "Forward", icon: "lucide-arrow-right", state: { type: "empty" } },
    ];
    leaf.trigger("history-change", leaf);
    const historyGo = vi.spyOn(leaf.history, "go").mockResolvedValue(true);

    view.backButtonEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(historyGo).toHaveBeenLastCalledWith(-1);

    const duplicate = app.workspace.getLeaf("tab");
    const duplicateGo = vi.spyOn(duplicate.history, "go").mockResolvedValue(true);
    vi.spyOn(app.workspace, "duplicateLeaf").mockResolvedValue(duplicate);
    view.forwardButtonEl.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    await vi.waitFor(() => expect(duplicateGo).toHaveBeenCalledWith(1));

    document.body.querySelectorAll(".menu").forEach((el) => el.remove());
    view.backButtonEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    expect([...document.body.querySelectorAll(".menu-item-title")].map((el) => el.textContent)).toEqual(["Closest", "Older"]);
    [...document.body.querySelectorAll<HTMLElement>(".menu-item")]
      .find((item) => item.textContent?.includes("Older"))?.click();
    expect(historyGo).toHaveBeenLastCalledWith(-2);

    document.body.querySelectorAll(".menu").forEach((el) => el.remove());
    view.forwardButtonEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    expect([...document.body.querySelectorAll(".menu-item-title")].map((el) => el.textContent)).toEqual(["Forward", "Farther"]);
    duplicateGo.mockClear();
    [...document.body.querySelectorAll<HTMLElement>(".menu-item")]
      .find((item) => item.textContent?.includes("Farther"))
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    await vi.waitFor(() => expect(duplicateGo).toHaveBeenCalledWith(2));
  });

  it("creates ItemView chrome inside the leaf owner document", async () => {
    const ownerDocument = document.implementation.createHTMLDocument("Owner");
    const app = new App(ownerDocument.body.appendChild(ownerDocument.createElement("div")));
    app.viewRegistry.registerView("owner-document-item-view-api", (leaf) => new ActionItemView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "owner-document-item-view-api", active: true });
    const view = leaf.view as ActionItemView;
    const action = view.addAction("lucide-star", "Star", () => {});

    expect(view.backButtonEl.ownerDocument).toBe(ownerDocument);
    expect(view.forwardButtonEl.ownerDocument).toBe(ownerDocument);
    expect(action.ownerDocument).toBe(ownerDocument);
  });

  it("lets sidebar ItemViews participate in pin/link tab menus while disabling sidebar split-right", async () => {
    document.body.querySelectorAll(".menu").forEach((el) => el.remove());
    const app = new App(document.body.appendChild(document.createElement("div")));
    app.viewRegistry.registerView("action-item-view-api", (leaf) => new ActionItemView(leaf));

    const leaf = await app.workspace.ensureSideLeaf("action-item-view-api", "right", { active: true, reveal: true });
    const view = leaf.view as ActionItemView;
    const menu = new Menu(document);

    expect(leaf.canPin()).toBe(true);

    view.onPaneMenu(menu, "more-options");
    menu.showAtPosition({ x: 0, y: 0 });

    const titles = [...menu.dom.querySelectorAll(".menu-item-title")].map((el) => el.textContent);
    const splitRightItem = [...menu.dom.querySelectorAll<HTMLElement>(".menu-item")]
      .find((item) => item.textContent?.includes("Split right"));

    expect(titles).toContain("Split right");
    expect(titles).toContain("Split down");
    expect(splitRightItem?.classList.contains("is-disabled")).toBe(true);
    document.body.querySelectorAll(".menu").forEach((el) => el.remove());
  });

  it("anchors ItemView more-options to the actual click target", async () => {
    document.body.querySelectorAll(".menu").forEach((el) => el.remove());
    const app = new App(document.body.appendChild(document.createElement("div")));
    app.viewRegistry.registerView("action-item-view-api", (leaf) => new ActionItemView(leaf));
    const leaf = app.workspace.getLeaf();
    let leafMenus = 0;
    app.workspace.on("leaf-menu", () => {
      leafMenus += 1;
    });

    await leaf.setViewState({ type: "action-item-view-api", active: true });
    const view = leaf.view as ActionItemView;
    const innerTarget = document.createElement("span");
    view.moreOptionsButtonEl.appendChild(innerTarget);
    view.moreOptionsButtonEl.classList.add("has-active-menu");

    innerTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(leafMenus).toBe(1);
    expect(document.body.querySelector(".menu")).not.toBeNull();
    expect(innerTarget.classList.contains("has-active-menu")).toBe(true);
  });

  it("adds phone-only close and pin actions to ItemView more-options", async () => {
    const previousPhone = Platform.isPhone;
    Platform.isPhone = true;
    document.body.querySelectorAll(".menu").forEach((el) => el.remove());
    try {
      const app = new App(document.body.appendChild(document.createElement("div")));
      app.viewRegistry.registerView("action-item-view-api", (leaf) => new ActionItemView(leaf));
      const leaf = app.workspace.getLeaf();

      await leaf.setViewState({ type: "action-item-view-api", active: true });
      const view = leaf.view as ActionItemView;
      expect(view.actionsEl.classList.contains("mod-raised")).toBe(true);
      view.moreOptionsButtonEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

      const titles = [...document.body.querySelectorAll(".menu-item-title")].map((el) => el.textContent);
      expect(titles).toContain("Close");
      expect(titles).toContain("Pin");

      const pinItem = [...document.body.querySelectorAll<HTMLElement>(".menu-item")]
        .find((item) => item.textContent?.includes("Pin"))
      expect(pinItem?.querySelector(".menu-item-icon svg.lucide-pin")).not.toBeNull();
      pinItem?.click();

      expect(leaf.pinned).toBe(true);

      document.body.querySelectorAll(".menu").forEach((el) => el.remove());
      view.moreOptionsButtonEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      const unpinItem = [...document.body.querySelectorAll<HTMLElement>(".menu-item")]
        .find((item) => item.textContent?.includes("Unpin"));
      expect(unpinItem?.querySelector(".menu-item-icon svg.lucide-pin-off")).not.toBeNull();
    } finally {
      Platform.isPhone = previousPhone;
      document.body.querySelectorAll(".menu").forEach((el) => el.remove());
    }
  });

  it("adds the mobile left sidebar toggle to ItemView headers", async () => {
    const previousMobile = Platform.isMobile;
    Platform.isMobile = true;
    try {
      const app = new App(document.body.appendChild(document.createElement("div")));
      app.viewRegistry.registerView("action-item-view-api", (leaf) => new ActionItemView(leaf));
      const leaf = app.workspace.getLeaf();

      await leaf.setViewState({ type: "action-item-view-api", active: true });
      const view = leaf.view as ActionItemView;

      expect(view.leftSidebarToggleEl?.className).toContain("mod-left-split-toggle");
      expect(view.headerLeftEl.firstElementChild).toBe(view.leftSidebarToggleEl);

      app.workspace.leftSplit.collapse();
      view.leftSidebarToggleEl?.click();

      expect(app.workspace.leftSplit.collapsed).toBe(false);
    } finally {
      Platform.isMobile = previousMobile;
    }
  });

  it("expands the right split from phone more-options contextmenu", async () => {
    const previousPhone = Platform.isPhone;
    Platform.isPhone = true;
    try {
      const app = new App(document.body.appendChild(document.createElement("div")));
      app.viewRegistry.registerView("action-item-view-api", (leaf) => new ActionItemView(leaf));
      const leaf = app.workspace.getLeaf();

      await leaf.setViewState({ type: "action-item-view-api", active: true });
      app.workspace.rightSplit.collapse();
      (leaf.view as ActionItemView).moreOptionsButtonEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

      expect(app.workspace.rightSplit.collapsed).toBe(false);
    } finally {
      Platform.isPhone = previousPhone;
    }
  });

  it("opens ItemView navigation history menus through long press and downward drag", async () => {
    vi.useFakeTimers();
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("action-item-view-api", (leaf) => new ActionItemView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "action-item-view-api", active: true });
    const view = leaf.view as ActionItemView;
    leaf.backHistory = [
      { title: "Older", icon: "lucide-file", state: { type: "empty" } },
      { title: "Closest", icon: "lucide-star", state: { type: "empty" } },
    ];
    leaf.forwardHistory = [
      { title: "Forward", icon: "lucide-arrow-right", state: { type: "empty" } },
    ];
    leaf.trigger("history-change", leaf);

    view.backButtonEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }));
    await vi.advanceTimersByTimeAsync(399);

    expect(document.body.querySelector(".menu")).toBeNull();

    await vi.advanceTimersByTimeAsync(1);

    expect([...document.body.querySelectorAll(".menu-item-title")].map((el) => el.textContent)).toEqual(["Closest", "Older"]);

    document.body.querySelectorAll(".menu").forEach((el) => el.remove());
    document.body.querySelectorAll(".suggestion-bg").forEach((el) => el.remove());

    view.forwardButtonEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 16 }));

    expect([...document.body.querySelectorAll(".menu-item-title")].map((el) => el.textContent)).toEqual(["Forward"]);
  });

  it("updates ItemView title fade state through the observed short scroll debounce", async () => {
    vi.useFakeTimers();
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();
    const view = new ActionItemView(leaf);

    Object.defineProperties(view.titleEl, {
      scrollLeft: { configurable: true, value: 5 },
      scrollWidth: { configurable: true, value: 100 },
      offsetWidth: { configurable: true, value: 20 },
    });

    view.titleEl.dispatchEvent(new Event("scroll"));

    expect(view.titleContainerEl.classList.contains("mod-at-start")).toBe(true);

    await vi.advanceTimersByTimeAsync(9);

    expect(view.titleContainerEl.classList.contains("mod-at-start")).toBe(true);

    await vi.advanceTimersByTimeAsync(1);

    expect(view.titleContainerEl.classList.contains("mod-at-start")).toBe(false);
    expect(view.titleContainerEl.classList.contains("mod-at-end")).toBe(false);
  });

  it("routes ItemView more-options through pane menu hooks and leaf-menu", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("action-item-view-api", (leaf) => new ActionItemView(leaf));
    const leaf = app.workspace.getLeaf();
    const leafMenus: unknown[] = [];
    app.workspace.on("leaf-menu", (menu, menuLeaf) => {
      leafMenus.push({ menu, menuLeaf });
    });

    await leaf.setViewState({ type: "action-item-view-api", active: true });
    const view = leaf.view as ActionItemView;

    view.moreOptionsButtonEl.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    view.moreOptionsButtonEl.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    expect(view.paneMenuSources).toContain("more-options");
    expect(view.moreOptionsMenus).toBe(2);
    expect(leafMenus).toHaveLength(2);
    expect((leafMenus[0] as { menuLeaf?: unknown }).menuLeaf).toBe(leaf);

    const duplicateLeaf = vi.spyOn(app.workspace, "duplicateLeaf").mockResolvedValue(leaf);
    [...document.body.querySelectorAll<HTMLElement>(".menu-item")]
      .find((item) => item.textContent?.includes("Split right"))
      ?.click();
    await vi.waitFor(() => expect(duplicateLeaf).toHaveBeenCalledWith(leaf, "vertical"));

    document.body.querySelectorAll(".menu").forEach((el) => el.remove());
    document.body.querySelectorAll(".suggestion-bg").forEach((el) => el.remove());
    const onStartLink = vi.spyOn(app.workspace, "onStartLink").mockImplementation(() => {});

    leaf.openTabHeaderMenu(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    await vi.waitFor(() => expect(document.body.querySelector(".menu")).toBeTruthy());
    [...document.body.querySelectorAll<HTMLElement>(".menu-item")]
      .find((item) => item.textContent?.includes("Link tab"))
      ?.click();

    expect(onStartLink).toHaveBeenCalledWith(leaf);
    expect(leaf.group).toBeNull();

    document.body.querySelectorAll(".menu").forEach((el) => el.remove());
    document.body.querySelectorAll(".suggestion-bg").forEach((el) => el.remove());
    const moveLeafToPopout = vi.spyOn(app.workspace, "moveLeafToPopout").mockReturnValue(undefined);

    leaf.openTabHeaderMenu(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    await vi.waitFor(() => expect(document.body.querySelector(".menu")).toBeTruthy());
    [...document.body.querySelectorAll<HTMLElement>(".menu-item")]
      .find((item) => item.textContent?.includes("Move to new window"))
      ?.click();

    expect(moveLeafToPopout).toHaveBeenCalledWith(leaf);
  });

  it("links ItemView leaves through the Workspace onStartLink mouse flow", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("action-item-view-api", (leaf) => new ActionItemView(leaf));
    const source = app.workspace.getLeaf();
    await source.setViewState({ type: "action-item-view-api", active: true });
    const target = app.workspace.getLeaf("tab");
    await target.setViewState({ type: "action-item-view-api", active: true });
    vi.spyOn(target.containerEl, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 30, 120, 80));

    app.workspace.onStartLink(source);
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 40, clientY: 50 }));

    expect(app.workspace.dragManager.overlayEl.parentElement).toBe(document.body);

    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 40, clientY: 50 }));

    expect(app.workspace.dragManager.overlayEl.parentElement).toBeNull();
    expect(source.group).toBeTruthy();
    expect(source.group).toBe(target.group);
  });
});
