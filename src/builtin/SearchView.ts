import { ItemView } from "../views/ItemView";
import type { SearchMatch, VaultSearchResult } from "../search/SearchEngine";

export class SearchView extends ItemView {
  private query = "";
  private inputEl: HTMLInputElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private searchId = 0;

  getViewType(): string { return "search"; }
  getDisplayText(): string { return "Search"; }

  async onOpen(): Promise<void> {
    this.contentEl.replaceChildren();
    this.contentEl.classList.add("search-view-container");

    const inputContainerEl = document.createElement("div");
    inputContainerEl.className = "search-input-container";
    this.inputEl = document.createElement("input");
    this.inputEl.className = "search-input";
    this.inputEl.placeholder = "Search vault";
    this.inputEl.value = this.query;
    this.inputEl.addEventListener("input", () => this.setQuery(this.inputEl?.value ?? ""));
    inputContainerEl.appendChild(this.inputEl);

    this.countEl = document.createElement("div");
    this.countEl.className = "search-result-count";
    this.resultsEl = document.createElement("div");
    this.resultsEl.className = "search-results-children";
    this.contentEl.append(inputContainerEl, this.countEl, this.resultsEl);
    this.inputEl.focus();
    this.setQuery(this.query);
  }

  async setState(state: unknown): Promise<void> {
    await super.setState(state);
    if (state && typeof state === "object" && "query" in state) {
      this.query = String((state as { query?: unknown }).query ?? "");
      if (this.inputEl) this.inputEl.value = this.query;
      this.setQuery(this.query);
    }
  }

  getState(): Record<string, unknown> {
    return { query: this.query };
  }

  setQuery(query: string): void {
    this.query = query;
    if (this.inputEl && this.inputEl.value !== query) this.inputEl.value = query;
    this.app.workspace.trigger("search-query-change", query);
    const searchId = ++this.searchId;
    if (!query.trim()) {
      this.renderResults([]);
      return;
    }
    void this.app.search.search({ query }).then((results) => {
      if (searchId === this.searchId) this.renderResults(results);
    });
  }

  renderResults(results: VaultSearchResult[]): void {
    if (!this.resultsEl || !this.countEl) return;
    this.resultsEl.replaceChildren();
    const matchCount = results.reduce((sum, result) => sum + result.matches.length, 0);
    this.countEl.textContent = this.query.trim() ? `${matchCount} result${matchCount === 1 ? "" : "s"} in ${results.length} file${results.length === 1 ? "" : "s"}` : "Type to search the vault";

    for (const result of results) this.renderResultFile(result, this.resultsEl);
  }

  getQuery(): string {
    return this.query;
  }

  focusSearch(query?: string): void {
    if (query !== undefined) this.setQuery(query);
    this.inputEl?.focus();
    this.inputEl?.select();
  }

  private renderResultFile(result: VaultSearchResult, parentEl: HTMLElement): void {
    const fileEl = document.createElement("div");
    fileEl.className = "search-result-file";
    fileEl.dataset.path = result.path;
    const titleEl = document.createElement("div");
    titleEl.className = "search-result-file-title tappable";
    titleEl.textContent = result.path;
    titleEl.addEventListener("click", () => this.openResult(result.path, result.matches[0]));
    const matchesEl = document.createElement("div");
    matchesEl.className = "search-result-file-matches";
    for (const match of result.matches) this.renderMatch(result.path, match, matchesEl);
    fileEl.append(titleEl, matchesEl);
    parentEl.appendChild(fileEl);
  }

  private renderMatch(path: string, match: SearchMatch, parentEl: HTMLElement): void {
    const matchEl = document.createElement("div");
    matchEl.className = "search-result-file-match tappable";
    const lineEl = document.createElement("span");
    lineEl.className = "search-result-file-match-line";
    lineEl.textContent = String(match.line + 1);
    const textEl = document.createElement("span");
    textEl.className = "search-result-file-match-text";
    appendHighlightedText(textEl, match.text, match.start, match.end);
    matchEl.append(lineEl, textEl);
    matchEl.addEventListener("click", () => this.openResult(path, match));
    parentEl.appendChild(matchEl);
  }

  private openResult(path: string, match: SearchMatch): void {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return;
    void this.app.workspace.openFile(file, { active: true, eState: { line: match.line, matchStart: match.start, matchEnd: match.end } });
  }
}

function appendHighlightedText(parentEl: HTMLElement, text: string, start: number, end: number): void {
  if (start > 0) parentEl.appendChild(document.createTextNode(text.slice(0, start)));
  const highlightEl = document.createElement("span");
  highlightEl.className = "search-result-file-matched-text";
  highlightEl.textContent = text.slice(start, end);
  parentEl.appendChild(highlightEl);
  if (end < text.length) parentEl.appendChild(document.createTextNode(text.slice(end)));
}
