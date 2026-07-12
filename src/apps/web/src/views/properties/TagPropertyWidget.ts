import { focusLastPill, renderEditablePropertyPill } from "./EditablePropertyPill";
import { completeTagSuggestionText, getTagSuggestions, renderTagSuggestion, stripHash, type TagSuggestion } from "../../metadata/TagSuggestion";
import type { PropertyWidgetContext, PropertyValue } from "./PropertyTypes";
import { setTooltip } from "../../ui/Popover";

export function renderTagPropertyWidget(parent: HTMLElement, context: PropertyWidgetContext): void {
  const containerEl = document.createElement("div");
  containerEl.className = "multi-select-container metadata-tags-container";
  const inputEl = document.createElement("input");
  inputEl.type = "text";
  inputEl.className = "multi-select-input metadata-input-text metadata-input-list";
  inputEl.autocomplete = "off";
  inputEl.autocapitalize = "none";

  const values = normalizeTagValues(context.value);
  const commitValues = (next: string[]) => context.onChange(next.length > 0 ? next : null);
  for (const [index, value] of values.entries()) {
    const display = stripHash(value);
    renderEditablePropertyPill(containerEl, {
      value,
      index,
      values,
      removeLabel: `Remove ${display}`,
      commitValues,
      createValue: (raw) => createTagValue(raw),
      findDuplicate: (candidate, existing) => existing.findIndex((item) => stripHash(item) === stripHash(candidate)),
      decoratePill: (pillEl, item) => {
        if (!isValidTag(`#${stripHash(item)}`)) {
          pillEl.classList.add("is-invalid");
          setTooltip(pillEl, "Invalid tag name");
        }
      },
      renderContent: (contentEl, item) => {
        contentEl.textContent = stripHash(item);
      },
      onContentClick: (event, item) => {
        event.preventDefault();
        openTagSearch(context, stripHash(item));
      },
    });
  }
  containerEl.appendChild(inputEl);
  containerEl.addEventListener("click", () => inputEl.focus());

  const suggest = new TagPropertySuggest(inputEl, context, values, (tag) => {
    const next = addTagValue(values, tag);
    if (next !== values) commitValues(next);
    inputEl.value = "";
  });

  inputEl.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (!suggest.acceptSelected()) commitInput(inputEl, values, commitValues);
      return;
    }
    if (event.key === "Tab" && suggest.completeSelected()) {
      event.preventDefault();
      return;
    }
    if (event.key === "Backspace" && inputEl.value === "" && values.length > 0) {
      event.preventDefault();
      focusLastPill(containerEl);
      return;
    }
    if (event.key === "ArrowLeft" && inputEl.value === "" && inputEl.selectionStart === 0 && values.length > 0) {
      event.preventDefault();
      focusLastPill(containerEl);
      return;
    }
    if (event.key === "Escape") {
      suggest.close();
    }
  });
  inputEl.addEventListener("input", () => suggest.refresh());
  inputEl.addEventListener("change", () => commitInput(inputEl, values, commitValues));
  inputEl.addEventListener("blur", () => {
    commitInput(inputEl, values, commitValues);
    window.setTimeout(() => suggest.close(), 120);
  });

  parent.appendChild(containerEl);
}

function commitInput(inputEl: HTMLInputElement, values: string[], commitValues: (values: string[]) => void): void {
  const incoming = splitTagInput(inputEl.value);
  if (incoming.length === 0) return;
  const next = addTagValues(values, incoming);
  inputEl.value = "";
  if (next !== values) commitValues(next);
}

class TagPropertySuggest {
  private suggestions: TagSuggestion[] = [];
  private selectedIndex = 0;
  private containerEl: HTMLElement | null = null;

  constructor(
    readonly inputEl: HTMLInputElement,
    readonly context: PropertyWidgetContext,
    readonly existingValues: string[],
    readonly onSelect: (tag: string) => void,
  ) {}

  refresh(): void {
    const query = this.inputEl.value.trim();
    const keepHash = query.startsWith("#");
    const tags = this.context.app?.tagIndex.getTags() ?? [];
    this.suggestions = getTagSuggestions(tags, query, keepHash, this.existingValues).slice(0, 50);
    this.selectedIndex = this.suggestions.length > 0 && query ? 0 : -1;
    if (this.suggestions.length === 0) {
      this.close();
      return;
    }
    this.render();
  }

  acceptSelected(): boolean {
    if (this.selectedIndex < 0) return false;
    const suggestion = this.suggestions[this.selectedIndex];
    if (!suggestion) return false;
    this.onSelect(suggestion.tag);
    this.close();
    return true;
  }

  completeSelected(): boolean {
    if (this.selectedIndex < 0) return false;
    const suggestion = this.suggestions[this.selectedIndex];
    if (!suggestion) return false;
    const completion = completeTagSuggestionText(suggestion);
    this.inputEl.value = completion;
    this.inputEl.setSelectionRange(completion.length, completion.length);
    this.inputEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
    return true;
  }

  close(): void {
    this.suggestions = [];
    this.selectedIndex = 0;
    this.containerEl?.remove();
    this.containerEl = null;
  }

  private render(): void {
    this.containerEl?.remove();
    const doc = this.inputEl.ownerDocument;
    const win = doc.defaultView ?? window;
    const rect = this.inputEl.getBoundingClientRect();
    const containerEl = doc.createElement("div");
    containerEl.className = "suggestion-container metadata-tag-suggestion-container";
    containerEl.style.position = "fixed";
    containerEl.style.left = `${rect.left}px`;
    containerEl.style.top = `${Math.min(rect.bottom + 4, win.innerHeight - 280)}px`;
    containerEl.style.width = `${Math.min(Math.max(rect.width, 220), 420)}px`;
    const listEl = doc.createElement("div");
    listEl.className = "suggestion";
    containerEl.appendChild(listEl);

    this.suggestions.forEach((suggestion, index) => {
      const itemEl = doc.createElement("div");
      itemEl.className = "suggestion-item";
      itemEl.classList.toggle("is-selected", index === this.selectedIndex);
      itemEl.addEventListener("mousemove", () => this.setSelectedIndex(index));
      itemEl.addEventListener("mousedown", (event) => event.preventDefault());
      itemEl.addEventListener("click", () => {
        this.onSelect(suggestion.tag);
        this.close();
      });
      renderTagSuggestion(itemEl, suggestion);
      listEl.appendChild(itemEl);
    });

    doc.body.appendChild(containerEl);
    this.containerEl = containerEl;
  }

  private setSelectedIndex(index: number): void {
    if (this.suggestions.length === 0) return;
    this.selectedIndex = (index + this.suggestions.length) % this.suggestions.length;
    const items = this.containerEl?.querySelectorAll<HTMLElement>(".suggestion-item") ?? [];
    items.forEach((item, itemIndex) => item.classList.toggle("is-selected", itemIndex === this.selectedIndex));
  }
}

function normalizeTagValues(value: PropertyValue): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return splitTagInput(value);
  return [];
}

function splitTagInput(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => isValidTag(item.startsWith("#") ? item : `#${item}`));
}

function addTagValues(values: string[], incoming: string[]): string[] {
  let next = values;
  for (const tag of incoming) next = addTagValue(next, tag);
  return next;
}

function addTagValue(values: string[], tag: string): string[] {
  if (!createTagValue(tag)) return values;
  if (hasTagValue(values, tag)) return values;
  return [...values, tag];
}

function createTagValue(raw: string): string | null {
  if (!raw.trim()) return null;
  const tag = raw.startsWith("#") ? raw : `#${raw}`;
  return isValidTag(tag) ? raw : null;
}

function hasTagValue(values: string[], tag: string): boolean {
  const normalized = stripHash(tag);
  return values.some((value) => stripHash(value) === normalized);
}

function isValidTag(value: string): boolean {
  if (!value.startsWith("#")) return false;
  const body = value.slice(1);
  if (!body || body.includes("//")) return false;
  return /^[\p{L}\p{N}_/-]+$/u.test(body);
}

function openTagSearch(context: PropertyWidgetContext, display: string): void {
  const plugin = context.app?.internalPlugins.getEnabledPluginById<{ openGlobalSearch?: (query: string) => void }>("global-search");
  plugin?.openGlobalSearch?.(`tag:${display}`);
}
