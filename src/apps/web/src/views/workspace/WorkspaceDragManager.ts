import type { WorkspaceParent } from "./WorkspaceParent";
import type { WorkspaceLeaf } from "./WorkspaceLeaf";
import type { WorkspaceItem } from "./WorkspaceItem";
import type { WorkspaceTabs, WorkspaceTabInsertLocation } from "./WorkspaceTabs";
import { setIcon } from "../../ui/Icon";

export type WorkspaceDropSide = "left" | "right" | "top" | "bottom" | "center";

export interface WorkspaceDropTarget {
  leaf?: WorkspaceLeaf | null;
  side: WorkspaceDropSide;
  clientX?: number;
  item?: WorkspaceItem;
  parent?: WorkspaceParent | null;
  root?: WorkspaceItem | null;
  tabs?: WorkspaceTabs | null;
  tabInsert?: WorkspaceTabInsertLocation | null;
  tabInsertIndex?: number;
  overlayRect?: DOMRect | { x: number; y: number; width: number; height: number } | null;
  fakeTargetRect?: DOMRect | { x: number; y: number; width: number; height: number } | null;
  fakeTargetEl?: HTMLElement | null;
  isInSidebar?: boolean;
  ownerWindow?: Window;
  ownerDocument?: Document;
}

export class WorkspaceDragManager {
  readonly overlayEl = document.createElement("div");
  readonly fakeTargetOverlayEl = document.createElement("div");
  private source: WorkspaceLeaf | null = null;
  private fakeTargetContainerEl: HTMLElement | null = null;
  private fakeTargetSourceEl: HTMLElement | null = null;

  constructor() {
    this.overlayEl.className = "workspace-drop-overlay";
    this.fakeTargetOverlayEl.className = "workspace-fake-target-overlay";
  }

  startDrag(leaf: WorkspaceLeaf): void {
    this.source = leaf;
    leaf.containerEl.classList.add("is-being-dragged");
  }

  finishDrag(target: WorkspaceDropTarget | null): boolean {
    const source = this.source;
    source?.containerEl.classList.remove("is-being-dragged");
    this.source = null;
    this.clearPreview();
    source?.containerEl.ownerDocument.body.classList.remove("is-grabbing");
    if (source && target) return source.workspace.moveLeafToDropTarget(source, target);
    return false;
  }

  getSource(): WorkspaceLeaf | null {
    return this.source;
  }

  showOverlay(
    rect: DOMRect | { x: number; y: number; width: number; height: number },
    doc: Document = document,
  ): void {
    this.overlayEl.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    this.overlayEl.style.width = `${rect.width}px`;
    this.overlayEl.style.height = `${rect.height}px`;
    doc.body.appendChild(this.overlayEl);
  }

  hideOverlay(): void {
    this.overlayEl.remove();
    this.hideFakeTargetPreview();
  }

  clearPreview(): void {
    this.hideOverlay();
  }

  createLeafDragGhost(leaf: WorkspaceLeaf, doc: Document = document): HTMLElement {
    const ghostEl = doc.createElement("div");
    ghostEl.className = "drag-ghost mod-leaf";
    const iconEl = doc.createElement("div");
    iconEl.className = "drag-ghost-icon";
    setIcon(iconEl, leaf.getIcon());
    const titleEl = doc.createElement("span");
    titleEl.textContent = truncateDragGhostTitle(leaf.getDisplayText());
    ghostEl.append(iconEl, titleEl);
    return ghostEl;
  }

  showFakeTargetPreview(
    targetEl: HTMLElement,
    rect: DOMRect | { x: number; y: number; width: number; height: number },
    options: { doc?: Document; isInSidebar?: boolean } = {},
  ): void {
    const doc = options.doc ?? document;

    if (this.fakeTargetSourceEl !== targetEl || this.fakeTargetContainerEl?.ownerDocument !== doc) {
      this.hideFakeTargetPreview();
      this.fakeTargetSourceEl = targetEl;
      targetEl.style.opacity = "0";

      let rootEl: HTMLElement = this.fakeTargetOverlayEl;
      for (
        let parentEl = targetEl.parentElement;
        parentEl && parentEl !== doc.body;
        parentEl = parentEl.parentElement
      ) {
        const wrapperEl = doc.createElement("div");
        wrapperEl.className = parentEl.className;
        wrapperEl.appendChild(rootEl);
        rootEl = wrapperEl;
      }

      const containerEl = doc.createElement("div");
      containerEl.className = "workspace-fake-target-container";
      containerEl.appendChild(rootEl);
      doc.body.appendChild(containerEl);
      this.fakeTargetContainerEl = containerEl;
    }

    this.fakeTargetOverlayEl.replaceChildren(targetEl.cloneNode(true));
    this.fakeTargetOverlayEl.classList.toggle("is-in-sidebar", Boolean(options.isInSidebar));
    this.fakeTargetOverlayEl.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    this.fakeTargetOverlayEl.style.width = `${rect.width}px`;
    this.fakeTargetOverlayEl.style.height = `${rect.height}px`;
  }

  hideFakeTargetPreview(): void {
    if (this.fakeTargetSourceEl) this.fakeTargetSourceEl.style.opacity = "";
    this.fakeTargetSourceEl = null;
    this.fakeTargetOverlayEl.remove();
    this.fakeTargetContainerEl?.remove();
    this.fakeTargetContainerEl = null;
  }
}

function truncateDragGhostTitle(title: string): string {
  return title.length > 60 ? `${title.slice(0, 57)}...` : title;
}
