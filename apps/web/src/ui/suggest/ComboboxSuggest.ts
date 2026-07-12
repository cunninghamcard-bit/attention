import type { App } from "../../app/App";
import { setIcon } from "../Icon";
import { SearchComponent } from "../Setting";
import { PopoverSuggest } from "./AbstractInputSuggest";
import { fuzzyMatch, prepareFuzzyQuery, renderFuzzyText, type FuzzyMatch } from "./SuggestModal";

export interface ComboboxItem {
  value: string;
  display?: string;
  icon?: string;
}

export interface ComboboxSuggestion extends ComboboxItem {
  match: FuzzyMatch | null;
  score: number;
}

export class ComboboxSuggest extends PopoverSuggest<ComboboxSuggestion> {
  clearable = false;
  readonly bgEl: HTMLElement;
  readonly buttonEl: HTMLElement;
  readonly iconEl: HTMLElement;
  readonly labelEl: HTMLElement;
  readonly clearButtonEl: HTMLElement;
  readonly chevronEl: HTMLElement;
  readonly searchComponent: SearchComponent;
  private items: ComboboxItem[] = [];
  private value: ComboboxItem | null = null;
  private selectCb:
    | ((value: ComboboxItem | null, event: MouseEvent | KeyboardEvent) => void)
    | null = null;
  private openCb: (() => void) | null = null;
  private closeCb: (() => void) | null = null;

  constructor(app: App, parentEl: HTMLElement) {
    super(app);
    this.suggestEl.classList.add("combobox");

    const doc = parentEl.ownerDocument;
    this.bgEl = doc.createElement("div");
    this.bgEl.className = "suggestion-bg";
    this.bgEl.style.opacity = "0";
    this.bgEl.addEventListener("mousedown", (event) => event.preventDefault());
    this.bgEl.addEventListener("click", () => this.close());

    this.buttonEl = doc.createElement("div");
    this.buttonEl.className = "combobox-button";
    this.buttonEl.tabIndex = 0;
    parentEl.appendChild(this.buttonEl);

    this.iconEl = doc.createElement("div");
    this.iconEl.className = "combobox-button-icon";
    this.iconEl.hidden = true;
    this.labelEl = doc.createElement("div");
    this.labelEl.className = "combobox-button-label";
    this.clearButtonEl = doc.createElement("div");
    this.clearButtonEl.className = "combobox-clear-button";
    setIcon(this.clearButtonEl, "lucide-x");
    this.chevronEl = doc.createElement("div");
    this.chevronEl.className = "combobox-button-chevron";
    setIcon(this.chevronEl, "lucide-chevrons-up-down");
    this.buttonEl.append(this.iconEl, this.labelEl, this.clearButtonEl, this.chevronEl);

    this.clearButtonEl.addEventListener("mousedown", (event) => event.preventDefault());
    this.clearButtonEl.addEventListener("click", (event) => {
      event.preventDefault();
      this.buttonEl.blur();
      this.selectValue(null, event);
    });
    this.buttonEl.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key.startsWith("Arrow") || event.key.length === 1) this.open();
    });
    this.buttonEl.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      this.toggle();
    });

    this.searchComponent = new SearchComponent(this.suggestEl)
      .setPlaceholder("Start search")
      .onChange((value) => this.onInputChange(value));
    this.suggestEl.prepend(this.searchComponent.containerEl);
    this.suggestEl.addEventListener("mousedown", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(".suggestion")) event.preventDefault();
    });
    this.searchComponent.inputEl.addEventListener("focus", () =>
      this.suggestEl.classList.add("has-input-focus"),
    );
    this.searchComponent.inputEl.addEventListener("blur", () =>
      this.suggestEl.classList.remove("has-input-focus"),
    );
    this.searchComponent.inputEl.addEventListener("keydown", (event) => {
      if (!event.isComposing && event.key === "Tab") this.buttonEl.focus({ preventScroll: true });
    });
    this.suggestEl.addEventListener("focusout", () => {
      const win = this.suggestEl.ownerDocument.defaultView ?? window;
      win.setTimeout(() => {
        if (this.buttonEl.ownerDocument.activeElement !== this.buttonEl) this.close();
      }, 0);
    });

    this.renderLabel();
  }

  setPlaceholder(text: string): this {
    this.labelEl.setAttribute("placeholder", text);
    return this;
  }

  setItems(items: ComboboxItem[]): this {
    this.items = items;
    return this;
  }

  getItems(): ComboboxItem[] {
    return this.items;
  }

  setClearable(clearable: boolean): this {
    this.clearable = clearable;
    if (this.value) this.renderLabel();
    return this;
  }

  setValue(value: ComboboxItem | null): this {
    this.value = value;
    this.renderLabel();
    return this;
  }

  getValue(): ComboboxItem | null {
    return this.value;
  }

  setValueById(value: string): this {
    const item = this.items.find((candidate) => candidate.value === value);
    if (item) this.setValue(item);
    return this;
  }

  toggle(): void {
    if (this.isOpen) {
      this.buttonEl.focus({ preventScroll: true });
      this.close();
    } else {
      this.open();
    }
  }

  override open(): void {
    if (this.isOpen) return;
    super.open();
    this.buttonEl.classList.add("has-focus");
    this.suggestions.setSuggestions(this.getSuggestions(""));
    this.reposition(this.buttonEl.getBoundingClientRect());
    this.searchComponent.autoSelect();
    this.setAutoDestroy(this.buttonEl);
    this.openCb?.();
  }

  override close(): void {
    if (!this.isOpen) return;
    super.close();
    this.buttonEl.classList.remove("has-focus");
    this.searchComponent.setValue("");
    this.closeCb?.();
  }

  override attachDom(): void {
    const body = this.buttonEl.ownerDocument.body;
    if (this.suggestEl.parentElement !== body) body.appendChild(this.suggestEl);
    this.suggestEl.style.left = "";
    this.suggestEl.style.top = "";
  }

  override detachDom(): void {
    this.suggestEl.remove();
    this.bgEl.remove();
  }

  onOpen(callback: () => void): this {
    this.openCb = callback;
    return this;
  }

  onClose(callback: () => void): this {
    this.closeCb = callback;
    return this;
  }

  onSelect(
    callback: (value: ComboboxItem | null, event: MouseEvent | KeyboardEvent) => void,
  ): this {
    this.selectCb = callback;
    return this;
  }

  focus(): void {
    this.buttonEl.focus({ preventScroll: true });
    this.open();
  }

  selectSuggestion(value: ComboboxSuggestion, event: MouseEvent | KeyboardEvent): void {
    this.selectValue(value, event);
  }

  renderSuggestion(value: ComboboxSuggestion, el: HTMLElement): void {
    el.classList.add("mod-complex", "mod-toggle");
    if (this.value?.value === value.value) {
      const checkedEl = el.ownerDocument.createElement("div");
      checkedEl.className = "suggestion-icon mod-checked";
      setIcon(checkedEl, "lucide-check");
      el.appendChild(checkedEl);
    }
    if (value.icon) {
      const iconEl = el.ownerDocument.createElement("div");
      iconEl.className = "suggestion-icon";
      const flairEl = el.ownerDocument.createElement("div");
      flairEl.className = "suggestion-flair";
      setIcon(flairEl, value.icon);
      iconEl.appendChild(flairEl);
      el.appendChild(iconEl);
    }
    const contentEl = el.ownerDocument.createElement("span");
    contentEl.className = "suggestion-content";
    const titleEl = el.ownerDocument.createElement("div");
    titleEl.className = "suggestion-title";
    renderFuzzyText(titleEl, value.display ?? value.value, value.match);
    contentEl.appendChild(titleEl);
    el.appendChild(contentEl);
  }

  onInputChange(value: string): void {
    this.suggestions.setSuggestions(this.getSuggestions(value));
  }

  getSuggestions(value: string): ComboboxSuggestion[] {
    const query = prepareFuzzyQuery(value);
    const suggestions: ComboboxSuggestion[] = [];
    for (const item of this.items) {
      const valueMatch = fuzzyMatch(query, item.value);
      if (valueMatch) {
        suggestions.push({ ...item, match: valueMatch, score: valueMatch.score });
        continue;
      }
      if (item.display) {
        const displayMatch = fuzzyMatch(query, item.display);
        if (displayMatch)
          suggestions.push({ ...item, match: displayMatch, score: displayMatch.score - 10 });
      }
    }
    suggestions.sort((left, right) => right.score - left.score);
    return suggestions;
  }

  private renderLabel(): void {
    const value = this.value;
    this.labelEl.textContent = value?.display ?? value?.value ?? "";
    this.iconEl.replaceChildren();
    if (value?.icon) {
      setIcon(this.iconEl, value.icon);
      this.iconEl.hidden = false;
    } else {
      this.iconEl.hidden = true;
    }
    this.buttonEl.classList.toggle("mod-clearable", this.clearable && value != null);
  }

  private selectValue(value: ComboboxItem | null, event: MouseEvent | KeyboardEvent): void {
    this.setValue(value);
    this.buttonEl.focus({ preventScroll: true });
    this.selectCb?.(value, event);
    this.close();
  }
}
