import { focusLastPill, renderEditablePropertyPill } from "./EditablePropertyPill";
import type { PropertyWidgetContext, PropertyValue } from "./PropertyTypes";

export function renderAliasPropertyWidget(
  parent: HTMLElement,
  context: PropertyWidgetContext,
): void {
  const containerEl = document.createElement("div");
  containerEl.className = "multi-select-container metadata-aliases-container";
  const inputEl = document.createElement("input");
  inputEl.type = "text";
  inputEl.className = "multi-select-input metadata-input-text metadata-input-list";
  inputEl.autocomplete = "off";

  const values = normalizeAliasValues(context.value);
  const commitValues = (next: string[]) => context.onChange(next.length > 0 ? next : null);
  for (const [index, value] of values.entries()) {
    renderEditablePropertyPill(containerEl, {
      value,
      index,
      values,
      removeLabel: `Remove ${value}`,
      commitValues,
      createValue: (raw) => raw.trim() || null,
      findDuplicate: (candidate, existing) => existing.indexOf(candidate),
      decoratePill: (pillEl, item) => {
        if (item.trim().length === 0) pillEl.classList.add("is-invalid");
      },
      renderContent: (contentEl, item) => {
        contentEl.textContent = item;
      },
    });
  }
  containerEl.appendChild(inputEl);
  containerEl.addEventListener("click", () => inputEl.focus());

  inputEl.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitInput(inputEl, values, commitValues);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      inputEl.blur();
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
  const alias = inputEl.value.trim();
  if (!alias || values.includes(alias)) return;
  inputEl.value = "";
  commitValues([...values, alias]);
}

function normalizeAliasValues(value: PropertyValue): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",").map((item) => item.trim());
  return [];
}
