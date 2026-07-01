export interface KeymapInfo {
  modifiers: string | null;
  key: string | null;
}

export interface KeymapContext extends KeymapInfo {
  vkey: string;
  modifiers: string;
  key: string;
}

export type KeymapEventListener = (evt: KeyboardEvent, ctx: KeymapContext) => false | any;

export interface NormalizedKeymapEvent extends KeymapContext {
  modifiers: string;
  key: string;
  vkey: string;
}

export type KeyHandler = (event: KeyboardEvent, keymapEvent?: NormalizedKeymapEvent) => boolean | void;

export interface KeymapEventHandler extends KeymapInfo {
  scope: Scope;
  modifiers: string | null;
  key: string | null;
  func: KeyHandler;
}

export class Scope {
  tabFocusContainerEl: HTMLElement | null = null;
  readonly keys: KeymapEventHandler[] = [];

  constructor(readonly parent: Scope | null = null) {}

  register(modifiers: string[] | null, key: string | null, handler: KeyHandler): KeymapEventHandler {
    const ref = {
      scope: this,
      modifiers: modifiers == null ? null : compileModifiers(modifiers),
      key,
      func: handler,
    };
    this.keys.push(ref);
    return ref;
  }

  unregister(ref: KeymapEventHandler): void {
    const index = this.keys.indexOf(ref);
    if (index !== -1) this.keys.splice(index, 1);
  }

  setTabFocusContainerEl(el: HTMLElement | null): void {
    this.tabFocusContainerEl = el;
  }

  handleKey(event: KeyboardEvent, keymapEvent: NormalizedKeymapEvent = normalizedKeymapEventFromKeyboardEvent(event)): boolean | void {
    for (const item of this.keys) {
      if (matches(item, keymapEvent)) {
        const result = item.func(event, keymapEvent);
        if (result !== undefined) return result;
        if (item.key !== null || item.modifiers !== null) return result;
      }
    }
    return this.parent?.handleKey(event, keymapEvent);
  }
}

export class DynamicScope extends Scope {
  constructor(parent: Scope | null, private readonly scopeProvider: () => Scope | null) {
    super(parent);
  }

  override handleKey(event: KeyboardEvent, keymapEvent: NormalizedKeymapEvent = normalizedKeymapEventFromKeyboardEvent(event)): boolean | void {
    const scope = this.scopeProvider();
    if (scope) return scope.handleKey(event, keymapEvent);
    return super.handleKey(event, keymapEvent);
  }
}

function matches(ref: KeymapEventHandler, event: NormalizedKeymapEvent): boolean {
  const modifiersMatch = ref.modifiers === null || ref.modifiers === event.modifiers;
  const keyMatch = !ref.key || ref.key === event.vkey || normalizeKey(ref.key) === normalizeKey(event.key);
  return modifiersMatch && keyMatch;
}

export function normalizedKeymapEventFromKeyboardEvent(event: KeyboardEvent): NormalizedKeymapEvent {
  return {
    modifiers: getModifiers(event),
    key: keyFromKeyboardEvent(event),
    vkey: virtualKeyFromKeyboardEvent(event),
  };
}

export function getModifiers(event: KeyboardEvent | MouseEvent): string {
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.metaKey) modifiers.push("Meta");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  return compileModifiers(modifiers);
}

export function compileModifiers(modifiers: string[]): string {
  return modifiers
    .map((modifier) => modifier === "Mod" ? (isMacLike() ? "Meta" : "Ctrl") : normalizeModifier(modifier))
    .sort()
    .join(",");
}

export function decompileModifiers(modifiers: string): string[] {
  return modifiers
    .split(",")
    .map((modifier) => isMacLike() && modifier === "Meta" || !isMacLike() && modifier === "Ctrl" ? "Mod" : modifier)
    .filter(Boolean);
}

function normalizeKey(key: string): string {
  return key.toLowerCase();
}

function isMacLike(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

function normalizeModifier(modifier: string): string {
  return modifier;
}

function keyFromKeyboardEvent(event: KeyboardEvent): string {
  return event.key || keyCodeMap[event.which || event.keyCode] || "";
}

function virtualKeyFromKeyboardEvent(event: KeyboardEvent): string {
  if ((event.which || event.keyCode) === 54 && event.key === "^" && event.code === "KeyI") return "KeyI";
  const keyCode = event.which || event.keyCode;
  return keyCodeMap[keyCode] || (keyCode ? `Key${keyCode}` : event.code ? normalizeCode(event.code) : event.key || "");
}

function normalizeCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Space") return " ";
  return code;
}

const keyCodeMap: Record<number, string> = {
  8: "Backspace",
  9: "Tab",
  13: "Enter",
  16: "Shift",
  17: "Control",
  18: "Alt",
  20: "CapsLock",
  27: "Escape",
  32: " ",
  33: "PageUp",
  34: "PageDown",
  35: "End",
  36: "Home",
  37: "ArrowLeft",
  38: "ArrowUp",
  39: "ArrowRight",
  40: "ArrowDown",
  46: "Delete",
  48: "0",
  49: "1",
  50: "2",
  51: "3",
  52: "4",
  53: "5",
  54: "6",
  55: "7",
  56: "8",
  57: "9",
  65: "A",
  66: "B",
  67: "C",
  68: "D",
  69: "E",
  70: "F",
  71: "G",
  72: "H",
  73: "I",
  74: "J",
  75: "K",
  76: "L",
  77: "M",
  78: "N",
  79: "O",
  80: "P",
  81: "Q",
  82: "R",
  83: "S",
  84: "T",
  85: "U",
  86: "V",
  87: "W",
  88: "X",
  89: "Y",
  90: "Z",
  91: "Meta",
  92: "Meta",
  93: "ContextMenu",
  112: "F1",
  113: "F2",
  114: "F3",
  115: "F4",
  116: "F5",
  117: "F6",
  118: "F7",
  119: "F8",
  120: "F9",
  121: "F10",
  122: "F11",
  123: "F12",
  186: ";",
  187: "=",
  188: ",",
  189: "-",
  190: ".",
  191: "/",
  192: "`",
  219: "[",
  220: "\\",
  221: "]",
  222: "'",
};
