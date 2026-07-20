import type { App } from "../../app/App";
import { AbstractInputSuggest } from "../../ui/suggest/AbstractInputSuggest";

export interface FilterOperator {
  /** What the user sees and types, e.g. `is:unread`. */
  operator: string;
  description: string;
}

/**
 * The qualifier suggestions for a GitHub list's filter box — the same shape the
 * host's own search view uses for `path:` / `file:` / `tag:`.
 *
 * A qualifier is the control. A row of buttons can only offer what someone drew
 * a button for; a filter language offers combinations nobody had to draw.
 */
export class GitHubFilterSuggest extends AbstractInputSuggest<FilterOperator> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly operators: FilterOperator[],
    private readonly onInsert: (query: string) => void,
  ) {
    super(app, inputEl);
    this.suggestEl.classList.add("mod-search-suggestion");
    this.onSelect((item) => {
      const current = this.getValue();
      const head = current.slice(0, current.lastIndexOf(" ") + 1);
      const next = `${head}${item.operator}`;
      this.setValue(next);
      inputEl.setSelectionRange(next.length, next.length);
      this.onInsert(next);
      this.close();
    });
  }

  getSuggestions(value: string): FilterOperator[] {
    // Only the token under the caret decides the list, so a second qualifier
    // suggests as readily as the first.
    const token = value.slice(value.lastIndexOf(" ") + 1).toLowerCase();
    return this.operators.filter((option) => option.operator.toLowerCase().startsWith(token));
  }

  renderSuggestion(item: FilterOperator, el: HTMLElement): void {
    const doc = el.ownerDocument;
    el.classList.add("mod-complex", "search-suggest-item");
    const content = doc.createElement("div");
    content.className = "suggestion-content";
    const title = doc.createElement("div");
    title.className = "suggestion-title";
    title.textContent = item.operator;
    const aux = doc.createElement("div");
    aux.className = "suggestion-aux";
    aux.textContent = item.description;
    content.appendChild(title);
    el.append(content, aux);
  }
}
