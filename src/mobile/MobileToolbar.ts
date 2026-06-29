import type { App } from "../app/App";
import { Platform } from "../platform/Platform";
import { setIcon } from "../ui/Icon";

export class MobileToolbar {
  readonly wrapperEl: HTMLElement;
  readonly spacerEl: HTMLElement;
  readonly optionsContainerEl: HTMLElement;
  readonly optionsListContainerEl: HTMLElement;
  readonly optionsListEl: HTMLElement;
  isVisible = false;
  lastCommandIds = "";
  lastKeyboardHeight = 0;
  hasKeyboardVisible = false;
  isMultiWindowMode = false;

  constructor(readonly app: App) {
    const doc = app.containerEl.ownerDocument;
    this.wrapperEl = doc.createElement("div");
    this.wrapperEl.className = "mobile-toolbar";
    this.spacerEl = doc.createElement("div");
    this.spacerEl.className = "mobile-toolbar-spacer";
    this.optionsContainerEl = doc.createElement("div");
    this.optionsContainerEl.className = "mobile-toolbar-options-container";
    this.optionsListContainerEl = doc.createElement("div");
    this.optionsListContainerEl.className = "mobile-toolbar-options-list-container mod-raised";
    this.optionsListEl = doc.createElement("div");
    this.optionsListEl.className = "mobile-toolbar-options-list";
    this.optionsListContainerEl.append(this.optionsListEl);
    this.optionsContainerEl.append(this.optionsListContainerEl);
    this.wrapperEl.append(this.optionsContainerEl);
  }

  attachListeners(): void {
    const win = this.app.containerEl.ownerDocument.defaultView;
    if (!win) return;
    win.addEventListener("focusout", () => this.update());
    win.addEventListener("focusin", () => this.update());
    win.addEventListener("keyboardWillHide", (event) => {
      this.animateToKeyboardHeight();
      if (!("hasPhysicalKeyboard" in event) || !(event as Event & { hasPhysicalKeyboard?: boolean }).hasPhysicalKeyboard) {
        this.hasKeyboardVisible = false;
        if (Platform.isAndroidApp) this.update();
      }
    });
    win.addEventListener("keyboardWillShow", () => {
      this.animateToKeyboardHeight();
      this.hasKeyboardVisible = true;
      if (Platform.isAndroidApp) this.update();
    });
  }

  compileToolbar(): void {
    const commandIds = this.getCommandIds();
    const serialized = JSON.stringify(commandIds);
    if (serialized === this.lastCommandIds) return;
    this.optionsListEl.replaceChildren();
    const commands = this.app.commands;
    for (const commandId of commandIds) {
      const command = commands.findCommand(commandId);
      if (!command) continue;
      const optionEl = this.optionsListEl.ownerDocument.createElement("div");
      optionEl.className = "mobile-toolbar-option";
      setIcon(optionEl, command.icon ?? "question-mark-glyph");
      optionEl.addEventListener("click", (event) => {
        commands.executeCommandById(commandId, event);
        event.preventDefault();
      });
      optionEl.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      this.optionsListEl.appendChild(optionEl);
    }
    this.lastCommandIds = serialized;
  }

  update(): void {
    this.lastKeyboardHeight = readCssPixelNumber("--keyboard-height");
    let hasFocusedEditor = Boolean(this.app.workspace.activeEditor?.editor.hasFocus());
    if (Platform.isAndroidApp && hasFocusedEditor) hasFocusedEditor = this.hasKeyboardVisible || this.isMultiWindowMode;
    if (hasFocusedEditor) {
      if (!this.isVisible) this.show();
    } else if (this.isVisible) this.hide();
  }

  animateToKeyboardHeight(): void {
    this.lastKeyboardHeight = readCssPixelNumber("--keyboard-height");
  }

  show(): void {
    if (this.getCommandIds().length === 0) {
      this.hide();
      return;
    }
    if (this.isVisible) return;
    this.isVisible = true;
    this.compileToolbar();
    this.app.dom.appContainerEl.append(this.spacerEl, this.wrapperEl);
    this.app.containerEl.ownerDocument.body.classList.add("mod-toolbar-open");
  }

  hide(): void {
    this.isVisible = false;
    this.spacerEl.remove();
    this.wrapperEl.remove();
    this.app.containerEl.ownerDocument.body.classList.remove("mod-toolbar-open");
  }

  private getCommandIds(): string[] {
    const configured = this.app.vault.getConfig<unknown>("mobileToolbarCommands");
    return Array.isArray(configured) ? configured.filter((id): id is string => typeof id === "string") : [];
  }
}

function readCssPixelNumber(property: string): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(property);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}
