import { Modal } from "../Modal";
import type { App } from "../../app/App";
import { Platform } from "../../platform/Platform";
import { renderResults, sortSearchResults } from "../../search/SearchHelpers";
import {
  fuzzyMatch,
  prepareFuzzyQuery,
  type FuzzyMatch,
  type PreparedFuzzyQuery,
} from "../../core/fuzzy";

export { fuzzyMatch, prepareFuzzyQuery, type FuzzyMatch, type PreparedFuzzyQuery };

export interface Instruction {
  command: string;
  purpose: string;
}

export type PromptInstruction = Instruction;

export interface FuzzySuggestion<T> {
  match: FuzzyMatch;
  item: T;
}

export interface ISuggestOwner<T> {
  renderSuggestion(value: T, el: HTMLElement): void;
  selectSuggestion(value: T, event: MouseEvent | KeyboardEvent): void;
}

export interface SuggestOwner<T> extends ISuggestOwner<T> {
  onSelectedChange(value: T, event: MouseEvent | KeyboardEvent | null): void;
}

export abstract class SuggestModal<T> extends Modal {
  limit = 100;
  emptyStateText = "No results found";
  isOpen = false;
  readonly inputEl: HTMLInputElement;
  readonly clearButtonEl: HTMLElement;
  readonly ctaEl: HTMLElement;
  readonly resultContainerEl: HTMLElement;
  readonly instructionsEl: HTMLElement;
  readonly chooser: SuggestChooser<T>;

  constructor(app: App) {
    super(app);
    this.modalEl.classList.remove("modal");
    this.modalEl.classList.add("prompt");
    this.modalEl.replaceChildren();

    const doc = this.containerEl.ownerDocument;
    const inputContainerEl = doc.createElement("div");
    inputContainerEl.className = "prompt-input-container";
    if (Platform.isPhone) inputContainerEl.classList.add("mod-raised");

    this.inputEl = doc.createElement("input");
    this.inputEl.className = "prompt-input";
    this.inputEl.type = "text";
    this.inputEl.autocapitalize = "off";
    this.inputEl.spellcheck = false;
    this.inputEl.enterKeyHint = Platform.isAndroidApp ? "enter" : "done";

    this.ctaEl = doc.createElement("div");
    this.ctaEl.className = "prompt-input-cta";

    this.clearButtonEl = doc.createElement("div");
    this.clearButtonEl.className = "search-input-clear-button";
    this.clearButtonEl.addEventListener("mousedown", (event) => event.preventDefault());
    this.clearButtonEl.addEventListener("click", () => {
      if (this.inputEl.value !== "") {
        this.inputEl.value = "";
        this.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        this.close();
      }
    });

    inputContainerEl.append(this.inputEl, this.ctaEl, this.clearButtonEl);

    this.resultContainerEl = doc.createElement("div");
    this.resultContainerEl.className = "prompt-results";

    this.instructionsEl = doc.createElement("div");
    this.instructionsEl.className = "prompt-instructions";

    this.modalEl.append(inputContainerEl, this.resultContainerEl);
    this.chooser = new SuggestChooser(this, this.resultContainerEl);

    this.inputEl.addEventListener("input", () => this.onInput());
    this.registerScopeNavigation();
  }

  setPlaceholder(text: string): void {
    this.inputEl.placeholder = text;
  }

  setInstructions(instructions: Instruction[]): void {
    this.instructionsEl.replaceChildren();
    if (instructions.length === 0) {
      this.instructionsEl.remove();
      return;
    }

    for (const instruction of instructions) {
      const doc = this.containerEl.ownerDocument;
      const instructionEl = doc.createElement("div");
      instructionEl.className = "prompt-instruction";
      const commandEl = doc.createElement("span");
      commandEl.className = "prompt-instruction-command";
      commandEl.textContent = instruction.command;
      const purposeEl = doc.createElement("span");
      purposeEl.textContent = instruction.purpose;
      instructionEl.append(commandEl, purposeEl);
      this.instructionsEl.appendChild(instructionEl);
    }

    this.modalEl.appendChild(this.instructionsEl);
  }

  onOpen(): void {
    this.isOpen = true;
    this.inputEl.value = "";
    this.inputEl.focus();
    this.updateSuggestions();
  }

  onClose(): void {
    this.isOpen = false;
  }

  onInput(): void {
    this.updateSuggestions();
  }

  updateSuggestions(): void {
    const query = this.inputEl.value;
    const suggestions = this.getSuggestions(query);
    if (Array.isArray(suggestions)) {
      this.applySuggestions(suggestions);
      return;
    }
    void suggestions.then((resolved) => this.applySuggestions(resolved));
  }

  private applySuggestions(suggestions: T[]): void {
    if (suggestions && suggestions.length > 0) {
      const limited = this.limit > 0 ? suggestions.slice(0, this.limit) : suggestions;
      this.chooser.setSuggestions(limited);
    } else {
      this.onNoSuggestion();
    }
  }

  onNoSuggestion(): void {
    this.chooser.setSuggestions(null);
    this.chooser.addMessage(this.emptyStateText);
  }

  selectSuggestion(value: T, event: MouseEvent | KeyboardEvent): void {
    this.app.keymap.updateModifiers(event);
    this.close();
    this.isOpen = false;
    this.onChooseSuggestion(value, event);
  }

  selectActiveSuggestion(event: KeyboardEvent): void {
    this.chooser.useSelectedItem(event);
  }

  private registerScopeNavigation(): void {
    this.scope.register([], "ArrowDown", (event) => {
      if (event.isComposing) return;
      this.chooser.moveSelectedItem(1, event);
      return false;
    });
    this.scope.register([], "ArrowUp", (event) => {
      if (event.isComposing) return;
      this.chooser.moveSelectedItem(-1, event);
      return false;
    });
    this.scope.register([], "PageDown", (event) => {
      if (event.isComposing) return;
      return this.chooser.pageDown(event);
    });
    this.scope.register([], "PageUp", (event) => {
      if (event.isComposing) return;
      return this.chooser.pageUp(event);
    });
    this.scope.register([], "Home", (event) => {
      this.chooser.setSelectedItem(0, event);
      return false;
    });
    this.scope.register([], "End", (event) => {
      this.chooser.setSelectedItem(this.chooser.length - 1, event);
      return false;
    });
    this.scope.register([], "Enter", (event) => {
      if (event.isComposing) return;
      return this.chooser.useSelectedItem(event) ? false : undefined;
    });
    if (Platform.isMacOS || Platform.isIosApp) {
      this.scope.register(["Ctrl"], "p", (event) => {
        if (event.isComposing) return;
        this.chooser.moveSelectedItem(-1, event);
        return false;
      });
      this.scope.register(["Ctrl"], "n", (event) => {
        if (event.isComposing) return;
        this.chooser.moveSelectedItem(1, event);
        return false;
      });
    }
  }

  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract onChooseSuggestion(value: T, event: MouseEvent | KeyboardEvent): void;
  onSelectedChange(_value: T, _event: MouseEvent | KeyboardEvent | null): void {}
}

export class SuggestChooser<T> {
  protected values: T[] = [];
  protected suggestionEls: HTMLElement[] = [];
  selectedItem = 0;
  selectOnHover = true;

  constructor(
    readonly owner: SuggestOwner<T>,
    readonly containerEl: HTMLElement,
  ) {}

  get length(): number {
    return this.values.length;
  }

  setSuggestions(values: T[] | null): void {
    this.containerEl.replaceChildren();
    this.values = values ?? [];
    this.suggestionEls = [];
    if (!values) return;

    for (const value of values) this.addSuggestion(value);
    this.setSelectedItem(0, null);
  }

  getSelectedElement(): HTMLElement | null {
    return this.suggestionEls[this.selectedItem] ?? null;
  }

  getSelectedValue(): T | null {
    return this.values[this.selectedItem] ?? null;
  }

  shouldSelectOnHover(value: boolean): this {
    this.selectOnHover = value;
    return this;
  }

  addSuggestion(value: T): void {
    const itemEl = this.containerEl.ownerDocument.createElement("div");
    itemEl.className = "suggestion-item";
    this.owner.renderSuggestion(value, itemEl);
    itemEl.addEventListener("click", (event) => this.onSuggestionClick(event, itemEl));
    itemEl.addEventListener("auxclick", (event) => this.onSuggestionClick(event, itemEl));
    itemEl.addEventListener("mousemove", (event) => {
      if (this.selectOnHover) this.setSelectedItem(this.suggestionEls.indexOf(itemEl), event);
    });
    this.containerEl.appendChild(itemEl);
    this.suggestionEls.push(itemEl);
  }

  addMessage(message: string): void {
    const emptyEl = this.containerEl.ownerDocument.createElement("div");
    emptyEl.className = "suggestion-empty";
    emptyEl.textContent = message;
    this.containerEl.appendChild(emptyEl);
  }

  getVisibleItemCount(): number {
    return this.numVisibleItems;
  }

  get rowHeight(): number {
    const selectedEl = this.suggestionEls[this.selectedItem] ?? this.suggestionEls[0];
    return selectedEl?.clientHeight || selectedEl?.getBoundingClientRect().height || 1;
  }

  get numVisibleItems(): number {
    return Math.max(1, Math.floor(this.containerEl.clientHeight / this.rowHeight));
  }

  pageUp(event: KeyboardEvent): false | undefined {
    if (event.isComposing) return;
    if (this.values.length === 0) return false;
    const paddingTop = parseFloat(getComputedStyle(this.containerEl).paddingTop) || 0;
    const scrollTop = this.containerEl.scrollTop - paddingTop;
    let index = Math.floor(scrollTop / this.rowHeight);
    if (this.selectedItem <= index) index -= this.numVisibleItems;
    this.setSelectedItem(Math.max(0, index), event);
    return false;
  }

  pageDown(event: KeyboardEvent): false | undefined {
    if (event.isComposing) return;
    if (this.values.length === 0) return false;
    const paddingTop = parseFloat(getComputedStyle(this.containerEl).paddingTop) || 0;
    const scrollTop = this.containerEl.scrollTop - paddingTop;
    let index = Math.floor(scrollTop / this.rowHeight) + this.numVisibleItems - 1;
    if (this.selectedItem >= index) index += this.numVisibleItems;
    this.setSelectedItem(Math.min(this.suggestionEls.length - 1, index), event);
    return false;
  }

  moveSelectedItem(delta: number, event: KeyboardEvent, wrap = true): void {
    if (this.values.length === 0) return;
    let index = this.selectedItem + delta;
    if (wrap) index = (index + this.values.length) % this.values.length;
    else index = Math.max(0, Math.min(this.values.length - 1, index));
    this.setSelectedItem(index, event);
  }

  setSelectedItem(index: number, event: MouseEvent | KeyboardEvent | null): void {
    if (this.values.length === 0) return;
    let next = index;
    if (next < 0) next = this.values.length - 1;
    else if (next >= this.values.length) next = 0;
    this.forceSetSelectedItem(next, event);
  }

  forceSetSelectedItem(index: number, event: MouseEvent | KeyboardEvent | null): void {
    const oldEl = this.suggestionEls[this.selectedItem];
    oldEl?.classList.remove("is-selected");
    this.selectedItem = index;
    const newEl = this.suggestionEls[index];
    newEl?.classList.add("is-selected");
    if (newEl && !(event instanceof MouseEvent) && typeof newEl.scrollIntoView === "function") {
      newEl.scrollIntoView({ block: "nearest" });
    }
    this.owner.onSelectedChange(this.values[index], event);
  }

  private onSuggestionClick(event: MouseEvent, itemEl: HTMLElement): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    this.setSelectedItem(this.suggestionEls.indexOf(itemEl), event);
    this.useSelectedItem(event);
  }

  useSelectedItem(event: MouseEvent | KeyboardEvent): boolean {
    const value = this.values[this.selectedItem];
    if (value === undefined) return false;
    this.owner.selectSuggestion(value, event);
    return true;
  }
}

export interface GroupedSuggestion {
  group: string;
}

export class GroupedSuggestChooser<T extends GroupedSuggestion> extends SuggestChooser<T> {
  override setSuggestions(values: T[] | null): void {
    this.containerEl.replaceChildren();
    this.values = values ?? [];
    this.suggestionEls = [];
    if (!values) return;

    let currentGroup = "";
    let groupEl: HTMLElement | null = null;
    for (const value of values) {
      if (!groupEl || value.group !== currentGroup) {
        currentGroup = value.group;
        groupEl = this.containerEl.ownerDocument.createElement("div");
        groupEl.className = "suggestion-group";
        groupEl.dataset.group = value.group;
        this.containerEl.appendChild(groupEl);
      }
      const itemEl = this.containerEl.ownerDocument.createElement("div");
      itemEl.className = "suggestion-item";
      this.owner.renderSuggestion(value, itemEl);
      itemEl.addEventListener("click", (event) => this.onGroupedSuggestionClick(event, itemEl));
      itemEl.addEventListener("auxclick", (event) => this.onGroupedSuggestionClick(event, itemEl));
      itemEl.addEventListener("mousemove", (event) => {
        if (this.selectOnHover) this.setSelectedItem(this.suggestionEls.indexOf(itemEl), event);
      });
      groupEl.appendChild(itemEl);
      this.suggestionEls.push(itemEl);
    }
    this.setSelectedItem(0, null);
  }

  private onGroupedSuggestionClick(event: MouseEvent, itemEl: HTMLElement): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    this.setSelectedItem(this.suggestionEls.indexOf(itemEl), event);
    this.useSelectedItem(event);
  }
}

export abstract class FuzzySuggestModal<T> extends SuggestModal<FuzzySuggestion<T>> {
  abstract getItems(): T[];
  abstract getItemText(item: T): string;
  abstract onChooseItem(item: T, event: MouseEvent | KeyboardEvent): void;

  sortSuggestions(suggestions: FuzzySuggestion<T>[]): void {
    sortFuzzySuggestions(suggestions);
  }

  getSuggestions(query: string): FuzzySuggestion<T>[] {
    const fuzzyQuery = prepareFuzzyQuery(query.trim());
    const suggestions: FuzzySuggestion<T>[] = [];
    for (const item of this.getItems()) {
      const match = fuzzyMatch(fuzzyQuery, this.getItemText(item));
      if (match) suggestions.push({ match, item });
    }
    this.sortSuggestions(suggestions);
    return suggestions;
  }

  renderSuggestion(value: FuzzySuggestion<T>, el: HTMLElement): void {
    renderFuzzyText(el, this.getItemText(value.item), value.match);
  }

  onChooseSuggestion(value: FuzzySuggestion<T>, event: MouseEvent | KeyboardEvent): void {
    this.onChooseItem(value.item, event);
  }
}

export function sortFuzzySuggestions<T>(suggestions: FuzzySuggestion<T>[]): void {
  sortSearchResults(suggestions);
}

export function renderFuzzyText(
  el: HTMLElement,
  text: string,
  match: FuzzyMatch | null,
  offset = 0,
): void {
  renderResults(el, text, match, offset);
}
