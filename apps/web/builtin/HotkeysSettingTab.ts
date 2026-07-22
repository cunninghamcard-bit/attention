import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import type { Command } from "../app/commands/CommandManager";
import { formatHotkey, getDisplayHotkeys } from "../app/commands/CommandPalette";
import type { Hotkey } from "../app/hotkeys/Keymap";
import { Setting, SettingGroup } from "../ui/Setting";
import { setIcon } from "../ui/Icon";

export class HotkeysSettingTab implements SettingTab {
  readonly id = "hotkeys";
  readonly name = "Hotkeys";
  readonly icon = "lucide-keyboard";
  readonly section = "options" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");
  private query = "";
  private recordingCleanup: (() => void) | null = null;

  constructor(readonly app: App) {
    this.navEl.className = "vertical-tab-nav-item tappable";
    const iconEl = document.createElement("div");
    iconEl.className = "vertical-tab-nav-item-icon";
    setIcon(iconEl, this.icon);
    const titleEl = document.createElement("div");
    titleEl.className = "vertical-tab-nav-item-title";
    titleEl.textContent = this.name;
    const chevronEl = document.createElement("div");
    chevronEl.className = "vertical-tab-nav-item-chevron";
    this.navEl.append(iconEl, titleEl, chevronEl);
    this.containerEl.className = "vertical-tab-content hotkeys-settings";
  }

  setQuery(query: string): void {
    this.query = query;
  }

  display(): void {
    this.stopRecording();
    this.containerEl.replaceChildren();
    const wrapperEl = document.createElement("div");
    wrapperEl.className = "hotkey-settings-container";
    this.containerEl.appendChild(wrapperEl);
    const group = new SettingGroup(wrapperEl).setHeading("Hotkeys");
    const headerEl = document.createElement("div");
    headerEl.className = "hotkey-header-container";
    group.groupEl.insertBefore(headerEl, group.itemsEl);
    const searchEl = document.createElement("input");
    searchEl.className = "setting-group-search hotkey-filter";
    searchEl.type = "text";
    searchEl.placeholder = "Search commands...";
    searchEl.value = this.query;
    headerEl.appendChild(searchEl);
    searchEl.addEventListener("input", () => {
      this.query = searchEl.value;
      this.display();
    });
    const listEl = document.createElement("div");
    listEl.className = "hotkey-list-container";
    group.groupEl.insertBefore(listEl, group.itemsEl);
    listEl.appendChild(group.itemsEl);

    for (const command of this.getMatchingCommands()) {
      const setting = new Setting(group.itemsEl).setName(command.name).setDesc(command.id);
      this.renderCommandHotkeys(setting, command);
    }
  }

  hide(): void {
    this.containerEl.remove();
  }

  private getMatchingCommands(): Command[] {
    const tokens = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return [...this.app.commands.getCommands()]
      .filter((command) => {
        const haystack = `${command.name} ${command.id}`.toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private renderCommandHotkeys(setting: Setting, command: Command): void {
    const hotkeysEl = document.createElement("div");
    hotkeysEl.className = "setting-command-hotkeys";
    const hotkeys = [...getDisplayHotkeys(this.app, command)];

    if (hotkeys.length === 0) {
      const emptyEl = document.createElement("span");
      emptyEl.className = "setting-hotkey mod-empty";
      emptyEl.textContent = "No hotkey";
      hotkeysEl.appendChild(emptyEl);
    }

    hotkeys.forEach((hotkey, index) => {
      hotkeysEl.appendChild(this.createHotkeyEl(command, hotkey, index));
    });

    hotkeysEl.appendChild(this.createAddHotkeyButton(command));
    if (this.app.hotkeys.hasHotkeyOverride(command.id))
      hotkeysEl.appendChild(this.createRestoreHotkeyButton(command));
    setting.controlEl.appendChild(hotkeysEl);
  }

  private createHotkeyEl(command: Command, hotkey: Hotkey, index: number): HTMLElement {
    const hotkeyEl = document.createElement("span");
    hotkeyEl.className = "setting-hotkey";
    hotkeyEl.appendChild(document.createTextNode(formatHotkey(hotkey)));
    const conflicts = getHotkeyConflicts(this.app, command, hotkey);
    if (conflicts.length > 0) {
      hotkeyEl.classList.add("has-conflict");
      hotkeyEl.title = `Conflicts with ${conflicts.map((conflict) => conflict.name).join(", ")}`;
    }

    const deleteEl = document.createElement("span");
    deleteEl.className = "setting-hotkey-icon setting-delete-hotkey clickable-icon";
    deleteEl.role = "button";
    deleteEl.tabIndex = 0;
    deleteEl.title = "Remove hotkey";
    deleteEl.setAttribute("aria-label", "Remove hotkey");
    setIcon(deleteEl, "lucide-x");
    deleteEl.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.removeHotkeyAt(command, index);
    });
    hotkeyEl.appendChild(deleteEl);
    return hotkeyEl;
  }

  private createAddHotkeyButton(command: Command): HTMLElement {
    const buttonEl = document.createElement("span");
    buttonEl.className = "setting-add-hotkey-button clickable-icon";
    buttonEl.role = "button";
    buttonEl.tabIndex = 0;
    buttonEl.title = "Add hotkey";
    buttonEl.setAttribute("aria-label", "Add hotkey");
    setIcon(buttonEl, "lucide-plus");
    buttonEl.addEventListener("click", (event) => {
      event.preventDefault();
      this.recordHotkey(command, buttonEl);
    });
    return buttonEl;
  }

  private createRestoreHotkeyButton(command: Command): HTMLElement {
    const buttonEl = document.createElement("span");
    buttonEl.className = "setting-restore-hotkey-button clickable-icon mod-active";
    buttonEl.role = "button";
    buttonEl.tabIndex = 0;
    buttonEl.title = "Restore default hotkeys";
    buttonEl.setAttribute("aria-label", "Restore default hotkeys");
    setIcon(buttonEl, "lucide-refresh-cw");
    buttonEl.addEventListener("click", (event) => {
      event.preventDefault();
      this.app.hotkeys.removeHotkeys(command.id);
      this.persistHotkeys();
      this.display();
    });
    return buttonEl;
  }

  private recordHotkey(command: Command, buttonEl: HTMLElement): void {
    this.stopRecording();
    buttonEl.classList.add("mod-active");
    buttonEl.title = "Press keys...";
    buttonEl.setAttribute("aria-label", "Press keys");
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.stopRecording();
      const hotkey = eventToHotkey(event);
      if (hotkey) {
        this.app.hotkeys.setHotkeys(command.id, [...getDisplayHotkeys(this.app, command), hotkey]);
        this.persistHotkeys();
      }
      this.display();
    };
    this.recordingCleanup = () => {
      buttonEl.classList.remove("mod-active");
      window.removeEventListener("keydown", handler, true);
    };
    window.addEventListener("keydown", handler, true);
  }

  private removeHotkeyAt(command: Command, index: number): void {
    const hotkeys = [...getDisplayHotkeys(this.app, command)];
    hotkeys.splice(index, 1);
    this.app.hotkeys.setHotkeys(command.id, hotkeys);
    this.persistHotkeys();
    this.display();
  }

  private persistHotkeys(): void {
    void this.app.hotkeys.save();
  }

  private stopRecording(): void {
    this.recordingCleanup?.();
    this.recordingCleanup = null;
  }
}

function eventToHotkey(event: KeyboardEvent): Hotkey | null {
  if (event.key === "Escape") return null;
  const modifiers: string[] = [];
  if (event.metaKey || event.ctrlKey) modifiers.push("Mod");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  const key = normalizeKey(event.key);
  if (!key || ["Meta", "Control", "Alt", "Shift"].includes(key)) return null;
  return { modifiers, key };
}

function normalizeKey(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function getHotkeyConflicts(app: App, command: Command, hotkey: Hotkey): Command[] {
  const signature = hotkeySignature(hotkey);
  return app.commands.getCommands().filter((candidate) => {
    if (candidate.id === command.id) return false;
    return getDisplayHotkeys(app, candidate).some(
      (candidateHotkey) => hotkeySignature(candidateHotkey) === signature,
    );
  });
}

function hotkeySignature(hotkey: Hotkey): string {
  const modifiers = [...hotkey.modifiers].sort().join(",");
  const key = hotkey.code ? normalizeCode(hotkey.code) : (hotkey.key ?? "");
  return `${modifiers}:${key}`.toLowerCase();
}

function normalizeCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Space") return "Space";
  return code;
}
