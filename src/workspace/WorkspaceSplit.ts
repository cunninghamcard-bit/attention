import { WorkspaceParent } from "./WorkspaceParent";
import type { Workspace } from "./Workspace";
import type { WorkspaceItem } from "./WorkspaceItem";

export type SplitDirection = "vertical" | "horizontal";

export class WorkspaceSplit extends WorkspaceParent {
  type = "split";
  direction: SplitDirection;
  private readonly minChildSize = 200;

  constructor(workspace: Workspace, direction: SplitDirection, id?: string, ownerDocument?: Document) {
    super(workspace, id, ownerDocument);
    this.containerEl.classList.add("workspace-split");
    this.direction = direction;
    this.setDirection(direction);
  }

  setDirection(direction: SplitDirection): void {
    this.containerEl.classList.remove(`mod-${this.direction}`);
    this.direction = direction;
    this.containerEl.classList.add(`mod-${direction}`);
  }

  override recomputeChildrenDimensions(): void {
    if (this.children.length === 0) return;
    const dimensions = this.children.map((child) => child.dimension);
    if (dimensions.some((dimension) => dimension == null || Number.isNaN(dimension))) {
      for (const child of this.children) child.setDimension(null);
      this.workspace.requestResize();
      return;
    }

    const total = dimensions.reduce((sum, dimension) => sum + (dimension ?? 0), 0);
    if (total <= 0) {
      for (const child of this.children) child.setDimension(null);
      this.workspace.requestResize();
      return;
    }

    for (const child of this.children) child.setDimension(((child.dimension ?? 0) / total) * 100);
    this.workspace.requestResize();
  }

  onChildResizeStart(child: WorkspaceItem, event: MouseEvent): void {
    const index = this.children.indexOf(child);
    if (index === -1 || event.button !== 0) return;

    const win = this.containerEl.ownerDocument.defaultView ?? window;
    const startPosition = this.direction === "vertical" ? event.clientX : event.clientY;
    const startSizes = this.children.map((item) => this.getElSize(item.containerEl));
    const move = (moveEvent: MouseEvent) => {
      const position = this.direction === "vertical" ? moveEvent.clientX : moveEvent.clientY;
      this.resizeItemsByDiff(index, position - startPosition, startSizes);
    };
    const up = () => {
      this.containerEl.ownerDocument.body.classList.remove("is-grabbing");
      win.removeEventListener("mousemove", move);
      win.removeEventListener("mouseup", up);
      this.finishResize();
    };

    this.containerEl.ownerDocument.body.classList.add("is-grabbing");
    win.addEventListener("mousemove", move);
    win.addEventListener("mouseup", up);
  }

  private resizeItemsByDiff(index: number, diff: number, startSizes: number[]): void {
    const beforeHandle = this.children.slice(0, index + 1).reverse();
    const afterHandle = this.children.slice(index + 1);
    if (diff > 0) {
      const consumed = this.resizeItemGroupByDiff(afterHandle, diff, 1, startSizes);
      const applied = Math.abs(diff) > consumed ? consumed : diff;
      this.resizeItemGroupByDiff(beforeHandle, applied, -1, startSizes);
      return;
    }
    const consumed = this.resizeItemGroupByDiff(beforeHandle, diff, -1, startSizes);
    const applied = Math.abs(diff) > consumed ? -consumed : diff;
    this.resizeItemGroupByDiff(afterHandle, applied, 1, startSizes);
  }

  private resizeItemGroupByDiff(items: WorkspaceItem[], diff: number, direction: 1 | -1, startSizes: number[]): number {
    let consumed = 0;
    let remaining = diff;
    for (const item of items) {
      const childIndex = this.children.indexOf(item);
      const originalSize = startSizes[childIndex] ?? 0;
      const nextSize = Math.max(this.minChildSize, originalSize - remaining * direction);
      const itemDiff = originalSize - nextSize;
      remaining -= itemDiff * direction;
      consumed += Math.abs(itemDiff);
      this.setElSize(item.containerEl, nextSize);
    }
    return consumed;
  }

  finishResize(): void {
    const sizes = this.children.map((child) => this.getElSize(child.containerEl));
    const total = sizes.reduce((sum, size) => sum + size, 0);
    this.children.forEach((child) => this.unsetElSize(child.containerEl));
    if (total > 0) {
      this.children.forEach((child, index) => child.setDimension((sizes[index] / total) * 100));
    }
    this.workspace.requestSaveLayout();
    this.workspace.requestResize();
  }

  private getElSize(el: HTMLElement): number {
    return this.direction === "vertical" ? el.offsetWidth : el.offsetHeight;
  }

  private setElSize(el: HTMLElement, size: number): void {
    el.style.flex = "0 0 auto";
    if (this.direction === "vertical") el.style.width = `${Math.max(0, size)}px`;
    else el.style.height = `${Math.max(0, size)}px`;
  }

  private unsetElSize(el: HTMLElement): void {
    el.style.flex = "";
    el.style.width = "";
    el.style.height = "";
  }

  serialize(): Record<string, unknown> {
    return { ...super.serialize(), direction: this.direction };
  }
}
