import type { Workspace } from "./Workspace";
import type { WorkspaceItem } from "./WorkspaceItem";
import { WorkspaceRoot } from "./WorkspaceRoot";
import type { SplitDirection } from "./WorkspaceSplit";
import { getActiveWindow, resetActiveWindow, setActiveWindow } from "../dom/ActiveDocument";
import { installDomExtensions } from "../dom/dom";
import type { EventRef } from "../core/Events";
import { unregisterEventRef } from "../core/EventRefInternal";
import { FrameDom } from "../app/FrameDom";
import { applyObsidianBodyClasses, installFocusBodyClassSync, installPopoutBodyClassSync, syncBodyThemeClasses, syncObsidianConfigBodyClasses } from "../app/BodyClasses";

export interface WorkspaceWindowState {
  id?: string;
  direction?: SplitDirection;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  maximize?: boolean;
  zoom?: number;
  size?: { x?: number; y?: number; width?: number; height?: number };
}

export class WorkspaceWindow extends WorkspaceRoot {
  readonly win: Window;
  readonly doc: Document;
  readonly frameDom: FrameDom;
  readonly appContainerEl: HTMLElement;
  readonly horizontalMainContainerEl: HTMLElement;
  readonly workspaceEl: HTMLElement;
  readonly statusBarEl: HTMLElement | null = null;
  x: number | null = null;
  y: number | null = null;
  width: number | null = null;
  height: number | null = null;
  maximize = false;
  zoom: number | null = null;
  size: { x?: number; y?: number; width?: number; height?: number } | null = null;
  private closing = false;
  private readonly beforeUnloadHandler = (event: BeforeUnloadEvent) => this.onBeforeUnload(event);
  private quitRef: EventRef | null = null;
  private layoutChangeRef: EventRef | null = null;
  private focusClassCleanup: (() => void) | null = null;
  private bodyClassSyncCleanup: (() => void) | null = null;

  constructor(workspace: Workspace, win: Window = window, state: WorkspaceWindowState = {}) {
    super(workspace, state.id, win.document);
    this.win = win;
    this.doc = win.document;
    installDomExtensions(win as Window & typeof globalThis);
    this.installAnimationFrameFallback();
    this.installPopoutDocumentBootstrap();
    (this.win as Window & { app?: unknown }).app = this.workspace.app;
    this.type = "window";
    this.setDirection(state.direction ?? "vertical");
    this.containerEl.classList.add("workspace-window");
    applyObsidianBodyClasses(this.doc.body, win);
    syncObsidianConfigBodyClasses(this.doc.body, this.workspace.app);
    syncBodyThemeClasses(this.doc.body);
    this.focusClassCleanup = installFocusBodyClassSync(win);
    this.doc.body.classList.add("is-popout-window");
    this.frameDom = new FrameDom(this.doc, { hidden: true, win });
    this.bodyClassSyncCleanup = installPopoutBodyClassSync(this.workspace.app.dom.appContainerEl.ownerDocument.body, this.doc.body);
    this.appContainerEl = this.createDiv("app-container", this.doc.body);
    this.frameDom.titleBarEl.after(this.appContainerEl);
    this.horizontalMainContainerEl = this.createDiv("horizontal-main-container", this.appContainerEl);
    this.workspaceEl = this.createDiv("workspace", this.horizontalMainContainerEl);
    this.workspaceEl.appendChild(this.containerEl);
    this.loadWindowState(state);
    this.win.addEventListener("resize", () => this.onResize());
    this.win.addEventListener("beforeunload", this.beforeUnloadHandler);
    this.win.addEventListener("focus", () => this.onFocus());
    this.quitRef = this.workspace.on("quit", () => {
      if (this.win !== window && !this.win.closed) this.win.close();
    });
    this.layoutChangeRef = this.workspace.on("layout-change", () => this.updateTitle());
    this.workspace.trigger("window-open", this, this.win);
    this.updateTitle();
  }

  focus(): void {
    this.win.focus();
    this.onFocus();
  }

  override appendChild(child: WorkspaceItem): void {
    super.appendChild(child);
  }

  override removeChild(child: WorkspaceItem): void {
    super.removeChild(child);
    if (!this.closing && this.children.length === 0) this.close();
  }

  loadWindowState(state: WorkspaceWindowState): void {
    this.x = state.x ?? state.size?.x ?? null;
    this.y = state.y ?? state.size?.y ?? null;
    this.width = state.width ?? state.size?.width ?? null;
    this.height = state.height ?? state.size?.height ?? null;
    this.maximize = state.maximize ?? false;
    this.zoom = state.zoom ?? null;
    this.size = this.x != null || this.y != null || this.width != null || this.height != null
      ? {
          ...(this.x == null ? {} : { x: this.x }),
          ...(this.y == null ? {} : { y: this.y }),
          ...(this.width == null ? {} : { width: this.width }),
          ...(this.height == null ? {} : { height: this.height }),
        }
      : null;
    if (this.width != null) this.containerEl.style.width = `${this.width}px`;
    if (this.height != null) this.containerEl.style.height = `${this.height}px`;
  }

  updateSize(): void {
    const electronWindow = (this.win as Window & {
      electronWindow?: {
        isMaximized?: () => boolean;
        isMinimized?: () => boolean;
        isFullScreen?: () => boolean;
        getBounds?: () => { x: number; y: number; width: number; height: number };
      };
    }).electronWindow;
    if (
      electronWindow?.getBounds
      && !electronWindow.isMaximized?.()
      && !electronWindow.isMinimized?.()
      && !electronWindow.isFullScreen?.()
    ) {
      const bounds = electronWindow.getBounds();
      this.x = bounds.x;
      this.y = bounds.y;
      this.width = bounds.width;
      this.height = bounds.height;
      this.size = bounds;
      return;
    }
    if (this.isMaximized() || this.isMinimized() || this.isFullscreen()) return;
    this.x = this.win.screenX;
    this.y = this.win.screenY;
    this.width = this.win.outerWidth;
    this.height = this.win.outerHeight;
    this.size = {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    };
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    if (this.workspace.activeLeaf && this.workspace.activeLeaf.getRoot() === this) {
      const fallback = this.workspace.getMostRecentRootLeaf() ?? this.workspace.getMostRecentLeaf();
      if (fallback && fallback.getRoot() !== this) this.workspace.setActiveLeaf(fallback);
    }
    for (const child of [...this.children]) child.detach();
    this.children = [];
    this.win.removeEventListener("beforeunload", this.beforeUnloadHandler);
    this.focusClassCleanup?.();
    this.focusClassCleanup = null;
    this.bodyClassSyncCleanup?.();
    this.bodyClassSyncCleanup = null;
    if (this.quitRef) unregisterEventRef(this.quitRef);
    this.quitRef = null;
    if (this.layoutChangeRef) unregisterEventRef(this.layoutChangeRef);
    this.layoutChangeRef = null;
    this.workspace.floatingSplit.removeChild(this);
    if (this.workspace.floatingSplit.children.length === 0) this.workspace.floatingSplit.closePopout();
    this.appContainerEl.remove();
    this.frameDom.remove();
    if (this.win === getActiveWindow()) resetActiveWindow();
    if (this.win !== window && !this.win.closed) {
      try {
        this.win.close();
      } catch {
        // Popout close is best-effort outside Electron.
      }
    }
    this.workspace.trigger("window-close", this, this.win);
  }

  override detach(): void {
    this.close();
  }

  private createDiv(className: string, parentEl: HTMLElement): HTMLElement {
    const el = this.doc.createElement("div");
    el.className = className;
    parentEl.appendChild(el);
    return el;
  }

  private installAnimationFrameFallback(): void {
    const parentWin = this.workspace.app.dom.appContainerEl.ownerDocument.defaultView ?? window;
    if (!this.win.requestAnimationFrame) {
      this.win.requestAnimationFrame = parentWin.requestAnimationFrame?.bind(parentWin) ?? ((callback) => this.win.setTimeout(() => callback(Date.now()), 16));
    }
    if (!this.win.cancelAnimationFrame) {
      this.win.cancelAnimationFrame = parentWin.cancelAnimationFrame?.bind(parentWin) ?? ((handle) => this.win.clearTimeout(handle));
    }
  }

  private installPopoutDocumentBootstrap(): void {
    const parentWin = this.workspace.app.dom.appContainerEl.ownerDocument.defaultView ?? window;
    if (this.win === parentWin) return;
    if (!this.doc.head.querySelector("base")) {
      const baseEl = this.doc.createElement("base");
      baseEl.href = parentWin.location.href;
      this.doc.head.appendChild(baseEl);
    }
    const popoutWin = this.win as Window & { history?: History };
    if (!popoutWin.history || popoutWin.history === parentWin.history) {
      Object.defineProperty(popoutWin, "history", { configurable: true, value: Object.create(parentWin.history) as History });
    }
    popoutWin.history.forward = () => parentWin.history.forward();
    popoutWin.history.back = () => parentWin.history.back();
    popoutWin.history.go = (delta?: number) => parentWin.history.go(delta);
  }

  override onFocus(): void {
    setActiveWindow(this.win);
    super.onFocus();
  }

  private onResize(): void {
    this.iterateLeaves((leaf) => (leaf.view as { onResize?: () => void } | null)?.onResize?.());
    this.workspace.requestSaveLayout();
    this.updateSize();
  }

  updateTitle(): void {
    const leaf = this.workspace.getMostRecentLeaf(this);
    this.doc.title = this.workspace.app.getAppTitle(leaf?.getDisplayText() ?? "");
    this.frameDom.updateTitle(this.doc.title);
    this.frameDom.updateStatus();
  }

  private onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.isQuitting()) {
      event.preventDefault();
      return;
    }
    this.close();
  }

  private isQuitting(): boolean {
    const electron = (this.win as Window & { electron?: { ipcRenderer?: { sendSync?: (channel: string) => unknown } } }).electron;
    return electron?.ipcRenderer?.sendSync?.("is-quitting") === true;
  }

  private isMaximized(): boolean {
    const win = this.win as Window & { isMaximized?: () => boolean };
    return win.isMaximized?.() ?? this.maximize;
  }

  private isMinimized(): boolean {
    const win = this.win as Window & { isMinimized?: () => boolean };
    return Boolean(win.isMinimized?.());
  }

  private isFullscreen(): boolean {
    return Boolean(this.doc.fullscreenElement);
  }

  protected override getDocument(): Document {
    return this.doc;
  }
}
