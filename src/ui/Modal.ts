import { Component } from "../core/Component";
import type { App } from "../app/App";
import { getActiveDocument, getActiveWindow } from "../dom/ActiveDocument";
import { Scope } from "../hotkeys/Scope";
import { Platform } from "../platform/Platform";
import { ButtonComponent } from "./Setting";
import { setIcon } from "./Icon";

export interface HistoryHandler {
  onHistoryBack(): void;
  onHistoryForward?(): void;
}

interface SavedSelection {
  win: Window;
  range: Range | null;
  focusEl: Element | null;
}

const openModals: Modal[] = [];

export class Modal extends Component implements HistoryHandler {
  static getOpenModals(): readonly Modal[] {
    return openModals;
  }

  static closeAll(): void {
    for (const modal of [...openModals].reverse()) modal.close();
  }

  app: App;
  containerEl: HTMLElement;
  bgEl: HTMLElement;
  modalEl: HTMLElement;
  headerEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  buttonEl: HTMLElement;
  closeButtonEl: HTMLElement;
  scope = new Scope();
  shouldRestoreSelection = true;
  shouldAnimate = true;
  dimBackground = true;
  bgOpacity = "0.85";
  private opened = false;
  private closeCallback: (() => any) | null = null;
  private win: Window | null = null;
  private selection: SavedSelection | null = null;
  private readonly onWindowClose = () => this.close();

  constructor(app: App) {
    super();
    this.app = app;
    const doc = getActiveDocument();
    this.containerEl = doc.createElement("div");
    this.containerEl.className = "modal-container";
    this.bgEl = doc.createElement("div");
    this.bgEl.className = "modal-bg";
    this.modalEl = doc.createElement("div");
    this.modalEl.className = "modal";
    this.closeButtonEl = doc.createElement("div");
    this.closeButtonEl.className = "modal-close-button mod-raised clickable-icon";
    setIcon(this.closeButtonEl, "x");
    this.headerEl = doc.createElement("div");
    this.headerEl.className = "modal-header";
    this.titleEl = doc.createElement("div");
    this.titleEl.className = "modal-title";
    this.contentEl = doc.createElement("div");
    this.contentEl.className = "modal-content";
    this.buttonEl = doc.createElement("div");
    this.buttonEl.className = "modal-button-container";
    this.headerEl.append(this.titleEl);
    this.modalEl.append(this.closeButtonEl, this.headerEl, this.contentEl);
    this.containerEl.append(this.bgEl, this.modalEl);
    this.scope.register([], "Escape", (event) => {
      this.onEscapeKey(event);
      return false;
    });
    this.scope.setTabFocusContainerEl(this.containerEl);
    this.closeButtonEl.addEventListener("click", () => this.close());
    this.bgEl.addEventListener("click", (event) => this.onClickOutside(event));
  }

  setTitle(title: string): this {
    this.titleEl.textContent = title;
    return this;
  }

  setContent(content: string | DocumentFragment): this;
  setContent(content: string | Node): this;
  setContent(content: string | Node): this {
    if (typeof content === "string") this.contentEl.textContent = content;
    else this.contentEl.appendChild(content);
    return this;
  }

  addButton(cls: string, text: string, callback: () => void | Promise<void>): this {
    const buttonContainerEl = this.ensureButtonContainer();
    const buttonEl = this.containerEl.ownerDocument.createElement("button");
    buttonEl.className = cls;
    buttonEl.textContent = text;
    buttonEl.addEventListener("click", () => {
      buttonEl.classList.add("mod-loading");
      void Promise.resolve(callback())
        .finally(() => buttonEl.classList.remove("mod-loading"));
    });
    buttonContainerEl.appendChild(buttonEl);
    return this;
  }

  addCancelButton(text = "Cancel"): this {
    const buttonContainerEl = this.ensureButtonContainer();
    const buttonEl = this.containerEl.ownerDocument.createElement("button");
    buttonEl.textContent = text;
    buttonEl.addEventListener("click", () => this.close());
    buttonContainerEl.appendChild(buttonEl);
    return this;
  }

  setCloseCallback(callback: () => any): this {
    this.closeCallback = callback;
    return this;
  }

  setBackgroundOpacity(opacity: string): this {
    this.bgOpacity = opacity;
    return this;
  }

  setDimBackground(dim: boolean): this {
    this.dimBackground = dim;
    return this;
  }

  open(): void {
    if (this.containerEl.parentNode) return;
    this.opened = true;
    const activeWindow = getActiveWindow();
    this.win = activeWindow;
    this.selection = this.shouldRestoreSelection ? captureSelection(activeWindow) : null;
    clearFocusAndSelection(activeWindow);
    this.app.keymap.pushScope(this.scope);
    activeWindow.document.body.appendChild(this.containerEl);
    pushOpenModal(this);
    void this.onOpen();
    this.containerEl.classList.toggle("mod-dim", this.dimBackground);
    this.bgEl.style.opacity = this.dimBackground ? this.bgOpacity : "0";
    if (Platform.hasPhysicalKeyboard) focusFirstElement(this.modalEl);
    if (activeWindow !== window) activeWindow.addEventListener("beforeunload", this.onWindowClose);
  }

  close(): void {
    if (!this.opened) return;
    const modalWindow = this.win;
    this.opened = false;
    this.app.keymap.popScope(this.scope);
    this.containerEl.remove();
    this.onClose();
    this.closeCallback?.();
    removeOpenModal(this);
    if (this.shouldRestoreSelection) restoreSelection(this.selection);
    if (modalWindow && modalWindow !== window) modalWindow.removeEventListener("beforeunload", this.onWindowClose);
    this.selection = null;
    this.win = null;
  }

  onOpen(): Promise<void> | void {}
  onClose(): void {}

  onHistoryBack(): void {
    this.close();
  }

  onClickOutside(event: MouseEvent): void {
    if (!event.defaultPrevented) this.close();
  }

  onEscapeKey(event: KeyboardEvent): void {
    if (!event.defaultPrevented) this.close();
  }

  protected ensureButtonContainer(): HTMLElement {
    if (this.buttonEl.parentElement !== this.modalEl) this.modalEl.appendChild(this.buttonEl);
    return this.buttonEl;
  }
}

export class ConfirmationButton extends ButtonComponent {
  private handler: ((evt: MouseEvent) => unknown | Promise<unknown>) | null = null;

  private constructor(
    parentEl: HTMLElement,
    private readonly modal: ConfirmationModal,
    private readonly setInitialFocusButton: (button: ConfirmationButton) => void,
  ) {
    super(parentEl);
    super.onClick(async (event) => {
      const keepOpen = await this.handler?.(event);
      if (!keepOpen) this.modal.close();
    });
  }

  static create(
    parentEl: HTMLElement,
    modal: ConfirmationModal,
    setInitialFocusButton: (button: ConfirmationButton) => void,
  ): ConfirmationButton {
    return new ConfirmationButton(parentEl, modal, setInitialFocusButton);
  }

  override onClick(handler: (evt: MouseEvent) => unknown | Promise<unknown>): this {
    this.handler = handler;
    return this;
  }

  setInitialFocus(): this {
    this.setInitialFocusButton(this);
    return this;
  }

  setSecondary(): this {
    this.buttonEl.classList.add("mod-secondary");
    return this;
  }

  setCancel(): this {
    this.buttonEl.classList.add("mod-cancel");
    return this;
  }
}

export class ConfirmationModal extends Modal {
  buttonContainerEl: HTMLElement;
  private initialFocusButton: ConfirmationButton | null = null;

  constructor(app: App) {
    super(app);
    this.containerEl.classList.add("mod-confirmation");
    this.buttonContainerEl = this.ensureButtonContainer();
  }

  addClass(cls: string): this {
    this.modalEl.classList.add(cls);
    return this;
  }

  addCheckbox(label: string, cb: (event: MouseEvent) => any | Promise<any>): this {
    const checkboxEl = this.containerEl.ownerDocument.createElement("label");
    checkboxEl.className = "mod-checkbox";
    const inputEl = this.containerEl.ownerDocument.createElement("input");
    inputEl.type = "checkbox";
    inputEl.tabIndex = -1;
    checkboxEl.append(inputEl, label);
    inputEl.addEventListener("click", (event) => {
      void cb(event);
    });
    this.buttonContainerEl.appendChild(checkboxEl);
    return this;
  }

  addButton(cb: (btn: ConfirmationButton) => any): this;
  addButton(cls: string | string[], text: string, callback: (event: MouseEvent) => unknown | Promise<unknown>): this;
  addButton(
    cbOrClass: ((btn: ConfirmationButton) => any) | string | string[],
    text?: string,
    callback?: (event: MouseEvent) => unknown | Promise<unknown>,
  ): this {
    if (typeof cbOrClass === "string" || Array.isArray(cbOrClass)) {
      const buttonEl = this.containerEl.ownerDocument.createElement("button");
      buttonEl.className = Array.isArray(cbOrClass) ? cbOrClass.join(" ") : cbOrClass;
      buttonEl.textContent = text ?? "";
      buttonEl.addEventListener("click", (event) => {
        void (async () => {
          try {
            buttonEl.classList.add("mod-loading");
            const keepOpen = await callback?.(event);
            if (!keepOpen) this.close();
          } finally {
            buttonEl.classList.remove("mod-loading");
          }
        })();
      });
      this.buttonContainerEl.appendChild(buttonEl);
      return this;
    }
    const button = ConfirmationButton.create(this.buttonContainerEl, this, (initialFocusButton) => {
      this.initialFocusButton = initialFocusButton;
    });
    cbOrClass(button);
    return this;
  }

  override addCancelButton(textOrCallback: string | (() => unknown | Promise<unknown>) = "Cancel"): this {
    if (typeof textOrCallback === "string") return this.addButton("mod-cancel", textOrCallback, () => undefined);
    return this.addButton("mod-cancel", "Cancel", () => textOrCallback());
  }

  override open(): void {
    super.open();
    this.initialFocusButton?.buttonEl.focus();
  }
}

function pushOpenModal(modal: Modal): void {
  removeOpenModal(modal);
  openModals.push(modal);
}

function removeOpenModal(modal: Modal): void {
  const index = openModals.indexOf(modal);
  if (index !== -1) openModals.splice(index, 1);
}

function captureSelection(win: Window): SavedSelection | null {
  const selection = win.getSelection();
  if (!selection) return null;
  let focusEl: Element | null = win.document.activeElement;
  if (focusEl === win.document.body) focusEl = null;
  if (isIframeElement(focusEl) && focusEl.contentDocument) focusEl = focusEl.contentDocument.activeElement;
  let range: Range | null = null;
  if (focusEl && selection.rangeCount > 0) {
    const selectedRange = selection.getRangeAt(0);
    const ancestor = selectedRange.commonAncestorContainer;
    if (focusEl === ancestor || focusEl.contains(ancestor)) range = selectedRange;
  }
  return { win, range, focusEl };
}

function clearFocusAndSelection(win: Window): void {
  const activeElement = win.document.activeElement;
  if (isHtmlElement(activeElement)) activeElement.blur();
  win.getSelection()?.removeAllRanges();
}

function restoreSelection(selection: SavedSelection | null): void {
  if (!selection || (!selection.focusEl && !selection.range)) return;
  const { win, range, focusEl } = selection;
  win.focus();
  const isCodeMirrorContent = isHtmlElement(focusEl) && focusEl.classList.contains("cm-content");
  if (range && !isCodeMirrorContent && containsInDocument(win, range.startContainer) && containsInDocument(win, range.endContainer)) {
    const currentSelection = win.getSelection();
    currentSelection?.removeAllRanges();
    currentSelection?.addRange(range);
  }
  if ((isHtmlElement(focusEl) || isSvgElement(focusEl)) && containsInDocument(win, focusEl)) {
    focusEl.focus({ preventScroll: true });
  }
}

function containsInDocument(win: Window, target: Node): boolean {
  let node: Node | null = target;
  while (node && node.ownerDocument.defaultView?.frameElement) node = node.ownerDocument.defaultView.frameElement;
  return win.document.body.contains(node);
}

function focusFirstElement(containerEl: HTMLElement): void {
  const focusable = containerEl.querySelector<HTMLElement>(
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1']), [contenteditable='true']",
  );
  try {
    (focusable ?? containerEl).focus({ preventScroll: true });
  } catch {
    containerEl.focus();
  }
}

function isHtmlElement(element: Element | null): element is HTMLElement {
  if (!element) return false;
  const win = element.ownerDocument.defaultView ?? window;
  return element instanceof win.HTMLElement;
}

function isSvgElement(element: Element | null): element is SVGElement {
  if (!element) return false;
  const win = element.ownerDocument.defaultView ?? window;
  return element instanceof win.SVGElement;
}

function isIframeElement(element: Element | null): element is HTMLIFrameElement {
  return element?.tagName === "IFRAME";
}
