import { createDiv, createSpan } from "../dom/dom";
import type { DragDropResult, DragSource, FileDragSource, FilesDragSource, LinkDragSource } from "../drag/DragManager";
import { setIcon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { Platform } from "../platform/Platform";
import { TFile } from "../vault/TAbstractFile";
import { WorkspaceParent } from "./WorkspaceParent";
import type { Workspace } from "./Workspace";
import type { WorkspaceItem } from "./WorkspaceItem";
import { WorkspaceLeaf } from "./WorkspaceLeaf";

export interface WorkspaceTabInsertLocation {
  index: number;
  droppedIndex: number | null;
  rect: DOMRect | null;
}

interface BookmarkDropItem {
  type: string;
  path?: string;
  subpath?: string;
  options?: Record<string, unknown>;
}

type BookmarksDragSource = DragSource & {
  type: "bookmarks";
  items: Array<{ item: BookmarkDropItem }>;
};

interface BookmarkOpener {
  openBookmarkInLeaf?: (item: BookmarkDropItem, leaf: WorkspaceLeaf, openState?: { active?: boolean }) => unknown;
  openItemInLeaf?: (item: BookmarkDropItem, leaf: WorkspaceLeaf, openState?: { active?: boolean }) => unknown;
}

const TAB_HEADER_ANIMATION_MS = 200;

export class WorkspaceTabs extends WorkspaceParent {
  type = "tabs";
  currentTab = 0;
  isStacked = false;
  tabHeaderEls: HTMLElement[] = [];
  hasLockedTabWidths = false;
  readonly tabHeaderContainerEl: HTMLElement;
  readonly tabsInnerEl: HTMLElement;
  readonly newTabButtonEl: HTMLElement;
  readonly newTabButtonIconEl: HTMLElement;
  readonly tabHeaderSpacerEl: HTMLElement;
  readonly tabListEl: HTMLElement;
  readonly tabListIconEl: HTMLElement;
  readonly tabsContainerEl: HTMLElement;

  static createFrom(workspace: Workspace, leaf: WorkspaceLeaf): WorkspaceTabs {
    const tabs = new WorkspaceTabs(workspace);
    tabs.insertChild(0, leaf);
    return tabs;
  }

  constructor(workspace: Workspace, id?: string, ownerDocument?: Document) {
    super(workspace, id, ownerDocument);
    this.autoManageDOM = false;
    this.allowSingleChild = true;
    this.containerEl.classList.add("workspace-tabs");
    this.tabHeaderContainerEl = createDiv("workspace-tab-header-container", this.containerEl);
    this.tabsInnerEl = createDiv("workspace-tab-header-container-inner", this.tabHeaderContainerEl);
    this.tabsInnerEl.addEventListener("wheel", (event) => this.handleTabHeaderWheel(event), { passive: false });
    this.tabHeaderContainerEl.addEventListener("mouseleave", () => this.unlockTabWidths());
    this.newTabButtonEl = createDiv("workspace-tab-header-new-tab", this.tabHeaderContainerEl);
    this.newTabButtonIconEl = createSpan("clickable-icon", this.newTabButtonEl);
    setIcon(this.newTabButtonIconEl, "lucide-plus");
    this.newTabButtonEl.title = "New tab";
    this.newTabButtonIconEl.setAttribute("aria-label", "New tab");
    this.newTabButtonEl.addEventListener("click", () => {
      const leaf = new WorkspaceLeaf(this.workspace, undefined, this.containerEl.ownerDocument);
      this.appendChild(leaf);
      this.selectTabIndex(this.children.length - 1);
      this.workspace.setActiveLeaf(leaf, { focus: true });
    });
    this.tabHeaderSpacerEl = createDiv("workspace-tab-header-spacer", this.tabHeaderContainerEl);
    this.tabListEl = createDiv("workspace-tab-header-tab-list", this.tabHeaderContainerEl);
    this.tabListIconEl = createSpan("clickable-icon", this.tabListEl);
    setIcon(this.tabListIconEl, "lucide-chevron-down");
    this.tabListEl.title = "Tab list";
    this.tabListIconEl.setAttribute("aria-label", "Tab list");
    this.tabListIconEl.addEventListener("click", (event) => this.showTabListMenu(event));
    this.tabListIconEl.addEventListener("contextmenu", (event) => this.showTabListMenu(event));
    this.tabsContainerEl = createDiv("workspace-tab-container", this.containerEl);
    this.tabsContainerEl.addEventListener("scroll", () => this.onContainerScroll(), { passive: true });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this.updateSlidingTabs()).observe(this.tabsContainerEl);
    this.app.dragManager.handleDrop(this.tabHeaderContainerEl, (event, source, hovering) => this.handleTabHeaderDrop(event, source, hovering));
  }

  appendChild(child: WorkspaceItem, activate = true): void {
    this.insertChild(this.children.length, child, activate);
  }

  insertChild(index: number, child: WorkspaceItem, activate = true): void {
    if (!(child instanceof WorkspaceLeaf)) return;
    const clamped = Math.max(0, Math.min(index, this.children.length));
    child.setParent(this);
    this.children.splice(clamped, 0, child);

    const beforeContainer = this.tabsContainerEl.children.item(clamped);
    if (beforeContainer) this.tabsContainerEl.insertBefore(child.containerEl, beforeContainer);
    else this.tabsContainerEl.appendChild(child.containerEl);

    const beforeHeader = this.tabsInnerEl.children.item(clamped);
    if (beforeHeader) this.tabsInnerEl.insertBefore(child.tabHeaderEl, beforeHeader);
    else this.tabsInnerEl.appendChild(child.tabHeaderEl);

    child.updateHeader();
    child.tabHeaderEl.addEventListener("click", () => {
      const childIndex = this.children.indexOf(child);
      if (childIndex !== -1) {
        this.selectTabIndex(childIndex);
        this.workspace.setActiveLeaf(child, { focus: true });
      }
    });

    if (this.children.length === 1) this.currentTab = 0;
    else if (clamped <= this.currentTab) this.currentTab += 1;

    this.onLayoutChange();
    this.unlockTabWidths();
    if (activate) {
      this.selectTabIndex(clamped);
      this.workspace.setActiveLeaf(child, { focus: true });
    }
    else this.updateTabDisplay();
  }

  removeChild(child: WorkspaceItem): void {
    const index = this.children.indexOf(child);
    const previousActiveTab = this.children[this.currentTab];
    if (this.children.length === 1) this.workspace.lastTabGroupStacked = this.isStacked;
    if (child instanceof WorkspaceLeaf) {
      child.tabHeaderEl.classList.remove("is-active");
      if (this.isStacked) child.tabHeaderEl.remove();
      child.containerEl.remove();
    }

    super.removeChild(child);

    if (this.children.length === 0) {
      this.currentTab = -1;
      this.tabHeaderEls = [];
      this.tabsInnerEl.replaceChildren();
      this.tabsContainerEl.replaceChildren();
      return;
    }

    if (child === previousActiveTab) {
      this.currentTab = Math.min(index, this.children.length - 1);
      this.workspace.onLayoutChange(this);
    }
    else this.currentTab = this.children.indexOf(previousActiveTab);
  }

  selectTabIndex(index: number, _activate = true, persist = true): void {
    if (this.children.length === 0) return;
    const nextTab = Math.max(0, Math.min(index, this.children.length - 1));
    const changed = this.currentTab !== nextTab;
    if (!changed) return;
    this.currentTab = nextTab;
    this.updateTabDisplay();
    if (this.isStacked) {
      this.children[this.currentTab]?.containerEl.classList.remove("is-hidden");
      this.scrollIntoView(this.currentTab);
    }
    if (persist) {
      this.workspace.requestSaveLayout();
      this.workspace.requestResize();
    }
  }

  selectTab(leaf: WorkspaceLeaf, _activate = true): void {
    const index = this.children.indexOf(leaf);
    if (index !== -1) this.selectTabIndex(index);
  }

  override recomputeChildrenDimensions(): void {
    this.updateTabDisplay();
  }

  getTabInsertLocation(clientX: number): WorkspaceTabInsertLocation {
    const groupRect = this.tabHeaderContainerEl.getBoundingClientRect();
    let rect: DOMRect | null = new DOMRect(groupRect.x - 5, groupRect.y, groupRect.width, groupRect.height);
    let index = this.tabHeaderEls.length;
    let droppedIndex: number | null = null;
    for (let childIndex = 0; childIndex < this.children.length; childIndex += 1) {
      const child = this.children[childIndex];
      if (!(child instanceof WorkspaceLeaf)) continue;
      const headerRect = child.tabHeaderEl.getBoundingClientRect();
      const left = headerRect.x;
      const right = headerRect.right;
      if (childIndex === this.children.length - 1 || clientX <= right) {
        const width = right - left || headerRect.width || 1;
        const middle = (left + right) / 2;
        index = childIndex;
        droppedIndex = Math.abs(clientX - middle) / width < 0.25 ? childIndex : null;
        rect = new DOMRect(clientX > middle ? right - 5 : left - 5, headerRect.y, 10, headerRect.height);
        if (clientX > middle) index += 1;
        break;
      }
    }
    return { index, droppedIndex, rect };
  }

  setStacked(stacked: boolean, layout = true): void {
    if (!Platform.canStackTabs) stacked = false;
    if (this.isStacked === stacked) return;
    this.isStacked = stacked;
    this.containerEl.classList.toggle("mod-stacked", stacked);
    if (this.children.length > 0) {
      this.updateTabDisplay();
      this.scrollIntoView(this.currentTab);
      if (layout) this.workspace.requestUpdateLayout();
    }
  }

  updateTabDisplay(): void {
    if (this.children.length === 0) return;
    const clamped = Math.max(0, Math.min(this.currentTab, this.children.length - 1));
    const corrected = clamped !== this.currentTab;
    this.currentTab = clamped;
    const previousTabHeaderEls = this.tabHeaderEls.slice();
    const leafChildren = this.children.filter((child): child is WorkspaceLeaf => child instanceof WorkspaceLeaf);
    this.tabHeaderEls = leafChildren.map((child) => child.tabHeaderEl);
    const containerChildren = this.isStacked
      ? leafChildren.flatMap((child) => {
        void child.loadIfDeferred();
        return [child.tabHeaderEl, child.containerEl];
      })
      : leafChildren.map((child) => child.containerEl);
    setChildrenInPlace(this.tabsContainerEl, containerChildren);
    if (this.isStacked) this.tabsInnerEl.replaceChildren();
    else syncTabHeadersWithAnimation(this.tabsInnerEl, previousTabHeaderEls, this.tabHeaderEls);

    let activeLeaf: WorkspaceLeaf | null = null;
    this.children.forEach((child, childIndex) => {
      const active = childIndex === this.currentTab;
      child.containerEl.style.display = this.isStacked || active ? "flex" : "none";
      if (!this.isStacked) child.containerEl.classList.remove("is-hidden");
      if (child instanceof WorkspaceLeaf) {
        if (!this.isStacked && active) activeLeaf = child;
        child.tabHeaderEl.classList.toggle("is-active", active);
      }
    });
    this.updateSlidingTabs();
    if (!this.isStacked && activeLeaf && this.containerEl.isShown()) void activeLeaf.loadIfDeferred();
    if (corrected) {
      this.workspace.requestSaveLayout();
      this.workspace.requestResize();
    }
  }

  serialize(): Record<string, unknown> {
    return {
      ...super.serialize(),
      ...(this.currentTab > 0 ? { currentTab: this.currentTab } : {}),
      ...(this.isStacked ? { stacked: true } : {}),
    };
  }

  private showTabListMenu(event: MouseEvent): void {
    if (this.tabListIconEl.classList.contains("has-active-menu")) return;
    event.preventDefault();
    const menu = new Menu(this.containerEl.ownerDocument).addSections(["action", "close", "", "tablist"]);
    menu.dom.classList.add("mod-tab-list");
    menu
      .addItem((item) => item
        .setSection("action")
        .setTitle(this.isStacked ? "Unstack tabs" : "Stack tabs")
        .setIcon("lucide-layers")
        .onClick(() => this.setStacked(!this.isStacked)))
      .addItem((item) => item
        .setSection("close")
        .setTitle("Close all")
        .setIcon("lucide-x")
        .onClick(() => {
          for (const child of [...this.children]) {
            if (child instanceof WorkspaceLeaf && !child.pinned) child.detach();
          }
        }));
    this.workspace.trigger("tab-group-menu", menu, this);
    for (let index = 0; index < this.children.length; index += 1) {
      const child = this.children[index];
      if (!(child instanceof WorkspaceLeaf)) continue;
      menu.addItem((item) => item
        .setSection("tablist")
        .setTitle(child.getDisplayText())
        .setChecked(index === this.currentTab)
        .setIcon(child.getIcon())
        .onClick(() => {
          this.selectTab(child);
          this.workspace.setActiveLeaf(child);
        }));
    }
    const rect = this.tabListIconEl.getBoundingClientRect();
    menu.setParentElement(this.tabListIconEl).showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: true });
  }

  private handleTabHeaderDrop(event: DragEvent, source: DragSource | null, hovering: boolean): DragDropResult {
    if (!source || !isTabHeaderDropSource(source)) return undefined;
    const location = this.getTabInsertLocation(event.clientX);
    const droppedLeaf = location.droppedIndex == null ? null : this.children[location.droppedIndex];

    if (source.type === "link") {
      const link = source as LinkDragSource;
      if (droppedLeaf instanceof WorkspaceLeaf && droppedLeaf.canNavigate()) {
        if (!hovering) {
          this.workspace.setActiveLeaf(droppedLeaf);
          void droppedLeaf.openLinkText(link.linktext, link.sourcePath, { active: true });
        }
        return openInCurrentTabResult(droppedLeaf);
      }
      if (!hovering) {
        const leaf = new WorkspaceLeaf(this.workspace, undefined, this.containerEl.ownerDocument);
        this.insertChild(location.index, leaf, false);
        void leaf.openLinkText(link.linktext, link.sourcePath, { active: true });
      }
      return this.openAsTabResult(location.rect);
    }

    if (source.type === "bookmarks") {
      return this.handleBookmarksDrop(source as BookmarksDragSource, droppedLeaf, location, hovering);
    }

    const files = getDraggedFiles(source);
    if (files.length === 0) return undefined;
    if (files.length === 1 && droppedLeaf instanceof WorkspaceLeaf && droppedLeaf.canNavigate()) {
      if (!hovering) {
        this.workspace.setActiveLeaf(droppedLeaf);
        void droppedLeaf.openFile(files[0], { active: true });
      }
      return openInCurrentTabResult(droppedLeaf);
    }
    if (!hovering) void this.openFilesInNewTabs(files, location.index);
    return this.openAsTabResult(location.rect);
  }

  private handleBookmarksDrop(source: BookmarksDragSource, droppedLeaf: WorkspaceItem | null, location: WorkspaceTabInsertLocation, hovering: boolean): DragDropResult {
    const opener = this.app.internalPlugins.getEnabledPluginById<BookmarkOpener>("bookmarks");
    const openBookmarkInLeaf = getBookmarkOpener(opener);
    if (!openBookmarkInLeaf) return undefined;
    const items = source.items.map((entry) => entry.item).filter((item) => item.type === "file" || item.type === "graph");
    if (items.length === 0) return undefined;
    if (location.droppedIndex !== null) {
      if (items.length !== 1) return undefined;
      if (droppedLeaf instanceof WorkspaceLeaf && droppedLeaf.canNavigate()) {
        if (!hovering) {
          this.workspace.setActiveLeaf(droppedLeaf);
          void openBookmarkInLeaf.call(opener, items[0], droppedLeaf, { active: true });
        }
        return openInCurrentTabResult(droppedLeaf);
      }
    }
    if (!hovering) void this.openBookmarksInNewTabs(items, location.index, opener);
    return this.openAsTabResult(location.rect);
  }

  private async openFilesInNewTabs(files: TFile[], startIndex: number): Promise<void> {
    const leaves: WorkspaceLeaf[] = [];
    let index = startIndex;
    for (const file of files) {
      const leaf = new WorkspaceLeaf(this.workspace, undefined, this.containerEl.ownerDocument);
      this.insertChild(index, leaf, false);
      index += 1;
      leaves.push(leaf);
    }
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      await leaves[fileIndex].openFile(files[fileIndex], { active: false });
    }
    const last = leaves[leaves.length - 1];
    if (last) this.workspace.setActiveLeaf(last, { focus: true });
  }

  private async openBookmarksInNewTabs(items: BookmarkDropItem[], startIndex: number, opener: BookmarkOpener): Promise<void> {
    const openBookmarkInLeaf = getBookmarkOpener(opener);
    if (!openBookmarkInLeaf) return;
    const leaves: WorkspaceLeaf[] = [];
    let index = startIndex;
    for (const item of items) {
      const leaf = new WorkspaceLeaf(this.workspace, undefined, this.containerEl.ownerDocument);
      this.insertChild(index, leaf, false);
      index += 1;
      leaves.push(leaf);
    }
    const last = leaves[leaves.length - 1];
    if (last) this.workspace.setActiveLeaf(last, { focus: true });
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      await openBookmarkInLeaf.call(opener, items[itemIndex], leaves[itemIndex], { active: true });
    }
  }

  private openAsTabResult(rect: DOMRect | null): DragDropResult {
    if (rect) this.app.dragManager.showOverlay(rect);
    return { action: "Open as tab", dropEffect: "copy" };
  }

  lockTabWidths(): void {
    if (!this.tabHeaderContainerEl.isShown() || this.isStacked) return;
    this.hasLockedTabWidths = true;
    const widths = this.children.map((child) => child instanceof WorkspaceLeaf ? child.tabHeaderEl.clientWidth : 0);
    this.children.forEach((child, index) => {
      if (child instanceof WorkspaceLeaf) child.tabHeaderEl.style.width = `${widths[index]}px`;
    });
  }

  unlockTabWidths(): void {
    if (!this.hasLockedTabWidths) return;
    this.hasLockedTabWidths = false;
    for (const child of this.children) {
      if (child instanceof WorkspaceLeaf) child.tabHeaderEl.style.width = "";
    }
  }

  updateSlidingTabs(): void {
    if (this.isStacked) {
      const headerWidths = this.children.map((child) => child instanceof WorkspaceLeaf ? child.tabHeaderEl.offsetWidth : 0);
      const totalHeaderWidth = headerWidths.reduce((sum, width) => sum + width, 0);
      const availableWidth = this.tabsContainerEl.clientWidth;
      const maxWidth = Math.max(300, availableWidth - totalHeaderWidth);
      const minWidth = this.children.length > 0 ? maxWidth / this.children.length : maxWidth;
      let left = 0;
      let right = totalHeaderWidth;
      this.children.forEach((child, index) => {
        if (!(child instanceof WorkspaceLeaf)) return;
        const headerWidth = headerWidths[index] ?? 0;
        child.tabHeaderEl.style.left = `${left}px`;
        left += headerWidth;
        right -= headerWidth;
        child.tabHeaderEl.style.right = `${right}px`;
        child.containerEl.style.left = `${left}px`;
        child.containerEl.style.minWidth = `${minWidth}px`;
        child.containerEl.style.maxWidth = `${maxWidth}px`;
      });
      this.onContainerScroll();
      return;
    }

    for (const child of this.children) {
      if (!(child instanceof WorkspaceLeaf)) continue;
      child.tabHeaderEl.style.left = "";
      child.tabHeaderEl.style.right = "";
      child.containerEl.style.left = "";
      child.containerEl.style.minWidth = "";
      child.containerEl.style.maxWidth = "";
      child.containerEl.classList.remove("is-hidden");
    }
  }

  onContainerScroll(): void {
    if (!this.isStacked) return;
    const scrollLeft = this.tabsContainerEl.scrollLeft;
    const scrollRight = scrollLeft + this.tabsContainerEl.clientWidth;
    let left = 0;
    this.children.forEach((child, index) => {
      if (!(child instanceof WorkspaceLeaf)) return;
      const headerWidth = child.tabHeaderEl.offsetWidth;
      const contentWidth = child.containerEl.offsetWidth;
      const contentLeft = left + headerWidth;
      const contentRight = contentLeft + contentWidth;
      left = contentRight;
      const hidden = index !== this.currentTab && (contentRight <= scrollLeft || contentLeft >= scrollRight);
      child.containerEl.classList.toggle("is-hidden", hidden);
    });
  }

  scrollIntoView(index: number): void {
    const child = this.children[index];
    if (!(child instanceof WorkspaceLeaf)) return;
    let totalHeadersToCurrent = 0;
    let totalHeadersAfterCurrent = 0;
    let leftEdge = 0;
    for (let childIndex = 0; childIndex < this.children.length; childIndex += 1) {
      const item = this.children[childIndex];
      if (!(item instanceof WorkspaceLeaf)) continue;
      const headerWidth = item.tabHeaderEl.offsetWidth;
      if (childIndex <= index) {
        totalHeadersToCurrent += headerWidth;
        leftEdge += headerWidth;
        if (childIndex < index) leftEdge += item.containerEl.offsetWidth;
      } else {
        totalHeadersAfterCurrent += headerWidth;
      }
    }
    const left = leftEdge - totalHeadersToCurrent;
    const right = leftEdge + child.containerEl.offsetWidth - this.tabsContainerEl.clientWidth + totalHeadersAfterCurrent;
    const current = this.tabsContainerEl.scrollLeft;
    if (current < right) this.scrollTabsContainerTo(right);
    else if (current > left) this.scrollTabsContainerTo(left);
  }

  private handleTabHeaderWheel(event: WheelEvent): void {
    if (!event.deltaY) return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    target.scrollLeft += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    event.preventDefault();
  }

  private scrollTabsContainerTo(left: number): void {
    if (typeof this.tabsContainerEl.scrollTo === "function") this.tabsContainerEl.scrollTo({ behavior: "smooth", left });
    else this.tabsContainerEl.scrollLeft = left;
  }
}

function setChildrenInPlace(container: HTMLElement, nextChildren: HTMLElement[]): void {
  const nextSet = new Set(nextChildren);
  for (const child of Array.from(container.children)) {
    if (!nextSet.has(child as HTMLElement)) child.remove();
  }
  nextChildren.forEach((child, index) => {
    const before = container.children.item(index);
    if (before !== child) container.insertBefore(child, before);
  });
}

function syncTabHeadersWithAnimation(container: HTMLElement, previousHeaders: HTMLElement[], nextHeaders: HTMLElement[]): void {
  const previousSet = new Set(previousHeaders);
  const nextSet = new Set(nextHeaders);
  const animate = shouldAnimateTabHeaderDiff(container);
  for (const header of previousHeaders) {
    if (!nextSet.has(header)) animateTabHeaderRemoval(container, header, animate);
  }
  nextHeaders.forEach((header, index) => {
    const before = container.children.item(index);
    if (before !== header) container.insertBefore(header, before);
    if (!previousSet.has(header)) animateTabHeaderInsertion(header, animate);
  });
}

function animateTabHeaderInsertion(header: HTMLElement, animate: boolean): void {
  const width = getTabHeaderAnimationWidth(header);
  if (!animate || width <= 0 || typeof header.animate !== "function") return;
  header.animate([
    { width: "0px", opacity: "0" },
    { width: `${width}px`, opacity: "1" },
  ], {
    duration: TAB_HEADER_ANIMATION_MS,
    easing: "ease-in-out",
  });
}

function animateTabHeaderRemoval(container: HTMLElement, header: HTMLElement, animate: boolean): void {
  if (header.parentElement !== container) {
    header.remove();
    return;
  }
  const width = getTabHeaderAnimationWidth(header);
  if (!animate || width <= 0 || typeof header.animate !== "function") {
    header.remove();
    return;
  }
  const clone = header.cloneNode(true) as HTMLElement;
  header.replaceWith(clone);
  const animation = clone.animate([
    { width: `${width}px`, opacity: "1" },
    { width: "0px", opacity: "0" },
  ], {
    duration: TAB_HEADER_ANIMATION_MS,
    easing: "ease-in-out",
  });
  animation.addEventListener("finish", () => clone.remove(), { once: true });
}

function getTabHeaderAnimationWidth(header: HTMLElement): number {
  return header.clientWidth || header.getBoundingClientRect().width || header.offsetWidth || 0;
}

function shouldAnimateTabHeaderDiff(container: HTMLElement): boolean {
  const maybeShown = (container as HTMLElement & { isShown?: () => boolean }).isShown;
  return typeof maybeShown === "function" ? maybeShown.call(container) : container.isConnected;
}

function isTabHeaderDropSource(source: DragSource): boolean {
  return source.type === "file" || source.type === "files" || source.type === "link" || source.type === "bookmarks";
}

function getBookmarkOpener(opener: BookmarkOpener | null | undefined): BookmarkOpener["openBookmarkInLeaf"] {
  return opener?.openBookmarkInLeaf ?? opener?.openItemInLeaf;
}

function getDraggedFiles(source: DragSource): TFile[] {
  if (source.type === "file") return [(source as FileDragSource).file].filter((file): file is TFile => file instanceof TFile);
  if (source.type === "files") return (source as FilesDragSource).files.filter((file): file is TFile => file instanceof TFile);
  return [];
}

function openInCurrentTabResult(leaf: WorkspaceLeaf): DragDropResult {
  return {
    hoverEl: leaf.tabHeaderEl,
    hoverClass: "is-highlighted",
    action: "Open in this tab",
    dropEffect: "move",
  };
}
