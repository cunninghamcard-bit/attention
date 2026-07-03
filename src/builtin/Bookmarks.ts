import type { App } from "../app/App";
import { setIcon } from "../ui/Icon";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { ItemView } from "../views/ItemView";
import { MarkdownView } from "../views/MarkdownView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { TFile, TFolder } from "../vault/TAbstractFile";
import type { DragSource } from "../drag/DragManager";

export type BookmarkItem =
  | { type: "file"; ctime: number; path: string; subpath?: string; title?: string }
  | { type: "folder"; ctime: number; path: string; title?: string }
  | { type: "group"; ctime: number; title: string; items: BookmarkItem[] }
  | { type: "graph"; ctime: number; title: string; options?: Record<string, unknown> }
  | { type: "url"; ctime: number; url: string; title: string }
  | { type: "search"; ctime: number; query: string; title?: string };

export interface BookmarksData {
  items: BookmarkItem[];
}

type BookmarkItemDom = {
  item: BookmarkItem;
  itemEl: HTMLElement;
  selfEl: HTMLElement;
  titleEl: HTMLElement;
};

type BookmarksDragSource = DragSource & {
  source: "bookmarks";
  type: "bookmarks";
  icon: "lucide-bookmark";
  items: BookmarkItemDom[];
};

const VIEW_TYPE = "bookmarks";

export class BookmarksController {
  items: BookmarkItem[] = [];
  plugin: InternalPluginWrapper | null = null;

  constructor(readonly app: App) {}

  async onEnable(plugin: InternalPluginWrapper): Promise<void> {
    this.plugin = plugin;
    const data = await plugin.loadData<BookmarksData>();
    this.items = data?.items ?? await this.loadStarredMigration();
    plugin.registerEvent(this.app.workspace.on("layout-change", () => this.updateBookmarkedState()));
    this.updateBookmarkedState();
  }

  async save(): Promise<void> {
    await this.plugin?.saveData<BookmarksData>({ items: this.items });
    this.updateBookmarkedState();
    this.app.workspace.trigger("bookmarks-change", this.items);
  }

  async openView(active = true): Promise<void> {
    await this.app.workspace.ensureSideLeaf(VIEW_TYPE, "left", { active, reveal: active });
  }

  async bookmarkCurrentView(): Promise<void> {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf?.view) return;
    const view = leaf.view as unknown as { file?: TFile | null; getViewType?: () => string; getState?: () => unknown };
    if (view.file instanceof TFile) {
      await this.addItem({ type: "file", ctime: Date.now(), path: view.file.path });
      return;
    }
    const type = view.getViewType?.();
    if (type === "graph") {
      await this.addItem({ type: "graph", ctime: Date.now(), title: "Graph view", options: getStateObject(view) });
      return;
    }
    if (type === "search") {
      await this.bookmarkCurrentSearch();
    }
  }

  async bookmarkCurrentSearch(): Promise<void> {
    const view = this.app.workspace.activeLeaf?.view as unknown as { getViewType?: () => string; getState?: () => unknown } | undefined;
    if (view?.getViewType?.() !== "search") return;
    const state = getStateObject(view);
    const query = String(state.query ?? state.search ?? "");
    await this.addItem({ type: "search", ctime: Date.now(), query, title: query ? `Search: ${query}` : "Search" });
  }

  async bookmarkCurrentHeading(): Promise<void> {
    const view = this.app.workspace.activeLeaf?.view;
    if (!(view instanceof MarkdownView) || !(view.file instanceof TFile)) return;
    const headings = this.app.metadataCache.getFileCache(view.file)?.headings ?? [];
    const cursorLine = this.app.workspace.activeEditor?.editor.getCursor().line ?? 0;
    const heading = [...headings].reverse().find((item) => (item.position?.line ?? -1) <= cursorLine);
    if (!heading) {
      await this.addItem({ type: "file", ctime: Date.now(), path: view.file.path });
      return;
    }
    await this.addItem({
      type: "file",
      ctime: Date.now(),
      path: view.file.path,
      subpath: `#${heading.heading}`,
      title: heading.heading,
    });
  }

  async bookmarkAllTabs(): Promise<void> {
    for (const leaf of this.collectLeaves()) {
      const file = (leaf.view as unknown as { file?: TFile | null }).file;
      if (file instanceof TFile) this.addItemSync({ type: "file", ctime: Date.now(), path: file.path });
    }
    await this.save();
  }

  async unbookmarkCurrentView(): Promise<void> {
    const file = (this.app.workspace.activeLeaf?.view as unknown as { file?: TFile | null } | undefined)?.file;
    if (file instanceof TFile) {
      this.items = this.items.filter((item) => item.type !== "file" || item.path !== file.path);
      await this.save();
    }
  }

  async addItem(item: BookmarkItem): Promise<void> {
    this.addItemSync(item);
    await this.save();
  }

  removeItem(item: BookmarkItem): void {
    this.items = removeBookmark(this.items, item);
    void this.save();
  }

  async openItem(item: BookmarkItem): Promise<void> {
    if (item.type === "file") {
      const file = this.app.vault.getFileByPath(item.path);
      if (file) await this.app.workspace.openFile(file, { active: true, eState: item.subpath ? { subpath: item.subpath } : undefined });
      return;
    }
    if (item.type === "folder") {
      const folder = this.app.vault.getFolderByPath(item.path);
      if (!folder) return;
      const leaf = await this.app.workspace.ensureSideLeaf("file-explorer", "left", { reveal: true });
      const view = leaf.view as unknown as { revealFile?: (target: TFolder) => void };
      view.revealFile?.(folder);
      return;
    }
    if (item.type === "search") {
      const leaf = await this.app.workspace.ensureSideLeaf("search", "left", { active: true, reveal: true });
      const view = leaf.view as unknown as { focusSearch?: (query: string) => void };
      view.focusSearch?.(item.query);
      return;
    }
    if (item.type === "graph") {
      if (!this.canOpenGraphBookmark()) return;
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: "graph", state: item.options ?? {}, active: true });
      return;
    }
    if (item.type === "url") {
      window.open(item.url, "_blank", "noopener");
    }
  }

  async openItemInLeaf(item: BookmarkItem, leaf: WorkspaceLeaf, openState: { active?: boolean } = {}): Promise<void> {
    await this.openBookmarkInLeaf(item, leaf, openState);
  }

  async openBookmarkInLeaf(item: BookmarkItem, leaf: WorkspaceLeaf, openState: { active?: boolean } = {}): Promise<void> {
    const active = openState.active ?? true;
    if (item.type === "file") {
      const file = this.app.vault.getFileByPath(item.path);
      if (file) await leaf.openFile(file, { active, eState: item.subpath ? { subpath: item.subpath } : undefined });
      return;
    }
    if (item.type === "graph") {
      if (!this.canOpenGraphBookmark()) return;
      await leaf.setViewState({ type: "graph", state: item.options ?? {}, active });
      return;
    }
    await this.openItem(item);
  }

  isBookmarked(path: string): boolean {
    return containsBookmark(this.items, path);
  }

  private addItemSync(item: BookmarkItem): void {
    if (item.type === "file" && this.isBookmarked(item.path)) return;
    this.items.push(item);
  }

  private canOpenGraphBookmark(): boolean {
    return Boolean(this.app.viewRegistry.getViewCreatorByType("graph"));
  }

  private updateBookmarkedState(): void {
    for (const leaf of this.collectLeaves()) {
      const file = (leaf.view as unknown as { file?: TFile | null }).file;
      leaf.tabHeaderEl?.classList.toggle("mod-bookmarked", file instanceof TFile && this.isBookmarked(file.path));
    }
  }

  private collectLeaves(): WorkspaceLeaf[] {
    const leaves = new Set<WorkspaceLeaf>();
    const visit = (item: unknown): void => {
      if (!item || typeof item !== "object") return;
      const maybeLeaf = item as WorkspaceLeaf & { children?: unknown[] };
      if ("view" in maybeLeaf && maybeLeaf.view) leaves.add(maybeLeaf);
      for (const child of maybeLeaf.children ?? []) visit(child);
    };
    visit(this.app.workspace.rootSplit);
    visit(this.app.workspace.leftSplit);
    visit(this.app.workspace.rightSplit);
    visit(this.app.workspace.floatingSplit);
    return [...leaves];
  }

  private async loadStarredMigration(): Promise<BookmarkItem[]> {
    const starred = await this.app.jsonStore.read<string[] | { items?: string[] }>("starred");
    const paths = Array.isArray(starred) ? starred : starred?.items ?? [];
    return paths.map((path) => ({ type: "file", ctime: Date.now(), path }));
  }
}

class BookmarksView extends ItemView {
  private readonly itemDoms = new Map<BookmarkItem, BookmarkItemDom>();
  private readonly selectedDoms = new Set<BookmarkItemDom>();
  private activeDom: BookmarkItemDom | null = null;

  constructor(leaf: WorkspaceLeaf, readonly controller: BookmarksController) {
    super(leaf);
    this.contentEl.classList.add("bookmarks-pane");
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Bookmarks";
  }

  getIcon(): string {
    return "lucide-bookmark";
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("bookmarks-change", () => this.render()));
    this.render();
  }

  render(): void {
    this.clearSelectedDoms();
    this.itemDoms.clear();
    this.contentEl.replaceChildren();
    if (this.controller.items.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "bookmarks-pane-empty";
      emptyEl.textContent = "No bookmarks";
      this.contentEl.appendChild(emptyEl);
      return;
    }
    const rootEl = document.createElement("div");
    rootEl.className = "tree-item-children";
    for (const item of this.controller.items) rootEl.appendChild(this.renderItem(item));
    this.contentEl.appendChild(rootEl);
  }

  private renderItem(item: BookmarkItem): HTMLElement {
    const itemEl = document.createElement("div");
    itemEl.className = "tree-item";
    if ("path" in item) itemEl.dataset.path = item.path;
    const selfEl = document.createElement("div");
    selfEl.className = "tree-item-self bookmark is-clickable";
    const itemDom: BookmarkItemDom = { item, itemEl, selfEl, titleEl: document.createElement("span") };
    this.itemDoms.set(item, itemDom);
    if (item.type === "group") {
      const collapseIconEl = document.createElement("div");
      collapseIconEl.className = "tree-item-icon collapse-icon";
      setIcon(collapseIconEl, "right-triangle");
      selfEl.appendChild(collapseIconEl);
    } else {
      const iconEl = document.createElement("div");
      iconEl.className = "tree-item-icon";
      setIcon(iconEl, getBookmarkIcon(item));
      selfEl.appendChild(iconEl);
    }
    const innerEl = document.createElement("div");
    innerEl.className = "tree-item-inner";
    const titleEl = itemDom.titleEl;
    titleEl.className = "tree-item-inner-text";
    titleEl.textContent = getBookmarkTitle(item);
    const removeEl = document.createElement("button");
    removeEl.className = "clickable-icon mod-bookmark";
    removeEl.dataset.icon = "lucide-x";
    removeEl.title = "Remove bookmark";
    removeEl.addEventListener("click", (event) => {
      event.stopPropagation();
      this.controller.removeItem(item);
    });
    innerEl.appendChild(titleEl);
    selfEl.append(innerEl, removeEl);
    selfEl.addEventListener("click", (event) => this.handleItemClick(event, itemDom));
    this.app.dragManager.handleDrag(selfEl, () => this.createDragSource(itemDom));
    itemEl.appendChild(selfEl);
    if (item.type === "group") {
      const childrenEl = document.createElement("div");
      childrenEl.className = "tree-item-children";
      for (const child of item.items) childrenEl.appendChild(this.renderItem(child));
      itemEl.appendChild(childrenEl);
    }
    return itemEl;
  }

  private handleItemClick(event: MouseEvent, itemDom: BookmarkItemDom): void {
    if (event.altKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.toggleSelectedDom(itemDom);
      if (this.activeDom && this.activeDom !== itemDom) this.selectItem(this.activeDom);
      this.setFocusedItem(itemDom);
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.selectRangeTo(itemDom);
      this.setFocusedItem(itemDom);
      return;
    }
    this.clearSelectedDoms();
    this.setFocusedItem(itemDom);
    void this.controller.openItem(itemDom.item);
  }

  private createDragSource(itemDom: BookmarkItemDom): BookmarksDragSource | null {
    const multi = this.dragSelectedBookmarks(itemDom);
    if (multi) return multi;
    if (!this.selectedDoms.has(itemDom)) {
      this.clearSelectedDoms();
      this.selectItem(itemDom);
    }
    return {
      source: "bookmarks",
      type: "bookmarks",
      icon: "lucide-bookmark",
      items: [itemDom],
      title: getBookmarkTitle(itemDom.item),
      payload: itemDom.item,
      elements: [itemDom.selfEl],
    };
  }

  private dragSelectedBookmarks(itemDom: BookmarkItemDom): BookmarksDragSource | null {
    if (this.selectedDoms.size === 0) return null;
    if (this.selectedDoms.size === 1 && this.selectedDoms.has(itemDom)) return null;
    if (!this.selectedDoms.has(itemDom)) return null;
    const selected = [...this.selectedDoms].sort((a, b) => a.selfEl.offsetTop - b.selfEl.offsetTop);
    return {
      source: "bookmarks",
      type: "bookmarks",
      icon: "lucide-bookmark",
      items: selected,
      title: `${selected.length} bookmarks`,
      payload: selected.map((entry) => entry.item),
      elements: [...this.selectedDoms].map((entry) => entry.selfEl),
    };
  }

  private toggleSelectedDom(itemDom: BookmarkItemDom): void {
    if (this.selectedDoms.has(itemDom)) {
      this.selectedDoms.delete(itemDom);
      itemDom.selfEl.classList.remove("is-selected");
      return;
    }
    this.selectItem(itemDom);
  }

  private selectItem(itemDom: BookmarkItemDom): void {
    this.selectedDoms.add(itemDom);
    itemDom.selfEl.classList.add("is-selected");
  }

  private clearSelectedDoms(): void {
    for (const selected of this.selectedDoms) selected.selfEl.classList.remove("is-selected");
    this.selectedDoms.clear();
  }

  private selectRangeTo(itemDom: BookmarkItemDom): void {
    if (!this.activeDom) {
      this.selectItem(itemDom);
      return;
    }
    const items = [...this.itemDoms.values()];
    const start = items.indexOf(this.activeDom);
    const end = items.indexOf(itemDom);
    if (start === -1 || end === -1) {
      this.selectItem(itemDom);
      return;
    }
    this.clearSelectedDoms();
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    for (let index = from; index <= to; index += 1) this.selectItem(items[index]);
  }

  private setFocusedItem(itemDom: BookmarkItemDom | null): void {
    this.activeDom?.selfEl.classList.remove("has-focus");
    this.activeDom = itemDom;
    this.activeDom?.selfEl.classList.add("has-focus");
  }
}

export function createBookmarksPluginDefinition(): InternalPluginDefinition {
  let controller: BookmarksController | null = null;
  return {
    id: "bookmarks",
    name: "Bookmarks",
    description: "Bookmark files, searches, headings, URLs, and graph views.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new BookmarksController(app);
      plugin.instance = controller;
      plugin.registerViewType(VIEW_TYPE, (leaf) => new BookmarksView(leaf, controller!));
      app.workspace.registerHoverLinkSource("bookmarks", { display: "Bookmarks", defaultMod: true });
      plugin.register(() => app.workspace.unregisterHoverLinkSource("bookmarks"));
      plugin.registerGlobalCommand({
        id: "bookmarks:open",
        name: "Show bookmarks",
        icon: "lucide-bookmark",
        callback: () => void controller?.openView(true),
      });
      plugin.registerGlobalCommand({
        id: "bookmarks:bookmark-current-view",
        name: "Bookmark current view",
        icon: "lucide-bookmark-plus",
        callback: () => void controller?.bookmarkCurrentView(),
      });
      plugin.registerGlobalCommand({
        id: "bookmarks:bookmark-current-search",
        name: "Bookmark current search",
        icon: "lucide-search",
        callback: () => void controller?.bookmarkCurrentSearch(),
      });
      plugin.registerGlobalCommand({
        id: "bookmarks:unbookmark-current-view",
        name: "Unbookmark current view",
        icon: "lucide-bookmark-minus",
        callback: () => void controller?.unbookmarkCurrentView(),
      });
      plugin.registerGlobalCommand({
        id: "bookmarks:bookmark-current-section",
        name: "Bookmark current section",
        icon: "lucide-heading",
        callback: () => void controller?.bookmarkCurrentHeading(),
      });
      plugin.registerGlobalCommand({
        id: "bookmarks:bookmark-current-heading",
        name: "Bookmark current heading",
        icon: "lucide-heading",
        callback: () => void controller?.bookmarkCurrentHeading(),
      });
      plugin.registerGlobalCommand({
        id: "bookmarks:bookmark-all-tabs",
        name: "Bookmark all open tabs",
        icon: "lucide-bookmark-plus",
        callback: () => void controller?.bookmarkAllTabs(),
      });
      plugin.registerRibbonItem("Show bookmarks", "lucide-bookmark", () => {
        void controller?.openView(true);
      });
    },
    async onEnable(app: App, plugin: InternalPluginWrapper) {
      await controller?.onEnable(plugin);
      app.workspace.onLayoutReady(() => void controller?.openView(false));
    },
  };
}

function getBookmarkTitle(item: BookmarkItem): string {
  if (item.type === "file") return item.title ?? `${item.path}${item.subpath ?? ""}`;
  if (item.type === "folder") return item.title ?? item.path;
  if (item.type === "search") return item.title ?? `Search: ${item.query}`;
  if (item.type === "graph") return item.title;
  if (item.type === "url") return item.title || item.url;
  return item.title;
}

function getBookmarkIcon(item: BookmarkItem): string {
  if (item.type === "file") return item.subpath ? "lucide-heading" : "lucide-file";
  if (item.type === "folder") return "lucide-folder";
  if (item.type === "search") return "lucide-search";
  if (item.type === "graph") return "lucide-git-fork";
  if (item.type === "url") return "lucide-globe-2";
  return "lucide-bookmark";
}

function containsBookmark(items: BookmarkItem[], path: string): boolean {
  return items.some((item) => {
    if (item.type === "file" || item.type === "folder") return item.path === path;
    if (item.type === "group") return containsBookmark(item.items, path);
    return false;
  });
}

function removeBookmark(items: BookmarkItem[], target: BookmarkItem): BookmarkItem[] {
  return items
    .filter((item) => item !== target)
    .map((item) => item.type === "group" ? { ...item, items: removeBookmark(item.items, target) } : item);
}

function getStateObject(view: { getState?: () => unknown }): Record<string, unknown> {
  const state = view.getState?.();
  if (!state || typeof state !== "object") return {};
  const maybeState = state as { state?: unknown };
  return maybeState.state && typeof maybeState.state === "object" ? maybeState.state as Record<string, unknown> : {};
}
