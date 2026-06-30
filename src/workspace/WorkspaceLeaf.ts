import { WorkspaceItem } from "./WorkspaceItem";
import type { EventRef } from "../core/Events";
import { createDiv, setChildrenInPlace } from "../dom/dom";
import type { OpenViewState, Workspace } from "./Workspace";
import { Notice } from "../ui/Notice";
import { Menu } from "../ui/Menu";
import { setIcon } from "../ui/Icon";
import { Platform } from "../platform/Platform";
import type { InternalViewState, InternalViewStateResult, View, ViewState } from "../views/View";
import { EmptyView } from "../views/EmptyView";
import { UnknownView } from "../views/UnknownView";
import { DeferredView } from "../views/DeferredView";
import { FileView } from "../views/FileView";
import type { DragDropResult, DragSource, FileDragSource, LinkDragSource } from "../drag/DragManager";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { parseLinktext } from "../metadata/Linkpath";
import type { HoverPopover } from "../ui/Popover";

export interface LeafHistoryState {
  title?: string;
  icon?: string;
  state: InternalViewState;
  eState?: unknown;
}

export interface LeafHistorySnapshot {
  backHistory: LeafHistoryState[];
  forwardHistory: LeafHistoryState[];
}

export interface WorkspaceLeafHistory {
  readonly backHistory: LeafHistoryState[];
  readonly forwardHistory: LeafHistoryState[];
  back(): Promise<boolean>;
  forward(): Promise<boolean>;
  go(delta: number): Promise<boolean>;
  pushState(state?: LeafHistoryState | InternalViewState | null, eState?: unknown): void;
  serialize(): LeafHistorySnapshot;
  deserialize(snapshot: LeafHistorySnapshot | LeafHistoryState[] | null | undefined): void;
}

interface BookmarkDropItem {
  type: string;
  path?: string;
  subpath?: string;
  options?: Record<string, unknown>;
}

type BookmarksDragSource = DragSource & {
  type: "bookmarks";
  items?: Array<{ item?: BookmarkDropItem }>;
};

interface BookmarkOpener {
  openBookmarkInLeaf?: (item: BookmarkDropItem, leaf: WorkspaceLeaf, openState?: { active?: boolean }) => unknown;
  openItemInLeaf?: (item: BookmarkDropItem, leaf: WorkspaceLeaf, openState?: { active?: boolean }) => unknown;
}

export class WorkspaceLeaf extends WorkspaceItem {
  type = "leaf";
  view!: View;
  readonly emptyView: EmptyView;
  readonly history: WorkspaceLeafHistory;
  working = false;
  activeTime = 0;
  backHistory: LeafHistoryState[] = [];
  forwardHistory: LeafHistoryState[] = [];
  group: string | null = null;
  pinned = false;
  hoverPopover: HoverPopover | null = null;
  private deferredViewState: InternalViewState | null = null;
  private deferredEphemeralState: unknown;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private width = 0;
  private height = 0;
  readonly tabHeaderEl: HTMLElement;
  readonly tabHeaderInnerIconEl: HTMLElement;
  readonly tabHeaderInnerTitleEl: HTMLElement;
  readonly tabHeaderStatusContainerEl: HTMLElement;
  readonly tabHeaderCloseEl: HTMLElement;
  private tabHeaderStatusLinkEl: HTMLElement | null = null;
  private tabHeaderStatusPinEl: HTMLElement | null = null;

  constructor(workspace: Workspace, id?: string, ownerDocument?: Document) {
    super(workspace, id, ownerDocument);
    this.history = new WorkspaceLeafHistoryController(this);
    this.containerEl.classList.add("workspace-leaf");
    this.containerEl.tabIndex = -1;

    this.tabHeaderEl = this.containerEl.ownerDocument.createElement("div");
    this.tabHeaderEl.className = "workspace-tab-header tappable";
    this.tabHeaderEl.setAttribute("role", "tab");
    this.tabHeaderEl.draggable = true;
    this.tabHeaderEl.addEventListener("dragstart", (event) => this.workspace.onDragLeaf(event, this));
    this.tabHeaderEl.addEventListener("contextmenu", (event) => this.onOpenTabHeaderMenu(event));
    this.tabHeaderEl.addEventListener("mousedown", (event) => {
      if (event.button === 1) event.preventDefault();
    });
    this.tabHeaderEl.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      this.closeFromTabHeader();
    });
    this.tabHeaderEl.addEventListener("mouseover", (event) => this.handleTabHeaderMouseover(event));

    const inner = createDiv("workspace-tab-header-inner", this.tabHeaderEl);
    this.tabHeaderInnerIconEl = createDiv("workspace-tab-header-inner-icon", inner);
    this.tabHeaderInnerTitleEl = createDiv("workspace-tab-header-inner-title", inner);
    this.tabHeaderStatusContainerEl = createDiv("workspace-tab-header-status-container", inner);
    this.tabHeaderCloseEl = createDiv("workspace-tab-header-inner-close-button", inner);
    setIcon(this.tabHeaderCloseEl, "lucide-x");
    this.tabHeaderCloseEl.title = "Close";
    this.tabHeaderCloseEl.setAttribute("aria-label", "Close");
    this.tabHeaderCloseEl.addEventListener("click", (event) => {
      event.stopPropagation();
      this.closeFromTabHeader();
    });

    this.containerEl.addEventListener("focusin", () => this.workspace.setActiveLeaf(this));
    this.containerEl.addEventListener("pointerdown", () => this.workspace.setActiveLeaf(this), { capture: true });

    this.emptyView = new EmptyView(this);
    this.view = this.emptyView;
    const ResizeObserverCtor = this.containerEl.ownerDocument.defaultView?.ResizeObserver ?? globalThis.ResizeObserver;
    if (ResizeObserverCtor) {
      this.resizeObserver = new ResizeObserverCtor((entries) => {
        if (!entries.some((entry) => entry.target === this.containerEl)) return;
        const width = this.containerEl.offsetWidth;
        const height = this.containerEl.offsetHeight;
        if (width === this.width && height === this.height) return;
        this.width = width;
        this.height = height;
        this.queueResize();
      });
      this.resizeObserver.observe(this.containerEl);
    }
    void this.view.open(this.containerEl).then(() => this.updateHeader());
  }

  override on(name: "pinned-change", callback: (pinned: boolean) => any, ctx?: any): EventRef;
  override on(name: "group-change", callback: (group: string) => any, ctx?: any): EventRef;
  override on(name: "history-change", callback: () => any, ctx?: any): EventRef;
  override on<TArgs extends unknown[]>(name: string, callback: (...args: TArgs) => any, ctx?: object): EventRef<TArgs>;
  override on<TArgs extends unknown[]>(name: string, callback: (...args: TArgs) => any, ctx?: object): EventRef<TArgs> {
    return super.on(name, callback, ctx);
  }

  onOpenTabHeaderMenu(event: MouseEvent, parentEl: HTMLElement = this.tabHeaderEl): Menu {
    return this.openTabHeaderMenu(event, parentEl);
  }

  openTabHeaderMenu(event: MouseEvent, parentEl: HTMLElement = this.tabHeaderEl): Menu {
    event.preventDefault();
    const menu = Menu.forEvent(event).addSections(["title", "close", "pane", "open", "action", "find", "info", "info.copy", "view", "view.linked", "system", "", "danger"]);
    menu.setSectionSubmenu("info.copy", { title: "Copy path", icon: "lucide-copy" });
    menu.setSectionSubmenu("view.linked", { title: "Open linked view", icon: "lucide-link" });
    if (Platform.isPhone) {
      menu.addItem((item) => {
        item
          .setSection("title")
          .setTitle(this.getDisplayText())
          .setIcon(this.getIcon())
          .setIsLabel(true);
        item.titleEl.classList.add("u-muted");
      });
    }
    this.view?.onTabMenu(menu);
    if (this.isVisible()) {
      this.view?.onPaneMenu(menu, this.workspace.isInSidebar(this) ? "sidebar-context-menu" : "tab-header");
      this.workspace.trigger("leaf-menu", menu, this);
    }
    menu.setParentElement(parentEl);
    return menu;
  }

  isVisible(): boolean {
    return this.containerEl.isShown();
  }

  get isDeferred(): boolean {
    return this.view instanceof DeferredView || this.deferredViewState !== null;
  }

  private handleTabHeaderMouseover(event: MouseEvent): void {
    if (event.defaultPrevented || !isEnteringElement(event, this.tabHeaderEl)) return;
    const state = this.getViewState().state as { file?: unknown } | undefined;
    const path = state?.file;
    if (typeof path !== "string") return;
    if (!this.app.vault.getFileByPath(path)) return;
    this.workspace.trigger("hover-link", {
      event,
      source: "tab-header",
      hoverParent: this,
      targetEl: this.tabHeaderEl,
      linktext: path,
    });
  }

  private closeFromTabHeader(): void {
    if (this.parent instanceof WorkspaceTabs) {
      const siblings = this.parent.children;
      if (this === siblings[siblings.length - 1]) this.parent.unlockTabWidths();
      else this.parent.lockTabWidths();
    }
    this.detach();
  }

  canNavigate(): boolean {
    return Boolean(this.view?.navigation && !this.pinned);
  }

  getDisplayText(): string {
    if (this.deferredViewState) return displayTextFromViewState(this.deferredViewState);
    return this.view?.getDisplayText() ?? "New tab";
  }

  getIcon(): string {
    if (this.deferredViewState?.icon) return this.deferredViewState.icon;
    return this.view?.getIcon?.() ?? this.view?.icon ?? "lucide-file";
  }

  getViewState(): InternalViewState {
    if (this.deferredViewState) {
      return {
        ...this.deferredViewState,
        ...(this.pinned ? { pinned: true } : {}),
      };
    }
    const view = this.view;
    return {
      type: view.getViewType(),
      state: view.getState(),
      icon: view.getIcon?.() || view.icon || undefined,
      title: view.getDisplayText().trim() || undefined,
      ...(this.pinned ? { pinned: true } : {}),
    };
  }

  getHistoryState(): LeafHistoryState | null {
    if (!this.view) return null;
    return {
      title: this.getDisplayText(),
      icon: this.getIcon(),
      state: this.getViewState(),
      eState: this.view.getEphemeralState(),
    };
  }

  getEphemeralState(): unknown {
    if (this.deferredViewState) return this.deferredEphemeralState;
    return this.view?.getEphemeralState();
  }

  setEphemeralState(state: unknown): void {
    if (isFocusEphemeralState(state) && this.workspace.isLayoutReady()) {
      const doc = this.containerEl.ownerDocument;
      const activeElement = doc.activeElement;
      if (activeElement && activeElement !== doc.body && !this.containerEl.contains(activeElement)) {
        if (activeElement instanceof HTMLElement) activeElement.blur();
        doc.getSelection()?.removeAllRanges();
      }
    }
    if (this.deferredViewState) this.deferredEphemeralState = cloneStatePayload(state);
    this.view.setEphemeralState(state);
  }

  async setViewState(state: ViewState, ephemeralState?: unknown): Promise<void>;
  async setViewState(
    state: InternalViewState,
    ephemeralState?: unknown,
    options?: { popstate?: boolean; history?: boolean; layout?: boolean; defer?: boolean },
  ): Promise<void>;
  async setViewState(
    state: InternalViewState,
    ephemeralState?: unknown,
    options: { popstate?: boolean; history?: boolean; layout?: boolean; defer?: boolean } = {},
  ): Promise<void> {
    if (this.working) return;
    this.working = true;

    try {
      const previousView = this.view;
      const previousType = previousView?.getViewType() ?? "empty";
      const type = state.type ?? "empty";
      const typeChanged = type !== previousType;
      const wasDeferredView = previousView instanceof DeferredView;
      const previousHistoryState = previousView && previousView !== this.emptyView ? this.getHistoryState() : null;
      const result: InternalViewStateResult = { history: false, layout: false, close: false };
      const internalState = state as InternalViewState;

      if (typeChanged || wasDeferredView || this.deferredViewState) {
        const creator = this.app.viewRegistry.getViewCreatorByType(type);
        const canDefer = Boolean(
          creator
          && !previousHistoryState
          && !this.deferredViewState
          && !wasDeferredView
          && Boolean(internalState.icon)
          && internalState.title !== undefined
          && !this.containerEl.isShown()
          && options.defer !== false,
        );
        const nextView = type === "empty"
          ? null
          : canDefer
            ? new DeferredView(this, type, internalState.icon as string, internalState.title as string)
            : creator
              ? creator(this)
              : new UnknownView(this, type);
        await this.openInternal(nextView);
        result.history = true;
        result.layout = true;
      }

      try {
        await this.view.setState(state.state ?? {}, result);
      } catch (error) {
        console.error(error);
      }

      if (result.close) await this.openInternal(null);
      if (state.active === true) this.workspace.setActiveLeaf(this, { focus: true });
      if ("group" in state) {
        const group = state.group;
        if (group instanceof WorkspaceLeaf) this.setGroupMember(group);
        else if (group == null) this.setGroupMember(null);
        else this.setGroup(group, { layout: false });
      }
      if (ephemeralState) this.setEphemeralState(ephemeralState);
      if (
        options.popstate
        || state.popstate === true
        || options.history === false
        || isSyncState(state.state)
        || (wasDeferredView && !typeChanged)
      ) result.history = false;
      if (options.layout === false) result.layout = false;
      else if (options.layout === true) result.layout = true;

      this.updateHeader();
      if (result.history !== false && previousHistoryState) this.recordHistory(previousHistoryState);
      if (result.layout) this.workspace.onLayoutChange(this);
      result.done?.();
    } finally {
      this.working = false;
    }
  }

  private async openEmptyView(): Promise<void> {
    await this.openInternal(null);
  }

  async open(view: View | null): Promise<View> {
    return this.openInternal(view);
  }

  private async openInternal(view: View | null): Promise<View> {
    const previous = this.view;
    if (view === previous) return view;
    if (previous) {
      const closing = previous.close();
      if (shouldAwaitViewClose(previous)) await closing;
    }
    setChildrenInPlace(this.containerEl, [this.resizeHandleEl]);
    const nextView = view ?? this.emptyView;
    this.view = nextView;
    try {
      await nextView.open(this.containerEl);
    } catch (error) {
      console.error("Failed to open view", error);
    }
    return nextView;
  }

  async openFile(
    file: { path: string; basename?: string; extension?: string } | null | undefined,
    openState: OpenViewState = {},
  ): Promise<void> {
    if (!file) return;

    const extension = file.extension ?? file.path.split(".").pop() ?? "";
    const currentType = this.view?.getViewType();
    let type = this.app.viewRegistry.getTypeByExtension(extension);
    if (currentType && this.view instanceof FileView && this.view.canAcceptExtension(extension)) type = currentType;
    if (!type) {
      const opener = this.app as unknown as { openWithDefaultApp?: (path: string) => void | Promise<void> };
      await opener.openWithDefaultApp?.(file.path);
      return;
    }

    const state = openState.state && typeof openState.state === "object" ? openState.state as Record<string, unknown> : {};
    state.file = file.path;

    await this.setViewState(
      {
        type,
        state,
        active: openState.active ?? this.workspace.activeLeaf === this,
        group: openState.group,
      },
      openState.eState,
    );
  }

  async openLinkText(
    linktext: string,
    sourcePath: string,
    openState: OpenViewState = {},
  ): Promise<void> {
    try {
      const parsed = parseLinktext(linktext);
      let file = this.app.metadataCache.getFirstLinkpathDest(parsed.path, sourcePath);
      const state = openState.state && typeof openState.state === "object" ? openState.state as Record<string, unknown> : {};
      const eState = openState.eState && typeof openState.eState === "object" ? openState.eState as Record<string, unknown> : {};

      if (file && parsed.subpath) eState.subpath = parsed.subpath;
      if (!file) {
        const parent = parsed.path.includes("/") ? null : this.app.fileManager.getNewFileParent(sourcePath, linktext);
        file = await this.app.fileManager.createNewFile(parent, parsed.path);
        state.mode = "source";
      }

      openState.state = state;
      openState.eState = eState;
      await this.openFile(file, openState);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      console.error(error);
    }
  }

  setDeferredViewState(state: InternalViewState, ephemeralState?: unknown): void {
    const deferredState = cloneViewState(state);
    this.deferredViewState = null;
    this.deferredEphemeralState = undefined;
    if ("group" in state) this.group = normalizeLeafGroup(state.group);
    if (typeof state.pinned === "boolean") this.pinned = state.pinned;
    const deferredView = new DeferredView(this, deferredState.type, deferredState.icon, deferredState.title);
    void deferredView.setState(deferredState.state ?? {});
    deferredView.setEphemeralState(cloneStatePayload(ephemeralState));
    void this.openInternal(deferredView).then(() => this.updateHeader());
    this.updateHeader();
  }

  async loadIfDeferred(): Promise<void> {
    if (this.view instanceof DeferredView) {
      await this.view.rerender();
      return;
    }
    const state = this.deferredViewState;
    if (!state) return;
    const ephemeralState = this.deferredEphemeralState;
    this.deferredViewState = null;
    this.deferredEphemeralState = undefined;
    await this.setViewState(state, ephemeralState, { history: false, layout: false, defer: false });
  }

  async rebuildView(): Promise<void> {
    const state = this.getViewState();
    const ephemeralState = this.view?.getEphemeralState();
    await this.openEmptyView();
    await this.setViewState(state, ephemeralState, { history: false, layout: false, defer: false });
  }

  canGoBack(): boolean {
    return this.backHistory.length > 0;
  }

  canGoForward(): boolean {
    return this.forwardHistory.length > 0;
  }

  async goBack(): Promise<boolean> {
    return this.goHistory(-1);
  }

  async goForward(): Promise<boolean> {
    return this.goHistory(1);
  }

  async goHistory(delta: number): Promise<boolean> {
    if (!Number.isFinite(delta)) return false;
    let remaining = Math.trunc(delta);
    if (remaining === 0) return false;
    if (this.working) {
      new Notice("Tab is busy");
      return false;
    }

    let next = this.getHistoryState();
    let moved = false;
    while (remaining > 0) {
      const state = this.forwardHistory.pop();
      if (!state) break;
      if (next) this.backHistory.push(next);
      next = state;
      moved = true;
      remaining -= 1;
    }
    while (remaining < 0) {
      const state = this.backHistory.pop();
      if (!state) break;
      if (next) this.forwardHistory.push(next);
      next = state;
      moved = true;
      remaining += 1;
    }
    if (!moved || !next) return moved;
    await this.restoreHistoryState(next);
    return true;
  }

  serializeHistory(): LeafHistorySnapshot {
    return {
      backHistory: this.backHistory.map(cloneHistoryState),
      forwardHistory: this.forwardHistory.map(cloneHistoryState),
    };
  }

  deserializeHistory(snapshot: LeafHistorySnapshot | LeafHistoryState[] | null | undefined): void {
    const backHistory = Array.isArray(snapshot) ? snapshot : snapshot?.backHistory;
    const forwardHistory = Array.isArray(snapshot) ? [] : snapshot?.forwardHistory;
    this.backHistory = (backHistory ?? []).map(cloneHistoryState);
    this.forwardHistory = (forwardHistory ?? []).map(cloneHistoryState);
    this.emitHistoryChange();
  }

  private async restoreHistoryState(historyState: LeafHistoryState): Promise<void> {
    await this.setViewState({ ...historyState.state, active: true }, historyState.eState, { history: false, popstate: true, defer: false });
    this.emitHistoryChange();
  }

  recordHistory(state: LeafHistoryState): void {
    if (!this.view?.navigation || this.view instanceof DeferredView || this.view instanceof EmptyView) return;
    const previous = this.backHistory[this.backHistory.length - 1];
    if (previous && isEquivalentViewState(previous.state, state.state)) return;
    this.backHistory.push(cloneHistoryState(state));
    this.forwardHistory = [];
    this.emitHistoryChange();
  }

  private emitHistoryChange(): void {
    this.trigger("history-change");
    this.workspace.trigger("history-change", this);
  }

  updateHeader(): void {
    const type = this.view?.getViewType() ?? "empty";
    const displayText = this.getDisplayText();
    this.containerEl.dataset.type = type;
    setIcon(this.tabHeaderInnerIconEl, this.getIcon());
    this.tabHeaderInnerTitleEl.textContent = displayText;
    this.tabHeaderEl.dataset.type = type;
    this.tabHeaderEl.title = displayText;
    this.tabHeaderEl.setAttribute("aria-label", displayText);
    this.tabHeaderEl.classList.toggle("is-loading", this.isDeferred);
    this.tabHeaderEl.classList.toggle("mod-unknown", type === "unknown");
    this.updateLinkedTabStatus();
    this.updatePinnedTabStatus();

    this.view?.containerEl.classList.toggle("mod-unknown", type === "unknown");
    if (this.view?.containerEl) this.view.containerEl.dataset.type = type;
    const itemView = this.view as unknown as { updateHeader?: () => void };
    itemView.updateHeader?.();
  }

  private updateLinkedTabStatus(): void {
    if (this.group) {
      let groupEl = this.tabHeaderStatusLinkEl;
      if (!groupEl) {
        groupEl = createDiv("workspace-tab-header-status-icon mod-linked");
        this.tabHeaderStatusContainerEl.prepend(groupEl);
        groupEl.title = "Unlink tab";
        groupEl.setAttribute("aria-label", "Unlink tab");
        groupEl.addEventListener("click", (event) => {
          event.stopPropagation();
          for (const leaf of this.workspace.getGroupLeaves(this.group)) leaf.unhighlight();
          this.setGroup(null);
        });
        groupEl.addEventListener("mouseover", () => {
          setIcon(groupEl, "lucide-unlink");
          for (const leaf of this.workspace.getGroupLeaves(this.group)) leaf.highlight();
        });
        groupEl.addEventListener("mouseout", () => {
          setIcon(groupEl, "lucide-link");
          for (const leaf of this.workspace.getGroupLeaves(this.group)) leaf.unhighlight();
        });
        this.tabHeaderStatusLinkEl = groupEl;
      }
      setIcon(groupEl, "lucide-link");
    } else {
      this.tabHeaderStatusLinkEl?.remove();
      this.tabHeaderStatusLinkEl = null;
    }
  }

  private updatePinnedTabStatus(): void {
    if (this.pinned) {
      let pinnedEl = this.tabHeaderStatusPinEl;
      if (!pinnedEl) {
        pinnedEl = createDiv("workspace-tab-header-status-icon mod-pinned");
        setIcon(pinnedEl, "lucide-pin");
        pinnedEl.title = "Unpin";
        pinnedEl.setAttribute("aria-label", "Unpin");
        pinnedEl.addEventListener("click", (event) => {
          event.stopPropagation();
          this.setPinned(false);
        });
        this.tabHeaderStatusContainerEl.appendChild(pinnedEl);
        this.tabHeaderStatusPinEl = pinnedEl;
      }
      setIcon(pinnedEl, "lucide-pin");
      this.tabHeaderCloseEl.style.display = "none";
    } else {
      this.tabHeaderCloseEl.style.display = "";
      this.tabHeaderStatusPinEl?.remove();
      this.tabHeaderStatusPinEl = null;
    }
  }

  setGroupMember(leaf: WorkspaceLeaf): void;
  setGroupMember(leaf: WorkspaceLeaf | null, options?: { layout?: boolean }): void;
  setGroupMember(leaf: WorkspaceLeaf | null, options: { layout?: boolean } = {}): void {
    if (leaf === this) return;
    if (!leaf) {
      this.setGroup(null, options);
      return;
    }
    if (!leaf.group) leaf.setGroup(createLeafGroupId(), { layout: false });
    this.setGroup(leaf.group, options);
  }

  setGroup(group: string): void;
  setGroup(group: string | WorkspaceLeaf | null, options?: { layout?: boolean }): void;
  setGroup(group: string | WorkspaceLeaf | null, options: { layout?: boolean } = {}): void {
    const nextGroup = normalizeLeafGroup(group);
    if (this.group === nextGroup) return;
    let shouldPin = this.pinned;
    if (nextGroup) {
      this.workspace.iterateAllLeaves((leaf) => {
        if (leaf !== this && leaf.group === nextGroup && leaf.pinned) shouldPin = true;
      });
    }
    const pinnedChanged = shouldPin !== this.pinned;
    this.group = nextGroup;
    this.pinned = shouldPin;
    this.updateHeader();
    this.trigger("group-change", this.group ?? "");
    if (pinnedChanged) {
      this.trigger("pinned-change", this.pinned);
    }
    if (options.layout !== false) this.workspace.requestUpdateLayout();
  }

  setPinned(pinned: boolean): void;
  setPinned(pinned: boolean, options?: { layout?: boolean }): void;
  setPinned(pinned: boolean, options: { layout?: boolean } = {}): void {
    if (this.pinned === pinned) return;
    this.pinned = pinned;
    if (this.group) {
      this.workspace.iterateAllLeaves((leaf) => {
        if (leaf !== this && leaf.group === this.group) leaf.setPinned(pinned, { layout: false });
      });
    }
    this.updateHeader();
    this.trigger("pinned-change", this.pinned);
    if (options.layout !== false) this.workspace.requestSaveLayout();
  }

  canPin(): boolean {
    return this.parent instanceof WorkspaceTabs;
  }

  togglePinned(): void;
  togglePinned(options?: { layout?: boolean }): void;
  togglePinned(options: { layout?: boolean } = {}): void {
    this.setPinned(!this.pinned, options);
  }

  onResize(): void {
    this.view?.onResize();
  }

  private queueResize(): void {
    if (this.resizeTimer) return;
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      this.onResize();
    }, 20);
  }

  highlight(): void {
    this.containerEl.classList.add("is-highlighted");
  }

  unhighlight(): void {
    this.containerEl.classList.remove("is-highlighted");
  }

  detach(): void {
    const parentId = this.parent?.id ?? null;
    const rootId = this.getRoot().id;
    const group = this.group;
    const view = this.view;
    const shouldRemoveTabHeader = !(this.parent instanceof WorkspaceTabs);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    if (group) for (const leaf of this.workspace.getGroupLeaves(group)) leaf.unhighlight();
    if (view) this.workspace.pushUndoHistory(this, parentId, rootId);
    this.view = this.emptyView;
    super.detach();
    if (shouldRemoveTabHeader) this.tabHeaderEl.remove();
    void view?.close();
  }

  handleDrop(_event: DragEvent, source: DragSource, hovering: boolean): DragDropResult {
    if (source.type === "file") {
      if (!hovering) {
        this.workspace.setActiveLeaf(this);
        void this.openFile((source as FileDragSource).file);
      }
      return { action: "Open in this tab", dropEffect: "move" };
    }

    if (source.type === "link") {
      if (!hovering) {
        const link = source as LinkDragSource;
        this.workspace.setActiveLeaf(this);
        void this.openLinkText(link.linktext, link.sourcePath);
      }
      return { action: "Open in this tab", dropEffect: "move" };
    }

    if (source.type === "bookmarks") {
      return this.handleBookmarksDrop(source as BookmarksDragSource, hovering);
    }

    return undefined;
  }

  private handleBookmarksDrop(source: BookmarksDragSource, hovering: boolean): DragDropResult {
    const opener = this.app.internalPlugins.getEnabledPluginById<BookmarkOpener>("bookmarks");
    const openBookmarkInLeaf = opener?.openBookmarkInLeaf ?? opener?.openItemInLeaf;
    if (!openBookmarkInLeaf) return undefined;
    const items = (source.items ?? [])
      .map((entry) => entry.item)
      .filter((item): item is BookmarkDropItem => !!item && (item.type === "file" || item.type === "graph"));
    if (items.length !== 1) return undefined;
    if (!hovering) {
      this.workspace.setActiveLeaf(this);
      void openBookmarkInLeaf.call(opener, items[0], this, { active: true });
    }
    return { action: "Open in this tab", dropEffect: "move" };
  }

  serialize(): Record<string, unknown> {
    return {
      ...super.serialize(),
      state: this.getViewState(),
      ...(this.group ? { group: this.group } : {}),
      ...(this.pinned ? { pinned: this.pinned } : {}),
    };
  }
}

function shouldAwaitViewClose(view: View): boolean {
  return !(view instanceof DeferredView || view instanceof EmptyView);
}

class WorkspaceLeafHistoryController implements WorkspaceLeafHistory {
  constructor(private readonly leaf: WorkspaceLeaf) {}

  get backHistory(): LeafHistoryState[] {
    return this.leaf.backHistory;
  }

  get forwardHistory(): LeafHistoryState[] {
    return this.leaf.forwardHistory;
  }

  back(): Promise<boolean> {
    return this.go(-1);
  }

  forward(): Promise<boolean> {
    return this.go(1);
  }

  async go(delta: number): Promise<boolean> {
    return this.leaf.goHistory(delta);
  }

  pushState(state: LeafHistoryState | InternalViewState | null = null, eState?: unknown): void {
    const historyState = normalizeHistoryPushState(this.leaf, state, eState);
    if (historyState) this.leaf.recordHistory(historyState);
  }

  serialize(): LeafHistorySnapshot {
    return this.leaf.serializeHistory();
  }

  deserialize(snapshot: LeafHistorySnapshot | LeafHistoryState[] | null | undefined): void {
    this.leaf.deserializeHistory(snapshot);
  }
}

function normalizeLeafGroup(group: string | WorkspaceLeaf | null | undefined): string | null {
  if (!group) return null;
  return group instanceof WorkspaceLeaf ? group.group ?? group.id : group;
}

function createLeafGroupId(length = 16): string {
  const id: string[] = [];
  for (let i = 0; i < length; i += 1) id.push(Math.floor(16 * Math.random()).toString(16));
  return id.join("");
}

function normalizeHistoryPushState(leaf: WorkspaceLeaf, state: LeafHistoryState | InternalViewState | null, eState: unknown): LeafHistoryState | null {
  if (!state) return leaf.getHistoryState();
  if ("type" in state) {
    return {
      title: displayTextFromViewState(state),
      icon: state.icon,
      state: cloneViewState(state),
      eState: cloneStatePayload(eState),
    };
  }
  return cloneHistoryState(state);
}

function displayTextFromViewState(state: InternalViewState): string {
  if (state.title?.trim()) return state.title.trim();
  const payload = state.state;
  if (payload && typeof payload === "object" && "file" in payload) {
    const file = (payload as { file?: unknown }).file;
    if (typeof file === "string" && file) return file.split("/").pop()?.replace(/\.[^.]+$/, "") ?? file;
  }
  return state.type === "empty" ? "New tab" : state.type;
}

function isEnteringElement(event: MouseEvent, element: HTMLElement): boolean {
  const relatedTarget = event.relatedTarget;
  return !(relatedTarget instanceof Node) || !element.contains(relatedTarget);
}

function cloneHistoryState(state: LeafHistoryState): LeafHistoryState {
  return {
    title: state.title,
    icon: state.icon,
    state: cloneViewState(state.state),
    eState: cloneStatePayload(state.eState),
  };
}

function cloneViewState(state: InternalViewState): InternalViewState {
  return {
    type: state.type,
    state: cloneStatePayload(state.state),
    active: state.active,
    group: state.group,
    pinned: state.pinned,
    icon: state.icon,
    title: state.title,
  };
}

function cloneStatePayload<T>(state: T): T {
  if (state == null || typeof state !== "object") return state;
  try {
    return structuredClone(state);
  } catch {
    return { ...(state as Record<string, unknown>) } as T;
  }
}

function isEquivalentViewState(a: InternalViewState, b: InternalViewState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isSyncState(state: unknown): boolean {
  return !!state && typeof state === "object" && (state as { sync?: unknown }).sync === true;
}

function mergeEphemeralState(primary: unknown, secondary: unknown): unknown {
  if (primary === undefined) return secondary;
  if (secondary === undefined) return primary;
  if (isPlainObject(primary) && isPlainObject(secondary)) return { ...primary, ...secondary };
  return secondary;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFocusEphemeralState(state: unknown): boolean {
  return !!state && typeof state === "object" && (state as { focus?: unknown }).focus === true;
}
