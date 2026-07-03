import { ItemView } from "../views/ItemView";
import type { SearchMatch, VaultSearchResult } from "../search/SearchEngine";
import { AbstractInputSuggest } from "../suggest/AbstractInputSuggest";
import { setIcon } from "../ui/Icon";
import { setTooltip } from "../ui/Popover";
import type { App } from "../app/App";

interface SearchOperatorOption {
  operator: string;
  /** Text inserted into the input; caret lands at `caretOffset` from its end. */
  insert: string;
  caretOffset: number;
  description: string;
}

const SEARCH_OPERATOR_OPTIONS: SearchOperatorOption[] = [
  { operator: "path:", insert: "path:", caretOffset: 0, description: "match path of the file" },
  { operator: "file:", insert: "file:", caretOffset: 0, description: "match file name" },
  { operator: "tag:", insert: "tag:", caretOffset: 0, description: "search for tags" },
  { operator: "line:", insert: "line:()", caretOffset: 1, description: "search keywords on same line" },
  { operator: "section:", insert: "section:()", caretOffset: 1, description: "search keywords under same heading" },
  { operator: "[property]", insert: "[]", caretOffset: 1, description: "match property" },
];

type SearchSuggestItem = { kind: "group" } | { kind: "option"; option: SearchOperatorOption };

/**
 * The "Search options" dropdown of the real search pane: focusing the empty
 * input lists the query operators; picking one inserts it at the caret. The
 * DOM contract (mod-search-suggestion, search-suggest-item, mod-group) is
 * recovered from the vendored app.css.
 */
class SearchOperatorSuggest extends AbstractInputSuggest<SearchSuggestItem> {
  constructor(app: App, inputEl: HTMLInputElement, private readonly onInsert: (query: string) => void) {
    super(app, inputEl);
    this.suggestEl.classList.add("mod-search-suggestion");
    this.onSelect((item) => {
      if (item.kind !== "option") return;
      const { insert, caretOffset } = item.option;
      const current = this.getValue();
      const next = current && !current.endsWith(" ") ? `${current} ${insert}` : `${current}${insert}`;
      this.setValue(next);
      const caret = next.length - caretOffset;
      inputEl.setSelectionRange(caret, caret);
      this.onInsert(next);
      this.close();
    });
  }

  getSuggestions(value: string): SearchSuggestItem[] {
    const token = value.slice(value.lastIndexOf(" ") + 1);
    const options = SEARCH_OPERATOR_OPTIONS.filter((option) => option.operator.startsWith(token));
    if (options.length === 0) return [];
    return [{ kind: "group" }, ...options.map((option) => ({ kind: "option" as const, option }))];
  }

  // DOM structure recovered from app.js (hJ.renderSuggestion): mod-complex
  // rows with suggestion-content/title/aux; the group row carries a
  // clickable lucide-info icon linking to the search help page.
  renderSuggestion(item: SearchSuggestItem, el: HTMLElement): void {
    const doc = el.ownerDocument;
    el.classList.add("mod-complex", "search-suggest-item");
    const contentEl = doc.createElement("div");
    contentEl.className = "suggestion-content";
    const auxEl = doc.createElement("div");
    auxEl.className = "suggestion-aux";
    const titleEl = doc.createElement("div");
    titleEl.className = "suggestion-title";
    contentEl.appendChild(titleEl);
    el.append(contentEl, auxEl);

    if (item.kind === "group") {
      el.classList.add("mod-group");
      titleEl.classList.add("list-item-part", "mod-extended");
      const nameEl = doc.createElement("span");
      nameEl.textContent = "Search options";
      titleEl.appendChild(nameEl);
      const iconEl = doc.createElement("div");
      iconEl.className = "list-item-part search-suggest-icon clickable-icon";
      setIcon(iconEl, "lucide-info");
      setTooltip(iconEl, "Read more");
      iconEl.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.open("https://help.obsidian.md/Plugins/Search", "_blank");
      });
      auxEl.appendChild(iconEl);
      return;
    }
    const nameEl = doc.createElement("span");
    nameEl.textContent = item.option.operator;
    const descriptionEl = doc.createElement("span");
    descriptionEl.className = "search-suggest-info-text";
    descriptionEl.textContent = item.option.description;
    titleEl.append(nameEl, descriptionEl);
  }
}

export class SearchView extends ItemView {
  private query = "";
  private inputEl: HTMLInputElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private searchId = 0;
  private operatorSuggest: SearchOperatorSuggest | null = null;

  getViewType(): string { return "search"; }
  getDisplayText(): string { return "Search"; }
  getIcon(): string { return "lucide-search"; }

  async onOpen(): Promise<void> {
    this.contentEl.replaceChildren();
    this.contentEl.classList.add("search-view-container");

    const inputContainerEl = document.createElement("div");
    inputContainerEl.className = "search-input-container";
    this.inputEl = document.createElement("input");
    // app.css sizes/styles inputs via attribute selectors (input[type='search']
    // gets --input-height, border, and the reset native search decoration).
    // Without a type attribute the input misses all of it and collapses to
    // content height, throwing the magnifier icon off-center.
    this.inputEl.type = "search";
    this.inputEl.className = "search-input";
    this.inputEl.placeholder = "Search...";
    this.inputEl.value = this.query;
    this.inputEl.addEventListener("input", () => this.setQuery(this.inputEl?.value ?? ""));
    this.operatorSuggest = new SearchOperatorSuggest(this.app, this.inputEl, (query) => this.setQuery(query));
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
    this.countEl.textContent = this.query.trim() ? `${matchCount} result${matchCount === 1 ? "" : "s"} in ${results.length} file${results.length === 1 ? "" : "s"}` : "";

    for (const result of results) this.renderResultFile(result, this.resultsEl);
  }

  getQuery(): string {
    return this.query;
  }

  async onClose(): Promise<void> {
    this.operatorSuggest?.close();
    this.operatorSuggest = null;
    await super.onClose();
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
