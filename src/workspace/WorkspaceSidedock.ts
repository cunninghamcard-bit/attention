import { WorkspaceSplit } from "./WorkspaceSplit";
import { setIcon } from "../ui/Icon";
import type { Workspace } from "./Workspace";
import type { WorkspaceItem } from "./WorkspaceItem";

const SIDEDOCK_MIN_WIDTH = 200;

export class WorkspaceSidedock extends WorkspaceSplit {
  collapsed = false;
  width: number | null = 300;
  readonly side: "left" | "right";
  readonly emptyStateEl: HTMLElement;
  readonly vaultProfileEl: HTMLElement | null;

  constructor(workspace: Workspace, side: "left" | "right", ownerDocument?: Document) {
    super(workspace, "horizontal", undefined, ownerDocument);
    this.side = side;
    this.containerEl.classList.add("mod-sidedock", `mod-${side}-split`);
    this.resizeHandleEl.addEventListener("mousedown", (event) => this.onSidedockResizeStart(event));
    this.workspace.containerEl.classList.add(`is-${this.side}-sidedock-open`);
    this.vaultProfileEl = side === "left" ? this.createVaultProfile() : null;
    if (this.vaultProfileEl) this.containerEl.appendChild(this.vaultProfileEl);
    const doc = this.containerEl.ownerDocument;
    this.emptyStateEl = doc.createElement("div");
    this.emptyStateEl.className = "workspace-sidedock-empty-state";
    const emptyTextEl = doc.createElement("p");
    emptyTextEl.className = "u-muted";
    emptyTextEl.textContent = "No views";
    this.emptyStateEl.appendChild(emptyTextEl);
    this.containerEl.appendChild(this.emptyStateEl);
    this.containerEl.style.width = `${this.width}px`;
  }

  appendChild(child: WorkspaceItem): void {
    super.appendChild(child);
  }

  removeChild(child: WorkspaceItem): void {
    super.removeChild(child);
  }

  override recomputeChildrenDimensions(): void {
    super.recomputeChildrenDimensions();
    this.updateEmptyState();
  }

  override serialize(): Record<string, unknown> {
    return {
      ...super.serialize(),
      ...(this.width == null ? {} : { width: this.width }),
      ...(this.collapsed ? { collapsed: true } : {}),
    };
  }

  toggle(_side?: "left" | "right"): void {
    if (this.collapsed) this.expand();
    else this.collapse();
  }

  collapse(): void {
    if (this.collapsed) return;
    this.collapsed = true;
    this.containerEl.classList.add("is-sidedock-collapsed");
    this.containerEl.style.width = "0px";
    this.containerEl.style.display = "none";
    this.resizeHandleEl.style.opacity = "0";
    this.workspace.containerEl.classList.remove(`is-${this.side}-sidedock-open`);
    const ribbon = this.side === "left" ? this.workspace.leftRibbon : this.workspace.rightRibbon;
    ribbon.setCollapsedState(true);
    if (this.workspace.activeLeaf && this.workspace.activeLeaf.getRoot() === this) {
      const fallback = this.workspace.getMostRecentRootLeaf();
      if (fallback) this.workspace.setActiveLeaf(fallback);
    }
    this.workspace.requestSaveLayout();
    if (this.workspace.rootSplit.children.length > 0) this.workspace.updateFrameless();
    this.workspace.requestResize();
  }

  expand(): void {
    if (!this.collapsed) return;
    this.collapsed = false;
    this.containerEl.style.display = "";
    this.containerEl.style.width = `${this.width ?? 300}px`;
    this.resizeHandleEl.style.opacity = "1";
    this.containerEl.classList.remove("is-sidedock-collapsed");
    this.workspace.containerEl.classList.add(`is-${this.side}-sidedock-open`);
    const ribbon = this.side === "left" ? this.workspace.leftRibbon : this.workspace.rightRibbon;
    ribbon.setCollapsedState(false);
    this.workspace.requestSaveLayout();
    if (this.workspace.rootSplit.children.length > 0) this.workspace.updateFrameless();
    this.workspace.requestResize();
  }

  setSize(width: number): void {
    this.width = width;
    this.containerEl.style.width = `${width}px`;
  }

  updateEmptyState(): void {
    if (!this.containerEl.contains(this.emptyStateEl)) this.containerEl.appendChild(this.emptyStateEl);
    const empty = this.children.length === 0;
    this.emptyStateEl.style.display = empty ? "" : "none";
    if (this.side === "right") {
      const ribbon = (this.workspace as unknown as { rightRibbon?: { hide: () => void; show: () => void } }).rightRibbon;
      if (empty) ribbon?.hide();
      else ribbon?.show();
    }
    if (empty && !this.collapsed) this.collapse();
  }

  private createVaultProfile(): HTMLElement {
    const ownerDocument = this.containerEl.ownerDocument;
    const profileEl = ownerDocument.createElement("div");
    profileEl.className = "workspace-sidedock-vault-profile";

    const switcherEl = ownerDocument.createElement("div");
    switcherEl.className = "workspace-drawer-vault-switcher";

    const iconEl = ownerDocument.createElement("div");
    iconEl.className = "workspace-drawer-vault-switcher-icon";
    setIcon(iconEl, "lucide-chevrons-up-down");

    const nameEl = ownerDocument.createElement("div");
    nameEl.className = "workspace-drawer-vault-name";
    const vault = this.workspace.app.vault as { getName?: () => string; name?: string };
    nameEl.textContent = vault.getName?.() ?? vault.name ?? "Obsidian";

    switcherEl.append(iconEl, nameEl);

    const actionsEl = ownerDocument.createElement("div");
    actionsEl.className = "workspace-drawer-vault-actions";

    const helpEl = ownerDocument.createElement("span");
    helpEl.className = "clickable-icon";
    helpEl.title = "Open help";
    helpEl.setAttribute("aria-label", "Open help");
    setIcon(helpEl, "lucide-help-circle");

    const settingsEl = ownerDocument.createElement("span");
    settingsEl.className = "clickable-icon";
    settingsEl.title = "Open settings";
    settingsEl.setAttribute("aria-label", "Open settings");
    setIcon(settingsEl, "lucide-settings");
    settingsEl.addEventListener("click", () => this.workspace.app.setting.open());
    actionsEl.append(helpEl, settingsEl);

    profileEl.append(switcherEl, actionsEl);
    return profileEl;
  }

  private onSidedockResizeStart(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.containerEl.ownerDocument.body.classList.add("is-grabbing");
    const win = this.containerEl.ownerDocument.defaultView ?? window;
    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = this.getWidthFromPointer(moveEvent.clientX);
      if (!this.collapsed && nextWidth < 50) this.collapse();
      else if (this.collapsed && nextWidth >= SIDEDOCK_MIN_WIDTH) this.expand();
      else if (!this.collapsed) {
        this.setSize(this.clampSidedockWidth(nextWidth));
      }
    };
    const onMouseUp = () => {
      this.containerEl.ownerDocument.body.classList.remove("is-grabbing");
      win.removeEventListener("mousemove", onMouseMove);
      win.removeEventListener("mouseup", onMouseUp);
      this.workspace.requestSaveLayout();
      this.workspace.requestResize();
    };
    win.addEventListener("mousemove", onMouseMove);
    win.addEventListener("mouseup", onMouseUp, { once: true });
  }

  private getWidthFromPointer(clientX: number): number {
    const handleOffset = this.resizeHandleEl.offsetWidth / 2;
    if (this.side === "left") {
      const rect = this.containerEl.getBoundingClientRect();
      return clientX - rect.x + handleOffset;
    }
    const workspaceWidth = this.getWorkspaceWidth();
    return workspaceWidth - clientX + handleOffset;
  }

  private clampSidedockWidth(width: number): number {
    const workspaceWidth = this.getWorkspaceWidth();
    return clamp(width, SIDEDOCK_MIN_WIDTH, Math.max(SIDEDOCK_MIN_WIDTH, 0.8 * workspaceWidth));
  }

  private getWorkspaceWidth(): number {
    return this.workspace.containerEl.clientWidth || this.workspace.containerEl.getBoundingClientRect().width || SIDEDOCK_MIN_WIDTH;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
