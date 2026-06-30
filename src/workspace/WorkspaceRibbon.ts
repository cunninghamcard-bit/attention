import { createEl } from "../dom/dom";
import { setIcon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import type { Workspace } from "./Workspace";

interface WorkspaceRibbonItem {
  id: string;
  icon: string;
  title: string;
  hidden: boolean;
  buttonEl?: HTMLElement;
  callback?: (event: MouseEvent) => unknown;
}

export class WorkspaceRibbon {
  readonly containerEl: HTMLElement;
  readonly actionsEl: HTMLElement | null = null;
  readonly settingsEl: HTMLElement | null = null;
  readonly items: WorkspaceRibbonItem[] = [];
  private readonly workspace: Workspace | null;
  private actions = new Map<string, HTMLElement>();

  constructor(parentOrWorkspace: HTMLElement | Workspace, side: "left" | "right" = "left") {
    this.workspace = "requestSaveLayout" in parentOrWorkspace ? parentOrWorkspace : null;
    const parent = this.workspace ? undefined : parentOrWorkspace as HTMLElement;
    this.containerEl = createEl("div", ["workspace-ribbon", "side-dock-ribbon", `mod-${side}`], parent);
    if (side === "left") {
      this.actionsEl = createEl("div", "side-dock-actions", this.containerEl);
      this.settingsEl = createEl("div", "side-dock-settings", this.containerEl);
    }
    this.containerEl.addEventListener("contextmenu", (event) => this.onContextMenu(event));
  }

  addRibbonItemButton(id: string, icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
    const button = this.makeRibbonItemButton(icon, title, callback);
    const existing = this.items.find((item) => item.id === id);
    if (existing) {
      existing.icon = icon;
      existing.title = title;
      existing.callback = callback;
      existing.buttonEl = button;
    } else {
      this.items.push({ id, icon, title, callback, buttonEl: button, hidden: false });
    }
    this.actions.set(id, button);
    this.onChange(false);
    return button;
  }

  private makeRibbonItemButton(icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
    const button = createEl("div", "clickable-icon side-dock-ribbon-action");
    button.title = title;
    button.setAttribute("aria-label", title);
    setIcon(button, icon);
    button.addEventListener("click", callback);
    return button;
  }

  addRibbonIcon(icon: string, title: string, callback: (event: MouseEvent) => unknown, id = title): HTMLElement {
    return this.addRibbonItemButton(id, icon, title, callback);
  }

  addRibbonSettingButton(id: string, icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
    const button = createEl("div", "clickable-icon side-dock-ribbon-action", this.settingsEl ?? this.containerEl);
    button.title = title;
    button.setAttribute("aria-label", title);
    setIcon(button, icon);
    button.addEventListener("click", callback);
    this.actions.set(id, button);
    return button;
  }

  removeRibbonAction(id: string): void {
    const item = this.items.find((entry) => entry.id === id);
    if (item) {
      item.buttonEl?.remove();
      delete item.buttonEl;
      delete item.callback;
    } else {
      this.actions.get(id)?.remove();
    }
    this.actions.delete(id);
  }

  serialize(): Record<string, unknown> {
    const hiddenItems: Record<string, boolean> = {};
    for (const item of this.items) hiddenItems[item.id] = item.hidden;
    return { hiddenItems };
  }

  setCollapsedState(collapsed: boolean): void {
    this.containerEl.classList.toggle("is-collapsed", collapsed);
  }

  load(state: unknown): void {
    if (!state || typeof state !== "object" || !Object.prototype.hasOwnProperty.call(state, "hiddenItems")) {
      this.onChange(false);
      return;
    }
    const hiddenItems = (state as { hiddenItems?: unknown }).hiddenItems;
    if (!hiddenItems || typeof hiddenItems !== "object") {
      this.onChange(false);
      return;
    }
    const hiddenById = hiddenItems as Record<string, unknown>;
    for (const item of this.items) item.hidden = Boolean(hiddenById[item.id]);
    const order = Object.keys(hiddenById);
    this.items.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
    this.onChange(false);
  }

  hide(): void {
    this.containerEl.classList.add("is-hidden");
  }

  show(): void {
    this.containerEl.classList.remove("is-hidden");
  }

  private onChange(persist: boolean): void {
    const buttons: HTMLElement[] = [];
    for (const item of this.items) {
      if (!item.buttonEl) continue;
      item.buttonEl.hidden = false;
      item.buttonEl.style.display = item.hidden ? "none" : "";
      buttons.push(item.buttonEl);
    }
    this.actionsEl?.replaceChildren(...buttons);
    if (persist) this.workspace?.requestSaveLayout();
  }

  private onContextMenu(event: MouseEvent): void {
    if (event.target !== this.containerEl) return;
    event.preventDefault();
    const menu = new Menu(this.containerEl.ownerDocument);
    for (const item of this.items) {
      if (!item.buttonEl) continue;
      menu.addItem((menuItem) => menuItem
        .setSection("order")
        .setTitle(item.title)
        .setIcon(item.icon)
        .setChecked(!item.hidden)
        .onClick(() => {
          item.hidden = !item.hidden;
          this.onChange(true);
        }));
    }
    menu.addItem((item) => item
      .setSection("ribbon")
      .setTitle("Hide ribbon")
      .setIcon("lucide-panel-left-close")
      .onClick(() => this.workspace?.app.vault.setConfig("showRibbon", false)));
    menu.showAtMouseEvent(event);
  }
}
