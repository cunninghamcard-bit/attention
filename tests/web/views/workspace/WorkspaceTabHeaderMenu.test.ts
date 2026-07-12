import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { Menu, MenuItem } from "@web/ui/Menu";
import { EditableFileView } from "@web/views/EditableFileView";
import type { TFile } from "@web/vault/TAbstractFile";
import { WorkspaceLeaf } from "@web/views/workspace/WorkspaceLeaf";
import { WorkspaceTabs } from "@web/views/workspace/WorkspaceTabs";

interface HoverLinkPayload {
  event?: MouseEvent;
  source: string;
  hoverParent?: unknown;
  targetEl?: HTMLElement | null;
  linktext: string;
  sourcePath?: string;
}

class TestEditableFileView extends EditableFileView {
  getViewType(): string {
    return "editable-menu-test";
  }
}

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

function rootTabs(app: App): WorkspaceTabs {
  const tabs = app.workspace.rootSplit.children[0];
  if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
  return tabs;
}

function firstLeaf(tabs: WorkspaceTabs): WorkspaceLeaf {
  const leaf = tabs.children[0];
  if (!(leaf instanceof WorkspaceLeaf)) throw new Error("Expected leaf");
  return leaf;
}

async function openHeaderMenu(leaf: WorkspaceLeaf): Promise<HTMLElement> {
  leaf.tabHeaderEl.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 11, clientY: 13 }),
  );
  await vi.waitFor(() => expect(document.body.querySelector(".menu")).toBeTruthy());
  const menu = document.body.querySelector<HTMLElement>(".menu");
  if (!menu) throw new Error("Expected menu");
  return menu;
}

function menuTitles(menu: HTMLElement): string[] {
  return Array.from(menu.querySelectorAll<HTMLElement>(".menu-item-title")).map(
    (el) => el.textContent ?? "",
  );
}

function menuItemTitles(items: MenuItem[]): string[] {
  return items.map((item) => item.titleEl.textContent ?? "");
}

function linkedViewItems(app: App, file: TFile, source: string, leaf: WorkspaceLeaf): MenuItem[] {
  const menu = new Menu(document);
  app.workspace.trigger("file-menu", menu, file, source, leaf);
  return menu.items.filter(
    (item): item is MenuItem => item instanceof MenuItem && item.section === "view.linked",
  );
}

function findMenuItem(items: MenuItem[], title: string): MenuItem {
  const item = items.find((candidate) => candidate.titleEl.textContent === title);
  if (!item) throw new Error(`Expected menu item ${title}`);
  return item;
}

function clickMenuItem(title: string): void {
  const item = Array.from(document.body.querySelectorAll<HTMLElement>(".menu-item")).find(
    (el) => el.querySelector(".menu-item-title")?.textContent === title,
  );
  if (!item) throw new Error(`Expected menu item ${title}`);
  item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

async function waitForModal(): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const modal = document.body.querySelector<HTMLElement>(".modal");
    if (modal) return modal;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Expected modal");
}

async function waitForPrompt(): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const prompt = document.body.querySelector<HTMLElement>(".prompt");
    if (prompt) return prompt;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Expected prompt");
}

async function waitForMovedFile(
  app: App,
  oldPath: string,
  newPath: string,
  file: TFile,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (app.vault.getFileByPath(oldPath) === null && app.vault.getFileByPath(newPath) === file)
      return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Expected file to move");
}

describe("WorkspaceLeaf tab header menu", () => {
  beforeEach(() => {
    document.body.className = "";
    document.body.replaceChildren();
    installBrowserStubs();
  });

  it("opens the Obsidian tab header context menu contract and leaf-menu hook", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const tabs = rootTabs(app);
    const leaf = firstLeaf(tabs);
    let seenMenu: Menu | null = null;
    let seenLeaf: WorkspaceLeaf | null = null;
    app.workspace.on<[Menu, WorkspaceLeaf]>("leaf-menu", (menu, menuLeaf) => {
      seenMenu = menu;
      seenLeaf = menuLeaf;
    });
    const onOpenTabHeaderMenu = vi.spyOn(leaf, "onOpenTabHeaderMenu");

    const menu = await openHeaderMenu(leaf);
    const titles = menuTitles(menu);

    expect(onOpenTabHeaderMenu).toHaveBeenCalled();
    expect(seenMenu).not.toBeNull();
    expect(seenLeaf).toBe(leaf);
    expect(leaf.tabHeaderEl.classList.contains("has-active-menu")).toBe(true);
    expect(titles).toContain("Close");
    expect(titles).toContain("Pin");
    expect(titles).toContain("Link tab");
    expect(titles).toContain("Split right");
    expect(titles).toContain("Split down");
    expect(titles).toContain("Move to new window");
    expect(menu.querySelector(".menu-item-icon svg.lucide-pin")).not.toBeNull();
    expect(menu.querySelector(".menu-item-icon svg.lucide-separator-vertical")).not.toBeNull();
    expect(menu.querySelector(".menu-item-icon svg.lucide-picture-in-picture")).not.toBeNull();
  });

  it("closes other unpinned tabs from the header menu while preserving pinned tabs", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const tabs = rootTabs(app);
    const leaf = firstLeaf(tabs);
    const second = new WorkspaceLeaf(app.workspace);
    const pinned = new WorkspaceLeaf(app.workspace);
    tabs.appendChild(second, false);
    tabs.appendChild(pinned, false);
    pinned.setPinned(true);

    await openHeaderMenu(leaf);
    clickMenuItem("Close others");

    expect(tabs.children).toContain(leaf);
    expect(tabs.children).not.toContain(second);
    expect(tabs.children).toContain(pinned);
  });

  it("supports pin toggling and middle-click tab close", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const tabs = rootTabs(app);
    const leaf = firstLeaf(tabs);
    const second = new WorkspaceLeaf(app.workspace);
    tabs.appendChild(second, false);

    await openHeaderMenu(leaf);
    clickMenuItem("Pin");
    expect(leaf.pinned).toBe(true);
    expect(leaf.tabHeaderEl.classList.contains("has-active-menu")).toBe(false);

    second.tabHeaderEl.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 }),
    );
    second.tabHeaderEl.dispatchEvent(
      new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
    );
    expect(tabs.children).not.toContain(second);
  });

  it("lets EditableFileView contribute rename/delete and file-menu entries", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const file = await app.vault.create("Note.md", "Body");
    const tabs = rootTabs(app);
    const leaf = firstLeaf(tabs);
    const view = new TestEditableFileView(leaf);
    await leaf.open(view);
    await view.loadFile(file);
    let seenFile: TFile | null = null;
    let seenContext = "";
    let seenLeaf: WorkspaceLeaf | null = null;
    app.workspace.on<[Menu, TFile, string, WorkspaceLeaf]>(
      "file-menu",
      (_menu, menuFile, context, menuLeaf) => {
        seenFile = menuFile;
        seenContext = context;
        seenLeaf = menuLeaf;
        _menu.addItem((item) => item.setSection("action").setTitle("Plugin action"));
      },
    );

    const menu = await openHeaderMenu(leaf);
    const titles = menuTitles(menu);

    expect(titles).toContain("Rename");
    expect(titles).toContain("Delete");
    expect(titles).toContain("Open linked view");
    expect(menu.querySelector(".menu-item-icon svg.lucide-edit-3")).not.toBeNull();
    expect(menu.querySelector(".menu-item-icon svg.lucide-trash-2")).not.toBeNull();
    expect(
      menu.querySelector<HTMLElement>(".menu-item.is-warning .menu-item-title")?.textContent,
    ).toBe("Delete");
    expect(titles.indexOf("Rename")).toBeLessThan(titles.indexOf("Plugin action"));
    expect(seenFile).toBe(file);
    expect(seenContext).toBe("tab-header");
    expect(seenLeaf).toBe(leaf);
  });

  it("opens Obsidian's rename prompt from file-backed pane menus", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const file = await app.vault.create("Prompted.md", "Body");
    const leaf = firstLeaf(rootTabs(app));
    const view = new TestEditableFileView(leaf);
    await leaf.open(view);
    await view.loadFile(file);

    await openHeaderMenu(leaf);
    clickMenuItem("Rename");
    const modal = await waitForModal();
    const input = modal.querySelector<HTMLTextAreaElement>("textarea.rename-textarea");

    expect(modal.classList.contains("mod-file-rename")).toBe(true);
    expect(input?.value).toBe("Prompted");
  });

  it("lets builtin file-menu plugins contribute linked-view submenu actions", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    await app.internalPlugins.enable("graph");
    await app.internalPlugins.enable("backlink");
    await app.internalPlugins.enable("outgoing-link");
    const file = await app.vault.create("Note.md", "# Heading\n\n[[Other]]");
    const textFile = await app.vault.create("Attachment.txt", "Plain text");
    const sourceLeaf = await app.workspace.openFile(file, { active: true });

    const items = linkedViewItems(app, file, "tab-header", sourceLeaf);
    const titles = menuItemTitles(items);

    expect(titles).toHaveLength(4);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Open local graph",
        "Open backlinks",
        "Open outgoing links",
        "Open outline",
      ]),
    );
    expect(
      findMenuItem(items, "Open local graph").iconEl.querySelector("svg.lucide-git-fork"),
    ).not.toBeNull();
    expect(
      findMenuItem(items, "Open backlinks").iconEl.querySelector("svg.links-coming-in"),
    ).not.toBeNull();
    expect(
      findMenuItem(items, "Open outgoing links").iconEl.querySelector("svg.links-going-out"),
    ).not.toBeNull();
    expect(
      findMenuItem(items, "Open outline").iconEl.querySelector("svg.lucide-list"),
    ).not.toBeNull();

    const fileMenu = new Menu(document);
    app.workspace.trigger("file-menu", fileMenu, file, "tab-header", sourceLeaf);
    const backlinksToggle = findMenuItem(
      fileMenu.items.filter((item): item is MenuItem => item instanceof MenuItem),
      "Backlinks in document",
    );
    expect(backlinksToggle.section).toBe("pane");
    expect(backlinksToggle.checked).toBe(false);
    backlinksToggle.handleEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(sourceLeaf.view?.getState()).toMatchObject({ backlinks: true });

    const nextFileMenu = new Menu(document);
    app.workspace.trigger("file-menu", nextFileMenu, file, "tab-header", sourceLeaf);
    expect(
      findMenuItem(
        nextFileMenu.items.filter((item): item is MenuItem => item instanceof MenuItem),
        "Backlinks in document",
      ).checked,
    ).toBe(true);

    findMenuItem(items, "Open outline").handleEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const outlineLeaf = app.workspace
      .getGroupLeaves(sourceLeaf.group ?? "")
      .find((leaf) => leaf.view?.getViewType() === "outline");
    expect(outlineLeaf).not.toBeNull();
    expect(outlineLeaf).not.toBe(sourceLeaf);

    expect(menuItemTitles(linkedViewItems(app, textFile, "tab-header", sourceLeaf))).toEqual([
      "Open backlinks",
    ]);
    expect(linkedViewItems(app, file, "sidebar-context-menu", sourceLeaf)).toHaveLength(0);
  });

  it("keeps Note Composer merge actions out of resolved link context menus", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    await app.internalPlugins.enable("note-composer");
    const file = await app.vault.create("Mergeable.md", "Body");
    const textFile = await app.vault.create("Attachment.txt", "Plain text");
    const leaf = await app.workspace.openFile(file, { active: true });

    const tabMenu = new Menu(document);
    app.workspace.trigger("file-menu", tabMenu, file, "tab-header", leaf);
    const linkMenu = new Menu(document);
    app.workspace.trigger("file-menu", linkMenu, file, "link-context-menu", leaf);
    const textMenu = new Menu(document);
    app.workspace.trigger("file-menu", textMenu, textFile, "tab-header", leaf);

    const tabItems = tabMenu.items.filter((item): item is MenuItem => item instanceof MenuItem);
    const linkItems = linkMenu.items.filter((item): item is MenuItem => item instanceof MenuItem);
    const textItems = textMenu.items.filter((item): item is MenuItem => item instanceof MenuItem);
    const mergeItem = findMenuItem(tabItems, "Merge entire file with...");

    expect(mergeItem.section).toBe("action");
    expect(mergeItem.iconEl.querySelector("svg.lucide-git-merge")).not.toBeNull();
    expect(menuItemTitles(linkItems)).not.toContain("Merge entire file with...");
    expect(menuItemTitles(textItems)).not.toContain("Merge entire file with...");
  });

  it("adds Obsidian's generic file-menu actions for files", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const file = await app.vault.create("Actions.md", "Body");
    const leaf = await app.workspace.openFile(file, { active: true });
    const menu = new Menu(document);

    app.workspace.trigger("file-menu", menu, file, "tab-header", leaf);

    const items = menu.items.filter((item): item is MenuItem => item instanceof MenuItem);
    const titles = menuItemTitles(items);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Copy Obsidian URL",
        "Open in default app",
        "Move file to...",
        "Copy path",
        "Open in new window",
      ]),
    );
    expect(findMenuItem(items, "Copy Obsidian URL").section).toBe("info.copy");
    expect(findMenuItem(items, "Open in default app").section).toBe("system");
    expect(findMenuItem(items, "Move file to...").section).toBe("action");
    expect(
      findMenuItem(items, "Move file to...").iconEl.querySelector("svg.lucide-folder-tree"),
    ).not.toBeNull();
    expect(findMenuItem(items, "Open in new window").section).toBe("open");
    expect(findMenuItem(items, "Copy path").iconEl.querySelector("svg.vault")).not.toBeNull();
  });

  it("moves files through Obsidian's generic move prompt", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    await app.vault.createFolder("Target");
    const file = await app.vault.create("Source.md", "Body");
    const leaf = await app.workspace.openFile(file, { active: true });
    const menu = new Menu(document);
    app.workspace.trigger("file-menu", menu, file, "tab-header", leaf);
    const moveItem = findMenuItem(
      menu.items.filter((item): item is MenuItem => item instanceof MenuItem),
      "Move file to...",
    );

    moveItem.handleEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const prompt = await waitForPrompt();
    const targetSuggestion = Array.from(
      prompt.querySelectorAll<HTMLElement>(".suggestion-item"),
    ).find((item) => item.textContent?.includes("Target"));
    if (!targetSuggestion) throw new Error("Expected Target folder suggestion");
    targetSuggestion.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitForMovedFile(app, "Source.md", "Target/Source.md", file);

    expect(file.path).toBe("Target/Source.md");
  });

  it("emits Obsidian tab-header hover-link events for file-backed leaves", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const file = await app.vault.create("Hover.md", "Body");
    const leaf = await app.workspace.openFile(file, { active: true });
    let seen: HoverLinkPayload | null = null;
    app.workspace.on("hover-link", (event) => {
      seen = event as HoverLinkPayload;
    });

    leaf.tabHeaderEl.dispatchEvent(
      new MouseEvent("mouseover", {
        bubbles: true,
        cancelable: true,
        relatedTarget: document.body,
      }),
    );

    expect(seen?.event).toBeInstanceOf(MouseEvent);
    expect(seen?.source).toBe("tab-header");
    expect(seen?.hoverParent).toBe(leaf);
    expect(seen?.targetEl).toBe(leaf.tabHeaderEl);
    expect(seen?.linktext).toBe(file.path);
    expect(seen?.sourcePath).toBeUndefined();
  });

  it("renders linked tab status icon that highlights the group and unlinks the current leaf", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const first = await app.vault.create("First.md", "first");
    const second = await app.vault.create("Second.md", "second");
    const sourceLeaf = await app.workspace.openFile(first, { active: true });
    const linkedLeaf = app.workspace.splitLeafOrActive(sourceLeaf, "vertical");
    await linkedLeaf.openFile(second, { active: true, group: sourceLeaf });

    const linkedIcon = sourceLeaf.tabHeaderEl.querySelector<HTMLElement>(
      ".workspace-tab-header-status-icon.mod-linked",
    );
    if (!linkedIcon) throw new Error("Expected linked status icon");

    expect(linkedIcon.querySelector("svg.lucide-link")).not.toBeNull();
    sourceLeaf.updateHeader();
    expect(
      sourceLeaf.tabHeaderEl.querySelector(".workspace-tab-header-status-icon.mod-linked"),
    ).toBe(linkedIcon);
    linkedIcon.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
    expect(linkedIcon.querySelector("svg.lucide-unlink")).not.toBeNull();
    expect(sourceLeaf.containerEl.classList.contains("is-highlighted")).toBe(true);
    expect(linkedLeaf.containerEl.classList.contains("is-highlighted")).toBe(true);
    expect(sourceLeaf.tabHeaderEl.classList.contains("is-highlighted")).toBe(false);

    linkedIcon.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true }));
    expect(linkedIcon.querySelector("svg.lucide-link")).not.toBeNull();
    expect(sourceLeaf.containerEl.classList.contains("is-highlighted")).toBe(false);
    expect(linkedLeaf.containerEl.classList.contains("is-highlighted")).toBe(false);

    linkedIcon.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(sourceLeaf.group).toBeNull();
    expect(
      sourceLeaf.tabHeaderEl.querySelector(".workspace-tab-header-status-icon.mod-linked"),
    ).toBeNull();
  });

  it("keeps pinned tab status icon stable across header refreshes", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const tabs = rootTabs(app);
    const leaf = firstLeaf(tabs);
    const pinnedEvents: boolean[] = [];
    leaf.on("pinned-change", (pinned) => pinnedEvents.push(pinned));
    const saveLayout = vi.spyOn(app.workspace, "requestSaveLayout");

    leaf.setPinned(true);
    leaf.setPinned(true);
    const pinnedIcon = leaf.tabHeaderEl.querySelector<HTMLElement>(
      ".workspace-tab-header-status-icon.mod-pinned",
    );
    if (!pinnedIcon) throw new Error("Expected pinned status icon");

    leaf.updateHeader();

    expect(pinnedEvents).toEqual([true, true]);
    expect(saveLayout).toHaveBeenCalledTimes(2);
    expect(leaf.tabHeaderEl.querySelector(".workspace-tab-header-status-icon.mod-pinned")).toBe(
      pinnedIcon,
    );
    expect(leaf.tabHeaderEl.getAttribute("aria-label")).toBe(leaf.getDisplayText());
    expect(leaf.tabHeaderEl.dataset.tooltipDelay).toBe("300");
    expect(leaf.tabHeaderEl.hasAttribute("title")).toBe(false);
    expect(leaf.tabHeaderCloseEl.getAttribute("aria-label")).toBe("Close");
    expect(leaf.tabHeaderCloseEl.hasAttribute("title")).toBe(false);
    expect(pinnedIcon.getAttribute("aria-label")).toBe("Unpin");
    expect(pinnedIcon.hasAttribute("title")).toBe(false);
    expect(leaf.tabHeaderCloseEl.style.display).toBe("none");

    pinnedIcon.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(leaf.pinned).toBe(false);
    expect(
      leaf.tabHeaderEl.querySelector(".workspace-tab-header-status-icon.mod-pinned"),
    ).toBeNull();
    expect(leaf.tabHeaderCloseEl.style.display).toBe("");
  });

  it("routes group changes through the pinned-change contract first", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const leaf = firstLeaf(rootTabs(app));
    const events: string[] = [];
    const saveLayout = vi.spyOn(app.workspace, "requestSaveLayout");
    leaf.on("pinned-change", (pinned) => events.push(`pinned:${pinned}`));
    leaf.on("group-change", (group) => events.push(`group:${group}`));

    leaf.setGroup("group-event-order");

    expect(events).toEqual(["pinned:false", "group:group-event-order"]);
    expect(saveLayout).toHaveBeenCalledOnce();
  });

  it("routes view header more-options through pane menu and leaf-menu hooks", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const tabs = rootTabs(app);
    const leaf = firstLeaf(tabs);
    const view = new TestEditableFileView(leaf);
    await leaf.open(view);
    let seenSource = "";
    let seenLeaf: WorkspaceLeaf | null = null;
    app.workspace.on<[Menu, WorkspaceLeaf]>("leaf-menu", (_menu, menuLeaf) => {
      seenLeaf = menuLeaf;
    });
    app.workspace.on<[Menu, TFile, string, WorkspaceLeaf]>("file-menu", (_menu, _file, source) => {
      seenSource = source;
    });

    view.moreOptionsButtonEl.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    const menu = document.body.querySelector<HTMLElement>(".menu");
    if (!menu) throw new Error("Expected menu");

    expect(menuTitles(menu)).toContain("Split right");
    expect(view.moreOptionsButtonEl.classList.contains("has-active-menu")).toBe(true);
    expect(seenLeaf).toBe(leaf);
    expect(seenSource).toBe("");
  });
});
