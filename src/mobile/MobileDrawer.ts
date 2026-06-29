import type { Workspace } from "../workspace/Workspace";
import { WorkspaceParent } from "../workspace/WorkspaceParent";
import type { WorkspaceItem } from "../workspace/WorkspaceItem";
import { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { setChildrenInPlace } from "../dom/dom";
import { setIcon } from "../ui/Icon";

export type MobileDrawerSide = "left" | "right";

export class MobileDrawer extends WorkspaceParent {
  override type = "mobile-drawer";
  override allowSingleChild = true;
  side: MobileDrawerSide;
  currentTab = 0;
  isPinned = false;
  collapsed = true;
  tabOptionsCollapsed = true;
  private openSide: MobileDrawerSide | null = null;
  readonly innerEl: HTMLElement;
  readonly backdropEl: HTMLElement;
  readonly headerEl: HTMLElement;
  readonly tabContainerEl: HTMLElement;
  readonly activeTabEl: HTMLElement;
  readonly activeTabContainerEl: HTMLElement;
  readonly tabsContainerEl: HTMLElement;
  readonly tabOptionsEl: HTMLElement;
  readonly activeTabHeaderEl: HTMLElement;
  readonly activeTabHeaderInnerEl: HTMLElement;
  readonly activeTabHeaderIconEl: HTMLElement;
  readonly activeTabHeaderTitleEl: HTMLElement;
  readonly activeTabHeaderChevronEl: HTMLElement;
  readonly tabSelectEl: HTMLElement;
  readonly tabsListEl: HTMLElement;
  readonly tabOptionsListEl: HTMLElement;
  readonly activeTabContentEl: HTMLElement;

  constructor(workspace: Workspace, side: MobileDrawerSide) {
    super(workspace);
    this.side = side;
    this.autoManageDOM = false;
    this.containerEl.className = `workspace-drawer mod-${side}`;
    this.containerEl.replaceChildren();
    this.backdropEl = document.createElement("div");
    this.backdropEl.className = "workspace-drawer-backdrop";
    this.backdropEl.addEventListener("click", () => this.close());
    this.innerEl = document.createElement("div");
    this.innerEl.className = "workspace-drawer-inner";
    this.headerEl = document.createElement("div");
    this.headerEl.className = "workspace-drawer-header";
    this.tabContainerEl = document.createElement("div");
    this.tabContainerEl.className = "workspace-drawer-tab-container";
    this.activeTabContainerEl = document.createElement("div");
    this.activeTabContainerEl.className = "workspace-drawer-active-tab-container";
    this.activeTabEl = this.activeTabContainerEl;
    this.tabOptionsEl = document.createElement("div");
    this.tabOptionsEl.className = "workspace-drawer-tab-options";
    this.tabsContainerEl = this.tabOptionsEl;
    this.activeTabHeaderEl = document.createElement("div");
    this.activeTabHeaderEl.className = "workspace-tab-header workspace-drawer-tab-select";
    this.activeTabHeaderEl.setAttribute("data-ignore-swipe", "true");
    this.activeTabHeaderEl.addEventListener("click", () => this.setTabOptionsCollapsed(!this.tabOptionsCollapsed));
    this.activeTabHeaderEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const leaf = this.children[this.currentTab];
      if (leaf instanceof WorkspaceLeaf) leaf.openTabHeaderMenu(event, this.activeTabHeaderEl);
    });
    this.activeTabHeaderInnerEl = document.createElement("div");
    this.activeTabHeaderInnerEl.className = "workspace-tab-header-inner";
    this.activeTabHeaderIconEl = document.createElement("span");
    this.activeTabHeaderIconEl.className = "workspace-tab-header-inner-icon";
    this.activeTabHeaderTitleEl = document.createElement("span");
    this.activeTabHeaderTitleEl.className = "workspace-tab-header-inner-title";
    this.activeTabHeaderChevronEl = document.createElement("div");
    this.activeTabHeaderChevronEl.className = "workspace-tab-header-inner-chevron";
    setIcon(this.activeTabHeaderChevronEl, "lucide-chevrons-up-down");
    this.activeTabHeaderInnerEl.append(this.activeTabHeaderIconEl, this.activeTabHeaderTitleEl, this.activeTabHeaderChevronEl);
    this.activeTabHeaderEl.append(this.activeTabHeaderInnerEl);
    this.tabSelectEl = this.activeTabHeaderEl;
    this.tabOptionsListEl = document.createElement("div");
    this.tabOptionsListEl.className = "workspace-drawer-tab-options-list";
    this.tabsListEl = this.tabOptionsListEl;
    this.tabOptionsListEl.addEventListener("click", (event) => this.onTabOptionsClick(event));
    this.activeTabContentEl = document.createElement("div");
    this.activeTabContentEl.className = "workspace-drawer-active-tab-content";
    this.tabOptionsEl.append(this.activeTabHeaderEl, this.tabOptionsListEl);
    this.activeTabContainerEl.append(this.tabOptionsEl, this.activeTabContentEl);
    this.tabContainerEl.append(this.activeTabContainerEl);
    this.innerEl.append(this.headerEl, this.tabContainerEl);
    this.containerEl.append(this.backdropEl, this.innerEl);
  }

  override appendChild(child: WorkspaceItem, activate = true): void {
    this.insertChild(this.children.length, child, activate);
  }

  override insertChild(index: number, child: WorkspaceItem, activate = true): void {
    super.insertChild(index, child);
    if (child instanceof WorkspaceLeaf) child.tabHeaderEl.style.width = "";
    if (activate) this.selectTabIndex(this.children.indexOf(child));
  }

  override removeChild(child: WorkspaceItem): void {
    const index = this.children.indexOf(child);
    const previousCurrentTab = this.currentTab;
    super.removeChild(child);
    if (this.children.length > 0 && index === previousCurrentTab) {
      this.currentTab = Math.min(index, this.children.length - 1);
      this.workspace.onLayoutChange(this);
    } else if (index !== -1 && index < this.currentTab) {
      this.currentTab -= 1;
    }
  }

  open(side: MobileDrawerSide = this.side): void {
    if (side !== this.side) return;
    this.expand();
  }

  expand(): void {
    if (!this.collapsed) return;
    this.collapsed = false;
    this.openSide = this.side;
    this.containerEl.classList.remove("mod-left", "mod-right");
    this.containerEl.classList.add("is-open", `mod-${this.side}`);
    this.app.workspace.trigger("mobile-drawer-open", this.side);
    this.app.workspace.requestResize();
  }

  close(): void {
    this.collapse();
  }

  collapse(): void {
    if (this.collapsed) return;
    const side = this.openSide;
    this.collapsed = true;
    this.openSide = null;
    this.containerEl.className = `workspace-drawer mod-${this.side}`;
    this.app.workspace.trigger("mobile-drawer-close", side);
    this.app.workspace.requestResize();
  }

  toggle(side: MobileDrawerSide): void {
    if (this.openSide === side) this.close();
    else this.open(side);
  }

  setPinned(pinned: boolean, options: { layout?: boolean } = {}): void {
    this.isPinned = pinned;
    this.containerEl.classList.toggle("is-pinned", pinned);
    if (pinned) this.expand();
    else this.collapse();
    if (options.layout !== false) this.app.workspace.requestUpdateLayout();
  }

  selectTabIndex(index: number): void {
    if (this.children.length === 0) {
      this.currentTab = 0;
      this.recomputeChildrenDimensions();
      return;
    }
    this.currentTab = index;
    this.recomputeChildrenDimensions();
    this.app.workspace.requestSaveLayout();
    this.app.workspace.requestResize();
  }

  override recomputeChildrenDimensions(): void {
    if (this.children.length === 0) {
      this.currentTab = 0;
      this.activeTabContentEl.replaceChildren();
      this.updateChrome();
      return;
    }
    this.currentTab = Math.max(0, Math.min(this.currentTab, this.children.length - 1));
    const activeChild = this.children[this.currentTab];
    if (activeChild) setChildrenInPlace(this.activeTabContentEl, [activeChild.containerEl]);
    else setChildrenInPlace(this.activeTabContentEl, []);
    this.updateCurrentTab();
    const tabHeaders = this.children.map((child, index) => {
      const tabHeaderEl = child instanceof WorkspaceLeaf ? child.tabHeaderEl : child.containerEl;
      tabHeaderEl.setAttribute("draggable", "false");
      tabHeaderEl.classList.toggle("is-active", index === this.currentTab);
      return tabHeaderEl;
    });
    setChildrenInPlace(this.tabsListEl, tabHeaders);
    this.tabsContainerEl.classList.toggle("is-collapsed", this.tabOptionsCollapsed);
    this.updateChrome();
  }

  setTabOptionsCollapsed(collapsed: boolean): void {
    this.tabOptionsCollapsed = collapsed;
    this.tabsContainerEl.classList.toggle("is-collapsed", collapsed);
  }

  updateCurrentTab(): void {
    const activeChild = this.children[this.currentTab];
    if (activeChild instanceof WorkspaceLeaf) {
      setIcon(this.activeTabHeaderIconEl, activeChild.getIcon());
      this.activeTabHeaderTitleEl.textContent = activeChild.getDisplayText();
      return;
    }
    setIcon(this.activeTabHeaderIconEl, "lucide-square-dashed");
    this.activeTabHeaderTitleEl.textContent = "Empty";
  }

  openLeaf(leaf: WorkspaceLeaf): void {
    const index = this.children.indexOf(leaf);
    if (index !== -1) this.selectTabIndex(index);
  }

  addHeaderButton(icon: string, callback: (event: MouseEvent) => void): HTMLElement {
    const buttonEl = document.createElement("div");
    buttonEl.className = "clickable-icon workspace-drawer-header-icon mod-raised";
    setIcon(buttonEl, icon);
    buttonEl.addEventListener("click", callback);
    this.headerEl.appendChild(buttonEl);
    return buttonEl;
  }

  clear(): void {
    for (const child of [...this.children]) child.detach();
    this.children = [];
    this.activeTabContentEl.replaceChildren();
    this.currentTab = 0;
  }

  getOpenSide(): MobileDrawerSide | null {
    return this.openSide;
  }

  override serialize(): Record<string, unknown> {
    return {
      ...super.serialize(),
      currentTab: this.currentTab,
      ...(this.isPinned ? { pinned: true } : {}),
    };
  }

  private onTabOptionsClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target.closest(".workspace-tab-header") : null;
    if (!target) return;
    const index = this.children.findIndex((child) => child instanceof WorkspaceLeaf && child.tabHeaderEl === target);
    if (index === -1) return;
    this.selectTabIndex(index);
    if (!this.isPinned || !document.body.classList.contains("is-phone")) {
      this.workspace.setActiveLeaf(this.children[index] as WorkspaceLeaf, { focus: true });
    }
    this.setTabOptionsCollapsed(true);
  }

  private updateChrome(): void {
    if (this.side === "left") {
      const ribbonEl = this.app.workspace.leftRibbon.containerEl;
      ribbonEl.classList.remove("workspace-ribbon");
      ribbonEl.classList.add("workspace-drawer-ribbon");
      setChildrenInPlace(this.innerEl, [ribbonEl, this.headerEl, this.tabContainerEl]);
      return;
    }
    setChildrenInPlace(this.innerEl, [this.headerEl, this.tabContainerEl]);
  }
}

export const WorkspaceMobileDrawer = MobileDrawer;
