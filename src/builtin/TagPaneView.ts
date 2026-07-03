import { ItemView } from "../views/ItemView";
import { setIcon } from "../ui/Icon";

interface TagTreeNode {
  name: string;
  tag: string;
  count: number;
  children: Map<string, TagTreeNode>;
}

export class TagPaneView extends ItemView {
  private collapsed = new Set<string>();

  getViewType(): string { return "tag"; }
  getDisplayText(): string { return "Tags"; }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("tag-pane");
    this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));
    this.registerEvent(this.app.metadataCache.on("deleted", () => this.render()));
    this.render();
  }

  render(): void {
    this.contentEl.replaceChildren();
    const tags = this.app.tagIndex.getTagCounts();
    if (tags.length === 0) {
      const emptyEl = this.contentEl.ownerDocument.createElement("div");
      emptyEl.className = "empty-state";
      emptyEl.textContent = "No tags found";
      this.contentEl.appendChild(emptyEl);
      return;
    }

    const root = buildTagTree(tags);
    const containerEl = this.contentEl.ownerDocument.createElement("div");
    containerEl.className = "tag-container tree-item-children";
    for (const child of [...root.children.values()].sort(sortTagNodes)) this.renderTagNode(child, containerEl, 0);
    this.contentEl.appendChild(containerEl);
  }

  private renderTagNode(node: TagTreeNode, parentEl: HTMLElement, depth: number): void {
    const doc = parentEl.ownerDocument;
    const itemEl = doc.createElement("div");
    itemEl.className = "tree-item tag-pane-tag";
    itemEl.dataset.tag = node.tag;
    const selfEl = doc.createElement("div");
    selfEl.className = "tree-item-self tag-pane-tag-self tappable";
    selfEl.style.setProperty("--tag-pane-padding", `${depth * 14 + 8}px`);
    const collapseEl = doc.createElement("div");
    collapseEl.className = "tree-item-icon collapse-icon";
    if (node.children.size > 0) {
      collapseEl.classList.toggle("is-collapsed", this.collapsed.has(node.tag));
      setIcon(collapseEl, "right-triangle");
    }
    const titleEl = doc.createElement("div");
    titleEl.className = "tree-item-inner tag-pane-tag-text";
    titleEl.textContent = node.name;
    const countEl = doc.createElement("div");
    countEl.className = "tag-pane-tag-count";
    countEl.textContent = String(node.count);
    selfEl.append(collapseEl, titleEl, countEl);
    selfEl.addEventListener("click", (event) => {
      if (node.children.size > 0 && (event.target === collapseEl || event.altKey)) {
        this.toggleTag(node.tag);
        return;
      }
      this.searchTag(node.tag);
    });
    itemEl.appendChild(selfEl);

    if (node.children.size > 0 && !this.collapsed.has(node.tag)) {
      const childrenEl = doc.createElement("div");
      childrenEl.className = "tree-item-children tag-pane-tag-children";
      for (const child of [...node.children.values()].sort(sortTagNodes)) this.renderTagNode(child, childrenEl, depth + 1);
      itemEl.appendChild(childrenEl);
    }

    parentEl.appendChild(itemEl);
  }

  private toggleTag(tag: string): void {
    if (this.collapsed.has(tag)) this.collapsed.delete(tag);
    else this.collapsed.add(tag);
    this.render();
  }

  private searchTag(tag: string): void {
    void this.app.workspace.ensureSideLeaf("search", "left", { active: true, reveal: true }).then((leaf) => {
      const view = leaf.view as unknown as { focusSearch?: (query: string) => void };
      view.focusSearch?.(tag);
    });
  }
}

function buildTagTree(tags: Array<{ tag: string; count: number }>): TagTreeNode {
  const root: TagTreeNode = { name: "", tag: "", count: 0, children: new Map() };
  for (const item of tags) {
    const parts = item.tag.replace(/^#/, "").split("/").filter(Boolean);
    let current = root;
    let full = "";
    for (const part of parts) {
      full = full ? `${full}/${part}` : part;
      let child = current.children.get(part);
      if (!child) {
        child = { name: part, tag: `#${full}`, count: 0, children: new Map() };
        current.children.set(part, child);
      }
      child.count += item.count;
      current = child;
    }
  }
  return root;
}

function sortTagNodes(a: TagTreeNode, b: TagTreeNode): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
}
