import { computeBlockIdInsertion, createBlockId } from "../../metadata/BlockCache";
import type { LinkFileSuggestion } from "../../metadata/LinkSuggestionManager";
import type { PropertyWidgetContext } from "./PropertyTypes";

export function bindPropertyLinkSuggest(
  inputEl: HTMLInputElement,
  context: PropertyWidgetContext,
): PropertyLinkSuggestController | null {
  if (!context.app || !context.sourcePath) return null;
  return new PropertyLinkSuggestController(inputEl, context);
}

class PropertyLinkSuggestController {
  private values: LinkFileSuggestion[] = [];
  private selectedIndex = 0;
  private containerEl: HTMLElement | null = null;
  private lastQuery = "";

  constructor(
    readonly inputEl: HTMLInputElement,
    readonly context: PropertyWidgetContext,
  ) {
    inputEl.addEventListener("input", () => void this.refresh());
    inputEl.addEventListener("keydown", (event) => void this.handleKeydown(event));
    inputEl.addEventListener("blur", () => {
      window.setTimeout(() => this.close(), 120);
    });
  }

  private get app() {
    return this.context.app;
  }

  private async refresh(): Promise<void> {
    const trigger = this.getTrigger();
    if (!trigger || !this.app) {
      this.close();
      return;
    }
    this.lastQuery = trigger.query;
    const values = await this.app.linkSuggestions.getSuggestionsAsync(
      null,
      trigger.query,
      this.context.sourcePath ?? "",
    );
    if (this.lastQuery !== trigger.query) return;
    if (values.length === 0) {
      this.close();
      return;
    }
    this.values = values;
    this.selectedIndex = 0;
    this.render();
  }

  private async handleKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key === "Escape") {
      this.close();
      return;
    }
    if (this.containerEl && event.key === "ArrowDown") {
      this.setSelectedIndex(this.selectedIndex + 1);
      event.preventDefault();
      return;
    }
    if (this.containerEl && event.key === "ArrowUp") {
      this.setSelectedIndex(this.selectedIndex - 1);
      event.preventDefault();
      return;
    }
    if (this.isAcceptKey(event) && this.values.length > 0) {
      const value = this.values[this.selectedIndex];
      event.preventDefault();
      await this.accept(value, event.key);
      return;
    }
    window.setTimeout(() => void this.refresh());
  }

  private async accept(value: LinkFileSuggestion, key: string): Promise<void> {
    const trigger = this.getTrigger();
    if (!trigger || !this.app) return;
    if (value.type === "block" && !value.node.id) {
      await this.writeBlockId(value, createBlockId(6));
    }
    const replacement = this.app.linkSuggestions.createLinkSuggestionReplacement(value, {
      query: trigger.query,
      tailText: this.inputEl.value.slice(trigger.end),
      start: trigger.openIndex,
      end: trigger.end,
      sourcePath: this.context.sourcePath,
      key,
      mode: "frontmatter",
      blockId: value.type === "block" ? value.node.id : undefined,
    });

    const next = `${this.inputEl.value.slice(0, replacement.start)}${replacement.replacement}${this.inputEl.value.slice(replacement.end)}`;
    this.inputEl.value = next;
    this.inputEl.setSelectionRange(replacement.selectionStart, replacement.selectionEnd);
    this.inputEl.dispatchEvent(new InputEvent("input", { bubbles: true }));

    if (key === "#" || key === "^" || key === "|") {
      await this.refresh();
      return;
    }

    this.close();
    this.inputEl.dispatchEvent(new Event("change", { bubbles: true }));
  }

  private async writeBlockId(
    value: Extract<LinkFileSuggestion, { type: "block" }>,
    blockId: string,
  ): Promise<void> {
    if (!this.app) return;
    const insertion = computeBlockIdInsertion(value, blockId);
    const update = (source: string) =>
      `${source.slice(0, insertion.blockEnd)}${insertion.addition}${source.slice(insertion.blockEnd)}`;
    if (this.context.writeFile) await this.context.writeFile(value.file, update);
    else await this.app.vault.process(value.file, update);
    value.node.id = blockId;
    value.content = update(value.content);
    this.app.metadataCache.blockCache.clear();
  }

  private isAcceptKey(event: KeyboardEvent): boolean {
    return (
      event.key === "Enter" ||
      event.key === "Tab" ||
      event.key === "#" ||
      event.key === "^" ||
      event.key === "|"
    );
  }

  private getTrigger(): { openIndex: number; end: number; query: string } | null {
    const end = this.inputEl.selectionStart ?? this.inputEl.value.length;
    const prefix = this.inputEl.value.slice(0, end);
    const openIndex = prefix.lastIndexOf("[[");
    if (openIndex === -1) return null;
    if (prefix.slice(openIndex + 2).includes("]]")) return null;
    return {
      openIndex,
      end,
      query: prefix.slice(openIndex + 2),
    };
  }

  private render(): void {
    this.containerEl?.remove();
    const doc = this.inputEl.ownerDocument;
    const win = doc.defaultView ?? window;
    const rect = this.inputEl.getBoundingClientRect();
    const containerEl = doc.createElement("div");
    containerEl.className = "suggestion-container metadata-link-suggestion-container";
    containerEl.style.position = "fixed";
    containerEl.style.left = `${rect.left}px`;
    containerEl.style.top = `${Math.min(rect.bottom + 4, win.innerHeight - 280)}px`;
    containerEl.style.width = `${Math.min(Math.max(rect.width, 280), 520)}px`;
    const listEl = doc.createElement("div");
    listEl.className = "suggestion";
    containerEl.appendChild(listEl);

    this.values.forEach((value, index) => {
      const itemEl = doc.createElement("div");
      itemEl.className = "suggestion-item mod-complex";
      itemEl.classList.toggle("is-selected", index === this.selectedIndex);
      itemEl.addEventListener("mousemove", () => this.setSelectedIndex(index));
      itemEl.addEventListener("mousedown", (event) => event.preventDefault());
      itemEl.addEventListener("click", () => void this.accept(value, "Enter"));
      const contentEl = doc.createElement("div");
      contentEl.className = "suggestion-content";
      const titleEl = doc.createElement("div");
      titleEl.className = "suggestion-title";
      titleEl.textContent = suggestionTitle(value);
      const noteEl = doc.createElement("div");
      noteEl.className = "suggestion-note";
      noteEl.textContent = suggestionNote(value);
      contentEl.append(titleEl, noteEl);
      const auxEl = doc.createElement("div");
      auxEl.className = "suggestion-aux";
      auxEl.textContent = value.type;
      itemEl.append(contentEl, auxEl);
      listEl.appendChild(itemEl);
    });

    doc.body.appendChild(containerEl);
    this.containerEl = containerEl;
  }

  private setSelectedIndex(index: number): void {
    if (this.values.length === 0) return;
    this.selectedIndex = (index + this.values.length) % this.values.length;
    const items = this.containerEl?.querySelectorAll<HTMLElement>(".suggestion-item") ?? [];
    items.forEach((item, itemIndex) =>
      item.classList.toggle("is-selected", itemIndex === this.selectedIndex),
    );
  }

  private close(): void {
    this.values = [];
    this.selectedIndex = 0;
    this.containerEl?.remove();
    this.containerEl = null;
  }
}

function suggestionTitle(value: LinkFileSuggestion): string {
  if (value.type === "file") return value.file.basename;
  if (value.type === "alias") return value.alias;
  if (value.type === "heading") return value.heading;
  if (value.type === "block") return value.display;
  return value.path;
}

function suggestionNote(value: LinkFileSuggestion): string {
  if (value.type === "file") return value.file.path;
  if (value.type === "alias") return value.file?.path ?? value.path;
  if (value.type === "heading") return `${value.file?.path ?? value.path ?? ""}${value.subpath}`;
  if (value.type === "block") return `${value.file.path}#^${value.node.id ?? ""}`;
  return value.path;
}
