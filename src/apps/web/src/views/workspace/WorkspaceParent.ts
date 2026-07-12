import { WorkspaceItem } from "./WorkspaceItem";
import type { WorkspaceLeaf } from "./WorkspaceLeaf";

export class WorkspaceParent extends WorkspaceItem {
  children: WorkspaceItem[] = [];
  allowSingleChild = false;
  autoManageDOM = true;

  appendChild(child: WorkspaceItem): void {
    child.setParent(this);
    this.children.push(child);
    if (this.autoManageDOM) this.containerEl.appendChild(child.containerEl);
    this.onLayoutChange();
  }

  insertChild(index: number, child: WorkspaceItem): void {
    child.setParent(this);
    const clamped = index < 0 || index >= this.children.length ? this.children.length : index;
    const before = this.children[clamped]?.containerEl ?? null;
    this.children.splice(clamped, 0, child);
    if (this.autoManageDOM) {
      if (before) this.containerEl.insertBefore(child.containerEl, before);
      else this.containerEl.appendChild(child.containerEl);
    }
    this.onLayoutChange();
  }

  removeChild(child: WorkspaceItem): void {
    const index = this.children.indexOf(child);
    if (index === -1) return;
    this.children.splice(index, 1);
    child.setParent(null);
    if (this.autoManageDOM) child.containerEl.remove();

    if (this.parent) {
      if (this.children.length === 0) {
        this.parent.removeChild(this);
        return;
      }

      if (this.children.length === 1 && !this.allowSingleChild) {
        const onlyChild = this.children[0];
        this.children = [];
        onlyChild.setParent(null);
        if (this.autoManageDOM) onlyChild.containerEl.remove();
        this.parent.replaceChild(this, onlyChild);
        onlyChild.setDimension(this.dimension);
        this.onLayoutChange();
        return;
      }
    }

    this.onLayoutChange();
  }

  replaceChild(oldChild: WorkspaceItem, newChild: WorkspaceItem): void;
  replaceChild(index: number, newChild: WorkspaceItem): void;
  replaceChild(indexOrOldChild: number | WorkspaceItem, newChild: WorkspaceItem): void {
    const index =
      typeof indexOrOldChild === "number"
        ? indexOrOldChild
        : this.children.indexOf(indexOrOldChild);
    if (index === -1) return;
    const oldChild = this.children[index];
    oldChild.setParent(null);
    newChild.setParent(this);
    this.children[index] = newChild;
    if (this.autoManageDOM) oldChild.containerEl.replaceWith(newChild.containerEl);
    this.onLayoutChange();
  }

  override recomputeChildrenDimensions(): void {}

  iterateLeaves(callback: (leaf: WorkspaceLeaf) => void): void {
    for (const child of this.children) {
      if (child.type === "leaf") callback(child as WorkspaceLeaf);
      else if (child instanceof WorkspaceParent) child.iterateLeaves(callback);
    }
  }

  serialize(): Record<string, unknown> {
    return {
      ...super.serialize(),
      children: this.children.map((child) => child.serialize()),
    };
  }
}
