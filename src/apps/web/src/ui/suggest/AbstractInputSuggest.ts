import type { App } from "../../app/App";
import { getActiveDocument } from "../../dom/ActiveDocument";
import { Scope } from "../../app/hotkeys/Scope";
import { Platform } from "../../platform/Platform";
import { registerActiveCloseable, unregisterActiveCloseable } from "../ActiveCloseableRegistry";
import { SuggestChooser, type SuggestOwner } from "./SuggestModal";

export type { ISuggestOwner } from "./SuggestModal";

export abstract class PopoverSuggest<T> implements SuggestOwner<T> {
  isOpen = false;
  readonly scope: Scope;
  readonly suggestEl: HTMLElement;
  readonly suggestInnerEl: HTMLElement;
  readonly suggestions: SuggestChooser<T>;
  private autoDestroy: (() => void) | null = null;

  constructor(readonly app: App, parentScope: Scope | null = app.scope, ownerDocument: Document = getActiveDocument()) {
    this.scope = new Scope(parentScope);
    const doc = ownerDocument;
    this.suggestEl = doc.createElement("div");
    this.suggestEl.className = "suggestion-container";
    this.suggestInnerEl = doc.createElement("div");
    this.suggestInnerEl.className = "suggestion";
    this.suggestEl.appendChild(this.suggestInnerEl);
    this.suggestions = new SuggestChooser(this, this.suggestInnerEl);
    this.registerScopeNavigation();
  }

  onEscapeKey(_event: KeyboardEvent): void {
    this.close();
  }

  attachDom(ownerDocument: Document = this.suggestEl.ownerDocument): void {
    ownerDocument.body.appendChild(this.suggestEl);
  }

  detachDom(): void {
    this.suggestEl.remove();
  }

  open(ownerDocument: Document = this.suggestEl.ownerDocument): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.app.keymap.pushScope(this.scope);
    this.attachDom(ownerDocument);
    registerActiveCloseable(this);
  }

  close(): void {
    this.autoDestroy?.();
    this.autoDestroy = null;
    this.app.keymap.popScope(this.scope);
    if (!this.isOpen) return;
    this.isOpen = false;
    this.suggestions.setSuggestions([]);
    this.detachDom();
    unregisterActiveCloseable(this);
  }

  reposition(rect: DOMRect | Pick<DOMRect, "left" | "right" | "top" | "bottom">, direction: "auto" | "ltr" | "rtl" = "auto"): void {
    positionSuggestion(this.suggestEl, rect, direction);
  }

  setAutoDestroy(el: HTMLElement | null): void {
    this.autoDestroy?.();
    this.autoDestroy = null;
    if (!el) return;

    const doc = el.ownerDocument;
    const win = doc.defaultView ?? window;
    const timerId = win.setInterval(() => {
      if (!isShown(el)) {
        win.clearInterval(timerId);
        this.close();
      }
    }, 500);
    this.autoDestroy = () => win.clearInterval(timerId);
  }

  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract selectSuggestion(value: T, event: MouseEvent | KeyboardEvent): void;

  onSelectedChange(_value: T, _event: MouseEvent | KeyboardEvent | null): void {}

  private registerScopeNavigation(): void {
    this.scope.register([], "Escape", (event) => {
      this.onEscapeKey(event);
      return false;
    });
    this.scope.register([], "ArrowUp", (event) => {
      if (event.isComposing) return;
      this.suggestions.moveSelectedItem(-1, event);
      return false;
    });
    this.scope.register([], "ArrowDown", (event) => {
      if (event.isComposing) return;
      this.suggestions.moveSelectedItem(1, event);
      return false;
    });
    this.scope.register([], "PageUp", (event) => {
      if (event.isComposing) return;
      return this.suggestions.pageUp(event);
    });
    this.scope.register([], "PageDown", (event) => {
      if (event.isComposing) return;
      return this.suggestions.pageDown(event);
    });
    this.scope.register([], "Home", (event) => {
      this.suggestions.setSelectedItem(0, event);
      return false;
    });
    this.scope.register([], "End", (event) => {
      this.suggestions.setSelectedItem(this.suggestions.length - 1, event);
      return false;
    });
    this.scope.register([], "Enter", (event) => {
      if (event.isComposing) return;
      return this.suggestions.useSelectedItem(event) ? false : undefined;
    });
    if (Platform.isMacOS || Platform.isIosApp) {
      this.scope.register(["Ctrl"], "p", (event) => {
        if (event.isComposing) return;
        this.suggestions.moveSelectedItem(-1, event);
        return false;
      });
      this.scope.register(["Ctrl"], "n", (event) => {
        if (event.isComposing) return;
        this.suggestions.moveSelectedItem(1, event);
        return false;
      });
    }
  }
}

function positionSuggestion(
  el: HTMLElement,
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  direction: "auto" | "ltr" | "rtl",
): void {
  const gap = 5;
  const doc = el.ownerDocument;
  const win = doc.defaultView ?? window;
  const root = doc.documentElement;
  const rootRect = root.getBoundingClientRect();
  const scrollTop = root.scrollTop;
  const scrollLeft = root.scrollLeft;
  const safeTop = scrollTop + Math.max(10, parseCssPx(root, "--safe-area-inset-top") - rootRect.top + 10);
  const safeBottom = scrollTop + Math.min(root.clientHeight - 10, win.innerHeight - parseCssPx(root, "--safe-area-inset-bottom") - rootRect.top - 10);
  const safeLeft = scrollLeft + Math.max(10, parseCssPx(root, "--safe-area-inset-left") - rootRect.left + 10);
  const safeRight = scrollLeft + Math.min(root.clientWidth - 10, win.innerWidth - parseCssPx(root, "--safe-area-inset-right") - rootRect.left - 10);
  const height = el.offsetHeight || el.getBoundingClientRect().height;
  const width = el.offsetWidth || el.getBoundingClientRect().width;
  const anchor = {
    left: rect.left + scrollLeft,
    right: rect.right + scrollLeft,
    top: rect.top + scrollTop,
    bottom: rect.bottom + scrollTop,
  };
  const spaceAbove = anchor.top - safeTop;
  const spaceBelow = safeBottom - anchor.bottom;
  const preferBelow = spaceBelow >= height + gap || spaceBelow >= spaceAbove;
  const align = direction === "auto"
    ? win.getComputedStyle(el).direction === "rtl" ? "right" : "left"
    : direction === "rtl" ? "right" : "left";

  el.style.position = "absolute";
  el.style.maxHeight = "";
  if (preferBelow) {
    el.style.top = `${anchor.bottom + gap}px`;
    el.style.bottom = "";
  } else {
    el.style.top = "";
    el.style.bottom = `${Math.max(0, Math.max(root.scrollHeight, root.clientHeight) - anchor.top + gap)}px`;
  }

  if (spaceAbove < height + gap && spaceBelow < height + gap) {
    el.style.maxHeight = `${Math.max(spaceAbove, spaceBelow) - gap}px`;
  }

  if (align === "left") {
    let left = anchor.left;
    if (left < safeLeft) left = safeLeft;
    if (left + width > safeRight) left = safeRight - width;
    el.style.left = `${Math.max(safeLeft, left)}px`;
    el.style.right = "";
  } else {
    const rootWidth = Math.max(root.scrollWidth, root.clientWidth);
    let right = rootWidth - anchor.right;
    const rightEdge = rootWidth - right;
    if (rightEdge > safeRight) right = rootWidth - safeRight;
    if (rightEdge - width < safeLeft) right = rootWidth - safeLeft - width;
    el.style.left = "";
    el.style.right = `${Math.max(0, right)}px`;
  }
}

function parseCssPx(el: HTMLElement, property: string): number {
  const win = el.ownerDocument.defaultView ?? window;
  const value = win.getComputedStyle(el).getPropertyValue(property);
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export abstract class AbstractInputSuggest<T> extends PopoverSuggest<T> {
  limit = 100;
  private selectCb: ((value: T, event: MouseEvent | KeyboardEvent) => void) | null = null;
  private lastRect: Pick<DOMRect, "left" | "right" | "top" | "bottom"> | null = null;

  constructor(app: App, readonly textInputEl: HTMLInputElement | HTMLTextAreaElement | HTMLElement) {
    super(app, app.scope, textInputEl.ownerDocument);
    this.autoReposition = this.autoReposition.bind(this);
    textInputEl.addEventListener("input", () => this.onInputChange());
    textInputEl.addEventListener("focus", () => this.onInputFocus());
    textInputEl.addEventListener("blur", () => this.close());
    this.suggestEl.addEventListener("mousedown", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(".suggestion-item")) event.preventDefault();
    });
  }

  showSuggestions(values: T[]): void {
    if (values.length === 0) {
      this.close();
      return;
    }
    if (!isShown(this.textInputEl)) return;

    const limited = this.limit > 0 ? values.slice(0, this.limit) : values;
    this.suggestions.setSuggestions(limited);
    this.open();
    this.setAutoDestroy(this.textInputEl);
  }

  setValue(value: string): void {
    if (isTextValueElement(this.textInputEl)) this.textInputEl.value = value;
    else this.textInputEl.innerText = value;
  }

  getValue(): string {
    return isTextValueElement(this.textInputEl) ? this.textInputEl.value : this.textInputEl.innerText;
  }

  onInputFocus(): void {
    if (Platform.isIosApp) {
      deferUntilMobileResizeSettles(this.textInputEl.ownerDocument.defaultView ?? window, () => this.onInputChange());
      return;
    }
    this.onInputChange();
  }

  onInputChange(): void {
    if (!isActiveElement(this.textInputEl)) return;
    const value = this.getValue();
    const suggestions = this.getSuggestions(value);
    if (Array.isArray(suggestions)) {
      this.showSuggestions(suggestions);
      return;
    }
    if (!suggestions) return;
    void suggestions.then((resolved) => this.showSuggestions(resolved));
  }

  selectSuggestion(value: T, event: MouseEvent | KeyboardEvent): void {
    this.selectCb?.(value, event);
  }

  onSelect(callback: (value: T, event: MouseEvent | KeyboardEvent) => void): this {
    this.selectCb = callback;
    return this;
  }

  override close(): void {
    super.close();
    this.textInputEl.ownerDocument.removeEventListener("scroll", this.autoReposition, { capture: true });
  }

  override reposition(rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">): void {
    super.reposition(rect);
    this.lastRect = rect;
  }

  override open(): void {
    super.open();
    const rect = projectRectToWindow(this.textInputEl.getBoundingClientRect(), this.textInputEl.ownerDocument.defaultView ?? window, this.suggestEl.ownerDocument.defaultView ?? window);
    this.reposition(rect);
    this.textInputEl.ownerDocument.addEventListener("scroll", this.autoReposition, { capture: true, passive: true });
  }

  autoReposition(): void {
    if (!this.lastRect) return;
    const rect = projectRectToWindow(this.textInputEl.getBoundingClientRect(), this.textInputEl.ownerDocument.defaultView ?? window, this.suggestEl.ownerDocument.defaultView ?? window);
    if (
      rect.bottom === this.lastRect.bottom
      && rect.top === this.lastRect.top
      && rect.left === this.lastRect.left
      && rect.right === this.lastRect.right
    ) return;
    this.reposition(rect);
  }

  abstract getSuggestions(inputStr: string): T[] | Promise<T[]>;
}

function projectRectToWindow(
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  fromWin: Window,
  toWin: Window,
): Pick<DOMRect, "left" | "right" | "top" | "bottom"> {
  let current = fromWin;
  let projected = rect;
  while (current !== toWin && current.frameElement instanceof HTMLElement) {
    const frame = current.frameElement;
    const frameRect = frame.getBoundingClientRect();
    const scale = frame.clientWidth ? frameRect.width / frame.clientWidth : 1;
    projected = {
      left: projected.left * scale + frameRect.left,
      right: projected.right * scale + frameRect.left,
      top: projected.top * scale + frameRect.top,
      bottom: projected.bottom * scale + frameRect.top,
    };
    if (!current.parent || current.parent === current) break;
    current = current.parent;
  }
  return projected;
}

function isTextValueElement(el: HTMLElement): el is HTMLInputElement {
  // Real Obsidian treats only <input> as a value element; <textarea> and
  // contenteditable targets read/write through .innerText.
  const win = el.ownerDocument.defaultView ?? window;
  return el instanceof win.HTMLInputElement;
}

function isActiveElement(el: HTMLElement): boolean {
  return el.ownerDocument.activeElement === el;
}

function isShown(el: HTMLElement): boolean {
  const win = el.ownerDocument.defaultView ?? window;
  const style = win.getComputedStyle(el);
  return el.isConnected && style.display !== "none" && style.visibility !== "hidden";
}

function deferUntilMobileResizeSettles(win: Window, callback: () => void): void {
  const started = Date.now();
  let lastWidth = win.innerWidth;
  let lastHeight = win.innerHeight;
  const poll = (): void => {
    const width = win.innerWidth;
    const height = win.innerHeight;
    const changed = width !== lastWidth || height !== lastHeight;
    lastWidth = width;
    lastHeight = height;
    if (!changed || Date.now() - started >= 500) {
      win.setTimeout(callback, 10);
      return;
    }
    win.setTimeout(poll, 50);
  };
  win.setTimeout(poll, 50);
}
