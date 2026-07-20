import { ItemView } from "../views/ItemView";
import { TreeItem } from "../ui/TreeItem";

interface TagTreeNode {
  name: string;
  tag: string;
  count: number;
  children: Map<string, TagTreeNode>;
}

export class TagPaneView extends ItemView {
  private collapsed = new Set<string>();

  getViewType(): string {
    return "tag";
  }
  getDisplayText(): string {
    return "Tags";
  }
  getIcon(): string {
    return "lucide-tags";
  }

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
    for (const child of [...root.children.values()].sort(sortTagNodes))
      this.renderTagNode(child, containerEl);
    this.contentEl.appendChild(containerEl);
  }

  private renderTagNode(node: TagTreeNode, parentEl: HTMLElement): void {
    const hasChildren = node.children.size > 0;
    const isCollapsed = this.collapsed.has(node.tag);
    const item = new TreeItem(parentEl, {
      itemClass: "tag-pane-tag",
      selfClass: "tag-pane-tag-self tappable",
      innerClass: "tag-pane-tag-text",
      childrenClass: "tag-pane-tag-children",
    });
    item.el.dataset.tag = node.tag;
    if (hasChildren) {
      item.setCollapsible(true);
      item.setCollapsed(isCollapsed);
    }
    item.innerEl.textContent = node.name;
    const countEl = parentEl.ownerDocument.createElement("div");
    countEl.className = "tag-pane-tag-count";
    countEl.textContent = String(node.count);
    item.selfEl.appendChild(countEl);
    // Chevron click bubbles to selfEl; neuter onCollapseClick so the single
    // onSelfClick handler decides toggle-vs-search exactly as before.
    item.onSelfClick = (event) => {
      if (hasChildren && (event.target === item.collapseEl || event.altKey)) {
        this.toggleTag(node.tag);
        return;
      }
      this.searchTag(node.tag);
    };
    item.onCollapseClick = () => {};

    if (hasChildren && !isCollapsed) {
      for (const child of [...node.children.values()].sort(sortTagNodes))
        this.renderTagNode(child, item.childrenEl);
    } else {
      // Faithful to the original: a leaf or collapsed tag renders no children
      // box at all (TreeItem creates one eagerly, so drop it here).
      item.childrenEl.remove();
    }
  }

  private toggleTag(tag: string): void {
    if (this.collapsed.has(tag)) this.collapsed.delete(tag);
    else this.collapsed.add(tag);
    this.render();
  }

  private searchTag(tag: string): void {
    void this.app.workspace
      .ensureSideLeaf("search", "left", { active: true, reveal: true })
      .then((leaf) => {
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
