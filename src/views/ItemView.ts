import { createDiv, createEl } from "../dom/dom";
import { View } from "./View";
import { Menu, MenuItem } from "../ui/Menu";
import { setIcon } from "../ui/Icon";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import type { DragDropResult, DragSource } from "../drag/DragManager";
import { Keymap } from "../hotkeys/Keymap";
import { Platform } from "../platform/Platform";
import { setTooltip } from "../ui/Popover";

export class ItemView extends View {
  readonly headerEl: HTMLElement;
  readonly headerLeftEl: HTMLElement;
  readonly leftSidebarToggleEl: HTMLElement | null = null;
  readonly navButtonsEl: HTMLElement;
  readonly titleContainerEl: HTMLElement;
  readonly titleParentEl: HTMLElement;
  readonly titleEl: HTMLElement;
  readonly actionsEl: HTMLElement;
  readonly backButtonEl: HTMLElement;
  readonly forwardButtonEl: HTMLElement;
  readonly moreOptionsButtonEl: HTMLElement;
  readonly contentEl: HTMLElement;
  canDropAnywhere = false;
  private titleFadeUpdateTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.headerEl = createDiv("view-header", this.containerEl);
    this.headerLeftEl = createDiv("view-header-left", this.headerEl);
    if (Platform.isMobile) {
      this.leftSidebarToggleEl = createEl("button", "view-action clickable-icon mod-left-split-toggle mod-raised sidebar-toggle-button mod-left", this.headerLeftEl);
      setTooltip(this.leftSidebarToggleEl, "Expand");
      setIcon(this.leftSidebarToggleEl, "sidebar-toggle-button-icon");
      this.leftSidebarToggleEl.addEventListener("click", () => {
        navigator.vibrate?.(100);
        this.app.workspace.leftSplit.toggle("left");
      });
    }
    this.navButtonsEl = createDiv("view-header-nav-buttons", this.headerLeftEl);
    this.backButtonEl = this.createNavButton("Back", "lucide-arrow-left", -1);
    this.forwardButtonEl = this.createNavButton("Forward", "lucide-arrow-right", 1);
    this.navButtonsEl.append(this.backButtonEl, this.forwardButtonEl);
    this.titleContainerEl = createDiv("view-header-title-container mod-at-start mod-fade", this.headerEl);
    this.titleParentEl = createDiv("view-header-title-parent", this.titleContainerEl);
    this.titleEl = createDiv("view-header-title", this.titleContainerEl);
    this.titleEl.addEventListener("scroll", () => this.scheduleTitleFadeUpdate());
    this.updateTitleFade();
    this.actionsEl = createDiv("view-actions", this.headerEl);
    if (Platform.isPhone) this.actionsEl.classList.add("mod-raised");
    this.moreOptionsButtonEl = this.addAction("lucide-more-vertical", "More options", (event) => this.onMoreOptions(event));
    this.moreOptionsButtonEl.addEventListener("contextmenu", (event) => {
      if (!Platform.isPhone) return;
      event.preventDefault();
      this.app.workspace.rightSplit.expand();
    });
    this.contentEl = createDiv("view-content", this.containerEl);
    this.app.dragManager.handleDrop(this.containerEl, (event, source, hovering) => this.handleDrop(event, source, hovering));
  }

  override onload(): void {
    this.titleEl.textContent = this.getDisplayText();
    this.registerEvent(this.leaf.on("group-change", this.onGroupChange, this));
    this.registerEvent(this.leaf.on("history-change", this.updateNavButtons, this));
    this.updateNavButtons();
    this.updateTitleFade();
  }

  onMoreOptionsMenu(_menu: Menu): void {}

  onGroupChange(): void {}

  onMoreOptions(event: MouseEvent): void {
    event.preventDefault();
    const target = event.target instanceof Element ? event.target : this.moreOptionsButtonEl;
    const menu = new Menu(target.ownerDocument).addSections(["close", "pane", "open", "action", "find", "info", "info.copy", "view", "view.linked", "system", "", "danger"]);
    menu.setSectionSubmenu("info.copy", { title: "Copy path", icon: "lucide-clipboard" });
    menu.setSectionSubmenu("view.linked", { title: "Open linked view", icon: "lucide-link" });
    this.onPaneMenu(menu, "more-options");
    this.onMoreOptionsMenu(menu);
    this.app.workspace.trigger("leaf-menu", menu, this.leaf);
    const rect = target.getBoundingClientRect();
    menu.setParentElement(target).showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: true });
  }

  override onPaneMenu(menu: Menu, source?: string): void {
    super.onPaneMenu(menu, source);
    const leaf = this.leaf;
    if (Platform.isPhone && source === "more-options") {
      menu.addItem((item) => item
        .setSection("close")
        .setTitle("Close")
        .setIcon("lucide-x")
        .onClick(() => leaf.detach()));
      menu.addItem((item) => item
        .setSection("action")
        .setTitle(leaf.pinned ? "Unpin" : "Pin")
        .setIcon(leaf.pinned ? "lucide-pin-off" : "lucide-pin")
        .onClick(() => leaf.togglePinned()));
    }
    if (Platform.canSplit && leaf.canPin()) {
      menu.addItem((item) => item
        .setSection("open")
        .setTitle("Split right")
        .setDisabled(this.app.workspace.isInSidebar(leaf))
        .setIcon("lucide-separator-vertical")
        .onClick(() => this.duplicateIntoSplit("vertical")))
      .addItem((item) => item
        .setSection("open")
        .setTitle("Split down")
        .setIcon("lucide-separator-horizontal")
        .onClick(() => this.duplicateIntoSplit("horizontal")));
    }
  }

  override onTabMenu(menu: Menu): void {
    super.onTabMenu(menu);
    const leaf = this.leaf;
    if (leaf.canPin()) {
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle(leaf.pinned ? "Unpin" : "Pin")
        .setIcon("lucide-pin")
        .onClick(() => leaf.togglePinned()));
    }
    if (leaf.group) {
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle("Unlink tab")
        .setIcon("lucide-link")
        .onClick(() => leaf.setGroup(null)));
    } else if (leaf.canPin()) {
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle("Link tab")
        .setIcon("lucide-link")
        .onClick(() => this.app.workspace.onStartLink(leaf)));
    }
    if (Platform.canPopoutWindow) {
      menu.addItem((item) => item
        .setSection("open")
        .setTitle("Move to new window")
        .setIcon("lucide-picture-in-picture")
        .onClick(() => {
          this.app.workspace.moveLeafToPopout(leaf);
        }));
    }
  }

  addAction(icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
    const button = this.containerEl.ownerDocument.createElement("button");
    button.className = "clickable-icon view-action";
    setTooltip(button, title);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      if (event.button === 0 || event.button === 1) callback(event);
    });
    setIcon(button, icon);
    this.actionsEl.prepend(button);
    return button;
  }

  override handleDrop(event: DragEvent, source: DragSource | null, hovering: boolean): DragDropResult {
    if (!source) return undefined;
    if (!this.canDropAnywhere && !isOpenInCurrentLeafModifier(event) && !this.headerEl.contains(event.target as Node | null)) return undefined;
    const result = this.leaf.handleDrop(event, source, hovering);
    if (!result) return undefined;
    return {
      ...result,
      hoverEl: this.headerEl,
      hoverClass: "is-highlighted",
    };
  }

  updateHeader(): void {
    this.titleEl.textContent = this.getDisplayText();
    this.updateNavButtons();
    this.updateTitleFade();
  }

  updateNavButtons(): void {
    setClickableIconDisabled(this.backButtonEl, !this.leaf.canGoBack());
    setClickableIconDisabled(this.forwardButtonEl, !this.leaf.canGoForward());
  }

  private createNavButton(title: string, icon: string, direction: -1 | 1): HTMLElement {
    const button = this.containerEl.ownerDocument.createElement("button");
    button.className = "clickable-icon";
    setIcon(button, icon);
    setTooltip(button, title);
    button.setAttribute("aria-disabled", "true");
    button.addEventListener("click", (event) => {
      if (event.button === 2) return;
      void this.navigateHistory(direction, event);
    });
    button.addEventListener("contextmenu", (event) => this.openHistoryMenu(event, button, direction, false));
    button.addEventListener("mousedown", (event) => this.armHistoryMenuPress(event, button, direction));
    return button;
  }

  private async navigateHistory(direction: -1 | 1, event?: MouseEvent): Promise<void> {
    await this.navigateHistoryDelta(direction, event);
  }

  private async navigateHistoryDelta(delta: number, event?: MouseEvent | KeyboardEvent): Promise<void> {
    const paneType = event ? Keymap.isModEvent(event) : false;
    const leaf = paneType ? await this.app.workspace.duplicateLeaf(this.leaf, paneType) : this.leaf;
    await leaf.history.go(delta);
  }

  private openHistoryMenu(event: MouseEvent, button: HTMLElement, direction: -1 | 1, selectOnMouseUp: boolean): Menu | null {
    event.preventDefault();
    const entries = direction < 0 ? this.leaf.history.backHistory : this.leaf.history.forwardHistory;
    if (entries.length === 0) return null;
    const menu = new Menu(button.ownerDocument);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const distance = direction * (entries.length - index);
      menu.addItem((item) => item
        .setTitle(truncateHistoryTitle(entry.title ?? "", 50))
        .setIcon(entry.icon ?? null)
        .onClick((clickEvent) => void this.navigateHistoryDelta(distance, clickEvent)));
    }
    const rect = button.getBoundingClientRect();
    menu.setParentElement(button).showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true });
    if (selectOnMouseUp) {
      menu.dom.addEventListener("mouseup", (mouseUpEvent) => {
        const target = mouseUpEvent.target instanceof Node ? mouseUpEvent.target : null;
        if (!target) return;
        window.setTimeout(() => {
          for (const item of menu.items) {
            if (item instanceof MenuItem && item.dom.contains(target)) {
              item.handleEvent(mouseUpEvent);
              return;
            }
          }
        });
      });
    }
    return menu;
  }

  private armHistoryMenuPress(event: MouseEvent, button: HTMLElement, direction: -1 | 1): void {
    const win = button.ownerDocument.defaultView ?? window;
    const openMenu = (): void => {
      cleanup();
      this.openHistoryMenu(event, button, direction, true);
    };
    const timer = win.setTimeout(openMenu, 400);
    const cleanup = (): void => {
      win.removeEventListener("mouseup", onMouseUp);
      win.removeEventListener("mousemove", onMouseMove);
      win.clearTimeout(timer);
    };
    const onMouseUp = (): void => cleanup();
    const onMouseMove = (moveEvent: MouseEvent): void => {
      const dx = moveEvent.clientX - event.clientX;
      const dy = moveEvent.clientY - event.clientY;
      if (dx * dx + dy * dy <= 25) return;
      cleanup();
      if (dy > 0 && dy > Math.abs(dx)) this.openHistoryMenu(event, button, direction, true);
    };
    win.addEventListener("mouseup", onMouseUp);
    win.addEventListener("mousemove", onMouseMove);
  }

  private duplicateIntoSplit(direction: "vertical" | "horizontal"): void {
    void this.app.workspace.duplicateLeaf(this.leaf, direction);
  }

  private updateTitleFade(): void {
    const scrollLeft = this.titleEl.scrollLeft;
    const scrollWidth = this.titleEl.scrollWidth;
    const offsetWidth = this.titleEl.offsetWidth;
    this.titleContainerEl.classList.toggle("mod-at-start", scrollLeft === 0);
    this.titleContainerEl.classList.toggle("mod-at-end", Math.ceil(scrollLeft) >= scrollWidth - offsetWidth);
  }

  private scheduleTitleFadeUpdate(): void {
    if (this.titleFadeUpdateTimer !== null) return;
    const win = this.titleEl.ownerDocument.defaultView ?? window;
    this.titleFadeUpdateTimer = win.setTimeout(() => {
      this.titleFadeUpdateTimer = null;
      this.updateTitleFade();
    }, 10);
  }
}

function setClickableIconDisabled(el: HTMLElement, disabled: boolean): void {
  el.setAttribute("aria-disabled", disabled ? "true" : "false");
}

function truncateHistoryTitle(title: string, maxLength: number): string {
  return title.length <= maxLength ? title : `${title.slice(0, maxLength - 1).trim()}\u2026`;
}

function isOpenInCurrentLeafModifier(event: DragEvent): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? event.shiftKey : event.altKey;
}
