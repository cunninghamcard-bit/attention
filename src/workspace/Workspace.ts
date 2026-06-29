import { Events, type EventRef } from "../core/Events";
import type { App } from "../app/App";
import type { Debouncer } from "../api/ApiUtils";
import type { Tasks } from "../app/QuitEvent";
import { WorkspaceSplit, type SplitDirection } from "./WorkspaceSplit";
import { WorkspaceRoot } from "./WorkspaceRoot";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { WorkspaceLeaf, type LeafHistorySnapshot } from "./WorkspaceLeaf";
import { WorkspaceSidedock } from "./WorkspaceSidedock";
import { WorkspaceFloating } from "./WorkspaceFloating";
import { WorkspaceWindow } from "./WorkspaceWindow";
import { MobileDrawer } from "../mobile/MobileDrawer";
import { WorkspaceRibbon } from "./WorkspaceRibbon";
import { WorkspaceDragManager, type WorkspaceDropTarget } from "./WorkspaceDragManager";
import { WorkspaceParent } from "./WorkspaceParent";
import { HoverLinkSourceRegistry, type HoverLinkSource, type HoverLinkSourceConfig } from "./WorkspaceHover";
import { WorkspaceLayoutSerializer } from "./WorkspaceLayoutSerializer";
import { RecentFileTracker, type RecentFilesOptions } from "./RecentFileTracker";
import type { Editor } from "../editor/Editor";
import type { MarkdownFileInfo } from "../editor/EditorStateField";
import { EditorSuggestManager } from "../suggest/EditorSuggest";
import { TFile, type TAbstractFile } from "../vault/TAbstractFile";
import { EditorExtensionHost } from "../editor/EditorExtension";
import { DynamicScope } from "../hotkeys/Scope";
import { getActiveDocument, getActiveWindow, setActiveWindow } from "../dom/ActiveDocument";
import { setChildrenInPlace } from "../dom/dom";
import { WorkspaceItem } from "./WorkspaceItem";
import type { WorkspaceLayout, WorkspaceLayoutNode } from "./WorkspaceLayout";
import { normalizeViewStatePayload, type InternalViewState } from "../views/View";
import { Platform } from "../platform/Platform";
import { ItemView } from "../views/ItemView";
import { FileView } from "../views/FileView";
import { MarkdownView } from "../views/MarkdownView";
import { DeferredView } from "../views/DeferredView";
import { parseObsidianUri, toObsidianProtocolData, type ObsidianProtocolData, type ObsidianProtocolHandler, type UriHandler } from "../protocol/UriRouter";
import type { Menu } from "../ui/Menu";
import { setIcon } from "../ui/Icon";
import { Notice } from "../ui/Notice";

interface WorkspaceActiveEditor extends MarkdownFileInfo {
  editor: Editor;
  file: TFile | null;
  leaf: WorkspaceLeaf;
}

export type PaneType = "tab" | "split" | "window";
export type LeafOpenMode = boolean | "tab" | "split" | "window";
type WorkspaceSidePane = WorkspaceSidedock | MobileDrawer;

export interface OpenViewState {
  active?: boolean;
  state?: Record<string, unknown>;
  eState?: Record<string, unknown>;
  group?: WorkspaceLeaf;
}

type WorkspaceOpenState = Omit<OpenViewState, "state" | "eState" | "group"> & {
  state?: unknown;
  eState?: unknown;
  group?: string | WorkspaceLeaf | null;
  mode?: LeafOpenMode;
  pinned?: boolean;
};

type WorkspaceActiveTabGroup = WorkspaceTabs | MobileDrawer;

function getWorkspaceActiveTabGroup(item: WorkspaceItem | null | undefined): WorkspaceActiveTabGroup | null {
  return item instanceof WorkspaceTabs || item instanceof MobileDrawer ? item : null;
}

interface LayoutReadyCallbackRecord {
  pluginId: string | null;
  callback: () => any;
}

export interface WorkspaceWindowInitData {
  id?: string;
  direction?: SplitDirection;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  maximize?: boolean;
  zoom?: number;
  size?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
}

export interface WorkspaceUndoHistoryEntry {
  leafId: string;
  parentId: string | null;
  rootId: string;
  state: InternalViewState;
  eState?: unknown;
  leafHistory?: LeafHistorySnapshot;
}

export interface OperatorFuncConfig {
  funcName: string;
  display: string;
  inverseDisplay: string;
}

interface UriHookWindow extends Window {
  OBS_ACT?: ObsidianProtocolData | ((data: ObsidianProtocolData) => void) | null;
  Capacitor?: { Plugins?: { App?: AppUrlOpenBridge } };
  electron?: AppUrlOpenBridge;
}

interface AppUrlOpenBridge {
  addListener?: (
    name: "appUrlOpen",
    callback: (event: { url?: string } | string) => void,
  ) => { remove?: () => void } | Promise<{ remove?: () => void }>;
}

function getAppUrlOpenBridge(win: UriHookWindow): AppUrlOpenBridge | undefined {
  return win.Capacitor?.Plugins?.App ?? win.electron;
}

function isPromiseLike<T>(value: T | Promise<T> | undefined): value is Promise<T> {
  return Boolean(value && typeof (value as Promise<T>).then === "function");
}

export class Workspace extends Events {
  readonly containerEl: HTMLElement;
  readonly leftSidebarToggleButtonEl: HTMLElement;
  readonly rightSidebarToggleButtonEl: HTMLElement;
  readonly leftRibbon: WorkspaceRibbon;
  readonly rightRibbon: WorkspaceRibbon;
  readonly rootSplit: WorkspaceRoot;
  readonly leftSplit: WorkspaceSidePane;
  readonly rightSplit: WorkspaceSidePane;
  readonly floatingSplit: WorkspaceFloating;
  readonly dragManager = new WorkspaceDragManager();
  readonly hoverLinkSources = new HoverLinkSourceRegistry();
  readonly editorSuggest = new EditorSuggestManager();
  readonly operatorFuncConfigs: Record<string, OperatorFuncConfig[]> = Object.create(null);
  activeLeaf: WorkspaceLeaf | null = null;
  activeTabGroup: WorkspaceActiveTabGroup | null = null;
  lastTabGroupStacked = false;
  readonly scope: DynamicScope;
  private _activeEditor: MarkdownFileInfo | null = null;
  readonly recentFileTracker: RecentFileTracker;
  editorExtensions: unknown[] = [];
  readonly undoHistory: WorkspaceUndoHistoryEntry[] = [];
  readonly editorExtensionHost = new EditorExtensionHost();
  readonly layoutItemQueue: WorkspaceItem[] = [];
  private lastActiveFile: TFile | null = null;
  private protocolHandlers = new Map<string, Map<ObsidianProtocolHandler, UriHandler>>();
  private uriHookRegistered = false;
  private appUrlOpenListener: { remove?: () => void } | null = null;
  private _layoutReady = false;
  private onLayoutReadyCallbacks: LayoutReadyCallbackRecord[] | null = [];
  private layoutReadyCallbacksPromise: Promise<void> = Promise.resolve();
  readonly requestUpdateLayout = createMicrotaskWorkspaceRequest(() => this.updateLayout());
  readonly requestResize = createDebouncedWorkspaceRequest(async () => {
    this.trigger("resize");
  }, () => true, 0);
  readonly requestActiveLeafEvents = createDebouncedWorkspaceRequest(async () => {
    this.activeLeafEvents();
  }, () => true, 0);
  readonly requestSaveLayout = createDebouncedWorkspaceRequest(async () => {
    await this.saveLayout();
  }, () => this.layoutReady && Boolean(this.app.workspaceLayouts), 1000);
  readonly requestLayoutChangeEvents = createDebouncedWorkspaceRequest(async () => {
    if (this.layoutReady) this.trigger("layout-change");
  }, () => true, 10);

  override on(name: "quick-preview", callback: (file: TFile, data: string) => any, ctx?: any): EventRef;
  override on(name: "resize", callback: () => any, ctx?: any): EventRef;
  override on(name: "active-leaf-change", callback: (leaf: WorkspaceLeaf | null) => any, ctx?: any): EventRef;
  override on(name: "file-open", callback: (file: TFile | null) => any, ctx?: any): EventRef;
  override on(name: "layout-ready", callback: () => any, ctx?: any): EventRef;
  override on(name: "layout-change", callback: () => any, ctx?: any): EventRef;
  override on(name: "window-frame-change", callback: () => any, ctx?: any): EventRef;
  override on(name: "window-open", callback: (win: WorkspaceWindow, window: Window) => any, ctx?: any): EventRef;
  override on(name: "window-close", callback: (win: WorkspaceWindow, window: Window) => any, ctx?: any): EventRef;
  override on(name: "css-change", callback: () => any, ctx?: any): EventRef;
  override on(name: "post-processor-change", callback: () => any, ctx?: any): EventRef;
  override on(name: "file-menu", callback: (menu: Menu, file: TAbstractFile, source: string, leaf?: WorkspaceLeaf) => any, ctx?: any): EventRef;
  override on(name: "files-menu", callback: (menu: Menu, files: TAbstractFile[], source: string, leaf?: WorkspaceLeaf) => any, ctx?: any): EventRef;
  override on(name: "url-menu", callback: (menu: Menu, url: string) => any, ctx?: any): EventRef;
  override on(name: "link-menu", callback: (menu: Menu, linktext: string, sourcePath: string, source: string) => any, ctx?: any): EventRef;
  override on(name: "leaf-menu", callback: (menu: Menu, leaf: WorkspaceLeaf) => any, ctx?: any): EventRef;
  override on(name: "tab-group-menu", callback: (menu: Menu, tabs: WorkspaceTabs) => any, ctx?: any): EventRef;
  override on(name: "hover-link", callback: (event: unknown) => any, ctx?: any): EventRef;
  override on(name: "editor-menu", callback: (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => any, ctx?: any): EventRef;
  override on(name: "editor-change", callback: (editor: Editor, info: MarkdownView | MarkdownFileInfo) => any, ctx?: any): EventRef;
  override on(name: "editor-selection-change", callback: (editor: Editor, info: MarkdownView | MarkdownFileInfo) => any, ctx?: any): EventRef;
  override on(name: "editor-paste", callback: (evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => any, ctx?: any): EventRef;
  override on(name: "editor-drop", callback: (evt: DragEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => any, ctx?: any): EventRef;
  override on(name: "markdown-scroll", callback: (view: MarkdownView) => any, ctx?: any): EventRef;
  override on(name: "markdown-properties-menu", callback: (menu: Menu, file: TFile | null) => any, ctx?: any): EventRef;
  override on(name: "markdown-viewport-menu", callback: (menu: Menu, view: MarkdownView, mode: "source" | "preview", source: string) => any, ctx?: any): EventRef;
  override on(name: "receive-text-menu", callback: (menu: Menu, text: string) => any, ctx?: any): EventRef;
  override on(name: "receive-files-menu", callback: (menu: Menu, files: File[]) => any, ctx?: any): EventRef;
  override on(name: "quit", callback: (tasks: Tasks) => any, ctx?: any): EventRef;
  override on<TArgs extends unknown[]>(name: string, callback: (...args: TArgs) => any, ctx?: object): EventRef<TArgs>;
  override on<TArgs extends unknown[]>(name: string, callback: (...args: TArgs) => any, ctx?: object): EventRef<TArgs> {
    return super.on(name, callback, ctx);
  }

  get activeEditor(): MarkdownFileInfo | null {
    if (this._activeEditor) return this._activeEditor;
    const view = this.getActiveViewOfType(MarkdownView);
    return this.isActiveEditorView(view) ? view : null;
  }

  set activeEditor(activeEditor: MarkdownFileInfo | null) {
    if (this.isActiveEditorView(activeEditor) && (activeEditor as unknown) === activeEditor.leaf.view) return;
    this._activeEditor = activeEditor;
  }

  get layoutReady(): boolean {
    return this._layoutReady;
  }

  set layoutReady(value: boolean) {
    this._layoutReady = value;
  }

  constructor(readonly app: App, parent: HTMLElement) {
    super();
    const mobile = isMobileRuntime();
    this.scope = new DynamicScope(this.app.scope, () => this.activeLeaf?.view?.scope ?? null);
    this.app.keymap.pushScope(this.scope);
    this.containerEl = parent;
    this.recentFileTracker = new RecentFileTracker(this, this.app.vault);
    this.containerEl.classList.add("workspace");
    this.containerEl.replaceChildren();
    const ownerDocument = this.containerEl.ownerDocument;
    this.leftSidebarToggleButtonEl = this.createSidebarToggleButton("left", ownerDocument);
    this.rightSidebarToggleButtonEl = this.createSidebarToggleButton("right", ownerDocument);
    this.leftRibbon = new WorkspaceRibbon(this, "left");
    this.leftSplit = mobile ? new MobileDrawer(this, "left") : new WorkspaceSidedock(this, "left", ownerDocument);
    this.rootSplit = new WorkspaceRoot(this, undefined, ownerDocument);
    this.rightSplit = mobile ? new MobileDrawer(this, "right") : new WorkspaceSidedock(this, "right", ownerDocument);
    this.rightRibbon = new WorkspaceRibbon(this, "right");
    if (this.rightSplit instanceof WorkspaceSidedock) this.rightSplit.updateEmptyState();
    this.leftRibbon.addRibbonSettingButton("app:open-settings", "lucide-settings", "Open settings", () => this.app.setting.open());
    this.floatingSplit = new WorkspaceFloating(this, undefined, ownerDocument);
    this.app.viewRegistry.on<[string]>("view-registered", (type) => this.rebuildLeavesOfType(type));
    this.app.viewRegistry.on<[string]>("view-unregistered", (type) => this.rebuildLeavesOfType(type));
    this.app.vault.on<[TFile, string]>("rename", (file, oldPath) => this.onFileRename(file, oldPath));
    window.addEventListener("focus", () => {
      setActiveWindow(window);
      this.rootSplit.onFocus();
    });
    this.installBrowserHistoryNavigation(ownerDocument.defaultView ?? window);
    this.registerClipboardEvents(window);

    if (mobile) {
      this.leftRibbon.containerEl.remove();
      this.rightRibbon.containerEl.remove();
      this.containerEl.append(
        this.leftSplit.containerEl,
        this.rootSplit.containerEl,
        this.rightSplit.containerEl,
      );
    } else {
      this.containerEl.append(
        this.leftRibbon.containerEl,
        this.leftSplit.containerEl,
        this.rootSplit.containerEl,
        this.rightSplit.containerEl,
        this.rightRibbon.containerEl,
      );
    }

    this.rightSplit.collapse();
    this.createDefaultMainLayout();
    this.updateSidebarTogglePlacement();
  }

  private createSidebarToggleButton(side: "left" | "right", ownerDocument: Document): HTMLElement {
    const buttonEl = ownerDocument.createElement("div");
    buttonEl.className = `sidebar-toggle-button mod-${side}`;
    buttonEl.title = side === "left" ? "Toggle left sidebar" : "Toggle right sidebar";
    buttonEl.setAttribute("aria-label", buttonEl.title);
    const iconEl = ownerDocument.createElement("div");
    iconEl.className = "clickable-icon";
    setIcon(iconEl, "sidebar-toggle-button-icon");
    buttonEl.appendChild(iconEl);
    buttonEl.addEventListener("click", () => {
      const dock = side === "left" ? this.leftSplit : this.rightSplit;
      const sidedock = dock as { collapsed?: boolean; collapse?: () => void; expand?: () => void };
      if (sidedock.collapsed) sidedock.expand?.();
      else sidedock.collapse?.();
    });
    return buttonEl;
  }

  private createDefaultMainLayout(): WorkspaceLeaf {
    this.clearChildren(this.rootSplit);
    const ownerDocument = this.rootSplit.containerEl.ownerDocument;
    const tabs = new WorkspaceTabs(this, undefined, ownerDocument);
    const leaf = new WorkspaceLeaf(this, undefined, ownerDocument);
    tabs.appendChild(leaf, false);
    this.rootSplit.appendChild(tabs);
    tabs.selectTabIndex(0, false);
    this.setActiveLeaf(leaf);
    return leaf;
  }

  private registerClipboardEvents(win: Window): void {
    win.addEventListener("copy", (event) => {
      if (event.defaultPrevented || !event.isTrusted) return;
      const activeDocument = getActiveDocument();
      const activeElement = activeDocument.activeElement;
      if (this.activeLeaf && !isInputLike(activeElement)) this.activeLeaf.view?.handleCopy(event);
      if (event.defaultPrevented || activeElement === activeDocument.body) return;
      activeElement?.dispatchEvent(createClipboardEvent(activeDocument, "copy"));
    });
    win.addEventListener("paste", (event) => {
      if (event.defaultPrevented || !this.activeLeaf || isInputLike(getActiveDocument().activeElement)) return;
      this.activeLeaf.view?.handlePaste(event);
    });
    win.addEventListener("cut", (event) => {
      if (event.defaultPrevented || !this.activeLeaf || isInputLike(getActiveDocument().activeElement)) return;
      this.activeLeaf.view?.handleCut(event);
    });
  }

  getSideLeaf(sideSplit: WorkspaceSidePane, split?: boolean): WorkspaceLeaf {
    const ownerDocument = sideSplit.containerEl.ownerDocument;
    if (sideSplit instanceof MobileDrawer) {
      const leaf = new WorkspaceLeaf(this, undefined, ownerDocument);
      sideSplit.appendChild(leaf, false);
      sideSplit.expand();
      return leaf;
    }

    if (split || sideSplit.children.length === 0 || !(sideSplit.children[0] instanceof WorkspaceTabs)) {
      const tabs = new WorkspaceTabs(this, undefined, ownerDocument);
      const leaf = new WorkspaceLeaf(this, undefined, ownerDocument);
      tabs.appendChild(leaf, false);
      sideSplit.appendChild(tabs);
      return leaf;
    }

    const tabs = sideSplit.children[0] as WorkspaceTabs;
    const leaf = new WorkspaceLeaf(this, undefined, ownerDocument);
    tabs.appendChild(leaf, false);
    return leaf;
  }

  getLeftLeaf(split?: boolean): WorkspaceLeaf | null {
    return this.getSideLeaf(this.leftSplit, split);
  }

  getRightLeaf(split?: boolean): WorkspaceLeaf | null {
    return this.getSideLeaf(this.rightSplit, split);
  }

  async ensureSideLeaf(
    type: string,
    side: "left" | "right",
    options: { active?: boolean; split?: boolean; reveal?: boolean; state?: unknown } = {},
  ): Promise<WorkspaceLeaf> {
    const leaf = this.getLeavesOfType(type)[0]
      ?? (side === "left" ? this.getLeftLeaf(options.split)! : this.getRightLeaf(options.split)!);
    const reveal = options.reveal ?? true;
    if (options.active || reveal) await leaf.loadIfDeferred();
    const shouldSetViewState = options.state !== undefined || leaf.view?.getViewType() !== type;
    if (shouldSetViewState) {
      await leaf.setViewState({ type, state: normalizeViewStatePayload(options.state), active: options.active === true });
    }
    if (reveal) await this.revealLeaf(leaf);
    if (options.active) this.setActiveLeaf(leaf);
    return leaf;
  }

  async openLinkText(linktext: string, sourcePath: string, paneType?: LeafOpenMode, openState?: OpenViewState): Promise<void> {
    await this.getLeaf(paneType).openLinkText(linktext, sourcePath, openState);
  }

  handleLinkContextMenu(menu: Menu, linktext: string, sourcePath: string, leaf?: WorkspaceLeaf): boolean {
    if (!linktext.trim()) return false;
    const file = this.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
    if (file) {
      menu.addItem((item) => item
        .setTitle("Open in new tab")
        .setIcon("lucide-file-plus")
        .setSection("open")
        .onClick(() => {
          void this.getLeaf("tab").openFile(file, { active: true });
        }));
      menu.addItem((item) => item
        .setTitle("Open to the right")
        .setIcon("lucide-separator-vertical")
        .setSection("open")
        .onClick(() => {
          void this.getLeaf("split").openFile(file, { active: true });
        }));
      menu.addItem((item) => item
        .setTitle("Rename")
        .setIcon("lucide-edit-3")
        .setSection("action")
        .onClick(() => {
          void this.app.fileManager.promptForFileRename(file);
        }));
      this.trigger("file-menu", menu, file, "link-context-menu", leaf ?? this.getLeaf(false));
      return true;
    }

    menu.addItem((item) => item
      .setTitle("Create file")
      .setIcon("lucide-file-plus")
      .setSection("open")
      .onClick(() => {
        void this.openLinkText(linktext, sourcePath, false, { active: true });
      }));
    return true;
  }

  handleExternalLinkContextMenu(menu: Menu, url: string): void {
    menu.addItem((item) => item
      .setTitle("Open link")
      .setIcon("lucide-external-link")
      .setSection("open")
      .onClick(() => {
        window.open(url, "_blank");
      }));
    menu.addItem((item) => item
      .setTitle("Copy URL")
      .setIcon("lucide-copy")
      .setSection("info")
      .onClick(() => {
        void navigator.clipboard?.writeText?.(url);
      }));
    this.trigger("url-menu", menu, url);
  }

  async openFile(file: TFile, openState?: WorkspaceOpenState): Promise<WorkspaceLeaf> {
    const leaf = this.getLeafForFile(file.path) ?? this.getLeafForOpenState(openState);
    await leaf.openFile(file, openState as OpenViewState);
    if (openState?.active !== false) await this.revealLeaf(leaf);
    return leaf;
  }

  private getLeafForOpenState(openState?: WorkspaceOpenState): WorkspaceLeaf {
    if (openState?.active !== false) return this.getLeaf(openState?.mode);
    const parentTabs = this.getTabContext();
    if (parentTabs instanceof WorkspaceTabs) {
      const leaf = new WorkspaceLeaf(this, undefined, parentTabs.containerEl.ownerDocument);
      parentTabs.appendChild(leaf, false);
      return leaf;
    }
    const ownerDocument = this.rootSplit.containerEl.ownerDocument;
    const leaf = new WorkspaceLeaf(this, undefined, ownerDocument);
    const tabs = new WorkspaceTabs(this, undefined, ownerDocument);
    tabs.appendChild(leaf, false);
    this.rootSplit.appendChild(tabs);
    return leaf;
  }

  getActiveFile(): TFile | null {
    const activeFile = this.activeEditor?.file;
    if (activeFile) return activeFile;
    return this.getActiveFileView()?.file ?? null;
  }

  getAdjacentLeafInDirection(leaf: WorkspaceLeaf | null | undefined, direction: "top" | "bottom" | "left" | "right"): WorkspaceLeaf | null {
    if (!leaf) return null;
    const sourceRect = getLeafRect(leaf);
    if (!sourceRect) return null;
    const sourceCenter = getRectCenter(sourceRect);
    let bestLeaf: WorkspaceLeaf | null = null;
    let bestScore: [number, number, number] | null = null;

    this.iterateAllLeaves((candidate) => {
      if (candidate === leaf) return;
      const candidateRect = getLeafRect(candidate);
      if (!candidateRect) return;
      const candidateCenter = getRectCenter(candidateRect);
      const score = getDirectionalLeafScore(sourceRect, sourceCenter, candidateRect, candidateCenter, direction);
      if (!score) return;
      if (!bestScore || compareDirectionalScore(score, bestScore) < 0) {
        bestLeaf = candidate;
        bestScore = score;
      }
    });

    return bestLeaf;
  }

  splitActiveLeaf(direction: SplitDirection = "vertical", id?: string): WorkspaceLeaf {
    const leaf = this.getMostRecentLeaf();
    return leaf ? this.createLeafBySplit(leaf, direction, false, id) : this.createLeafInRootSplit(direction, id);
  }

  splitLeafOrActive(leaf: WorkspaceLeaf | null = this.activeLeaf, direction: SplitDirection = "vertical", id?: string): WorkspaceLeaf {
    return leaf ? this.createLeafBySplit(leaf, direction, false, id) : this.splitActiveLeaf(direction, id);
  }

  getGroupLeaves(group: string): WorkspaceLeaf[] {
    if (!group) return [];
    const leaves: WorkspaceLeaf[] = [];
    this.iterateAllLeaves((leaf) => {
      if (leaf.group === group) leaves.push(leaf);
    });
    return leaves;
  }

  getLeafForFile(path: string): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;
    this.iterateAllLeaves((leaf) => {
      const view = leaf.view as ({ file?: { path: string } | null } | null);
      if (!found && view?.file?.path === path) found = leaf;
    });
    return found;
  }

  async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
    const root = leaf.getRoot();
    if (root === this.leftSplit) this.leftSplit.expand();
    if (root === this.rightSplit) this.rightSplit.expand();
    if (leaf.parent instanceof MobileDrawer) {
      const index = leaf.parent.children.indexOf(leaf);
      if (index !== -1) leaf.parent.selectTabIndex(index);
      leaf.parent.expand();
      const otherSide = leaf.parent === this.leftSplit ? this.rightSplit : this.leftSplit;
      if (otherSide instanceof MobileDrawer) otherSide.collapse();
    }
    if (leaf.parent instanceof WorkspaceTabs) {
      const index = leaf.parent.children.indexOf(leaf);
      if (index !== -1) leaf.parent.selectTabIndex(index, false);
    }
    leaf.containerEl.focus({ preventScroll: true });
    await leaf.loadIfDeferred();
    this.trigger("leaf-revealed", leaf);
  }

  getLeaf(mode?: LeafOpenMode, direction?: SplitDirection): WorkspaceLeaf {
    if (mode === "split") return this.splitActiveLeaf(direction);
    if (mode === "tab" || mode === true) return this.createLeafInTabGroup();
    if (mode === "window") return this.openPopoutLeaf();
    return this.getUnpinnedLeaf();
  }

  getUnpinnedLeaf(active = true): WorkspaceLeaf {
    if (this.activeLeaf?.canNavigate()) return this.activeLeaf;

    const activeContainer = this.activeLeaf?.getContainer();
    const container = activeContainer instanceof WorkspaceParent ? activeContainer : this.rootSplit;
    let selectedLeaf: WorkspaceLeaf | null = null;
    let selectedTime = -Infinity;

    container.iterateLeaves((leaf) => {
      const parent = leaf.parent;
      const isCurrentTab = parent instanceof WorkspaceTabs && parent.children[parent.currentTab] === leaf;
      const isStackedTab = parent instanceof WorkspaceTabs && parent.isStacked;

      if (!leaf.canNavigate() || (!isCurrentTab && !isStackedTab)) return;

      if (!selectedLeaf || leaf.activeTime > selectedTime) {
        selectedLeaf = leaf;
        selectedTime = leaf.activeTime;
      }
    });

    if (!selectedLeaf) {
      const recentLeaf = this.getMostRecentLeaf(container);
      const parent = recentLeaf?.parent ?? container;
      selectedLeaf = this.createLeafInWorkspaceParent(parent);
    }

    if (active) this.setActiveLeaf(selectedLeaf);
    return selectedLeaf;
  }

  createNewTab(): WorkspaceLeaf | null {
    const leaf = this.getMostRecentLeaf();
    if (!(leaf?.parent instanceof WorkspaceTabs)) return null;
    const nextLeaf = new WorkspaceLeaf(this, undefined, leaf.parent.containerEl.ownerDocument);
    leaf.parent.appendChild(nextLeaf);
    leaf.parent.selectTabIndex(leaf.parent.children.length - 1);
    this.setActiveLeaf(nextLeaf, { focus: true });
    return nextLeaf;
  }

  async openActiveLeafInNewWindow(): Promise<WorkspaceLeaf | null> {
    const sourceLeaf = this.activeLeaf;
    if (!this.canPopoutLeaf(sourceLeaf)) return null;
    const targetLeaf = this.openPopoutLeaf();
    await targetLeaf.setViewState(sourceLeaf.getViewState(), { focus: true });
    this.setActiveLeaf(targetLeaf, { focus: true });
    return targetLeaf;
  }

  moveActiveLeafToNewWindow(): WorkspaceWindow | null {
    const leaf = this.activeLeaf;
    if (!this.canPopoutLeaf(leaf)) return null;
    return this.moveLeafToPopout(leaf) ?? null;
  }

  getLayout(): WorkspaceLayout {
    return new WorkspaceLayoutSerializer().serialize(this);
  }

  async readWorkspaceFile(): Promise<WorkspaceLayout> {
    return (await this.app.workspaceLayouts.readWorkspaceFile()) ?? {};
  }

  iterateCodeMirrors(callback: (codeMirror: unknown) => unknown): void {
    void callback;
  }

  async saveLayout(): Promise<WorkspaceLayout | undefined> {
    if (!this.layoutReady) return undefined;
    return this.app.workspaceLayouts.saveCurrentLayout();
  }

  async loadLayout(): Promise<WorkspaceLayout | null> {
    const layout = await this.app.workspaceLayouts.restoreSavedLayout();
    if (!this.layoutReady) this.markLayoutReady();
    return layout;
  }

  async clearLayout(): Promise<void> {
    this.layoutReady = false;
    this.requestLayoutChangeEvents.cancel();

    const leaves: WorkspaceLeaf[] = [];
    this.iterateAllLeaves((leaf) => {
      leaves.push(leaf);
    });
    await Promise.all(leaves.map((leaf) => leaf.open(null)));

    for (const child of [...this.floatingSplit.children]) {
      if (child instanceof WorkspaceWindow) child.close();
    }

    this.activeLeaf?.containerEl.classList.remove("mod-active");
    this.activeLeaf?.tabHeaderEl.classList.remove("mod-active");
    this.activeTabGroup?.containerEl.classList.remove("mod-active");
    this.activeLeaf = null;
    this.activeTabGroup = null;
    this._activeEditor = null;

    this.clearChildren(this.leftSplit, { detach: false });
    this.clearChildren(this.rootSplit, { detach: false });
    this.clearChildren(this.rightSplit, { detach: false });
    this.clearChildren(this.floatingSplit, { detach: false });
    this.floatingSplit.closePopout();
    this.layoutItemQueue.length = 0;
  }

  async changeLayout(layout: WorkspaceLayout): Promise<void> {
    if (!this.layoutReady) return;
    await this.clearLayout();
    await this.setLayout(layout);
  }

  async setLayout(layout: WorkspaceLayout): Promise<void> {
    this.layoutReady = false;
    if (Object.prototype.hasOwnProperty.call(layout, "lastOpenFiles")) this.recentFileTracker.load(layout.lastOpenFiles);
    if (layout.main) await this.replaceSplitFromLayout(this.rootSplit, layout.main);
    else {
      const leaf = this.createDefaultMainLayout();
      const recentPath = this.recentFilePaths[0];
      const recentFile = recentPath ? this.app.vault.getFileByPath(recentPath) : null;
      if (recentFile) await leaf.openFile(recentFile);
    }

    if (layout.left) await this.replaceSplitFromLayout(this.leftSplit, layout.left, "left");
    else {
      this.clearChildren(this.leftSplit);
      this.leftSplit.collapse();
    }

    if (layout.right) await this.replaceSplitFromLayout(this.rightSplit, layout.right, "right");
    else {
      this.clearChildren(this.rightSplit);
      this.rightSplit.collapse();
    }

    await this.replaceSplitFromLayout(this.floatingSplit, layout.floating);
    if (layout["left-ribbon"]) this.leftRibbon.load(layout["left-ribbon"]);

    const activeId = layout.active ?? layout.activeLeafId;
    const activeLeaf = activeId ? this.getLeafById(activeId) : this.getMostRecentLeaf();
    if (activeLeaf) this.setActiveLeaf(activeLeaf);
    await Promise.all(this.getVisibleLeaves().map((leaf) => leaf.loadIfDeferred()));
    this.markLayoutReady();
    this.onLayoutChange();
  }

  getLeafById(id: string | undefined): WorkspaceLeaf | null {
    if (!id) return null;
    let found: WorkspaceLeaf | null = null;
    this.iterateAllLeaves((leaf) => {
      if (leaf.id === id) found = leaf;
    });
    return found;
  }

  private async replaceSplitFromLayout(split: WorkspaceSplit | MobileDrawer, node?: WorkspaceLayoutNode, side?: "left" | "right"): Promise<void> {
    this.clearChildren(split);
    if (!node) return;

    if (node.type === "mobile-drawer") {
      await this.deserializeLayoutNode(node, side);
      return;
    }

    if (node.type === "floating") {
      split.id = node.id;
      if (node.dimension !== undefined) split.setDimension(node.dimension);
      for (const child of node.children) {
        if (child.type !== "window") continue;
        const item = await this.deserializeLayoutNode(child, side);
        if (item instanceof WorkspaceWindow && item.parent !== split) split.appendChild(item);
      }
      return;
    }

    if (node.type === "split") {
      if (!(split instanceof WorkspaceSplit)) return;
      split.id = node.id;
      split.setDirection(node.direction);
      if (node.dimension !== undefined) split.setDimension(node.dimension);
      for (const child of node.children) {
        const item = await this.deserializeLayoutNode(child, undefined, split.containerEl.ownerDocument);
        if (item instanceof WorkspaceLeaf) {
          const tabs = new WorkspaceTabs(this, undefined, split.containerEl.ownerDocument);
          tabs.appendChild(item, false);
          split.appendChild(tabs);
        } else if (item) {
          split.appendChild(item);
        }
      }
      if (split instanceof WorkspaceSidedock) {
        if (node.width !== undefined) split.setSize(node.width);
        if (node.collapsed) split.collapse();
        else split.expand();
      }
      return;
    }

    const item = await this.deserializeLayoutNode(node, side, split.containerEl.ownerDocument);
    if (item instanceof WorkspaceLeaf) {
      if (split instanceof MobileDrawer) {
        split.appendChild(item, false);
      } else {
        const tabs = new WorkspaceTabs(this, undefined, split.containerEl.ownerDocument);
        tabs.appendChild(item, false);
        split.appendChild(tabs);
      }
    } else if (item) {
      split.appendChild(item);
    }
  }

  private async deserializeLayoutNode(
    node: WorkspaceLayoutNode,
    side?: "left" | "right",
    ownerDocument: Document = this.rootSplit.containerEl.ownerDocument,
  ): Promise<WorkspaceItem | null> {
    if (node.type === "leaf") {
      const leaf = new WorkspaceLeaf(this, node.id, ownerDocument);
      if (node.dimension !== undefined) leaf.setDimension(node.dimension);
      leaf.group = node.group ?? null;
      leaf.pinned = node.pinned ?? false;
      leaf.setDeferredViewState({ ...(node.state ?? { type: "empty" }), active: false } as InternalViewState);
      return leaf;
    }

    if (node.type === "tabs") {
      const tabs = new WorkspaceTabs(this, node.id, ownerDocument);
      if (node.dimension !== undefined) tabs.setDimension(node.dimension);
      tabs.setStacked(node.stacked ?? false, false);
      for (const child of node.children) {
        const item = await this.deserializeLayoutNode(child, side, ownerDocument);
        if (item instanceof WorkspaceLeaf) tabs.appendChild(item, false);
      }
      if (tabs.children.length === 0) tabs.appendChild(new WorkspaceLeaf(this, undefined, ownerDocument), false);
      tabs.selectTabIndex(Math.min(node.currentTab ?? 0, tabs.children.length - 1), false);
      return tabs;
    }

    if (node.type === "mobile-drawer") {
      if (!isMobileRuntime()) return null;
      const drawer = side === "right" ? this.rightSplit : this.leftSplit;
      if (!(drawer instanceof MobileDrawer)) return null;
      drawer.clear();
      drawer.id = node.id;
      if (node.dimension !== undefined) drawer.setDimension(node.dimension);
      drawer.setPinned(node.pinned ?? false, { layout: false });
      for (const child of node.children) {
        const item = await this.deserializeLayoutNode(child, side, drawer.containerEl.ownerDocument);
        if (item instanceof WorkspaceLeaf) {
          drawer.appendChild(item, false);
        } else if (item) {
          drawer.appendChild(item, false);
        }
      }
      drawer.selectTabIndex(Math.min(node.currentTab ?? 0, drawer.children.length - 1));
      return drawer;
    }

    if (node.type === "split") {
      const split = new WorkspaceSplit(this, node.direction, undefined, ownerDocument);
      if (node.dimension !== undefined) split.setDimension(node.dimension);
      for (const child of node.children) {
        const item = await this.deserializeLayoutNode(child, side, split.containerEl.ownerDocument);
        if (item instanceof WorkspaceLeaf) {
          const tabs = new WorkspaceTabs(this, undefined, split.containerEl.ownerDocument);
          tabs.appendChild(item, false);
          split.appendChild(tabs);
        } else if (item) {
          split.appendChild(item);
        }
      }
      return split;
    }

    if (node.type === "floating") {
      const floating = new WorkspaceFloating(this, node.id, ownerDocument);
      if (node.dimension !== undefined) floating.setDimension(node.dimension);
      for (const child of node.children) {
        if (child.type !== "window") continue;
        const item = await this.deserializeLayoutNode(child, side, ownerDocument);
        if (item instanceof WorkspaceWindow) floating.appendChild(item);
      }
      return floating;
    }

    if (node.type === "window") {
      const workspaceWindow = this.openPopout(node);
      if (node.dimension !== undefined) workspaceWindow.setDimension(node.dimension);
      for (const child of node.children) {
        const item = await this.deserializeLayoutNode(child, undefined, workspaceWindow.doc);
        if (item instanceof WorkspaceLeaf) {
          const tabs = new WorkspaceTabs(this, undefined, workspaceWindow.doc);
          tabs.appendChild(item, false);
          workspaceWindow.appendChild(tabs);
        } else if (item) {
          workspaceWindow.appendChild(item);
        }
      }
      if (workspaceWindow.children.length === 0) {
        workspaceWindow.close();
        return null;
      }
      return workspaceWindow;
    }

    return null;
  }

  private clearChildren(item: WorkspaceSplit | WorkspaceTabs | MobileDrawer, options: { detach?: boolean } = {}): void {
    if (item instanceof MobileDrawer) {
      item.clear();
      return;
    }
    for (const child of [...item.children]) {
      if (options.detach === false) this.releaseLayoutItem(child);
      else child.detach();
    }
    item.children = [];
    if (item instanceof WorkspaceTabs) {
      item.tabsInnerEl.replaceChildren();
      item.tabsContainerEl.replaceChildren();
    } else if (item instanceof WorkspaceSidedock) {
      setChildrenInPlace(item.containerEl, [
        item.resizeHandleEl,
        ...(item.vaultProfileEl ? [item.vaultProfileEl] : []),
        item.emptyStateEl,
      ]);
      item.updateEmptyState();
    } else {
      setChildrenInPlace(item.containerEl, [item.resizeHandleEl]);
    }
  }

  private releaseLayoutItem(item: WorkspaceItem): void {
    if (item instanceof WorkspaceParent) {
      for (const child of [...item.children]) this.releaseLayoutItem(child);
      item.children = [];
    }
    item.setParent(null);
    item.containerEl.remove();
  }

  setActiveLeaf(leaf: WorkspaceLeaf | undefined | null, options: boolean | { focus?: boolean } = {}, focus = false): void {
    if (!leaf || !this.isAttached(leaf)) return;
    const shouldFocus = options && typeof options !== "boolean" ? options.focus === true : focus;
    const previous = this.activeLeaf;
    const previousTabGroup = getWorkspaceActiveTabGroup(previous?.parent);
    if (previous === leaf) {
      if (shouldFocus) this.focusLeaf(leaf);
      return;
    }
    previous?.containerEl.classList.remove("mod-active");
    previous?.tabHeaderEl.classList.remove("mod-active");
    previousTabGroup?.containerEl.classList.remove("mod-active");

    this.activeLeaf = leaf;
    this._activeEditor = null;
    this.activeTabGroup = getWorkspaceActiveTabGroup(leaf.parent);
    leaf.activeTime = Date.now();
    if (leaf.parent instanceof WorkspaceTabs) {
      const index = leaf.parent.children.indexOf(leaf);
      if (index !== -1 && leaf.parent.currentTab !== index) leaf.parent.selectTabIndex(index, false);
      leaf.parent.containerEl.classList.add("mod-active");
      leaf.parent.updateTabDisplay();
    } else if (leaf.parent instanceof MobileDrawer) {
      const index = leaf.parent.children.indexOf(leaf);
      if (index !== -1 && leaf.parent.currentTab !== index) leaf.parent.selectTabIndex(index);
      leaf.parent.containerEl.classList.add("mod-active");
    }
    if (previousTabGroup instanceof WorkspaceTabs && previousTabGroup !== this.activeTabGroup) previousTabGroup.updateTabDisplay();
    leaf.containerEl.classList.add("mod-active");
    leaf.tabHeaderEl.classList.add("mod-active");
    this.iterateAllLeaves((item) => item.updateHeader());
    const container = leaf.getContainer();
    if (container instanceof WorkspaceWindow) container.updateTitle();
    else this.updateTitle();
    if (shouldFocus) this.focusLeaf(leaf);
    this.updateMobileVisibleTabGroup();
    this.requestActiveLeafEvents();
    this.requestSaveLayout();
  }

  private focusLeaf(leaf: WorkspaceLeaf): void {
    const container = leaf.getContainer() as WorkspaceItem & { focus?: () => void };
    container.focus?.();
    leaf.setEphemeralState(withFocusEphemeralState(leaf.getEphemeralState()));
    if (isMobileRuntime() && leaf.getRoot() === this.rootSplit) {
      this.leftSplit.collapse();
      this.rightSplit.collapse();
    }
  }

  activeLeafEvents(): void {
    if (!this.layoutReady) return;
    this.trigger("active-leaf-change", this.activeLeaf);
    const activeFile = this.getActiveFile();
    if (this.lastActiveFile === activeFile) return;
    const previousFile = this.lastActiveFile;
    this.recentFileTracker.onFileOpen(activeFile, previousFile);
    this.lastActiveFile = activeFile;
    this.trigger("file-open", activeFile);
  }

  private isActiveEditorView(view: unknown): view is WorkspaceActiveEditor {
    return Boolean(
      view
        && typeof view === "object"
        && "editor" in view
        && "leaf" in view
        && (view as { leaf?: unknown }).leaf instanceof WorkspaceLeaf,
    );
  }

  iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => boolean | void): void {
    this.iterateLeaves(this.rootSplit, callback);
    this.iterateLeaves(this.leftSplit, callback);
    this.iterateLeaves(this.rightSplit, callback);
    this.iterateLeaves(this.floatingSplit, callback);
  }

  iterateLeaves(callback: (leaf: WorkspaceLeaf) => boolean | void): boolean;
  iterateLeaves(root: WorkspaceItem | WorkspaceItem[], callback: (leaf: WorkspaceLeaf) => boolean | void): boolean;
  iterateLeaves(callback: (leaf: WorkspaceLeaf) => boolean | void, root: WorkspaceItem | WorkspaceItem[]): boolean;
  iterateLeaves(
    rootOrCallback: WorkspaceItem | WorkspaceItem[] | ((leaf: WorkspaceLeaf) => boolean | void),
    callbackOrRoot?: ((leaf: WorkspaceLeaf) => boolean | void) | WorkspaceItem | WorkspaceItem[],
  ): boolean {
    let roots: WorkspaceItem | WorkspaceItem[];
    let callback: (leaf: WorkspaceLeaf) => boolean | void;
    if (typeof rootOrCallback === "function") {
      callback = rootOrCallback;
      roots = callbackOrRoot instanceof WorkspaceItem || Array.isArray(callbackOrRoot)
        ? callbackOrRoot
        : [this.rootSplit, this.leftSplit, this.rightSplit, this.floatingSplit];
    } else {
      roots = rootOrCallback;
      callback = callbackOrRoot as (leaf: WorkspaceLeaf) => boolean | void;
    }
    const items = Array.isArray(roots) ? roots : [roots];
    const visit = (item: WorkspaceItem): boolean => {
      if (item instanceof WorkspaceLeaf) return Boolean(callback(item));
      if (item instanceof WorkspaceParent) {
        for (const child of item.children) {
          if (visit(child)) return true;
        }
      }
      return false;
    };
    for (const item of items) {
      if (visit(item)) return true;
    }
    return false;
  }

  iterateRootLeaves(callback: (leaf: WorkspaceLeaf) => boolean | void): void {
    this.iterateLeaves(this.rootSplit, callback);
  }

  getLeavesOfType(type: string): WorkspaceLeaf[] {
    const leaves: WorkspaceLeaf[] = [];
    this.iterateAllLeaves((leaf) => {
      if (leaf.view?.getViewType() === type) leaves.push(leaf);
    });
    return leaves;
  }

  private getActiveFileView(): FileView | null {
    const activeView = this.activeLeaf?.view;
    if (activeView?.navigation) return activeView instanceof FileView ? activeView : null;
    let activeFileView: FileView | null = null;
    let activeNavigationLeaf: WorkspaceLeaf | null = null;
    let activeTime = -Infinity;
    this.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!view?.navigation) return;
      if (!activeNavigationLeaf || leaf.activeTime > activeTime) {
        activeNavigationLeaf = leaf;
        activeFileView = view instanceof FileView ? view : null;
        activeTime = leaf.activeTime;
      }
    });
    return activeFileView;
  }

  getVisibleLeaves(): WorkspaceLeaf[] {
    const leaves: WorkspaceLeaf[] = [];
    this.iterateAllLeaves((leaf) => {
      if (leaf.containerEl.style.display !== "none") leaves.push(leaf);
    });
    return leaves;
  }

  detachLeavesOfType(type: string): void {
    for (const leaf of this.getLeavesOfType(type)) leaf.detach();
  }

  closeActiveLeaf(): boolean {
    let leaf = this.activeLeaf;
    if (leaf && this.isInSidebar(leaf) && !isFileBackedLeaf(leaf)) leaf = this.getMostRecentRootLeaf();
    if (!leaf) return false;
    if (leaf.pinned) leaf.setPinned(false);
    else leaf.detach();
    return true;
  }

  closeOtherLeaves(): boolean {
    const leaf = this.activeLeaf;
    if (!leaf) return false;
    const leaves = this.getContainerLeaves(leaf).filter((item) => item !== leaf && !item.pinned);
    for (const item of leaves) item.detach();
    return leaves.length > 0;
  }

  canCloseOtherLeaves(): boolean {
    const leaf = this.activeLeaf;
    return Boolean(leaf && this.getContainerLeaves(leaf).some((item) => item !== leaf && !item.pinned));
  }

  closeTabGroup(): boolean {
    const leaf = this.activeLeaf;
    if (!leaf || this.isInSidebar(leaf) || !(leaf.parent instanceof WorkspaceTabs)) return false;
    for (const item of [...leaf.parent.children]) {
      if (item instanceof WorkspaceLeaf && !item.pinned) item.detach();
    }
    return true;
  }

  canCloseTabGroup(): boolean {
    const leaf = this.activeLeaf;
    return Boolean(leaf && !this.isInSidebar(leaf) && leaf.parent instanceof WorkspaceTabs);
  }

  closeOthersInTabGroup(): boolean {
    const leaf = this.activeLeaf;
    if (!leaf || this.isInSidebar(leaf) || !(leaf.parent instanceof WorkspaceTabs) || leaf.parent.children.length <= 1) return false;
    for (const item of [...leaf.parent.children]) {
      if (item instanceof WorkspaceLeaf && item !== leaf && !item.pinned) item.detach();
    }
    return true;
  }

  canCloseOthersInTabGroup(): boolean {
    const leaf = this.activeLeaf;
    return Boolean(leaf && !this.isInSidebar(leaf) && leaf.parent instanceof WorkspaceTabs && leaf.parent.children.length > 1);
  }

  canPopoutActiveLeaf(): boolean {
    return this.canPopoutLeaf(this.activeLeaf);
  }

  selectNextTab(): boolean {
    const leaf = this.activeLeaf;
    if (!(leaf?.parent instanceof WorkspaceTabs)) return false;
    const tabs = leaf.parent;
    const index = tabs.currentTab + 1 >= tabs.children.length ? 0 : tabs.currentTab + 1;
    tabs.selectTabIndex(index);
    const nextLeaf = tabs.children[index];
    if (nextLeaf instanceof WorkspaceLeaf) this.setActiveLeaf(nextLeaf, { focus: true });
    return true;
  }

  selectPreviousTab(): boolean {
    const leaf = this.activeLeaf;
    if (!(leaf?.parent instanceof WorkspaceTabs)) return false;
    const tabs = leaf.parent;
    const index = tabs.currentTab - 1 < 0 ? tabs.children.length - 1 : tabs.currentTab - 1;
    tabs.selectTabIndex(index);
    const nextLeaf = tabs.children[index];
    if (nextLeaf instanceof WorkspaceLeaf) this.setActiveLeaf(nextLeaf, { focus: true });
    return true;
  }

  selectTab(index: number): boolean {
    const leaf = this.activeLeaf;
    if (!(leaf?.parent instanceof WorkspaceTabs)) return false;
    const target = leaf.parent.children[index];
    if (!(target instanceof WorkspaceLeaf)) return false;
    this.setActiveLeaf(target, { focus: true });
    return true;
  }

  canSelectTab(index: number): boolean {
    const leaf = this.activeLeaf;
    return Boolean(leaf?.parent instanceof WorkspaceTabs && leaf.parent.children[index] instanceof WorkspaceLeaf);
  }

  selectLastTab(): boolean {
    const leaf = this.activeLeaf;
    if (!(leaf?.parent instanceof WorkspaceTabs)) return false;
    return this.selectTab(leaf.parent.children.length - 1);
  }

  canSelectLastTab(): boolean {
    const leaf = this.activeLeaf;
    return Boolean(leaf?.parent instanceof WorkspaceTabs && leaf.parent.children.at(-1) instanceof WorkspaceLeaf);
  }

  pushUndoHistory(leaf: WorkspaceLeaf, parentId: string | null, rootId: string): void {
    const state = leaf.getViewState();
    if (state.type === "empty") return;
    this.undoHistory.unshift({
      leafId: leaf.id,
      parentId,
      rootId,
      state,
      eState: leaf.getEphemeralState(),
      leafHistory: leaf.history.serialize(),
    });
    if (this.undoHistory.length > 10) this.undoHistory.pop();
  }

  hasUndoHistory(): boolean {
    return this.undoHistory.length > 0;
  }

  async undoClosePane(): Promise<boolean> {
    const entry = this.undoHistory.shift();
    if (!entry) return false;

    const root = this.findUndoHistoryRoot(entry.rootId);
    let leaf = this.activeLeaf;

    if (entry.parentId) {
      let parentTabs: WorkspaceTabs | null = null;
      this.iterateTabs([root], (tabs) => {
        if (tabs.id === entry.parentId) parentTabs = tabs;
      });
      if (parentTabs) leaf = this.createLeafInTabGroup(parentTabs, entry.leafId);
    }

    if (!leaf || leaf.view?.getViewType() !== "empty") {
      leaf = root === this.floatingSplit ? this.createLeafInFloatingSplit(undefined, entry.leafId) : this.splitActiveLeaf("vertical", entry.leafId);
      if (entry.parentId && leaf.parent) leaf.parent.id = entry.parentId;
    }

    if (entry.leafId) leaf.id = entry.leafId;
    if (entry.leafHistory) leaf.history.deserialize(entry.leafHistory);
    await leaf.setViewState({ ...entry.state, active: true }, entry.eState, { defer: false });
    return true;
  }

  iterateTabs(roots: WorkspaceItem[] | WorkspaceItem, callback: (tabs: WorkspaceTabs) => boolean | void): boolean {
    const items = Array.isArray(roots) ? roots : [roots];
    const visit = (item: WorkspaceItem): boolean => {
      if (item instanceof WorkspaceTabs && callback(item)) return true;
      if (item instanceof WorkspaceSplit || item instanceof WorkspaceTabs) {
        for (const child of item.children) {
          if (visit(child)) return true;
        }
      }
      return false;
    };
    for (const item of items) {
      if (visit(item)) return true;
    }
    return false;
  }

  private rebuildLeavesOfType(type: string): void {
    for (const leaf of this.getLeavesOfType(type)) {
      if (leaf.view instanceof DeferredView) continue;
      void leaf.rebuildView();
    }
  }

  private onFileRename(file: TFile, oldPath: string): void {
    if (!(file instanceof TFile)) return;
    this.iterateAllLeaves((leaf) => {
      this.updateHistoryFilePaths(leaf.backHistory, file, oldPath);
      this.updateHistoryFilePaths(leaf.forwardHistory, file, oldPath);
      const viewFile = (leaf.view as { file?: TFile | null } | null)?.file;
      if (viewFile === file || viewFile?.path === file.path) leaf.updateHeader();
    });

    for (const entry of this.undoHistory) {
      updateViewStateFilePath(entry.state, file.path, oldPath);
      this.updateHistoryFilePaths(entry.leafHistory?.backHistory, file, oldPath);
      this.updateHistoryFilePaths(entry.leafHistory?.forwardHistory, file, oldPath);
    }
  }

  private updateHistoryFilePaths(
    entries: Array<{ title?: string; state: InternalViewState }> | undefined,
    file: TFile,
    oldPath: string,
  ): void {
    for (const entry of entries ?? []) {
      if (updateViewStateFilePath(entry.state, file.path, oldPath)) entry.title = file.basename;
    }
  }

  getMostRecentLeaf(container?: WorkspaceItem): WorkspaceLeaf | null {
    let mostRecent: WorkspaceLeaf | null = null;
    let fallback: WorkspaceLeaf | null = null;
    const iterate = (callback: (leaf: WorkspaceLeaf) => void) => {
      if (container instanceof WorkspaceParent) container.iterateLeaves(callback);
      else {
        this.rootSplit.iterateLeaves(callback);
        this.floatingSplit.iterateLeaves(callback);
      }
    };
    iterate((leaf) => {
      fallback ??= leaf;
      if (!leaf.isVisible()) return;
      if (!mostRecent || leaf.activeTime > mostRecent.activeTime) mostRecent = leaf;
    });
    return mostRecent ?? fallback;
  }

  getFocusedContainer(): WorkspaceRoot | WorkspaceWindow {
    const activeWindow = getActiveWindow();
    if (activeWindow === window) return this.rootSplit;
    const focused = this.floatingSplit.children.find((child): child is WorkspaceWindow => child instanceof WorkspaceWindow && child.win === activeWindow);
    return focused ?? this.rootSplit;
  }

  getMostRecentRootLeaf(options: { reusable?: boolean } = {}): WorkspaceLeaf | null {
    let fallback: WorkspaceLeaf | null = null;
    let mostRecent: WorkspaceLeaf | null = null;
    this.rootSplit.iterateLeaves((leaf) => {
      if (options.reusable && !this.canReuseLeaf(leaf)) return;
      fallback ??= leaf;
      if (!mostRecent || leaf.activeTime > mostRecent.activeTime) mostRecent = leaf;
    });
    return mostRecent ?? fallback;
  }

  isInSidebar(leaf: WorkspaceLeaf): boolean {
    const root = leaf.getRoot();
    return root === this.leftSplit || root === this.rightSplit;
  }

  getActiveViewOfType<T>(ctor: abstract new (...args: any[]) => T): T | null {
    const view = this.activeLeaf?.view;
    return view instanceof ctor ? view : null;
  }

  getActiveLeafOfViewType<T>(ctor: abstract new (...args: any[]) => T): T | null {
    return this.getActiveViewOfType(ctor);
  }

  registerEditorExtension(extension: unknown): void {
    this.editorExtensions.push(extension);
    this.editorExtensionHost.register(extension, "plugin");
    this.updateOptions();
  }

  unregisterEditorExtension(extension: unknown): void {
    this.editorExtensions = this.editorExtensions.filter((item) => item !== extension);
    this.editorExtensionHost.unregister(extension);
    this.updateOptions();
  }

  registerOperatorFuncConfigs(id: string, configs: OperatorFuncConfig[]): void {
    this.operatorFuncConfigs[id] = configs;
  }

  unregisterOperatorFuncConfigs(id: string): void {
    delete this.operatorFuncConfigs[id];
  }

  registerUriHook(): void {
    if (this.uriHookRegistered) return;
    this.uriHookRegistered = true;
    const ownerWindow = this.containerEl.ownerDocument.defaultView ?? window;
    const hookWindow = ownerWindow as UriHookWindow;
    const pendingAction = hookWindow.OBS_ACT;
    const handleAction = (data?: ObsidianProtocolData | null): void => {
      if (!data) return;
      console.log("Received URL action", data);
      (this.getFocusedContainer() as { focus?: () => void }).focus?.();
      void this.app.uriRouter.handleProtocolData(data).then((handled) => {
        if (!handled && data.action) new Notice(`Invalid URI action "${data.action}"`);
      });
    };

    hookWindow.OBS_ACT = handleAction;
    if (pendingAction && typeof pendingAction !== "function") handleAction(pendingAction);

    const bridge = getAppUrlOpenBridge(hookWindow);
    const listener = bridge?.addListener?.("appUrlOpen", (event) => {
      const uri = typeof event === "string" ? event : event?.url;
      if (!uri) return;
      const data = parseObsidianUri(uri);
      if (!data) return;
      const vault = data.vault;
      if (vault && vault.toLowerCase() !== this.app.vault.getName().toLowerCase()) {
        ownerWindow.sessionStorage.setItem("obsidian-uri", uri);
        ownerWindow.location.reload();
        return;
      }
      handleAction(data);
    });
    if (isPromiseLike(listener)) {
      void listener.then((resolved) => {
        this.appUrlOpenListener = resolved;
      });
    } else {
      this.appUrlOpenListener = listener ?? null;
    }
  }

  updateOptions(): void {
    if (!this.layoutReady) return;
    this.iterateAllLeaves((leaf) => {
      const view = leaf.view as { getViewType?: () => string; updateOptions?: () => void } | null;
      if (view?.getViewType?.() === "markdown") view.updateOptions?.();
    });
  }

  registerObsidianProtocolHandler(action: string, handler: ObsidianProtocolHandler): void {
    if (this.protocolHandlers.has(action)) throw new Error(`Action "${action}" is already registered as a handler.`);
    const wrapped: UriHandler = (context) => handler(toObsidianProtocolData(context));
    this.app.uriRouter.registerAction(action, wrapped);
    this.protocolHandlers.set(action, new Map([[handler, wrapped]]));
  }

  unregisterObsidianProtocolHandler(action: string, handler?: ObsidianProtocolHandler): void {
    const handlers = this.protocolHandlers.get(action);
    if (!handlers) return;
    const wrapped = handler ? handlers?.get(handler) : undefined;
    if (handler && !wrapped) return;
    this.app.uriRouter.unregisterAction(action, wrapped);
    if (handler) handlers?.delete(handler);
    else handlers?.clear();
    if (handlers?.size === 0) this.protocolHandlers.delete(action);
  }

  handleXCallback(params: URLSearchParams, file: TFile): boolean {
    if (!this.app.vault.getConfig<boolean>("uriCallbacks")) return false;
    if (!params.has("x-success")) return false;
    const callbackUrl = params.get("x-success");
    if (!callbackUrl) return true;
    return openCallbackUrl(callbackUrl, {
      name: file.basename,
      url: this.app.getObsidianUrl(file),
    });
  }

  handleXErrorCallback(params: URLSearchParams, errorCode: string, errorMessage: string): boolean {
    if (!this.app.vault.getConfig<boolean>("uriCallbacks")) return false;
    if (!params.has("x-error")) return false;
    const callbackUrl = params.get("x-error");
    if (!callbackUrl) return true;
    return openCallbackUrl(callbackUrl, { errorCode, errorMessage });
  }

  registerHoverLinkSource(id: string, source: HoverLinkSourceConfig): void;
  registerHoverLinkSource(source: HoverLinkSource): void;
  registerHoverLinkSource(idOrSource: string | HoverLinkSource, source?: HoverLinkSourceConfig): void {
    const normalized = typeof idOrSource === "string" ? { id: idOrSource, ...(source ?? { display: idOrSource }) } : idOrSource;
    this.hoverLinkSources.register(normalized);
    this.trigger("hover-link-source-change", normalized);
  }

  unregisterHoverLinkSource(idOrSource: string | HoverLinkSource): void {
    const id = typeof idOrSource === "string" ? idOrSource : idOrSource.id;
    this.hoverLinkSources.unregister(id);
    this.trigger("hover-link-source-change", id);
  }

  unsetActiveEditor(activeEditor?: MarkdownFileInfo | null): void {
    if (!activeEditor || this._activeEditor === activeEditor) this._activeEditor = null;
  }

  get recentFilePaths(): string[] {
    return this.recentFileTracker.serialize();
  }

  set recentFilePaths(paths: string[]) {
    this.recentFileTracker.load(paths);
  }

  getLastOpenFiles(): string[] {
    return this.recentFileTracker.getLastOpenFiles();
  }

  getRecentFiles(options?: RecentFilesOptions): TFile[] {
    return this.recentFileTracker.getRecentFiles(options);
  }

  addRecentFile(file: TFile): void {
    this.recentFileTracker.addRecentFile(file);
  }

  onQuickPreview(file: TFile, data: string): void {
    this.trigger("quick-preview", file, data);
  }

  private canReuseLeaf(leaf: WorkspaceLeaf): boolean {
    return !this.isInSidebar(leaf) && leaf.canNavigate();
  }

  private getTabContext(): WorkspaceTabs | null {
    if (this.activeLeaf && !this.isInSidebar(this.activeLeaf) && this.activeLeaf.parent instanceof WorkspaceTabs) {
      return this.activeLeaf.parent;
    }
    const rootLeaf = this.getMostRecentRootLeaf();
    return rootLeaf?.parent instanceof WorkspaceTabs ? rootLeaf.parent : null;
  }

  createLeafInParent(parent: WorkspaceSplit, index: number): WorkspaceLeaf {
    const ownerDocument = parent.containerEl.ownerDocument;
    const leaf = new WorkspaceLeaf(this, undefined, ownerDocument);
    if (parent.children.length > 0) leaf.setDimension(100 / parent.children.length);
    parent.insertChild(index, leaf);
    this.setActiveLeaf(leaf);
    return leaf;
  }

  private createLeafInWorkspaceParent(parent: WorkspaceParent, id?: string): WorkspaceLeaf {
    const ownerDocument = parent.containerEl.ownerDocument;
    const leaf = new WorkspaceLeaf(this, id, ownerDocument);
    if (parent instanceof WorkspaceTabs) parent.appendChild(leaf);
    else {
      const tabs = new WorkspaceTabs(this, undefined, ownerDocument);
      tabs.appendChild(leaf, false);
      parent.appendChild(tabs);
    }
    this.setActiveLeaf(leaf);
    return leaf;
  }

  private createLeafInRootSplit(direction: SplitDirection = "vertical", id?: string): WorkspaceLeaf {
    const ownerDocument = this.rootSplit.containerEl.ownerDocument;
    const leaf = new WorkspaceLeaf(this, id, ownerDocument);
    const tabs = new WorkspaceTabs(this, undefined, ownerDocument);
    tabs.appendChild(leaf);
    if (this.rootSplit.children.length === 0) this.rootSplit.appendChild(tabs);
    else {
      const split = new WorkspaceSplit(this, direction);
      split.appendChild(tabs);
      this.rootSplit.appendChild(split);
    }
    this.setActiveLeaf(leaf);
    return leaf;
  }

  createLeafBySplit(leaf: WorkspaceLeaf, direction: SplitDirection = "vertical", before = false, id?: string): WorkspaceLeaf {
    const nextLeaf = new WorkspaceLeaf(this, id, leaf.containerEl.ownerDocument);
    this.splitLeaf(leaf, nextLeaf, direction, before);
    this.setActiveLeaf(nextLeaf);
    return nextLeaf;
  }

  async duplicateLeaf(leaf: WorkspaceLeaf, direction?: SplitDirection): Promise<WorkspaceLeaf>;
  async duplicateLeaf(leaf: WorkspaceLeaf, leafType: PaneType | boolean, direction?: SplitDirection): Promise<WorkspaceLeaf>;
  async duplicateLeaf(
    leaf: WorkspaceLeaf,
    leafTypeOrDirection: PaneType | boolean | SplitDirection = "split",
    direction: SplitDirection = "vertical",
  ): Promise<WorkspaceLeaf> {
    const targetLeaf = this.createDuplicateTargetLeaf(leaf, leafTypeOrDirection, direction);
    await targetLeaf.setViewState(leaf.getViewState(), withFocusEphemeralState(leaf.getEphemeralState()), { history: false });
    targetLeaf.history.deserialize(leaf.history.serialize());
    this.setActiveLeaf(targetLeaf, { focus: true });
    return targetLeaf;
  }

  private createDuplicateTargetLeaf(
    leaf: WorkspaceLeaf,
    leafTypeOrDirection: PaneType | boolean | SplitDirection,
    direction: SplitDirection,
  ): WorkspaceLeaf {
    if (leafTypeOrDirection === "window") return this.openPopoutLeaf();
    if (leafTypeOrDirection === "tab" || leafTypeOrDirection === true) return this.getLeaf("tab");
    const splitDirection = isSplitDirection(leafTypeOrDirection) ? leafTypeOrDirection : direction;
    return this.createLeafBySplit(leaf, splitDirection);
  }

  onStartLink(leaf: WorkspaceLeaf): void {
    const win = leaf.containerEl.ownerDocument.defaultView ?? window;
    const cleanup = (): void => {
      win.removeEventListener("mousemove", onMouseMove);
      win.removeEventListener("mouseup", onMouseUp);
      this.dragManager.hideOverlay();
    };
    const onMouseMove = (event: MouseEvent): void => {
      event.preventDefault();
      const target = this.getLinkTargetLeaf(event, leaf);
      if (!target) {
        this.dragManager.hideOverlay();
        return;
      }
      this.dragManager.showOverlay(target.containerEl.getBoundingClientRect(), target.containerEl.ownerDocument);
    };
    const onMouseUp = (event: MouseEvent): void => {
      cleanup();
      const target = this.getLinkTargetLeaf(event, leaf);
      if (target) leaf.setGroupMember(target);
    };
    win.addEventListener("mousemove", onMouseMove);
    win.addEventListener("mouseup", onMouseUp);
  }

  private getLinkTargetLeaf(event: MouseEvent, source: WorkspaceLeaf): WorkspaceLeaf | null {
    let target: WorkspaceLeaf | null = null;
    this.iterateAllLeaves((leaf) => {
      if (target || leaf === source || !(leaf.view instanceof ItemView)) return;
      const rect = leaf.containerEl.getBoundingClientRect();
      if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) target = leaf;
    });
    return target;
  }

  onDragLeaf(event: DragEvent, leaf: WorkspaceLeaf): void {
    event.preventDefault();
    event.dataTransfer?.setData("text/plain", "");
    const win = leaf.tabHeaderEl.ownerDocument.defaultView ?? event.view ?? window;
    const doc = win.document;
    const bodyEl = doc.body;
    const ghostEl = this.dragManager.createLeafDragGhost(leaf, doc);
    bodyEl.appendChild(ghostEl);
    event.dataTransfer?.setDragImage?.(ghostEl, 0, 0);
    win.setTimeout(() => ghostEl.remove());
    const sessionWindows = this.getLeafDragWindows(win);
    const sessionDocuments = sessionWindows.map((sessionWindow) => sessionWindow.document);
    const startX = event.clientX;
    const startY = event.clientY;
    let isDragging = false;
    const cleanup = () => {
      for (const sessionWindow of sessionWindows) {
        sessionWindow.removeEventListener("dragover", dragover);
        sessionWindow.removeEventListener("dragenter", dragenter);
        sessionWindow.removeEventListener("dragleave", dragleave);
        sessionWindow.removeEventListener("drop", drop);
        sessionWindow.removeEventListener("dragend", finish, { capture: true });
      }
      for (const sessionDocument of sessionDocuments) sessionDocument.body.classList.remove("is-grabbing");
      this.dragManager.clearPreview();
    };
    const setMoveDropEffect = (dragEvent: DragEvent) => {
      if (dragEvent.dataTransfer) dragEvent.dataTransfer.dropEffect = "move";
    };
    const dragenter = (dragEvent: DragEvent) => {
      const target = this.getLeafDropTargetFromEvent(dragEvent);
      if (!target || this.isSelfLeafDropTarget(target, leaf)) return;
      dragEvent.preventDefault();
      setMoveDropEffect(dragEvent);
    };
    const dragleave = (dragEvent: DragEvent) => {
      if (dragEvent.relatedTarget) return;
      this.dragManager.hideOverlay();
    };
    const dragover = (dragEvent: DragEvent) => {
      const target = this.getLeafDropTargetFromEvent(dragEvent);
      if (!target || this.isSelfLeafDropTarget(target, leaf)) {
        this.dragManager.hideOverlay();
        return;
      }
      dragEvent.preventDefault();
      setMoveDropEffect(dragEvent);
      if (!isDragging) {
        const dx = dragEvent.clientX - startX;
        const dy = dragEvent.clientY - startY;
        if (dx * dx + dy * dy < 25) return;
        isDragging = true;
        for (const sessionDocument of sessionDocuments) sessionDocument.body.classList.add("is-grabbing");
      }
      const targetDoc = target.ownerDocument ?? dragEvent.view?.document ?? document;
      if (target.overlayRect) this.dragManager.showOverlay(target.overlayRect, targetDoc);
      if (target.fakeTargetEl && target.fakeTargetRect) {
        this.dragManager.showFakeTargetPreview(target.fakeTargetEl, target.fakeTargetRect, {
          doc: target.ownerDocument ?? targetDoc,
          isInSidebar: target.isInSidebar,
        });
      } else {
        this.dragManager.hideFakeTargetPreview();
      }
    };
    const drop = (dropEvent: DragEvent) => {
      const target = this.getLeafDropTargetFromEvent(dropEvent);
      const finalTarget = target && !this.isSelfLeafDropTarget(target, leaf) ? target : null;
      if (finalTarget) dropEvent.preventDefault();
      if (finalTarget) this.moveLeafToDropTarget(leaf, finalTarget);
      cleanup();
    };
    const finish = () => {
      cleanup();
    };
    for (const sessionWindow of sessionWindows) {
      sessionWindow.addEventListener("dragover", dragover);
      sessionWindow.addEventListener("dragenter", dragenter);
      sessionWindow.addEventListener("dragleave", dragleave);
      sessionWindow.addEventListener("drop", drop);
      sessionWindow.addEventListener("dragend", finish, { capture: true, once: true });
    }
  }

  private isSelfLeafDropTarget(target: WorkspaceDropTarget, leaf: WorkspaceLeaf): boolean {
    return target.item === leaf;
  }

  private getLeafDragWindows(ownerWindow: Window): Window[] {
    const mainWindow = this.rootSplit.containerEl.ownerDocument.defaultView ?? window;
    const windows = new Set<Window>([mainWindow, ownerWindow]);
    for (const child of this.floatingSplit.children) {
      if (child instanceof WorkspaceWindow && !child.win.closed) windows.add(child.win);
    }
    return [...windows];
  }

  moveLeafToDropTarget(sourceLeaf: WorkspaceLeaf, target: WorkspaceDropTarget): boolean {
    if (this.isSelfLeafDropTarget(target, sourceLeaf)) return false;
    if (!sourceLeaf.parent) return false;
    if (!target.leaf && target.parent) return this.moveLeafIntoParentTarget(sourceLeaf, target.parent);
    if (!target.leaf?.parent) return false;

    if (target.side === "center") {
      if (target.leaf.view?.getViewType() === "empty") return this.replaceEmptyTargetLeaf(sourceLeaf, target.leaf);
      const targetTabs = target.leaf.parent instanceof WorkspaceTabs ? target.leaf.parent : null;
      if (targetTabs) return this.moveLeafIntoTabGroup(sourceLeaf, targetTabs, target);
      return this.swapLeaves(sourceLeaf, target.leaf);
    }

    const direction: SplitDirection = target.side === "top" || target.side === "bottom" ? "horizontal" : "vertical";
    const before = target.side === "top" || target.side === "left";
    const splitTarget = target.item instanceof WorkspaceTabs ? target.item : target.leaf;
    if (!splitTarget) return false;
    sourceLeaf.parent.removeChild(sourceLeaf);
    sourceLeaf.setDimension(null);
    this.splitItemWithLeaf(splitTarget, sourceLeaf, direction, before);
    this.setActiveLeaf(sourceLeaf, { focus: true });
    this.requestResize();
    return true;
  }

  private replaceEmptyTargetLeaf(sourceLeaf: WorkspaceLeaf, targetLeaf: WorkspaceLeaf): boolean {
    if (sourceLeaf === targetLeaf) return false;
    const sourceParent = sourceLeaf.parent;
    const targetParent = targetLeaf.parent;
    if (!sourceParent || !targetParent) return false;

    const targetDimension = targetLeaf.dimension;
    sourceParent.removeChild(sourceLeaf);
    sourceLeaf.setDimension(targetDimension);

    if (targetParent instanceof WorkspaceTabs) {
      const targetIndex = Math.max(0, targetParent.children.indexOf(targetLeaf));
      targetParent.insertChild(targetIndex, sourceLeaf, false);
      targetParent.removeChild(targetLeaf);
      targetParent.selectTab(sourceLeaf);
    } else {
      targetParent.replaceChild(targetLeaf, sourceLeaf);
      targetLeaf.detach();
    }

    this.setActiveLeaf(sourceLeaf, { focus: true });
    this.requestResize();
    return true;
  }

  private moveLeafIntoParentTarget(sourceLeaf: WorkspaceLeaf, targetParent: WorkspaceParent): boolean {
    sourceLeaf.parent?.removeChild(sourceLeaf);
    sourceLeaf.setDimension(null);
    let tabs = targetParent === this.leftSplit || targetParent === this.rightSplit
      ? targetParent.children.find((child): child is WorkspaceTabs => child instanceof WorkspaceTabs) ?? null
      : null;
    if (!tabs) {
      tabs = this.createTabsForParent(targetParent);
      targetParent.appendChild(tabs);
    }
    tabs.appendChild(sourceLeaf, false);
    tabs.selectTab(sourceLeaf);
    if (targetParent instanceof WorkspaceSidedock) targetParent.expand();
    this.setActiveLeaf(sourceLeaf, { focus: true });
    this.requestResize();
    return true;
  }

  private createTabsForParent(parent: WorkspaceParent): WorkspaceTabs {
    return new WorkspaceTabs(this, undefined, parent.containerEl.ownerDocument);
  }

  createLeafInTabGroup(tabs?: WorkspaceTabs | null, id?: string): WorkspaceLeaf {
    const mostRecentLeaf = this.getMostRecentLeaf();
    const targetTabs = tabs ?? (mostRecentLeaf?.parent instanceof WorkspaceTabs ? mostRecentLeaf.parent : null);
    if (!targetTabs) throw new Error("No tab group found.");

    let recentLeaf: WorkspaceLeaf | null = null;
    let recentIndex = -1;
    targetTabs.children.forEach((child, index) => {
      if (!(child instanceof WorkspaceLeaf)) return;
      if (!recentLeaf || child.activeTime > recentLeaf.activeTime) {
        recentLeaf = child;
        recentIndex = index;
      }
    });

    if (recentLeaf?.view?.getViewType() === "empty") return recentLeaf;

    const leaf = new WorkspaceLeaf(this, id, targetTabs.containerEl.ownerDocument);
    targetTabs.insertChild(recentIndex + 1, leaf, false);
    if (this.app.vault.getConfig("focusNewTab")) this.setActiveLeaf(leaf);
    return leaf;
  }

  splitLeaf(sourceLeaf: WorkspaceLeaf, nextLeaf: WorkspaceLeaf, direction: SplitDirection = "vertical", before = false): void {
    const sourceItem: WorkspaceItem = sourceLeaf.parent instanceof WorkspaceTabs ? sourceLeaf.parent : sourceLeaf;
    this.splitItemWithLeaf(sourceItem, nextLeaf, direction, before);
  }

  private splitItemWithLeaf(sourceItem: WorkspaceItem, nextLeaf: WorkspaceLeaf, direction: SplitDirection = "vertical", before = false): void {
    const parentSplit = this.findParentSplit(sourceItem);
    const nextTabs = new WorkspaceTabs(this, undefined, sourceItem.containerEl.ownerDocument);
    nextTabs.appendChild(nextLeaf, false);
    nextTabs.selectTabIndex(0, false);

    if (!parentSplit) {
      this.rootSplit.appendChild(nextTabs);
      return;
    }

    const sourceIndex = parentSplit.children.indexOf(sourceItem);
    if (sourceIndex === -1) {
      parentSplit.appendChild(nextTabs);
      return;
    }

    if (parentSplit.direction === direction) {
      if (sourceItem.dimension != null) {
        const dimension = sourceItem.dimension / 2;
        sourceItem.setDimension(dimension);
        nextTabs.setDimension(dimension);
      }
      parentSplit.insertChild(sourceIndex + (before ? 0 : 1), nextTabs);
      return;
    }

    const wrapper = new WorkspaceSplit(this, direction);
    parentSplit.replaceChild(sourceItem, wrapper);
    wrapper.appendChild(sourceItem);
    wrapper.insertChild(before ? 0 : 1, nextTabs);
  }

  private findParentSplit(item: WorkspaceItem): WorkspaceSplit | null {
    let parent = item.parent;
    while (parent) {
      if (parent instanceof WorkspaceSplit) return parent;
      parent = parent.parent;
    }
    return null;
  }

  private moveLeafIntoTabGroup(sourceLeaf: WorkspaceLeaf, targetTabs: WorkspaceTabs, target: WorkspaceDropTarget): boolean {
    const sourceTabs = sourceLeaf.parent instanceof WorkspaceTabs ? sourceLeaf.parent : null;
    let insertIndex = target.tabInsert?.index ?? target.tabInsertIndex;
    if (insertIndex == null && target.clientX != null) insertIndex = targetTabs.getTabInsertLocation(target.clientX).index;
    if (insertIndex == null) insertIndex = targetTabs.children.indexOf(target.leaf) + 1;

    if (sourceTabs === targetTabs) {
      const sourceIndex = targetTabs.children.indexOf(sourceLeaf);
      if (sourceIndex === -1) return false;
      if (insertIndex > sourceIndex) insertIndex -= 1;
      if (sourceIndex === insertIndex) return false;
    }

    sourceLeaf.parent?.removeChild(sourceLeaf);
    sourceLeaf.setDimension(null);
    targetTabs.insertChild(insertIndex, sourceLeaf, false);
    targetTabs.selectTab(sourceLeaf);
    this.setActiveLeaf(sourceLeaf, { focus: true });
    this.requestResize();
    return true;
  }

  private getLeafDropTargetFromEvent(event: DragEvent): WorkspaceDropTarget | null {
    const x = event.clientX;
    const item = this.getDropLocationFromEvent(event);
    if (!item) return null;
    if (item === this.leftSplit || item === this.rightSplit) {
      if (!(item instanceof WorkspaceParent)) return null;
      const ownerDocument = item.containerEl.ownerDocument;
      const ownerWindow = ownerDocument.defaultView ?? window;
      return {
        leaf: null,
        parent: item,
        root: item.getRoot(),
        item,
        side: "center",
        clientX: x,
        overlayRect: this.getSidedockDropOverlayRect(item),
        fakeTargetRect: null,
        fakeTargetEl: null,
        isInSidebar: true,
        ownerWindow,
        ownerDocument,
      };
    }

    const targetLeaf = this.getLeafForDropLocation(item);
    if (!targetLeaf) return null;
    const targetTabs = item instanceof WorkspaceTabs ? item : targetLeaf.parent instanceof WorkspaceTabs ? targetLeaf.parent : null;
    const root = item.getRoot();
    const side = this.getDropDirectionFromEvent(event, targetLeaf, {
      blockedSides: this.getBlockedDropSidesForRoot(root),
      item,
    });
    const tabLocation = targetTabs && side === "center" ? targetTabs.getTabInsertLocation(x) : null;
    const fakeTargetEl = item.containerEl;
    const ownerDocument = item.containerEl.ownerDocument;
    const ownerWindow = ownerDocument.defaultView ?? window;
    return {
      leaf: targetLeaf,
      side,
      clientX: x,
      item,
      tabs: targetTabs,
      tabInsert: tabLocation,
      ...(tabLocation ? { tabInsertIndex: tabLocation.index } : {}),
      overlayRect: tabLocation?.rect ?? this.getDropOverlayRect(event, targetLeaf, side, item),
      fakeTargetRect: this.getFakeTargetRect(targetLeaf, side, item),
      fakeTargetEl,
      isInSidebar: root !== this.rootSplit,
      ownerWindow,
      ownerDocument,
    };
  }

  private getDropLocationFromEvent(event: DragEvent): WorkspaceItem | null {
    const eventWindow = getDragEventWindow(event);
    const mainWindow = this.rootSplit.containerEl.ownerDocument.defaultView ?? window;
    if (eventWindow !== mainWindow) {
      for (const child of this.floatingSplit.children) {
        if (child instanceof WorkspaceWindow && child.win === eventWindow) return this.recursiveGetDropTarget(event, child);
      }
    }
    if (eventInsideElement(event, this.leftRibbon.containerEl) || eventInsideElement(event, this.leftSidebarToggleButtonEl)) return this.leftSplit;
    if (eventInsideElement(event, this.rightRibbon.containerEl) || eventInsideElement(event, this.rightSidebarToggleButtonEl)) return this.rightSplit;
    const leftTarget = this.leftSplit.children.length > 0 ? this.recursiveGetDropTarget(event, this.leftSplit) : null;
    if (eventInsideElement(event, this.leftSplit.containerEl)) {
      return this.leftSplit.children.length === 0 ? this.leftSplit : leftTarget;
    }
    if (leftTarget) return leftTarget;
    const rightTarget = this.rightSplit.children.length > 0 ? this.recursiveGetDropTarget(event, this.rightSplit) : null;
    if (eventInsideElement(event, this.rightSplit.containerEl)) {
      return this.rightSplit.children.length === 0 ? this.rightSplit : rightTarget;
    }
    if (rightTarget) return rightTarget;
    const rootTarget = this.recursiveGetDropTarget(event, this.rootSplit);
    if (eventInsideElement(event, this.rootSplit.containerEl) || rootTarget) return rootTarget;
    return null;
  }

  private recursiveGetDropTarget(event: DragEvent, parent: WorkspaceParent): WorkspaceItem | null {
    for (const child of parent.children) {
      const nestedTarget = child instanceof WorkspaceParent ? this.recursiveGetDropTarget(event, child) : null;
      if (!eventInsideElement(event, child.containerEl) && !nestedTarget) continue;
      if (child instanceof WorkspaceTabs) return child;
      if (child instanceof WorkspaceParent) return nestedTarget;
      return child;
    }
    return null;
  }

  private getLeafForDropLocation(item: WorkspaceItem): WorkspaceLeaf | null {
    if (item instanceof WorkspaceLeaf) return item;
    if (item instanceof WorkspaceTabs) {
      const child = item.children[item.currentTab];
      return child instanceof WorkspaceLeaf ? child : null;
    }
    return null;
  }

  private getBlockedDropSidesForRoot(root: WorkspaceItem): ReadonlySet<WorkspaceDropTarget["side"]> | undefined {
    if (root instanceof WorkspaceSidedock) return new Set(["left", "right", "top", "bottom"]);
    if (root === this.leftSplit || root === this.rightSplit) return new Set(["left", "right"]);
    return undefined;
  }

  private getDropDirectionFromEvent(
    event: DragEvent,
    leaf: WorkspaceLeaf,
    options: { blockedSides?: ReadonlySet<WorkspaceDropTarget["side"]>; item?: WorkspaceItem } = {},
  ): WorkspaceDropTarget["side"] {
    const item = options.item ?? (leaf.parent instanceof WorkspaceTabs ? leaf.parent : leaf);
    const rect = item.containerEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return "center";
    const x = event.clientX;
    const y = event.clientY;
    const candidates: Array<{ side: WorkspaceDropTarget["side"]; distance: number }> = [
      { side: "left", distance: (x - rect.left) / rect.width },
      { side: "right", distance: (rect.right - x) / rect.width },
      { side: "top", distance: (y - rect.top) / rect.height },
      { side: "bottom", distance: (rect.bottom - y) / rect.height },
    ];
    candidates.sort((a, b) => a.distance - b.distance);
    const blockedSides = options.blockedSides;
    for (const candidate of candidates) {
      if (candidate.distance >= 0.33) return "center";
      if (blockedSides?.has(candidate.side)) continue;
      if (item instanceof WorkspaceTabs && item.isStacked && (candidate.side === "left" || candidate.side === "right") && !pointInRect(x, y, item.tabHeaderContainerEl.getBoundingClientRect())) {
        return "center";
      }
      if (item instanceof WorkspaceTabs && candidate.side === "top") {
        const headerRect = item.tabHeaderContainerEl.getBoundingClientRect();
        if (headerRect.height > 0 && y > headerRect.top + headerRect.height / 3) return "center";
      }
      return candidate.side;
    }
    return "center";
  }

  private getDropOverlayRect(event: DragEvent, leaf: WorkspaceLeaf, side: WorkspaceDropTarget["side"], item: WorkspaceItem = leaf): DOMRect | null {
    const sourceRect = item.containerEl.getBoundingClientRect();
    if (sourceRect.width <= 0 || sourceRect.height <= 0) return null;
    if (side === "center") return new DOMRect(sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height);

    const rect = new DOMRect(sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height);
    if (side === "left" || side === "right") {
      const width = Math.max(sourceRect.width / 3, 40);
      rect.width = Math.min(width, sourceRect.width);
      if (side === "right") rect.x = sourceRect.right - rect.width;
    } else {
      const height = Math.max(sourceRect.height / 3, 40);
      rect.height = Math.min(height, sourceRect.height);
      if (side === "bottom") rect.y = sourceRect.bottom - rect.height;
    }
    return rect;
  }

  private getDropOverlayRectForItem(item: WorkspaceItem): DOMRect | null {
    const rect = item.containerEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return new DOMRect(rect.x, rect.y, rect.width, rect.height);
  }

  private getSidedockDropOverlayRect(item: WorkspaceParent): DOMRect | null {
    const collapsed = (item as WorkspaceParent & { collapsed?: boolean }).collapsed === true;
    if (!collapsed) return this.getDropOverlayRectForItem(item);
    const toggleEl = item === this.leftSplit
      ? this.leftSidebarToggleButtonEl
      : item === this.rightSplit
        ? this.rightSidebarToggleButtonEl
        : null;
    if (!toggleEl) return this.getDropOverlayRectForItem(item);
    const rect = toggleEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return this.getDropOverlayRectForItem(item);
    return new DOMRect(rect.x, rect.y, rect.width, rect.height);
  }

  private getFakeTargetRect(leaf: WorkspaceLeaf, side: WorkspaceDropTarget["side"], item: WorkspaceItem = leaf): DOMRect | null {
    if (side === "center") return null;
    const sourceRect = item.containerEl.getBoundingClientRect();
    const edgeRect = this.getDropOverlayRect({} as DragEvent, leaf, side, item);
    if (!edgeRect) return null;
    if (side === "top") return new DOMRect(sourceRect.x, sourceRect.y + edgeRect.height, sourceRect.width, sourceRect.height - edgeRect.height);
    if (side === "bottom") return new DOMRect(sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height - edgeRect.height);
    if (side === "left") return new DOMRect(sourceRect.x + edgeRect.width, sourceRect.y, sourceRect.width - edgeRect.width, sourceRect.height);
    return new DOMRect(sourceRect.x, sourceRect.y, sourceRect.width - edgeRect.width, sourceRect.height);
  }

  private swapLeaves(sourceLeaf: WorkspaceLeaf, targetLeaf: WorkspaceLeaf): boolean {
    const sourceParent = sourceLeaf.parent;
    const targetParent = targetLeaf.parent;
    if (!sourceParent || !targetParent) return false;
    const sourceDimension = sourceLeaf.dimension;
    const targetDimension = targetLeaf.dimension;
    const placeholder = new WorkspaceLeaf(this, undefined, targetParent.containerEl.ownerDocument);

    targetParent.replaceChild(targetLeaf, placeholder);
    sourceParent.replaceChild(sourceLeaf, targetLeaf);
    targetParent.replaceChild(placeholder, sourceLeaf);
    sourceLeaf.setDimension(targetDimension);
    targetLeaf.setDimension(sourceDimension);
    if (targetLeaf.view?.getViewType() === "empty") targetLeaf.detach();
    this.setActiveLeaf(sourceLeaf, { focus: true });
    this.requestResize();
    return true;
  }

  private createLeafInFloatingSplit(data?: WorkspaceWindowInitData, id?: string): WorkspaceLeaf {
    const workspaceWindow = this.openPopout(data);
    const leaf = new WorkspaceLeaf(this, id, workspaceWindow.doc);
    const tabs = new WorkspaceTabs(this, undefined, workspaceWindow.doc);
    tabs.appendChild(leaf);
    workspaceWindow.appendChild(tabs);
    return leaf;
  }

  openPopout(data?: WorkspaceWindowInitData): WorkspaceWindow {
    const ownerWindow = this.rootSplit.containerEl.ownerDocument.defaultView ?? window;
    const popoutWindow = this.openNativePopoutWindow(ownerWindow, data);
    const workspaceWindow = new WorkspaceWindow(this, popoutWindow, data);
    this.floatingSplit.insertChild(this.floatingSplit.children.length, workspaceWindow);
    this.floatingSplit.openPopout();
    return workspaceWindow;
  }

  openPopoutLeaf(data?: WorkspaceWindowInitData): WorkspaceLeaf {
    return this.createLeafInFloatingSplit(data);
  }

  moveLeafToPopout(leaf: WorkspaceLeaf, data?: WorkspaceWindowInitData): WorkspaceWindow | undefined {
    if (!this.canPopoutLeaf(leaf)) return undefined;
    const popoutData = this.getPopoutInitData(leaf, data);
    leaf.parent?.removeChild(leaf);
    leaf.setDimension(null);
    const workspaceWindow = this.openPopout(popoutData);
    const tabs = new WorkspaceTabs(this, undefined, workspaceWindow.doc);
    tabs.appendChild(leaf, false);
    tabs.selectTabIndex(0, false);
    workspaceWindow.appendChild(tabs);
    this.setActiveLeaf(leaf, { focus: true });
    return workspaceWindow;
  }

  private getPopoutInitData(leaf: WorkspaceLeaf, data: WorkspaceWindowInitData = {}): WorkspaceWindowInitData {
    const rect = leaf.containerEl.getBoundingClientRect();
    const size = data.size ?? (rect.width > 0 && rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined);
    const win = leaf.containerEl.ownerDocument.defaultView as Window & { electron?: { webFrame?: { getZoomLevel?: () => number } } } | null;
    const zoom = data.zoom ?? win?.electron?.webFrame?.getZoomLevel?.();
    return {
      ...data,
      ...(size ? { size } : {}),
      ...(zoom != null ? { zoom } : {}),
    };
  }

  private openNativePopoutWindow(ownerWindow: Window, data?: WorkspaceWindowInitData): Window {
    const features = this.getPopoutWindowFeatures(ownerWindow, data);
    try {
      const opened = ownerWindow.open?.("about:blank", "_blank", features);
      if (opened?.document) {
        this.prepareNativePopoutDocument(opened, ownerWindow);
        return opened;
      }
    } catch {
      // jsdom and some locked-down browser contexts do not allow opening windows.
    }
    return ownerWindow;
  }

  private getPopoutWindowFeatures(ownerWindow: Window, data?: WorkspaceWindowInitData): string {
    const features = ["popup"];
    if (data) {
      const x = data.x ?? data.size?.x;
      const y = data.y ?? data.size?.y;
      const width = data.width ?? data.size?.width;
      const height = data.height ?? data.size?.height;
      if (x != null) features.push(`x=${x}`);
      if (y != null) features.push(`y=${y}`);
      if (width != null) features.push(`width=${Math.max(width, 600)}`);
      if (height != null) features.push(`height=${Math.max(height, 600)}`);
    }
    try {
      const background = ownerWindow.getComputedStyle(ownerWindow.document.body).backgroundColor;
      if (background) features.push(`background=${encodeURIComponent(background)}`);
    } catch {
      // Background feature is best-effort.
    }
    return features.join(",");
  }

  private prepareNativePopoutDocument(popoutWindow: Window, ownerWindow: Window): void {
    if (!popoutWindow.document.head.querySelector("base")) {
      const baseEl = popoutWindow.document.createElement("base");
      baseEl.href = ownerWindow.location.href;
      popoutWindow.document.head.appendChild(baseEl);
    }
    (popoutWindow as Window & { app?: App }).app = this.app;
  }

  closeActiveWindow(): boolean {
    const leaf = this.activeLeaf;
    const container = leaf?.getContainer();
    if (!(container instanceof WorkspaceWindow) || container.parent !== this.floatingSplit) return false;
    container.close();
    if (this.floatingSplit.children.length === 0) this.floatingSplit.closePopout();
    return true;
  }

  private getContainerLeaves(leaf: WorkspaceLeaf): WorkspaceLeaf[] {
    const root = leaf.getRoot();
    const leaves: WorkspaceLeaf[] = [];
    if (root instanceof WorkspaceSplit || root instanceof WorkspaceTabs) root.iterateLeaves((item) => leaves.push(item));
    return leaves;
  }

  onLayoutChange(item?: WorkspaceItem): void {
    this.requestUpdateLayout();
    if (item && !this.layoutItemQueue.includes(item)) this.layoutItemQueue.push(item);
  }

  updateLayout(): void {
    if (!this.layoutReady) return;
    while (this.layoutItemQueue.length > 0) {
      const item = this.layoutItemQueue.pop();
      item?.recomputeChildrenDimensions();
    }
    if (this.rootSplit.children.length === 0) {
      const ownerDocument = this.rootSplit.containerEl.ownerDocument;
      const tabs = new WorkspaceTabs(this, undefined, ownerDocument);
      const leaf = new WorkspaceLeaf(this, undefined, ownerDocument);
      if (this.lastTabGroupStacked) tabs.setStacked(true, false);
      tabs.insertChild(0, leaf, false);
      this.rootSplit.insertChild(0, tabs);
      tabs.selectTabIndex(0, false);
    }
    if (!this.isAttached(this.activeLeaf)) {
      const leaf = this.getLayoutRepairLeaf();
      if (leaf) this.setActiveLeaf(leaf, { focus: true });
    }
    const activeTabGroup = getWorkspaceActiveTabGroup(this.activeLeaf?.parent);
    if (activeTabGroup !== this.activeTabGroup) {
      this.activeTabGroup?.containerEl.classList.remove("mod-active");
      this.activeTabGroup = activeTabGroup;
      this.activeTabGroup?.containerEl.classList.add("mod-active");
    }
    this.updateMobileVisibleTabGroup();
    this.cleanupSingletonLeafGroups();
    this.updateFrameless();
    this.updateTitle();
    this.requestSaveLayout();
    this.requestResize();
    this.requestLayoutChangeEvents();
  }

  private getLayoutRepairLeaf(): WorkspaceLeaf | null {
    if (this.activeTabGroup && this.isAttached(this.activeTabGroup)) {
      const candidate = this.activeTabGroup.children[this.activeTabGroup.currentTab];
      if (candidate instanceof WorkspaceLeaf) return candidate;
    }
    return this.getMostRecentLeaf(this.getFocusedContainer())
      ?? this.getMostRecentLeafAcrossAllRoots()
      ?? this.createLeafInParent(this.rootSplit, 0);
  }

  private installBrowserHistoryNavigation(ownerWindow: Window): void {
    ownerWindow.addEventListener("popstate", (event) => {
      event.preventDefault();
    });
    ownerWindow.history.forward = () => this.activeLeaf?.history.forward();
    ownerWindow.history.back = () => this.activeLeaf?.history.back();
    ownerWindow.history.go = (delta?: number) => this.activeLeaf?.history.go(delta ?? 0);
    if (!Platform.isLinux) {
      ownerWindow.addEventListener("mousedown", (event) => {
        if (event.button !== 3 && event.button !== 4) return;
        event.preventDefault();
        event.stopPropagation();
        void (event.button === 3 ? ownerWindow.history.back() : ownerWindow.history.forward());
      }, { capture: true });
    }
  }

  updateTitle(): void {
    const leaf = this.getMostRecentLeaf(this.rootSplit);
    document.title = this.app.getAppTitle(leaf?.getDisplayText() ?? "");
  }

  private updateMobileVisibleTabGroup(): void {
    if (!isMobileRuntime()) return;
    const visible = new Set<WorkspaceItem>();
    const leaf = this.activeTabGroup instanceof MobileDrawer ? this.getMostRecentLeaf() : this.activeLeaf;
    let item: WorkspaceItem | null = leaf?.parent ?? null;
    while (item) {
      visible.add(item);
      item.containerEl.classList.add("mod-visible");
      item = item.parent;
    }
    this.clearHiddenMobileLayoutItems(this.rootSplit, visible);
  }

  private clearHiddenMobileLayoutItems(item: WorkspaceItem, visible: Set<WorkspaceItem>): void {
    if (!visible.has(item)) item.containerEl.classList.remove("mod-visible");
    if (item instanceof WorkspaceParent) {
      for (const child of item.children) {
        if (child instanceof WorkspaceParent) this.clearHiddenMobileLayoutItems(child, visible);
      }
    }
  }

  private getMostRecentLeafAcrossAllRoots(): WorkspaceLeaf | null {
    let leaf: WorkspaceLeaf | null = null;
    this.iterateAllLeaves((candidate) => {
      if (!leaf || leaf.activeTime < candidate.activeTime) leaf = candidate;
    });
    return leaf;
  }

  private cleanupSingletonLeafGroups(): void {
    const counts = new Map<string, number>();
    this.iterateAllLeaves((leaf) => {
      if (leaf.group) counts.set(leaf.group, (counts.get(leaf.group) ?? 0) + 1);
    });
    for (const [group, count] of counts) {
      if (count === 1) {
        for (const leaf of this.getGroupLeaves(group)) leaf.setGroup(null);
      }
    }
  }

  updateFrameless(): void {
    if (!this.layoutReady) return;
    const allTabs: WorkspaceTabs[] = [];
    const collectAllTabs = (item: WorkspaceItem): void => {
      if (item instanceof WorkspaceTabs) {
        allTabs.push(item);
        return;
      }
      if (item instanceof WorkspaceParent) {
        for (const child of item.children) collectAllTabs(child);
      }
    };

    collectAllTabs(this.rootSplit);
    collectAllTabs(this.leftSplit);
    collectAllTabs(this.rightSplit);
    collectAllTabs(this.floatingSplit);
    for (const tabs of allTabs) tabs.containerEl.classList.remove("mod-top", "mod-top-left-space", "mod-top-right-space");

    const markTopTabs = (item: WorkspaceItem): { first: WorkspaceTabs | null; last: WorkspaceTabs | null } => {
      const topTabs: WorkspaceTabs[] = [];
      const visit = (candidate: WorkspaceItem | undefined): void => {
        if (!candidate) return;
        if (candidate instanceof WorkspaceTabs) {
          topTabs.push(candidate);
          return;
        }
        if (candidate instanceof WorkspaceSplit) {
          if (candidate.direction === "vertical") {
            for (const child of candidate.children) visit(child);
          } else {
            visit(candidate.children[0]);
          }
          return;
        }
        if (candidate instanceof WorkspaceParent) {
          for (const child of candidate.children) visit(child);
        }
      };

      visit(item);
      for (const tabs of topTabs) tabs.containerEl.classList.add("mod-top");
      return { first: topTabs[0] ?? null, last: topTabs[topTabs.length - 1] ?? null };
    };

    const rootTopTabs = markTopTabs(this.rootSplit);
    let leftSpaceTabs = rootTopTabs.first;
    let rightSpaceTabs = rootTopTabs.last;
    const leftSidedockTabs = this.leftSplit.children[0];
    const rightSidedockTabs = this.rightSplit.children[0];

    if (leftSidedockTabs instanceof WorkspaceTabs) {
      leftSidedockTabs.containerEl.classList.add("mod-top", "mod-top-left-space");
      if (!(this.leftSplit instanceof WorkspaceSidedock) || !this.leftSplit.collapsed) leftSpaceTabs = leftSidedockTabs;
    }
    if (rightSidedockTabs instanceof WorkspaceTabs) {
      rightSidedockTabs.containerEl.classList.add("mod-top", "mod-top-right-space");
      if (!(this.rightSplit instanceof WorkspaceSidedock) || !this.rightSplit.collapsed) rightSpaceTabs = rightSidedockTabs;
    }

    if (!isMobileRuntime()) {
      leftSpaceTabs?.containerEl.classList.add("mod-top-left-space");
      rightSpaceTabs?.containerEl.classList.add("mod-top-right-space");
      this.updateSidebarTogglePlacement(rootTopTabs, leftSidedockTabs instanceof WorkspaceTabs ? leftSidedockTabs : null, rightSidedockTabs instanceof WorkspaceTabs ? rightSidedockTabs : null);
    }

    for (const child of this.floatingSplit.children) {
      if (!(child instanceof WorkspaceWindow)) continue;
      const topTabs = markTopTabs(child);
      topTabs.first?.containerEl.classList.add("mod-top-left-space");
      topTabs.last?.containerEl.classList.add("mod-top-right-space");
    }
    this.trigger("window-frame-change");
  }

  private updateSidebarTogglePlacement(
    rootTopTabs?: { first: WorkspaceTabs | null; last: WorkspaceTabs | null },
    leftSidedockTabs?: WorkspaceTabs | null,
    rightSidedockTabs?: WorkspaceTabs | null,
  ): void {
    if (isMobileRuntime()) {
      this.leftSidebarToggleButtonEl.remove();
      this.rightSidebarToggleButtonEl.remove();
      return;
    }

    const body = this.containerEl.ownerDocument.body;
    const isMacHiddenTitlebar = body.classList.contains("mod-macos") && body.classList.contains("is-hidden-frameless");
    const shouldPlaceLeftToggleInTabs = !body.classList.contains("show-ribbon") || isMacHiddenTitlebar;
    const leftSidedockOpen = !(this.leftSplit instanceof WorkspaceSidedock) || !this.leftSplit.collapsed;
    const leftTarget = leftSidedockOpen && leftSidedockTabs
      ? leftSidedockTabs
      : rootTopTabs?.first ?? this.getFirstTopTabsFallback(this.rootSplit);
    if (shouldPlaceLeftToggleInTabs && leftTarget) {
      if (leftSidedockOpen && leftTarget === leftSidedockTabs) leftTarget.tabHeaderContainerEl.appendChild(this.leftSidebarToggleButtonEl);
      else leftTarget.tabHeaderContainerEl.prepend(this.leftSidebarToggleButtonEl);
    } else {
      this.leftRibbon.containerEl.prepend(this.leftSidebarToggleButtonEl);
    }

    const rightSidedockOpen = !(this.rightSplit instanceof WorkspaceSidedock) || !this.rightSplit.collapsed;
    const rightTarget = rightSidedockOpen && rightSidedockTabs
      ? rightSidedockTabs
      : rootTopTabs?.last ?? this.getTopTabsFallback(this.rootSplit);

    if (rightTarget) rightTarget.tabHeaderContainerEl.appendChild(this.rightSidebarToggleButtonEl);
    else this.rightSidebarToggleButtonEl.remove();
  }

  private getTopTabsFallback(item: WorkspaceItem): WorkspaceTabs | null {
    if (item instanceof WorkspaceTabs) return item;
    if (!(item instanceof WorkspaceParent)) return null;
    for (let index = item.children.length - 1; index >= 0; index -= 1) {
      const child = item.children[index];
      const tabs = this.getTopTabsFallback(child);
      if (tabs) return tabs;
    }
    return null;
  }

  private getFirstTopTabsFallback(item: WorkspaceItem): WorkspaceTabs | null {
    if (item instanceof WorkspaceTabs) return item;
    if (!(item instanceof WorkspaceParent)) return null;
    for (const child of item.children) {
      const tabs = this.getFirstTopTabsFallback(child);
      if (tabs) return tabs;
    }
    return null;
  }

  private visitLayoutItems(item: WorkspaceItem, callback: (item: WorkspaceItem) => void): void {
    callback(item);
    if (item instanceof WorkspaceParent) {
      for (const child of item.children) this.visitLayoutItems(child, callback);
    }
  }

  onLayoutReady(callback: () => any, pluginId?: string | null): void {
    const callbackPluginId = pluginId === undefined ? this.app.pluginInstaller.loadingPluginId : pluginId;
    if (this.layoutReady || this.onLayoutReadyCallbacks === null) {
      callback();
      return;
    }
    this.onLayoutReadyCallbacks.push({ pluginId: callbackPluginId, callback });
  }

  isLayoutReady(): boolean {
    return this.layoutReady;
  }

  waitForLayoutReadyCallbacks(): Promise<void> {
    return this.layoutReadyCallbacksPromise;
  }

  markLayoutReady(): void {
    if (this.layoutReady) return;
    this.layoutReady = true;
    this.trigger("layout-ready");
    const callbacks = this.onLayoutReadyCallbacks ?? [];
    this.onLayoutReadyCallbacks = null;
    this.layoutReadyCallbacksPromise = new Promise((resolve) => {
      queueMicrotask(() => {
        void this.flushLayoutReadyCallbacks(callbacks).then(resolve, resolve);
      });
    });
    this.requestActiveLeafEvents();
  }

  private async flushLayoutReadyCallbacks(callbacks: LayoutReadyCallbackRecord[]): Promise<void> {
    for (const { pluginId, callback } of callbacks) {
      await nextLayoutReadyCallbackTurn();
      try {
        const result = callback();
        if (isPromiseLike(result)) {
          void result.catch((error: unknown) => this.reportLayoutReadyCallbackError(pluginId, error));
        }
      } catch (error) {
        this.reportLayoutReadyCallbackError(pluginId, error);
      }
    }
  }

  private reportLayoutReadyCallbackError(pluginId: string | null, error: unknown): void {
    if (pluginId) console.error(`Plugin ${pluginId} failed in onLayoutReady callback`, error);
    else console.error(error);
  }

  private findUndoHistoryRoot(rootId: string): WorkspaceSplit | MobileDrawer {
    return [this.rootSplit, this.floatingSplit, this.leftSplit, this.rightSplit].find((root) => root.id === rootId) ?? this.rootSplit;
  }

  private canPopoutLeaf(leaf: WorkspaceLeaf | null | undefined): leaf is WorkspaceLeaf {
    return Boolean(leaf?.view instanceof ItemView);
  }

  private isAttached<T extends WorkspaceItem>(item: T | null | undefined): item is T {
    if (!item) return false;
    const root = item.getRoot();
    return root === this.leftSplit || root === this.rootSplit || root === this.floatingSplit || root === this.rightSplit;
  }
}

function createDebouncedWorkspaceRequest<T>(save: () => Promise<T>, canRun: () => boolean, delay: number): Debouncer<[], Promise<T>> {
  let timer: number | undefined;
  const cancel = (): void => {
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timer = undefined;
  };
  const request = (() => {
    if (!canRun()) return request;
    cancel();
    timer = window.setTimeout(() => {
      timer = undefined;
      if (canRun()) void save();
    }, delay);
    return request;
  }) as Debouncer<[], Promise<T>>;
  request.run = () => {
    cancel();
    if (!canRun()) return;
    return save();
  };
  request.cancel = () => {
    cancel();
    return request;
  };
  return request;
}

function createMicrotaskWorkspaceRequest(fn: () => void): () => void {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    const run = () => {
      queued = false;
      fn();
    };
    if (typeof queueMicrotask === "function") queueMicrotask(run);
    else window.setTimeout(run, 0);
  };
}

function nextLayoutReadyCallbackTurn(): Promise<void> {
  return Promise.resolve();
}

function isFileBackedLeaf(leaf: WorkspaceLeaf): boolean {
  const view = leaf.view as ({ file?: unknown } | null);
  return Boolean(view?.file);
}

function isSplitDirection(value: unknown): value is SplitDirection {
  return value === "vertical" || value === "horizontal";
}

function isInputLike(activeElement: Element | null): boolean {
  if (!activeElement) return false;
  if (activeElement.nodeName === "INPUT") return true;
  const win = activeElement.ownerDocument.defaultView ?? window;
  return activeElement instanceof win.HTMLElement && activeElement.contentEditable === "true";
}

function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function getLeafRect(leaf: WorkspaceLeaf): DOMRect | null {
  const rect = leaf.containerEl.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function getRectCenter(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function getDirectionalLeafScore(
  sourceRect: DOMRect,
  sourceCenter: { x: number; y: number },
  candidateRect: DOMRect,
  candidateCenter: { x: number; y: number },
  direction: "top" | "bottom" | "left" | "right",
): [number, number, number] | null {
  if (direction === "left") {
    if (candidateCenter.x >= sourceCenter.x) return null;
    return [
      Math.max(0, sourceRect.left - candidateRect.right),
      getAxisGap(sourceRect.top, sourceRect.bottom, candidateRect.top, candidateRect.bottom),
      Math.abs(sourceCenter.y - candidateCenter.y),
    ];
  }
  if (direction === "right") {
    if (candidateCenter.x <= sourceCenter.x) return null;
    return [
      Math.max(0, candidateRect.left - sourceRect.right),
      getAxisGap(sourceRect.top, sourceRect.bottom, candidateRect.top, candidateRect.bottom),
      Math.abs(sourceCenter.y - candidateCenter.y),
    ];
  }
  if (direction === "top") {
    if (candidateCenter.y >= sourceCenter.y) return null;
    return [
      Math.max(0, sourceRect.top - candidateRect.bottom),
      getAxisGap(sourceRect.left, sourceRect.right, candidateRect.left, candidateRect.right),
      Math.abs(sourceCenter.x - candidateCenter.x),
    ];
  }
  if (candidateCenter.y <= sourceCenter.y) return null;
  return [
    Math.max(0, candidateRect.top - sourceRect.bottom),
    getAxisGap(sourceRect.left, sourceRect.right, candidateRect.left, candidateRect.right),
    Math.abs(sourceCenter.x - candidateCenter.x),
  ];
}

function getAxisGap(sourceStart: number, sourceEnd: number, candidateStart: number, candidateEnd: number): number {
  if (candidateEnd < sourceStart) return sourceStart - candidateEnd;
  if (candidateStart > sourceEnd) return candidateStart - sourceEnd;
  return 0;
}

function compareDirectionalScore(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    const diff = left[index]! - right[index]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

function eventInsideElement(event: DragEvent, el: HTMLElement): boolean {
  return pointInRect(event.clientX, event.clientY, el.getBoundingClientRect());
}

function getDragEventWindow(event: DragEvent): Window {
  const eventWithWindow = event as DragEvent & { win?: Window };
  return eventWithWindow.win ?? event.view ?? window;
}

function isMobileRuntime(): boolean {
  return document.body.classList.contains("is-mobile") || navigator.userAgent.includes("Mobile");
}

function createClipboardEvent(doc: Document, type: "copy" | "paste" | "cut"): ClipboardEvent {
  const ClipboardEventCtor = doc.defaultView?.ClipboardEvent ?? ClipboardEvent;
  if (typeof ClipboardEventCtor === "function") return new ClipboardEventCtor(type, { bubbles: true, cancelable: true });
  return new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
}

function updateViewStateFilePath(state: InternalViewState, nextPath: string, oldPath: string): boolean {
  const payload = state.state;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const fileState = payload as { file?: unknown };
  if (fileState.file !== oldPath) return false;
  fileState.file = nextPath;
  return true;
}

function withFocusEphemeralState(state: unknown): unknown {
  if (!state || typeof state !== "object") return { focus: true };
  return { ...state, focus: true };
}

function openCallbackUrl(callbackUrl: string, params: Record<string, string>): boolean {
  try {
    const url = new URL(callbackUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (url.protocol.toLowerCase() === "file:") return true;
    window.open(url.toString());
  } catch (error) {
    console.error(error);
  }
  return true;
}
