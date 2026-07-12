import { bindPropertyLinkSuggest } from "./PropertyLinkSuggest";
import { focusLastPill, renderEditablePropertyPill } from "./EditablePropertyPill";
import { renderPropertyLinkValue } from "./PropertyLinkRenderer";
import type { PropertyWidgetContext, PropertyValue } from "./PropertyTypes";

export function renderMultiValuePropertyWidget(
  parent: HTMLElement,
  context: PropertyWidgetContext,
): void {
  const containerEl = document.createElement("div");
  containerEl.className = "multi-select-container";
  const inputEl = document.createElement("input");
  inputEl.type = "text";
  inputEl.className = "multi-select-input metadata-input-text metadata-input-list";
  inputEl.autocomplete = "off";

  const values = normalizeValues(context.value);
  const commitValues = (next: string[]) => context.onChange(next.length > 0 ? next : null);
  for (const [index, value] of values.entries()) {
    renderEditablePropertyPill(containerEl, {
      value,
      index,
      values,
      removeLabel: `Remove ${value}`,
      commitValues,
      createValue: (raw) => normalizeCommittedText(raw.trim()) || null,
      findDuplicate: (candidate, existing) => existing.indexOf(candidate),
      decoratePill: (pillEl, item) => {
        if (isInternalLink(item)) pillEl.classList.add("internal-link");
      },
      renderContent: (contentEl, item) => {
        if (!renderPropertyLinkValue(item, contentEl, context)) contentEl.textContent = item;
      },
      setupEditInput: (editInputEl) => bindPropertyLinkSuggest(editInputEl, context),
    });
  }
  containerEl.appendChild(inputEl);
  containerEl.addEventListener("click", () => inputEl.focus());
  bindPropertyLinkSuggest(inputEl, context);

  inputEl.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitInput(inputEl, values, commitValues);
      return;
    }
    if (event.key === "Backspace" && inputEl.value === "" && values.length > 0) {
      event.preventDefault();
      focusLastPill(containerEl);
      return;
    }
    if (
      event.key === "ArrowLeft" &&
      inputEl.value === "" &&
      inputEl.selectionStart === 0 &&
      values.length > 0
    ) {
      event.preventDefault();
      focusLastPill(containerEl);
    }
  });
  inputEl.addEventListener("blur", () => commitInput(inputEl, values, commitValues));
  inputEl.addEventListener("change", () => commitInput(inputEl, values, commitValues));

  parent.appendChild(containerEl);
}

function commitInput(
  inputEl: HTMLInputElement,
  values: string[],
  commitValues: (values: string[]) => void,
): void {
  const incoming = splitInput(inputEl.value);
  if (incoming.length === 0) return;
  inputEl.value = "";
  commitValues(uniqueValues([...values, ...incoming]));
}

function normalizeValues(value: PropertyValue): string[] {
  if (Array.isArray(value))
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
  if (typeof value === "string") return splitInput(value);
  return [];
}

function splitInput(value: string): string[] {
  return value
    .split(",")
    .map((item) => normalizeCommittedText(item.trim()))
    .filter(Boolean);
}

function normalizeCommittedText(value: string): string {
  if (value.startsWith("[[") && !value.endsWith("]]")) return `${value}]]`;
  return value;
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function isInternalLink(value: string): boolean {
  return /^\[\[.+\]\]$/.test(value);
}
