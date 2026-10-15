/**
 * Input: ../../ui/TreeItem, ../../views/ItemView, ./LanguageServerService
 * Output: REFERENCES_VIEW_TYPE, ReferencesResult, ReferencesView
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { TreeItem } from "../../ui/TreeItem";
import { ItemView } from "../../views/ItemView";
import type { LanguageLocation } from "./LanguageServerService";

export const REFERENCES_VIEW_TYPE = "language-references";

export interface ReferencesResult {
  /** The symbol that was asked about, as written in the source. */
  symbol: string;
  locations: LanguageLocation[];
}

/**
 * "Find references" results, in the right sidebar.
 *
 * A reference list is the code-side twin of Backlinks — who points at this —
 * so it is built the way `BacklinksView` is: one tree row per file, the
 * faithful search-result rows under it. No list markup of its own.
 */
export class ReferencesView extends ItemView {
  private result: ReferencesResult | null = null;

  getViewType(): string {
    return REFERENCES_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "References";
  }
  getIcon(): string {
    return "lucide-list-tree";
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("backlink-pane", "language-references");
    this.render();
  }

  setResult(result: ReferencesResult | null): void {
    this.result = result;
    this.render();
  }

  private render(): void {
    this.contentEl.replaceChildren();
    const doc = this.contentEl.ownerDocument;
    if (!this.result) {
      const emptyEl = doc.createElement("div");
      emptyEl.className = "empty-state";
      emptyEl.textContent = "Put the cursor on a symbol and press Shift+F12.";
      this.contentEl.appendChild(emptyEl);
      return;
    }

    const { symbol, locations } = this.result;
    // One section per file, in the order the server listed the files.
    const byFile = new Map<string, LanguageLocation[]>();
    for (const location of locations) {
      const key = location.path ?? location.fullPath;
      const group = byFile.get(key);
      if (group) group.push(location);
      else byFile.set(key, [location]);
    }

    const summary = new TreeItem(this.contentEl, {
      itemClass: "backlink-pane-section",
      selfClass: "backlink-pane-section-header",
      childrenClass: "search-results-children backlink-pane-results",
    });
    summary.innerEl.textContent = `${symbol} ${locations.length}`;
    if (locations.length === 0) {
      const emptyEl = doc.createElement("div");
      emptyEl.className = "search-empty-state";
      emptyEl.textContent = "No references found.";
      summary.childrenEl.appendChild(emptyEl);
      return;
    }

    for (const [title, group] of byFile) {
      const fileEl = doc.createElement("div");
      fileEl.className = "search-result-file backlink-result";
      const titleEl = doc.createElement("div");
      titleEl.className = "search-result-file-title tappable";
      titleEl.textContent = title;
      titleEl.addEventListener("click", () => this.reveal(group[0]!));
      fileEl.appendChild(titleEl);
      for (const location of group.sort((a, b) => a.start.line - b.start.line)) {
        const matchEl = doc.createElement("div");
        matchEl.className = "search-result-file-match tappable";
        const lineEl = doc.createElement("span");
        lineEl.className = "search-result-file-match-line";
        lineEl.textContent = String(location.start.line + 1);
        const textEl = doc.createElement("span");
        textEl.className = "search-result-file-match-text";
        this.appendMatch(textEl, location);
        matchEl.append(lineEl, textEl);
        matchEl.addEventListener("click", () => this.reveal(location));
        fileEl.appendChild(matchEl);
      }
      summary.childrenEl.appendChild(fileEl);
    }
  }

  /** The line's text with the referenced name marked, trimmed of its indent. */
  private appendMatch(parentEl: HTMLElement, location: LanguageLocation): void {
    const text = location.text;
    if (text === null) {
      parentEl.textContent = `${location.start.line + 1}:${location.start.character + 1}`;
      return;
    }
    const doc = parentEl.ownerDocument;
    const indent = text.length - text.trimStart().length;
    const start = Math.max(location.start.character, indent);
    const end =
      location.end.line === location.start.line
        ? Math.max(location.end.character, start)
        : text.length;
    parentEl.appendChild(doc.createTextNode(text.slice(indent, start)));
    const highlightEl = doc.createElement("span");
    highlightEl.className = "search-result-file-matched-text";
    highlightEl.textContent = text.slice(start, end);
    parentEl.appendChild(highlightEl);
    parentEl.appendChild(doc.createTextNode(text.slice(end)));
  }

  private reveal(location: LanguageLocation): void {
    void this.app.languageServers.revealLocation(location);
  }
}
