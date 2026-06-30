import { Component } from "../core/Component";
import { createDiv, detach } from "../dom/dom";
import type { App } from "../app/App";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { Scope } from "../hotkeys/Scope";
import { Menu } from "../ui/Menu";

export interface ViewState {
  type: string;
  state?: Record<string, unknown>;
  active?: boolean;
  pinned?: boolean;
  group?: WorkspaceLeaf;
}

export interface InternalViewState extends Omit<ViewState, "state" | "group"> {
  state?: Record<string, unknown>;
  group?: string | WorkspaceLeaf | null;
  icon?: string;
  title?: string;
  popstate?: boolean;
}

export interface ViewStateResult {
  history?: boolean;
}

export interface InternalViewStateResult extends ViewStateResult {
  layout?: boolean;
  close?: boolean;
  done?: () => void | Promise<void>;
}

export class View extends Component {
  app: App;
  leaf: WorkspaceLeaf;
  containerEl: HTMLElement;
  scope: Scope | null;
  icon = "lucide-file";
  navigation = false;

  constructor(leaf: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.scope = new Scope(this.app.scope);
    this.containerEl = createDiv("workspace-leaf-content", leaf.containerEl);
    this.containerEl.dataset.type = this.getViewType();
  }

  getViewType(): string {
    return "empty";
  }

  getDisplayText(): string {
    return this.getViewType();
  }

  getIcon(): string {
    return this.icon || "lucide-file";
  }

  getSideTooltipPlacement(): "left" | "right" | undefined {
    const side = (this.leaf.getRoot() as { side?: "left" | "right" }).side;
    return side === "left" ? "right" : side === "right" ? "left" : undefined;
  }

  onResize(): void {}

  async open(parent: HTMLElement): Promise<void> {
    this.containerEl.dataset.type = this.getViewType();
    parent.appendChild(this.containerEl);
    this.load();
    await this.onOpen();
  }

  async close(): Promise<void> {
    detach(this.containerEl);
    this.unload();
    await this.onClose();
  }

  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}

  handleCopy(_event: ClipboardEvent): void {}
  handlePaste(_event: ClipboardEvent): void {}
  handleCut(_event: ClipboardEvent): void {}
  handleDrop(_event: DragEvent, _source: unknown, _hovering: boolean): unknown {
    return undefined;
  }

  onHeaderMenu(_menu: Menu): void {}

  onPaneMenu(_menu: Menu, _source?: string): void {}

  onTabMenu(menu: Menu): void {
    const leaf = this.leaf;
    const parent = leaf.parent;
    menu.addItem((item) => item
      .setSection("close")
      .setTitle("Close")
      .setIcon("lucide-x")
      .onClick(() => leaf.detach()));
    if (!parent || this.app.workspace.isInSidebar(leaf)) return;
    const siblings = Array.isArray(parent.children)
      ? parent.children.filter((child): child is WorkspaceLeaf => isWorkspaceLeafLike(child))
      : [];
    const index = siblings.indexOf(leaf);
    const closeOthers = siblings.filter((candidate) => candidate !== leaf && !candidate.pinned);
    if (closeOthers.length > 0) {
      menu.addItem((item) => item
        .setSection("close")
        .setTitle("Close others")
        .setIcon("lucide-x")
        .onClick(() => {
          for (const candidate of closeOthers) candidate.detach();
        }));
    }
    const closeAfter = index === -1 ? [] : siblings.slice(index + 1).filter((candidate) => !candidate.pinned);
    if (closeAfter.length > 0) {
      menu.addItem((item) => item
        .setSection("close")
        .setTitle("Close tabs to the right")
        .setIcon("lucide-x")
        .onClick(() => {
          for (const candidate of closeAfter) candidate.detach();
        }));
    }
    const closeAll = siblings.filter((candidate) => !candidate.pinned);
    if (closeAll.length > 0 && !(closeAll.length === 1 && closeAll[0] === leaf)) {
      menu.addItem((item) => item
        .setSection("close")
        .setTitle("Close all")
        .setIcon("lucide-x")
        .onClick(() => {
          for (const candidate of closeAll) candidate.detach();
        }));
    }
  }

  async setState(_state: unknown, _result?: ViewStateResult): Promise<void> {}

  getState(): Record<string, unknown> {
    return {};
  }

  setEphemeralState(_state: unknown): void {}

  getEphemeralState(): unknown {
    return {};
  }

  async rerender(): Promise<void> {
    await this.leaf.setViewState({ type: this.getViewType(), state: this.getState() }, this.getEphemeralState());
  }
}

export function normalizeViewStatePayload(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  return state as Record<string, unknown>;
}

function isWorkspaceLeafLike(value: unknown): value is WorkspaceLeaf {
  return !!value && typeof value === "object" && "pinned" in value && "detach" in value;
}
