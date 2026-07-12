import { getActiveDocument } from "../../dom/ActiveDocument";
import { Platform } from "../../platform/Platform";
import type { PaneType } from "../../views/workspace/Workspace";
import {
  compileModifiers,
  decompileModifiers,
  getModifiers,
  normalizedKeymapEventFromKeyboardEvent,
  Scope,
} from "./Scope";

export interface Hotkey {
  modifiers: string[];
  key?: string;
  code?: string;
}

export type Modifier = "Mod" | "Ctrl" | "Meta" | "Shift" | "Alt";
export type UserEvent = MouseEvent | PointerEvent | TouchEvent | KeyboardEvent;

export class Keymap {
  static global?: Keymap;

  readonly rootScope = new Scope();
  scope: Scope = this.rootScope;
  readonly prevScopes: Scope[] = [];
  modifiers = "";

  constructor(readonly win: Window | null = typeof window === "undefined" ? null : window) {
    this.win?.addEventListener("keydown", (event) => this.onKeyEvent(event), true);
    this.win?.addEventListener("focusin", (event) => this.onFocusIn(event));
  }

  getRootScope(): Scope {
    return this.rootScope;
  }

  pushScope(scope: Scope): void {
    if (this.scope === scope) return;
    this.prevScopes.push(this.scope);
    this.scope = scope;
  }

  popScope(scope: Scope): void {
    if (scope === this.rootScope) return;
    if (this.scope === scope) this.scope = this.prevScopes.pop() ?? this.rootScope;
    else {
      const index = this.prevScopes.indexOf(scope);
      if (index !== -1) this.prevScopes.splice(index, 1);
    }
  }

  handleKey(event: KeyboardEvent): boolean {
    return this.onKeyEvent(event) === false;
  }

  onKeyEvent(event: KeyboardEvent): false | void {
    this.updateModifiers(event);
    if (Keymap.isModifierKey(event.key)) return;
    const result = this.scope.handleKey(event, normalizedKeymapEventFromKeyboardEvent(event));
    if (result === false) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
  }

  onFocusIn(event: FocusEvent): void {
    const container = this.scope.tabFocusContainerEl;
    const target = event.target;
    const activeDocument = getActiveDocument();
    if (!container || target === activeDocument.body || !isElementLike(target) || container.contains(target)) return;
    const scope = this.scope;
    const activeWindow = activeDocument.defaultView ?? window;
    activeWindow.setTimeout(() => {
      if (this.scope !== scope) return;
      if (!tryFocus(container)) {
        const activeElement = activeDocument.activeElement;
        if (activeElement instanceof HTMLElement) activeElement.blur();
      }
    }, 0);
  }

  updateModifiers(event: KeyboardEvent | MouseEvent): void {
    this.modifiers = Keymap.getModifiers(event);
  }

  matchModifiers(modifiers: string): boolean {
    return this.modifiers === modifiers;
  }

  hasModifier(modifier: Modifier): boolean {
    return Keymap.decompileModifiers(this.modifiers).includes(modifier);
  }

  static getModifiers(event: KeyboardEvent | MouseEvent): string {
    return getModifiers(event);
  }

  static init(): Keymap {
    return this.global ??= new Keymap();
  }

  static compileModifiers(modifiers: string[]): string {
    return compileModifiers(modifiers);
  }

  static decompileModifiers(modifiers: string): string[] {
    return decompileModifiers(modifiers);
  }

  static isModifierKey(key: string): boolean {
    return key === "Control" || key === "Alt" || key === "Shift" || key === "OS" || key === "Meta";
  }

  static isModifier(evt: MouseEvent | TouchEvent | KeyboardEvent, modifier: Modifier): boolean {
    if (modifier === "Mod") return Platform.isMacOS ? evt.metaKey : evt.ctrlKey;
    if (modifier === "Ctrl") return evt.ctrlKey;
    if (modifier === "Meta") return evt.metaKey;
    if (modifier === "Shift") return evt.shiftKey;
    if (modifier === "Alt") return evt.altKey;
    return false;
  }

  static isMatch(ref: { modifiers: string | null; key: string | null }, event: { modifiers: string; key: string; vkey: string }): boolean {
    const modifiers = ref.modifiers;
    const key = ref.key;
    return (modifiers === null || modifiers === event.modifiers)
      && (!key || key === event.vkey || Boolean(event.key && key.toLowerCase() === event.key.toLowerCase()));
  }

  static isModEvent(event?: UserEvent | null): false | PaneType {
    if (!event) return false;
    if (
      typeof MouseEvent !== "undefined" && event instanceof MouseEvent && event.button === 1
      || typeof PointerEvent !== "undefined" && event instanceof PointerEvent && event.button === 1
    ) return "tab";
    if (!Keymap.isModifier(event, "Mod")) return false;
    if (Keymap.isModifier(event, "Alt")) return Keymap.isModifier(event, "Shift") ? "window" : "split";
    return "tab";
  }
}

function isElementLike(target: EventTarget | null): target is Element {
  return Boolean(target && typeof (target as Element).contains === "function");
}

function tryFocus(container: HTMLElement): boolean {
  try {
    container.focus({ preventScroll: true });
    return container.ownerDocument.activeElement === container;
  } catch {
    return false;
  }
}
