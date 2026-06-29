import { ItemView } from "../views/ItemView";
import type { CachedMetadata } from "../metadata/MetadataCache";
import type { TFile } from "../vault/TAbstractFile";
import { MarkdownView } from "../views/MarkdownView";

export class OutlineView extends ItemView {
  private file: TFile | null = null;

  getViewType(): string { return "outline"; }
  getDisplayText(): string { return "Outline"; }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("outline-view");
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateFromActiveFile()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.renderForFile(this.file)));
    this.updateFromActiveFile();
  }

  updateFromActiveFile(): void {
    const activeView = this.app.workspace.activeLeaf?.view;
    this.file = this.app.workspace.activeEditor?.file ?? (activeView instanceof MarkdownView ? activeView.file : null);
    this.renderForFile(this.file);
  }

  renderForFile(file: TFile | null): void {
    this.contentEl.replaceChildren();
    if (!file) {
      this.renderEmpty("No active file");
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const headings = cache?.headings ?? [];
    if (headings.length === 0) {
      this.renderEmpty("No headings found");
      return;
    }

    const treeEl = this.contentEl.ownerDocument.createElement("div");
    treeEl.className = "outline tree-item-children";
    for (const heading of headings) this.renderHeading(file, heading, treeEl);
    this.contentEl.appendChild(treeEl);
  }

  private renderHeading(file: TFile, heading: NonNullable<CachedMetadata["headings"]>[number], parentEl: HTMLElement): void {
    const doc = parentEl.ownerDocument;
    const itemEl = doc.createElement("div");
    itemEl.className = `tree-item outline-heading mod-heading-${heading.level}`;
    itemEl.style.setProperty("--outline-heading-padding", `${Math.max(0, heading.level - 1) * 14 + 8}px`);
    const selfEl = doc.createElement("div");
    selfEl.className = "tree-item-self outline-heading-self tappable";
    const titleEl = doc.createElement("div");
    titleEl.className = "tree-item-inner outline-heading-title";
    titleEl.textContent = heading.heading;
    selfEl.appendChild(titleEl);
    selfEl.addEventListener("click", () => {
      void this.app.workspace.openFile(file, { active: true, eState: heading.position ? { line: heading.position.line } : undefined });
    });
    itemEl.appendChild(selfEl);
    parentEl.appendChild(itemEl);
  }

  private renderEmpty(text: string): void {
    const emptyEl = this.contentEl.ownerDocument.createElement("div");
    emptyEl.className = "empty-state";
    emptyEl.textContent = text;
    this.contentEl.appendChild(emptyEl);
  }
}
