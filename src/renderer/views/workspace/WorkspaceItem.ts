import { Events } from "../../core/Events";
import { getActiveDocument } from "../../dom/ActiveDocument";
import { detach } from "../../dom/dom";
import type { App } from "../../app/App";
import type { Workspace } from "./Workspace";
import type { WorkspaceContainer } from "./WorkspaceContainer";
import type { WorkspaceParent } from "./WorkspaceParent";

export interface SerializedWorkspaceItem {
  id: string;
  type: string;
  dimension?: number;
  [key: string]: unknown;
}

const workspaceItemElSymbol = Symbol("workspaceItem");

export class WorkspaceItem extends Events {
  readonly app: App;
  readonly workspace: Workspace;
  id: string;
  readonly containerEl: HTMLElement;
  readonly resizeHandleEl: HTMLElement;
  parent: WorkspaceParent | null = null;
  type = "item";
  isWorkspaceContainer = false;
  dimension: number | null = null;
  component: unknown = null;

  constructor(
    workspace: Workspace,
    id: string = crypto.randomUUID(),
    ownerDocument: Document = getActiveDocument(),
  ) {
    super();
    this.workspace = workspace;
    this.app = workspace.app;
    this.id = id;
    this.containerEl = ownerDocument.createElement("div");
    setWorkspaceItemForElement(this.containerEl, this);
    this.resizeHandleEl = ownerDocument.createElement("hr");
    this.resizeHandleEl.className = "workspace-leaf-resize-handle";
    this.resizeHandleEl.addEventListener("mousedown", (event) => this.onResizeStart(event));
    this.containerEl.appendChild(this.resizeHandleEl);
  }

  serialize(): Record<string, unknown> {
    return {
      id: this.id,
      type: this.type,
      ...(this.dimension == null ? {} : { dimension: this.dimension }),
    };
  }

  getRoot(): WorkspaceItem {
    let item: WorkspaceItem = this;
    while (item.parent) item = item.parent;
    return item;
  }

  getContainer(): WorkspaceContainer {
    let item: WorkspaceItem = this;
    while (item.parent) {
      const root = item.parent;
      if (root.isWorkspaceContainer) return root as WorkspaceContainer;
      item = root;
    }
    return item.isWorkspaceContainer ? (item as WorkspaceContainer) : this.workspace.rootSplit;
  }

  setParent(parent: WorkspaceParent | null): void {
    this.parent = parent;
  }

  setDimension(dimension: number | null): void {
    this.dimension = dimension != null && dimension > 0 && dimension < 100 ? dimension : null;
    if (this.dimension != null) this.containerEl.style.flexGrow = String(this.dimension);
    else this.containerEl.style.flexGrow = "";
  }

  detach(): void {
    this.parent?.removeChild(this);
    detach(this.containerEl);
  }

  onLayoutChange(): void {
    this.workspace.onLayoutChange(this);
  }

  recomputeChildrenDimensions(): void {
    // Leaves do not own child dimensions, but the real workspace layout queue
    // calls this uniformly for queued layout items.
  }

  private onResizeStart(event: MouseEvent): void {
    if (event.button !== 0) return;
    if (!isResizableParent(this.parent)) return;
    event.preventDefault();
    this.parent.onChildResizeStart(this, event);
  }
}

export function getWorkspaceItemFromElement(el: Element | null | undefined): WorkspaceItem | null {
  let current: Element | null = el ?? null;
  while (current) {
    const item = (current as WorkspaceItemElement)[workspaceItemElSymbol];
    if (item) return item;
    current = current.parentElement;
  }
  return null;
}

function setWorkspaceItemForElement(el: HTMLElement, item: WorkspaceItem): void {
  (el as WorkspaceItemElement)[workspaceItemElSymbol] = item;
}

type WorkspaceItemElement = HTMLElement & {
  [workspaceItemElSymbol]?: WorkspaceItem;
};

function isResizableParent(parent: WorkspaceParent | null): parent is WorkspaceParent & {
  onChildResizeStart(child: WorkspaceItem, event: MouseEvent): void;
} {
  return (
    typeof (parent as { onChildResizeStart?: unknown } | null)?.onChildResizeStart === "function"
  );
}
