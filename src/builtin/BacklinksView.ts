import { ItemView } from "../views/ItemView";
import type { LinkGraphEdge } from "../metadata/LinkGraph";
import type { TFile } from "../vault/TAbstractFile";
import { MarkdownView } from "../views/MarkdownView";

export class BacklinksView extends ItemView {
  file: TFile | null = null;

  getViewType(): string { return "backlink"; }
  getDisplayText(): string { return "Backlinks"; }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("backlink-pane");
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateFromActiveFile()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));
    this.registerEvent(this.app.metadataCache.on("deleted", () => this.render()));
    this.updateFromActiveFile();
  }

  updateFromActiveFile(): void {
    const activeView = this.app.workspace.activeLeaf?.view;
    this.setFile(this.app.workspace.activeEditor?.file ?? (activeView instanceof MarkdownView ? activeView.file : null));
  }

  setFile(file: TFile | null): void {
    this.file = file;
    this.render();
  }

  render(): void {
    this.contentEl.replaceChildren();
    if (!this.file) {
      this.renderEmpty("No active file");
      return;
    }

    const backlinks = this.app.linkGraph.getBacklinks(this.file.path);
    this.renderSection("Linked mentions", backlinks, "No linked mentions");
    this.renderSection("Unlinked mentions", [], "No unlinked mentions");
  }

  private renderSection(title: string, backlinks: LinkGraphEdge[], emptyText: string): void {
    const doc = this.contentEl.ownerDocument;
    const sectionEl = doc.createElement("div");
    sectionEl.className = "backlink-pane-section";
    const titleEl = doc.createElement("div");
    titleEl.className = "tree-item-self backlink-pane-section-header";
    titleEl.textContent = `${title}${backlinks.length ? ` ${backlinks.length}` : ""}`;
    const childrenEl = doc.createElement("div");
    childrenEl.className = "search-results-children backlink-pane-results";
    sectionEl.append(titleEl, childrenEl);

    if (backlinks.length === 0) {
      const emptyEl = doc.createElement("div");
      emptyEl.className = "search-empty-state";
      emptyEl.textContent = emptyText;
      childrenEl.appendChild(emptyEl);
    } else {
      for (const backlink of backlinks.sort((a, b) => a.from.localeCompare(b.from))) this.renderBacklink(backlink, childrenEl);
    }

    this.contentEl.appendChild(sectionEl);
  }

  private renderBacklink(backlink: LinkGraphEdge, parentEl: HTMLElement): void {
    const doc = parentEl.ownerDocument;
    const fileEl = doc.createElement("div");
    fileEl.className = "search-result-file backlink-result";
    const titleEl = doc.createElement("div");
    titleEl.className = "search-result-file-title tappable";
    titleEl.textContent = backlink.from;
    titleEl.addEventListener("click", () => this.openBacklink(backlink));
    fileEl.appendChild(titleEl);

    const matchEl = doc.createElement("div");
    matchEl.className = "search-result-file-match tappable";
    const lineEl = doc.createElement("span");
    lineEl.className = "search-result-file-match-line";
    lineEl.textContent = backlink.position ? String(backlink.position.line + 1) : "";
    const textEl = doc.createElement("span");
    textEl.className = "search-result-file-match-text";
    if (backlink.position) appendHighlightedText(textEl, backlink.position.text, backlink.position.start, backlink.position.end);
    else textEl.textContent = backlink.original;
    matchEl.append(lineEl, textEl);
    matchEl.addEventListener("click", () => this.openBacklink(backlink));
    fileEl.appendChild(matchEl);
    parentEl.appendChild(fileEl);
  }

  private renderEmpty(text: string): void {
    const emptyEl = this.contentEl.ownerDocument.createElement("div");
    emptyEl.className = "empty-state";
    emptyEl.textContent = text;
    this.contentEl.appendChild(emptyEl);
  }

  private openBacklink(backlink: LinkGraphEdge): void {
    const file = this.app.vault.getFileByPath(backlink.from);
    if (!file) return;
    void this.app.workspace.openFile(file, {
      active: true,
      eState: backlink.position ? { line: backlink.position.line, matchStart: backlink.position.start, matchEnd: backlink.position.end } : undefined,
    });
  }
}

function appendHighlightedText(parentEl: HTMLElement, text: string, start: number, end: number): void {
  const doc = parentEl.ownerDocument;
  if (start > 0) parentEl.appendChild(doc.createTextNode(text.slice(0, start)));
  const highlightEl = doc.createElement("span");
  highlightEl.className = "search-result-file-matched-text";
  highlightEl.textContent = text.slice(start, end);
  parentEl.appendChild(highlightEl);
  if (end < text.length) parentEl.appendChild(doc.createTextNode(text.slice(end)));
}
