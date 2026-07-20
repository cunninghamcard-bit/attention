import { ItemView } from "../views/ItemView";
import type { LinkGraphEdge } from "../metadata/LinkGraph";
import type { TFile } from "../vault/TAbstractFile";
import { MarkdownView } from "../views/MarkdownView";
import { TreeItem } from "../ui/TreeItem";

export class OutgoingLinksView extends ItemView {
  private file: TFile | null = null;

  getViewType(): string {
    return "outgoing-link";
  }
  getDisplayText(): string {
    return "Outgoing links";
  }
  getIcon(): string {
    return "links-going-out";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("outgoing-link-pane");
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.updateFromActiveFile()),
    );
    this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));
    this.registerEvent(this.app.metadataCache.on("deleted", () => this.render()));
    this.updateFromActiveFile();
  }

  updateFromActiveFile(): void {
    const activeView = this.app.workspace.activeLeaf?.view;
    this.file =
      this.app.workspace.activeEditor?.file ??
      (activeView instanceof MarkdownView ? activeView.file : null);
    this.render();
  }

  render(): void {
    this.contentEl.replaceChildren();
    if (!this.file) {
      this.renderEmpty("No active file");
      return;
    }

    const links = this.app.linkGraph.getOutgoingLinks(this.file.path);
    const resolved = links.filter((link) => link.resolved);
    const unresolved = links.filter((link) => !link.resolved);
    this.renderSection("Links", resolved, "No outgoing links");
    this.renderSection("Unresolved links", unresolved, "No unresolved links");
  }

  private renderSection(title: string, links: LinkGraphEdge[], emptyText: string): void {
    // The section IS a tree row: header = selfEl, results box = childrenEl.
    // Not collapsible (unchanged behaviour) — construction only moves to TreeItem.
    const section = new TreeItem(this.contentEl, {
      itemClass: "outgoing-link-pane-section",
      selfClass: "outgoing-link-pane-section-header",
      childrenClass: "search-results-children outgoing-link-pane-results",
    });
    const { innerEl: titleEl, childrenEl } = section;
    titleEl.textContent = `${title}${links.length ? ` ${links.length}` : ""}`;

    if (links.length === 0) {
      const emptyEl = childrenEl.ownerDocument.createElement("div");
      emptyEl.className = "search-empty-state";
      emptyEl.textContent = emptyText;
      childrenEl.appendChild(emptyEl);
    } else {
      for (const link of links.sort((a, b) => a.to.localeCompare(b.to)))
        this.renderLink(link, childrenEl);
    }
  }

  private renderLink(link: LinkGraphEdge, parentEl: HTMLElement): void {
    const doc = parentEl.ownerDocument;
    const fileEl = doc.createElement("div");
    fileEl.className = "search-result-file outgoing-link-result";
    const titleEl = doc.createElement("div");
    titleEl.className = "search-result-file-title tappable";
    titleEl.textContent = link.to;
    titleEl.addEventListener("click", () => this.openLink(link));
    fileEl.appendChild(titleEl);

    const matchEl = doc.createElement("div");
    matchEl.className = "search-result-file-match tappable";
    const lineEl = doc.createElement("span");
    lineEl.className = "search-result-file-match-line";
    lineEl.textContent = link.position ? String(link.position.line + 1) : "";
    const textEl = doc.createElement("span");
    textEl.className = "search-result-file-match-text";
    if (link.position)
      appendHighlightedText(textEl, link.position.text, link.position.start, link.position.end);
    else textEl.textContent = link.original;
    matchEl.append(lineEl, textEl);
    matchEl.addEventListener("click", () => this.openLink(link));
    fileEl.appendChild(matchEl);
    parentEl.appendChild(fileEl);
  }

  private openLink(link: LinkGraphEdge): void {
    if (!this.file) return;
    const file = this.app.vault.getFileByPath(link.to);
    if (file) {
      void this.app.workspace.openFile(file, { active: true });
      return;
    }
    void this.app.workspace.openLinkText(link.to, this.file.path, undefined, { active: true });
  }

  private renderEmpty(text: string): void {
    const emptyEl = this.contentEl.ownerDocument.createElement("div");
    emptyEl.className = "empty-state";
    emptyEl.textContent = text;
    this.contentEl.appendChild(emptyEl);
  }
}

function appendHighlightedText(
  parentEl: HTMLElement,
  text: string,
  start: number,
  end: number,
): void {
  const doc = parentEl.ownerDocument;
  if (start > 0) parentEl.appendChild(doc.createTextNode(text.slice(0, start)));
  const highlightEl = doc.createElement("span");
  highlightEl.className = "search-result-file-matched-text";
  highlightEl.textContent = text.slice(start, end);
  parentEl.appendChild(highlightEl);
  if (end < text.length) parentEl.appendChild(doc.createTextNode(text.slice(end)));
}
