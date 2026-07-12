import { Menu } from "../../ui/Menu";

export interface EditablePropertyPillOptions {
  value: string;
  index: number;
  values: string[];
  removeLabel: string;
  commitValues(values: string[]): void;
  createValue(raw: string): string | null;
  findDuplicate?(value: string, values: string[]): number;
  decoratePill?(pillEl: HTMLElement, value: string): void;
  renderContent(contentEl: HTMLElement, value: string): void;
  setupEditInput?(inputEl: HTMLInputElement): void;
  onContentClick?(event: MouseEvent, value: string): void;
}

export function renderEditablePropertyPill(containerEl: HTMLElement, options: EditablePropertyPillOptions): HTMLElement {
  const pillEl = document.createElement("div");
  pillEl.className = "multi-select-pill";
  pillEl.tabIndex = 0;
  pillEl.dataset.value = options.value;
  options.decoratePill?.(pillEl, options.value);

  const contentEl = document.createElement("span");
  contentEl.className = "multi-select-pill-content";
  options.renderContent(contentEl, options.value);
  if (options.onContentClick) {
    contentEl.addEventListener("click", (event) => options.onContentClick?.(event, options.value));
  }

  const removeButtonEl = document.createElement("button");
  removeButtonEl.type = "button";
  removeButtonEl.className = "multi-select-pill-remove-button clickable-icon";
  removeButtonEl.dataset.icon = "lucide-x";
  removeButtonEl.ariaLabel = options.removeLabel;
  removeButtonEl.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeValue(options);
  });

  pillEl.addEventListener("copy", (event) => {
    event.preventDefault();
    event.clipboardData?.setData("text/plain", String(options.value));
  });
  pillEl.addEventListener("contextmenu", (event) => {
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle("Edit")
      .setIcon("lucide-pencil")
      .onClick(() => startEdit(containerEl, pillEl, options)));
    menu.addItem((item) => item
      .setTitle("Copy")
      .setIcon("lucide-copy")
      .onClick(() => void copyText(String(options.value))));
    menu.addItem((item) => item
      .setTitle("Remove")
      .setIcon("lucide-x")
      .onClick(() => removeValue(options)));
    menu.showAtMouseEvent(event);
  });
  pillEl.addEventListener("dblclick", (event) => {
    event.preventDefault();
    startEdit(containerEl, pillEl, options);
  });
  pillEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      startEdit(containerEl, pillEl, options);
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      removeValue(options);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      focusMainInput(containerEl);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      containerEl.querySelector<HTMLElement>(".multi-select-pill")?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusMainInput(containerEl);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      focusSiblingPill(containerEl, options.index + (event.key === "ArrowLeft" ? -1 : 1));
    }
  });

  pillEl.append(contentEl, removeButtonEl);
  const duplicateIndex = options.findDuplicate?.(options.value, options.values) ?? -1;
  if (duplicateIndex >= 0 && duplicateIndex < options.index) pillEl.classList.add("is-invalid");
  containerEl.appendChild(pillEl);
  return pillEl;
}

function removeValue(options: EditablePropertyPillOptions): void {
  options.commitValues(options.values.filter((_, valueIndex) => valueIndex !== options.index));
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard?.writeText?.(value);
}

function startEdit(containerEl: HTMLElement, pillEl: HTMLElement, options: EditablePropertyPillOptions): void {
  if (!pillEl.parentElement) return;
  let editing = true;
  const inputEl = document.createElement("input");
  inputEl.type = "text";
  inputEl.className = "multi-select-input metadata-input-text metadata-input-list";
  inputEl.value = options.value;
  inputEl.autocomplete = "off";
  options.setupEditInput?.(inputEl);

  const restore = () => {
    if (!inputEl.parentElement) return;
    editing = false;
    containerEl.insertBefore(pillEl, inputEl);
    inputEl.remove();
    pillEl.focus();
  };

  const save = (focusAfter = false): boolean => {
    const nextValue = options.createValue(inputEl.value);
    if (!nextValue) return false;
    const duplicateIndex = options.findDuplicate?.(nextValue, options.values) ?? -1;
    if (duplicateIndex >= 0 && duplicateIndex !== options.index) {
      highlightDuplicate(containerEl, duplicateIndex > options.index ? duplicateIndex - 1 : duplicateIndex);
      return false;
    }
    editing = false;
    const nextValues = options.values.map((value, index) => index === options.index ? nextValue : value);
    options.commitValues(nextValues);
    if (focusAfter) window.setTimeout(() => focusPill(containerEl, options.index));
    return true;
  };

  inputEl.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && inputEl.value.length > 0) {
      event.preventDefault();
      save(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      restore();
    }
  });
  inputEl.addEventListener("change", () => {
    if (editing && inputEl.value.length > 0) save(false);
  });
  inputEl.addEventListener("blur", () => {
    if (!editing) return;
    if (inputEl.value.length > 0) save(false);
    else restore();
  });

  containerEl.insertBefore(inputEl, pillEl);
  pillEl.remove();
  inputEl.focus();
  inputEl.setSelectionRange(0, inputEl.value.length);
}

function highlightDuplicate(containerEl: HTMLElement, index: number): void {
  const duplicateEl = containerEl.querySelectorAll<HTMLElement>(".multi-select-pill")[index];
  if (!duplicateEl) return;
  duplicateEl.classList.add("multi-select-duplicate");
  window.setTimeout(() => duplicateEl.classList.remove("multi-select-duplicate"), 2_000);
}

function focusPill(containerEl: HTMLElement, index: number): void {
  containerEl.querySelectorAll<HTMLElement>(".multi-select-pill")[index]?.focus();
}

function focusSiblingPill(containerEl: HTMLElement, index: number): void {
  const pills = containerEl.querySelectorAll<HTMLElement>(".multi-select-pill");
  const target = pills[Math.max(0, Math.min(index, pills.length - 1))];
  if (target) target.focus();
  else focusMainInput(containerEl);
}

export function focusLastPill(containerEl: HTMLElement): void {
  const pills = containerEl.querySelectorAll<HTMLElement>(".multi-select-pill");
  const target = pills[pills.length - 1];
  if (target) target.focus();
  else focusMainInput(containerEl);
}

function focusMainInput(containerEl: HTMLElement): void {
  const inputs = containerEl.querySelectorAll<HTMLInputElement>(".multi-select-input");
  inputs[inputs.length - 1]?.focus();
}
