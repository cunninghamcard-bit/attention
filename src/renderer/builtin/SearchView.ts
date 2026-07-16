import { ItemView } from "../views/ItemView";
import type { SearchMatch, VaultSearchResult } from "../search/SearchEngine";
import { AbstractInputSuggest } from "../ui/suggest/AbstractInputSuggest";
import { DropdownComponent, SearchComponent, Setting, ToggleComponent } from "../ui/Setting";
import { setIcon } from "../ui/Icon";
import { setTooltip } from "../ui/Popover";
import { TreeItem } from "../ui/TreeItem";
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
  {
    operator: "line:",
    insert: "line:()",
    caretOffset: 1,
    description: "search keywords on same line",
  },
  {
    operator: "section:",
    insert: "section:()",
    caretOffset: 1,
    description: "search keywords under same heading",
  },
  { operator: "[property]", insert: "[]", caretOffset: 1, description: "match property" },
];

type SearchSuggestItem = { kind: "group" } | { kind: "option"; option: SearchOperatorOption };

/**
 * The search-options suggestion list used by the real global search view.
 * Its DOM classes are part of the existing Obsidian-compatible stylesheet.
 */
class SearchOperatorSuggest extends AbstractInputSuggest<SearchSuggestItem> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly onInsert: (query: string) => void,
  ) {
    super(app, inputEl);
    this.suggestEl.classList.add("mod-search-suggestion");
    this.onSelect((item) => {
      if (item.kind !== "option") return;
      const { insert, caretOffset } = item.option;
      const current = this.getValue();
      const next =
        current && !current.endsWith(" ") ? `${current} ${insert}` : `${current}${insert}`;
      this.setValue(next);
      const caret = next.length - caretOffset;
      inputEl.setSelectionRange(caret, caret);
      this.onInsert(next);
      this.close();
    });
  }

  getSuggestions(value: string): SearchSuggestItem[] {
    const token = value.slice(value.lastIndexOf(" ") + 1);
    const registered: SearchOperatorOption[] = this.app.search
      .getRegisteredOperators()
      .map((definition) => ({
        operator: `${definition.name}:`,
        insert: definition.token,
        caretOffset: definition.token.endsWith("()") ? 1 : 0,
        description: definition.description,
      }));
    const options = [...SEARCH_OPERATOR_OPTIONS, ...registered].filter((option) =>
      option.operator.startsWith(token),
    );
    if (options.length === 0) return [];
    return [{ kind: "group" }, ...options.map((option) => ({ kind: "option" as const, option }))];
  }

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

type SearchSortOrder =
  | "alphabetical"
  | "alphabeticalReverse"
  | "byModifiedTime"
  | "byModifiedTimeReverse"
  | "byCreatedTime"
  | "byCreatedTimeReverse";

const SEARCH_SORT_OPTIONS: Array<[SearchSortOrder, string]> = [
  ["alphabetical", "A to Z"],
  ["alphabeticalReverse", "Z to A"],
  ["byModifiedTime", "Modified time (new to old)"],
  ["byModifiedTimeReverse", "Modified time (old to new)"],
  ["byCreatedTime", "Created time (new to old)"],
  ["byCreatedTimeReverse", "Created time (old to new)"],
];

export class SearchView extends ItemView {
  private query = "";
  private inputEl: HTMLInputElement | null = null;
  private searchComponent: SearchComponent | null = null;
  private resultContainerEl: HTMLElement | null = null;
  private searchInfoEl: HTMLElement | null = null;
  private infoEl: HTMLElement | null = null;
  private resultCountEl: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private emptyStateEl: HTMLElement | null = null;
  private filterSectionToggleEl: HTMLElement | null = null;
  private searchParamsContainerEl: HTMLElement | null = null;
  private collapseResultsToggle: ToggleComponent | null = null;
  private extraContextToggle: ToggleComponent | null = null;
  private explainSearchToggle: ToggleComponent | null = null;
  private sortOrderDropdown: DropdownComponent | null = null;
  private matchingCaseButtonEl: HTMLElement | null = null;
  private searchId = 0;
  private lastResults: VaultSearchResult[] = [];
  private readonly resultItems = new WeakMap<HTMLElement, TreeItem>();
  private operatorSuggest: SearchOperatorSuggest | null = null;
  private matchingCase = false;
  private explainSearch = false;
  private showParams = false;
  private collapseAll = false;
  private extraContext = false;
  private sortOrder: SearchSortOrder = "alphabetical";

  getViewType(): string {
    return "search";
  }

  getDisplayText(): string {
    return "Search";
  }

  getIcon(): string {
    return "lucide-search";
  }

  async onOpen(): Promise<void> {
    const doc = this.contentEl.ownerDocument;
    this.contentEl.replaceChildren();

    const rowEl = doc.createElement("div");
    rowEl.className = "search-row";
    this.searchComponent = new SearchComponent(rowEl)
      .setPlaceholder("Search...")
      .setClass("global-search-input-container")
      .onChange((value) => this.setQuery(value));
    this.inputEl = this.searchComponent.inputEl;
    this.inputEl.value = this.query;
    this.inputEl.setAttribute("aria-label", "Search");
    this.inputEl.addEventListener("keydown", (event) => {
      if (!event.isComposing && event.key === "Enter") this.startSearch();
    });
    this.searchComponent.addRightDecorator((decoratorEl) => {
      this.matchingCaseButtonEl = decoratorEl;
      decoratorEl.classList.add("clickable-icon");
      decoratorEl.classList.toggle("is-active", this.matchingCase);
      setIcon(decoratorEl, "uppercase-lowercase-a");
      setTooltip(decoratorEl, "Match case");
      decoratorEl.addEventListener("click", () => this.setMatchingCase(!this.matchingCase));
    });
    setTooltip(this.searchComponent.clearButtonEl, "Clear search");
    this.operatorSuggest = new SearchOperatorSuggest(this.app, this.inputEl, (query) =>
      this.setQuery(query),
    );

    this.resultContainerEl = doc.createElement("div");
    this.resultContainerEl.className = "search-result-container mod-global-search";
    this.searchInfoEl = doc.createElement("div");
    this.searchInfoEl.className = "search-info-container";
    this.searchInfoEl.style.display = "none";

    this.filterSectionToggleEl = doc.createElement("div");
    this.filterSectionToggleEl.className = "clickable-icon";
    setIcon(this.filterSectionToggleEl, "lucide-sliders-horizontal");
    setTooltip(this.filterSectionToggleEl, "Toggle search settings");
    this.filterSectionToggleEl.addEventListener("click", () => this.toggleFilterSection());
    rowEl.appendChild(this.filterSectionToggleEl);

    this.searchParamsContainerEl = doc.createElement("div");
    this.searchParamsContainerEl.className = "search-params";
    this.searchParamsContainerEl.style.display = "none";
    new Setting(this.searchParamsContainerEl)
      .setName("Collapse results")
      .setClass("mod-toggle")
      .addToggle((toggle) => {
        this.collapseResultsToggle = toggle;
        toggle.onChange((value) => this.setCollapseAll(value));
      });
    new Setting(this.searchParamsContainerEl)
      .setName("More context")
      .setClass("mod-toggle")
      .addToggle((toggle) => {
        this.extraContextToggle = toggle;
        toggle.onChange((value) => this.setExtraContext(value));
      });
    new Setting(this.searchParamsContainerEl)
      .setName("Explain search term")
      .setClass("mod-toggle")
      .addToggle((toggle) => {
        this.explainSearchToggle = toggle;
        toggle.onChange((value) => this.setExplainSearch(value));
      });
    this.collapseResultsToggle.setValue(this.collapseAll);
    this.extraContextToggle.setValue(this.extraContext);
    this.explainSearchToggle.setValue(this.explainSearch);

    this.infoEl = doc.createElement("div");
    this.infoEl.className = "search-results-info";
    this.infoEl.style.display = "none";
    const countButtonEl = doc.createElement("div");
    countButtonEl.className = "clickable-icon search-results-result-count";
    this.resultCountEl = doc.createElement("span");
    const moreOptionsEl = doc.createElement("div");
    moreOptionsEl.className = "more-options-icon";
    setIcon(moreOptionsEl, "lucide-more-horizontal");
    countButtonEl.append(this.resultCountEl, moreOptionsEl);
    this.infoEl.appendChild(countButtonEl);
    this.sortOrderDropdown = new DropdownComponent(this.infoEl);
    for (const [value, label] of SEARCH_SORT_OPTIONS)
      this.sortOrderDropdown.addOption(value, label);
    this.sortOrderDropdown.setValue(this.sortOrder).onChange((value) => {
      this.setSortOrder(value as SearchSortOrder);
      this.app.workspace.requestSaveLayout();
    });

    this.emptyStateEl = doc.createElement("div");
    this.emptyStateEl.className = "search-empty-state";
    this.emptyStateEl.textContent = "No matches found";
    this.resultsEl = doc.createElement("div");
    this.resultsEl.className = "search-results-children";
    this.resultContainerEl.append(this.emptyStateEl, this.resultsEl);
    this.contentEl.append(
      rowEl,
      this.searchInfoEl,
      this.searchParamsContainerEl,
      this.infoEl,
      this.resultContainerEl,
    );

    this.inputEl.focus();
    this.setQuery(this.query);
  }

  async setState(state: unknown): Promise<void> {
    await super.setState(state);
    if (!state || typeof state !== "object") return;
    const value = state as Record<string, unknown>;
    if (typeof value.query === "string" || value.query === null) {
      this.query = typeof value.query === "string" ? value.query : "";
      if (this.searchComponent) this.searchComponent.setValue(this.query);
    }
    if (typeof value.matchingCase === "boolean") this.setMatchingCase(value.matchingCase, false);
    if (typeof value.explainSearch === "boolean") this.setExplainSearch(value.explainSearch, false);
    if (typeof value.collapseAll === "boolean") this.setCollapseAll(value.collapseAll, false);
    if (typeof value.extraContext === "boolean") this.setExtraContext(value.extraContext, false);
    if (typeof value.sortOrder === "string" && isSearchSortOrder(value.sortOrder))
      this.setSortOrder(value.sortOrder, false);
    if (this.inputEl) this.startSearch();
  }

  getState(): Record<string, unknown> {
    return {
      query: this.query,
      matchingCase: this.matchingCase,
      explainSearch: this.explainSearch,
      collapseAll: this.collapseAll,
      extraContext: this.extraContext,
      sortOrder: this.sortOrder,
    };
  }

  setQuery(query: string): void {
    this.query = query;
    if (this.searchComponent && this.searchComponent.getValue() !== query)
      this.searchComponent.setValue(query);
    this.app.workspace.trigger("search-query-change", query);
    this.startSearch();
  }

  getQuery(): string {
    return this.query;
  }

  focusSearch(query?: string): void {
    if (query !== undefined) this.setQuery(query);
    this.inputEl?.focus();
    this.inputEl?.select();
  }

  async onClose(): Promise<void> {
    this.searchId += 1;
    this.operatorSuggest?.close();
    this.operatorSuggest = null;
    await super.onClose();
  }

  private startSearch(): void {
    const searchId = ++this.searchId;
    const query = this.query.trim();
    this.lastResults = [];
    this.renderResults([]);
    this.searchInfoEl?.replaceChildren();
    this.setLoading(false);

    if (!query) {
      if (this.infoEl) this.infoEl.style.display = "none";
      if (this.searchInfoEl) this.searchInfoEl.style.display = "none";
      return;
    }

    if (this.infoEl) this.infoEl.style.display = "flex";
    if (this.explainSearch && this.searchInfoEl) {
      const info = this.searchInfoEl.ownerDocument.createElement("div");
      info.className = "search-info";
      info.textContent = `Search: ${query}`;
      this.searchInfoEl.appendChild(info);
      this.searchInfoEl.style.display = "";
    }
    this.setLoading(true);
    void this.app.search
      .search({ query, caseSensitive: this.matchingCase })
      .then((results) => {
        if (searchId !== this.searchId) return;
        this.lastResults = results;
        this.renderResults(results);
      })
      .catch((error: unknown) => {
        if (searchId !== this.searchId) return;
        this.renderError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (searchId === this.searchId) this.setLoading(false);
      });
  }

  private renderResults(results: VaultSearchResult[]): void {
    if (!this.resultsEl || !this.resultCountEl || !this.emptyStateEl) return;
    this.resultsEl.replaceChildren();
    const sorted = this.sortResults(results);
    const matchCount = sorted.reduce((sum, result) => sum + Math.max(1, result.matches.length), 0);
    this.resultCountEl.textContent = `${matchCount} result${matchCount === 1 ? "" : "s"} in ${sorted.length} file${sorted.length === 1 ? "" : "s"}`;
    this.emptyStateEl.style.display = sorted.length === 0 ? "" : "none";
    for (const result of sorted) this.renderResultFile(result, this.resultsEl);
  }

  private renderError(message: string): void {
    if (!this.resultsEl || !this.emptyStateEl || !this.searchInfoEl) return;
    this.resultsEl.replaceChildren();
    this.emptyStateEl.style.display = "none";
    const errorEl = this.searchInfoEl.ownerDocument.createElement("div");
    errorEl.className = "search-info";
    errorEl.textContent = message;
    this.searchInfoEl.replaceChildren(errorEl);
    this.searchInfoEl.style.display = "";
    if (this.resultCountEl) this.resultCountEl.textContent = "";
  }

  private sortResults(results: VaultSearchResult[]): VaultSearchResult[] {
    const sorted = [...results];
    sorted.sort((a, b) => {
      const fileA = this.app.vault.getFileByPath(a.path);
      const fileB = this.app.vault.getFileByPath(b.path);
      const nameA = fileA?.basename ?? a.path;
      const nameB = fileB?.basename ?? b.path;
      switch (this.sortOrder) {
        case "alphabeticalReverse":
          return compareText(nameB, nameA) || compareText(b.path, a.path);
        case "byModifiedTime":
          return (fileB?.stat.mtime ?? 0) - (fileA?.stat.mtime ?? 0) || compareText(a.path, b.path);
        case "byModifiedTimeReverse":
          return (fileA?.stat.mtime ?? 0) - (fileB?.stat.mtime ?? 0) || compareText(a.path, b.path);
        case "byCreatedTime":
          return (fileB?.stat.ctime ?? 0) - (fileA?.stat.ctime ?? 0) || compareText(a.path, b.path);
        case "byCreatedTimeReverse":
          return (fileA?.stat.ctime ?? 0) - (fileB?.stat.ctime ?? 0) || compareText(a.path, b.path);
        case "alphabetical":
        default:
          return compareText(nameA, nameB) || compareText(a.path, b.path);
      }
    });
    return sorted;
  }

  private renderResultFile(result: VaultSearchResult, parentEl: HTMLElement): void {
    const fileItem = new TreeItem(parentEl, {
      itemClass: "search-result",
      selfClass: "search-result-file-title is-clickable tappable",
      childrenClass: "search-result-file-matches",
    });
    this.resultItems.set(fileItem.el, fileItem);
    const fileEl = fileItem.el;
    fileEl.dataset.path = result.path;
    fileEl.setAttribute("aria-expanded", "true");
    fileItem.innerEl.textContent = result.path;
    fileItem.onSelfClick = () => this.openResult(result.path, result.matches[0]);
    fileItem.setCollapsible(result.matches.length > 0);
    if (fileItem.collapseEl) fileItem.collapseEl.style.visibility = "visible";
    const matchesEl = fileItem.childrenEl;
    for (const match of result.matches) this.renderMatch(result.path, match, matchesEl);
    if (this.collapseAll) this.setResultCollapsed(fileEl, true);
  }

  private renderMatch(path: string, match: SearchMatch, parentEl: HTMLElement): void {
    const doc = parentEl.ownerDocument;
    const matchEl = doc.createElement("div");
    matchEl.className = "search-result-file-match tappable";
    const lineEl = doc.createElement("span");
    lineEl.className = "search-result-file-match-line";
    lineEl.textContent = `${match.line + 1}: `;
    const textEl = doc.createElement("span");
    textEl.className = "search-result-file-match-text";
    appendHighlightedText(textEl, match.text, match.start, match.end);
    matchEl.append(lineEl, textEl);
    matchEl.addEventListener("click", () => this.openResult(path, match));
    parentEl.appendChild(matchEl);
  }

  private openResult(path: string, match?: SearchMatch): void {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return;
    const eState = match
      ? { line: match.line, matchStart: match.start, matchEnd: match.end }
      : undefined;
    void this.app.workspace.openFile(file, { active: true, eState });
  }

  private toggleFilterSection(): void {
    this.showParams = !this.showParams;
    this.filterSectionToggleEl?.classList.toggle("is-active", this.showParams);
    if (this.searchParamsContainerEl)
      this.searchParamsContainerEl.style.display = this.showParams ? "flex" : "none";
  }

  private setMatchingCase(value: boolean, rerun = true): void {
    if (value === this.matchingCase) return;
    this.matchingCase = value;
    this.matchingCaseButtonEl?.classList.toggle("is-active", value);
    if (rerun && this.query.trim()) this.startSearch();
  }

  private setExplainSearch(value: boolean, persist = true): void {
    if (this.explainSearch === value && this.explainSearchToggle?.getValue() === value) return;
    this.explainSearch = value;
    this.explainSearchToggle?.setValue(value);
    if (this.searchInfoEl) {
      this.searchInfoEl.replaceChildren();
      if (value && this.query.trim()) {
        const info = this.searchInfoEl.ownerDocument.createElement("div");
        info.className = "search-info";
        info.textContent = `Search: ${this.query}`;
        this.searchInfoEl.appendChild(info);
      }
      this.searchInfoEl.style.display = value && this.query.trim() ? "" : "none";
    }
    if (persist) this.app.workspace.requestSaveLayout();
  }

  private setCollapseAll(value: boolean, persist = true): void {
    if (this.collapseAll === value && this.collapseResultsToggle?.getValue() === value) return;
    this.collapseAll = value;
    this.collapseResultsToggle?.setValue(value);
    this.resultsEl
      ?.querySelectorAll<HTMLElement>(".search-result")
      .forEach((resultEl) => this.setResultCollapsed(resultEl, value));
    if (persist) this.app.workspace.requestSaveLayout();
  }

  private setExtraContext(value: boolean, persist = true): void {
    if (this.extraContext === value && this.extraContextToggle?.getValue() === value) return;
    this.extraContext = value;
    this.extraContextToggle?.setValue(value);
    this.resultsEl?.classList.toggle("mod-search-extra-context", value);
    if (persist) this.app.workspace.requestSaveLayout();
  }

  private setSortOrder(value: SearchSortOrder, persist = true): void {
    if (!isSearchSortOrder(value)) return;
    this.sortOrder = value;
    this.sortOrderDropdown?.setValue(value);
    if (this.lastResults.length > 0) this.renderResults(this.lastResults);
    if (persist) this.app.workspace.requestSaveLayout();
  }

  private setResultCollapsed(resultEl: HTMLElement, collapsed: boolean): void {
    const resultItem = this.resultItems.get(resultEl);
    if (resultItem) {
      resultItem.setCollapsed(collapsed);
      return;
    }
    resultEl.classList.toggle("is-collapsed", collapsed);
    resultEl.setAttribute("aria-expanded", String(!collapsed));
    const matchesEl = resultEl.querySelector<HTMLElement>(".search-result-file-matches");
    if (matchesEl) matchesEl.hidden = collapsed;
  }

  private setLoading(loading: boolean): void {
    this.resultContainerEl?.classList.toggle("is-loading", loading);
    if (this.emptyStateEl && loading) this.emptyStateEl.style.display = "none";
  }
}

function isSearchSortOrder(value: string): value is SearchSortOrder {
  return SEARCH_SORT_OPTIONS.some(([option]) => option === value);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
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
