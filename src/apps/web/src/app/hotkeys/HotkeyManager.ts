import type { Command } from "../commands/CommandManager";
import type { App } from "../App";
import type { EventRef } from "../../core/Events";
import { unregisterEventRef } from "../../core/EventRefInternal";
import type { Hotkey } from "./Keymap";
import {
  compileModifiers,
  normalizedKeymapEventFromKeyboardEvent,
  type KeymapEventHandler,
  type NormalizedKeymapEvent,
} from "./Scope";

export class HotkeyManager {
  private defaultHotkeys = new Map<string, Hotkey[]>();
  private hotkeyOverrides = new Map<string, Hotkey[]>();
  private bakedHotkeys: Hotkey[] = [];
  private bakedIds: string[] = [];
  private hotkeysDirty = true;
  private hotkeyReloadTimer: ReturnType<typeof setTimeout> | null = null;
  private rawListenerRef: EventRef | null = null;
  private readonly globalScopeRef: KeymapEventHandler | null = null;

  constructor(private readonly app?: App) {
    this.globalScopeRef =
      this.app?.scope.register(null, null, (event, keymapEvent) =>
        this.onTrigger(event, keymapEvent),
      ) ?? null;
  }

  registerListeners(): void {
    if (!this.app) return;
    if (!this.rawListenerRef)
      this.rawListenerRef = this.app.vault.on<[string]>("raw", (path) => this.onRaw(path));
  }

  unregisterListeners(): void {
    if (this.rawListenerRef) unregisterEventRef(this.rawListenerRef);
    this.rawListenerRef = null;
    this.cancelConfigFileChange();
  }

  async load(): Promise<void> {
    const data = await this.app?.vault.readConfigJson<Record<string, Hotkey[]>>("hotkeys");
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    this.hotkeyOverrides.clear();
    for (const [commandId, hotkeys] of Object.entries(data)) {
      if (!Array.isArray(hotkeys)) continue;
      this.hotkeyOverrides.set(commandId, hotkeys);
    }
    this.markDirty();
  }

  async save(): Promise<void> {
    if (!this.app) return;
    await this.app.vault.writeConfigJson("hotkeys", this.getHotkeyOverrides());
  }

  setHotkeys(commandId: string, hotkeys: Hotkey[]): void {
    this.hotkeyOverrides.set(commandId, hotkeys);
    this.markDirty();
  }

  addDefaultHotkeys(commandId: string, hotkeys: Hotkey[]): void {
    this.defaultHotkeys.set(commandId, hotkeys);
    this.markDirty();
  }

  removeDefaultHotkeys(commandId: string): void {
    this.defaultHotkeys.delete(commandId);
    this.markDirty();
  }

  onCommandsChanged(): void {
    this.markDirty();
  }

  clearHotkeys(commandId: string): void {
    this.hotkeyOverrides.set(commandId, []);
    this.markDirty();
  }

  removeHotkeys(commandId: string): void {
    this.hotkeyOverrides.delete(commandId);
    this.markDirty();
  }

  getHotkeys(commandId: string): readonly Hotkey[] | undefined {
    return this.hotkeyOverrides.get(commandId);
  }

  getDefaultHotkeys(commandId: string): readonly Hotkey[] | undefined {
    return this.defaultHotkeys.get(commandId);
  }

  getEffectiveHotkeys(commandId: string): readonly Hotkey[] | undefined {
    return this.hotkeyOverrides.has(commandId)
      ? this.getHotkeys(commandId)
      : this.getDefaultHotkeys(commandId);
  }

  getCustomHotkeys(commandId: string): readonly Hotkey[] {
    return this.hotkeyOverrides.get(commandId) ?? [];
  }

  hasHotkeyOverride(commandId: string): boolean {
    return this.hotkeyOverrides.has(commandId);
  }

  getAllHotkeys(): Record<string, Hotkey[]> {
    const ids = new Set([...this.defaultHotkeys.keys(), ...this.hotkeyOverrides.keys()]);
    return Object.fromEntries(
      [...ids].map((id) => [id, [...(this.getEffectiveHotkeys(id) ?? [])]]),
    );
  }

  getHotkeyOverrides(): Record<string, Hotkey[]> {
    return Object.fromEntries(
      [...this.hotkeyOverrides.entries()].map(([id, hotkeys]) => [id, [...hotkeys]]),
    );
  }

  get customKeys(): Record<string, Hotkey[]> {
    return this.getHotkeyOverrides();
  }

  printHotkeyForCommand(commandId: string): string {
    const hotkeys = this.getHotkeys(commandId) ?? this.getDefaultHotkeys(commandId);
    return hotkeys && hotkeys.length > 0 ? formatHotkey(hotkeys[0]) : "";
  }

  onConfigFileChange(): void {
    this.cancelConfigFileChange();
    this.hotkeyReloadTimer = setTimeout(() => {
      this.hotkeyReloadTimer = null;
      void this.load();
    }, 50);
  }

  private onRaw(path: string): void {
    if (!this.app || path !== `${this.app.vault.configDir}/hotkeys.json`) return;
    this.onConfigFileChange();
  }

  findMatchingCommand(event: KeyboardEvent, commands: readonly Command[]): Command | null {
    this.bake(commands);
    for (let index = 0; index < this.bakedHotkeys.length; index++) {
      if (!matches(event, this.bakedHotkeys[index])) continue;
      const id = this.bakedIds[index];
      const command = commands.find((item) => item.id === id);
      if (command) return command;
    }

    for (const command of commands) {
      const registeredHotkeys = this.getHotkeys(command.id) ?? [];
      const hotkeys = this.hasHotkeyOverride(command.id)
        ? registeredHotkeys
        : (command.hotkeys ?? []);
      for (const hotkey of hotkeys) {
        if (matches(event, hotkey)) return command;
      }
    }
    return null;
  }

  private onTrigger(event: KeyboardEvent, keymapEvent?: NormalizedKeymapEvent): false | void {
    if (!this.app) return;
    const commands = this.app.commands.getCommands();
    this.bake(commands);
    for (let index = 0; index < this.bakedHotkeys.length; index++) {
      if (
        keymapEvent
          ? !matchesKeymapEvent(this.bakedHotkeys[index], keymapEvent)
          : !matches(event, this.bakedHotkeys[index])
      )
        continue;
      const command = this.app.commands.findCommand(this.bakedIds[index]);
      if (!command) continue;
      if (event.repeat && !command.repeatable) continue;
      if (this.app.commands.executeCommand(command)) return false;
    }
  }

  private cancelConfigFileChange(): void {
    if (this.hotkeyReloadTimer == null) return;
    clearTimeout(this.hotkeyReloadTimer);
    this.hotkeyReloadTimer = null;
  }

  private bake(commands: readonly Command[]): void {
    if (!this.hotkeysDirty) return;
    this.bakedHotkeys = [];
    this.bakedIds = [];
    const commandIds = new Set(commands.map((command) => command.id));
    for (const [commandId, hotkeys] of this.hotkeyOverrides) {
      if (!commandIds.has(commandId)) continue;
      this.addBakedHotkeys(commandId, hotkeys);
    }
    for (const command of commands) {
      if (this.hotkeyOverrides.has(command.id)) continue;
      this.addBakedHotkeys(
        command.id,
        this.defaultHotkeys.get(command.id) ?? command.hotkeys ?? [],
      );
    }
    this.hotkeysDirty = false;
  }

  private addBakedHotkeys(commandId: string, hotkeys: readonly Hotkey[]): void {
    for (const hotkey of hotkeys) {
      this.bakedHotkeys.push({
        modifiers: hotkey.modifiers,
        key: hotkey.code ? normalizeCode(hotkey.code) : hotkey.key,
      });
      this.bakedIds.push(commandId);
    }
  }

  private markDirty(): void {
    this.hotkeysDirty = true;
  }
}

function matchesKeymapEvent(hotkey: Hotkey, event: NormalizedKeymapEvent): boolean {
  const modifiers = compileModifiers(hotkey.modifiers);
  const key = hotkey.code ? normalizeCode(hotkey.code) : hotkey.key;
  return (
    modifiers === event.modifiers &&
    (!key || key === event.vkey || key.toLowerCase() === event.key.toLowerCase())
  );
}

function matches(event: KeyboardEvent, hotkey: Hotkey): boolean {
  return matchesKeymapEvent(hotkey, normalizedKeymapEventFromKeyboardEvent(event));
}

function normalizeCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Space") return " ";
  return code;
}

function isMacLike(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

const MODIFIER_ORDER = ["Mod", "Ctrl", "Meta", "Alt", "Shift"] as const;
const MAC_MODIFIER_LABELS: Record<string, string> = {
  Mod: "⌘",
  Ctrl: "⌃",
  Meta: "⌘",
  Alt: "⌥",
  Shift: "⇧",
};
const NON_MAC_MODIFIER_LABELS: Record<string, string> = {
  Mod: "Ctrl",
  Ctrl: "Ctrl",
  Meta: "Win",
  Alt: "Alt",
  Shift: "Shift",
};
const SPECIAL_KEY_LABELS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  " ": "Space",
};

function formatHotkey(hotkey: Hotkey): string {
  const labels = isMacLike() ? MAC_MODIFIER_LABELS : NON_MAC_MODIFIER_LABELS;
  const parts = MODIFIER_ORDER.filter((modifier) => hotkey.modifiers.includes(modifier)).map(
    (modifier) => labels[modifier],
  );
  parts.push(formatHotkeyKey(hotkey.code ? normalizeDisplayCode(hotkey.code) : (hotkey.key ?? "")));
  return parts.join(isMacLike() ? " " : " + ");
}

function normalizeDisplayCode(code: string): string {
  return code.startsWith("Key") && code.length === 4 ? code.charAt(3) : code;
}

function formatHotkeyKey(key: string): string {
  if (Object.prototype.hasOwnProperty.call(SPECIAL_KEY_LABELS, key)) return SPECIAL_KEY_LABELS[key];
  const spaced = key.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
