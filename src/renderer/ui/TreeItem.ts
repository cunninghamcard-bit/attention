import { Component } from "../core/Component";
import { setIcon } from "./Icon";

export interface TreeItemOptions {
  /** Extra classes for the `.tree-item` root, e.g. "nav-folder". */
  itemClass?: string;
  /** Extra classes for the `.tree-item-self` row, e.g. "nav-folder-title tappable is-clickable". */
  selfClass?: string;
  /** Extra classes for the `.tree-item-inner` content, e.g. "nav-folder-title-content". */
  innerClass?: string;
  /** Extra classes for the `.tree-item-children` box, e.g. "nav-folder-children". */
  childrenClass?: string;
  /** Extra classes for the `.tree-item-icon collapse-icon` chevron, e.g. "nav-folder-collapse-indicator". */
  collapseClass?: string;
}

/**
 * Faithful port of Obsidian's shared tree row (decode-obsidian app.js `YL`/`QL`):
 * `.tree-item` > `.tree-item-self` > `.tree-item-inner`, a `.tree-item-children`
 * box, and a `.tree-item-icon collapse-icon` chevron added by `setCollapsible`.
 * The base classes are generic; views layer their own domain classes
 * (`nav-folder`, `git-log-entry`, …) via TreeItemOptions or directly on the
 * exposed handles, and wire content + clicks through `onSelfClick` / `onCollapseClick`.
 */
export class TreeItem extends Component {
  readonly el: HTMLElement;
  readonly selfEl: HTMLElement;
  readonly innerEl: HTMLElement;
  // ponytail: childrenEl is eager. Obsidian's collapsible tree item builds it in
  // the constructor, and every Phase-1 caller is a collapsible parent that reads
  // it immediately. A pure leaf variant (Phase 2) can make it lazy if needed.
  readonly childrenEl: HTMLElement;
  collapseEl: HTMLElement | null = null;
  private collapsible = false;
  private collapsed = false;
  private readonly collapseClass: string;

  constructor(parent: HTMLElement, options: TreeItemOptions = {}) {
    super();
    const doc = parent.ownerDocument;
    this.collapseClass = joinClasses("tree-item-icon collapse-icon", options.collapseClass);
    this.el = doc.createElement("div");
    this.el.className = joinClasses("tree-item", options.itemClass);
    this.selfEl = doc.createElement("div");
    this.selfEl.className = joinClasses("tree-item-self", options.selfClass);
    this.innerEl = doc.createElement("div");
    this.innerEl.className = joinClasses("tree-item-inner", options.innerClass);
    this.childrenEl = doc.createElement("div");
    this.childrenEl.className = joinClasses("tree-item-children", options.childrenClass);
    this.selfEl.appendChild(this.innerEl);
    this.el.append(this.selfEl, this.childrenEl);
    // Dynamic dispatch (not `.bind`) so views can override onSelfClick per instance.
    this.selfEl.addEventListener("click", (event) => {
      if (event.button === 0 && !event.defaultPrevented) this.onSelfClick(event);
    });
    parent.appendChild(this.el);
  }

  /** Add or remove the collapse chevron and the `mod-collapsible` gutter. */
  setCollapsible(value: boolean): void {
    if (this.collapsible === value) return;
    this.collapsible = value;
    if (value) {
      if (!this.collapseEl) {
        const collapseEl = (this.collapseEl = this.el.ownerDocument.createElement("div"));
        collapseEl.className = this.collapseClass;
        setIcon(collapseEl, "right-triangle");
        collapseEl.addEventListener("click", (event) => this.onCollapseClick(event));
      }
      this.selfEl.prepend(this.collapseEl);
    } else if (this.collapseEl) {
      this.collapseEl.remove();
      this.collapseEl = null;
      this.collapsed = false;
    }
    this.selfEl.classList.toggle("mod-collapsible", value);
  }

  /** Reflect collapsed state on the item, the chevron and the children box. */
  setCollapsed(value: boolean): void {
    this.collapsed = value;
    this.el.classList.toggle("is-collapsed", value);
    this.collapseEl?.classList.toggle("is-collapsed", value);
    this.selfEl.setAttribute("aria-expanded", String(!value));
    this.childrenEl.hidden = value;
  }

  toggleCollapsed(): void {
    if (this.collapsible) this.setCollapsed(!this.collapsed);
  }

  /** Row-body click. Empty by default (Obsidian's `onSelfClick`); overridable. */
  onSelfClick(_event: MouseEvent): void {}

  /** Chevron click. Toggles collapsed; overridable to add view side effects. */
  onCollapseClick(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.toggleCollapsed();
  }

  override addChild<T extends Component>(child: T): T {
    if (child instanceof TreeItem) this.childrenEl.appendChild(child.el);
    return super.addChild(child);
  }
}

function joinClasses(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}
