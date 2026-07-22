import type { App } from "../App";
import { runCommandCallback, type Command } from "./CommandManager";
import {
  FuzzySuggestModal,
  fuzzyMatch,
  prepareFuzzyQuery,
  type FuzzySuggestion,
  renderFuzzyText,
  sortFuzzySuggestions,
} from "../../ui/suggest/SuggestModal";
import type { InternalPluginDefinition } from "../../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../../plugin/InternalPluginWrapper";
import type { SettingTab } from "../SettingRegistry";
import type { Hotkey } from "../hotkeys/Keymap";
import { setIcon } from "../../ui/Icon";
import { setTooltip } from "../../ui/Popover";

export interface CommandPaletteOptions {
  pinned?: string[] | null;
}

export class CommandPaletteCorePlugin {
  readonly id = "command-palette";
  readonly name = "Command palette";
  readonly description = "Quickly run commands by typing their names.";
  readonly defaultOn = true;
  modal: CommandPalette | null = null;
  options: CommandPaletteOptions = {};
  recentCommands: string[] = [];
  plugin: InternalPluginWrapper | null = null;

  constructor(readonly app: App) {}

  init(plugin: InternalPluginWrapper): void {
    this.plugin = plugin;
    plugin.instance = this;
    const openCallback = this.onOpen.bind(this);
    plugin.registerRibbonItem("Open command palette", "lucide-terminal", openCallback);
    plugin.registerGlobalCommand({
      id: "command-palette:open",
      name: "Open command palette",
      icon: "lucide-terminal-square",
      callback: openCallback,
      hotkeys: [{ modifiers: ["Mod"], key: "P" }],
      showOnMobileToolbar: true,
    });
  }

  async onEnable(plugin: InternalPluginWrapper): Promise<void> {
    this.modal = new CommandPalette(this.app, this);
    this.options = { ...(await plugin.loadData<CommandPaletteOptions>()) };
    const recent = this.app.loadLocalStorage<string[]>("recent-commands");
    if (Array.isArray(recent)) this.recentCommands = recent;
    plugin.addSettingTab(new CommandPaletteSettingTab(this.app, plugin, this));
  }

  onDisable(): void {
    this.modal?.close();
    this.modal = null;
  }

  async onExternalSettingsChange(): Promise<void> {
    this.options = { ...(await this.plugin?.loadData<CommandPaletteOptions>()) };
  }

  async saveSettings(): Promise<void> {
    await this.plugin?.saveData(this.options);
    this.app.saveLocalStorage("recent-commands", this.recentCommands);
  }

  onOpen(): void {
    this.modal?.open();
  }

  getCommands(): Command[] {
    let commands = this.app.commands.listCommands();
    const pinnedIds = this.options.pinned ?? [];
    const pinned: Command[] = [];

    if (pinnedIds.length > 0) {
      const pinnedSet = new Set(pinnedIds);
      const rest: Command[] = [];
      for (const command of commands) {
        if (pinnedSet.has(command.id)) pinned.push(command);
        else rest.push(command);
      }
      orderByIds(pinned, pinnedIds);
      commands = rest;
    }

    commands.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
    );
    orderByIds(commands, this.recentCommands);
    return [...pinned, ...commands];
  }

  recordRecent(command: Command): void {
    this.recentCommands = this.recentCommands.filter((id) => id !== command.id);
    this.recentCommands.unshift(command.id);
    if (this.recentCommands.length > 100) this.recentCommands.length = 100;
    this.app.saveLocalStorage("recent-commands", this.recentCommands);
  }

  setPinned(ids: string[]): void {
    this.options.pinned = ids.length > 0 ? ids : null;
    void this.saveSettings();
  }
}

export class CommandPalette extends FuzzySuggestModal<Command> {
  private commands: Command[] | null = null;

  constructor(
    app: App,
    readonly plugin: CommandPaletteCorePlugin,
  ) {
    super(app);
    this.emptyStateText = "No commands found";
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to use" },
      { command: "esc", purpose: "to dismiss" },
    ]);
    this.setPlaceholder("Type a command...");
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Tab") event.preventDefault();
    });
  }

  onOpen(): void {
    this.commands = null;
    super.onOpen();
  }

  onClose(): void {
    this.commands = null;
    super.onClose();
  }

  getItems(): Command[] {
    this.commands ??= this.plugin.getCommands();
    return this.commands;
  }

  getItemText(item: Command): string {
    return item.name;
  }

  renderSuggestion(value: FuzzySuggestion<Command>, el: HTMLElement): void {
    el.classList.add("mod-complex");
    const contentEl = document.createElement("span");
    contentEl.className = "suggestion-content";
    const auxEl = document.createElement("span");
    auxEl.className = "suggestion-aux";
    const titleEl = document.createElement("div");
    titleEl.className = "suggestion-title";

    const command = value.item;
    const separatorIndex = command.name.indexOf(": ");
    if (separatorIndex !== -1) {
      const prefixText = command.name.slice(0, separatorIndex);
      const titleText = command.name.slice(separatorIndex + 2);
      const prefixEl = document.createElement("span");
      prefixEl.className = "suggestion-prefix";
      renderFuzzyText(prefixEl, prefixText, value.match);
      titleEl.appendChild(prefixEl);
      renderFuzzyText(titleEl, titleText, value.match, -(separatorIndex + 2));
    } else {
      renderFuzzyText(titleEl, command.name, value.match);
    }

    contentEl.appendChild(titleEl);
    for (const hotkey of getDisplayHotkeys(this.app, command)) {
      const hotkeyEl = document.createElement("kbd");
      hotkeyEl.className = "suggestion-hotkey";
      hotkeyEl.textContent = formatHotkey(hotkey);
      auxEl.appendChild(hotkeyEl);
    }

    if (this.plugin.options.pinned?.includes(command.id)) {
      const pinnedEl = document.createElement("span");
      pinnedEl.className = "suggestion-flair";
      setIcon(pinnedEl, "lucide-pin");
      pinnedEl.append("Pinned");
      auxEl.appendChild(pinnedEl);
    }

    el.append(contentEl, auxEl);
  }

  onChooseItem(item: Command, event: MouseEvent | KeyboardEvent): void {
    this.app.lastEvent = event;
    runCommandCallback(item);
    this.plugin.recordRecent(item);
  }
}

class CommandPaletteSettingTab implements SettingTab {
  id = "command-palette";
  name = "Command palette";
  icon = "lucide-terminal-square";
  section = "core-plugins" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");

  constructor(
    readonly app: App,
    readonly wrapper: InternalPluginWrapper,
    readonly plugin: CommandPaletteCorePlugin,
  ) {
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
  }

  display(): void {
    const contentEl = this.containerEl;
    contentEl.replaceChildren();
    contentEl.className = "vertical-tab-content command-palette-settings";
    const heading = document.createElement("h2");
    heading.textContent = "Pinned commands";
    const search = document.createElement("input");
    search.className = "prompt-input";
    search.placeholder = "Type a command...";
    const resultsEl = document.createElement("div");
    resultsEl.className = "suggestion-container command-palette-pin-results";
    const pinnedEl = document.createElement("div");
    pinnedEl.className = "command-palette-pinned-list";
    contentEl.append(heading, search, resultsEl, pinnedEl);

    const renderPinned = () => {
      pinnedEl.replaceChildren();
      const ids = this.plugin.options.pinned ?? [];
      if (ids.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "mobile-option-setting-item";
        emptyEl.textContent = "No commands";
        pinnedEl.appendChild(emptyEl);
        return;
      }
      for (const [index, id] of ids.entries()) {
        const command = this.app.commands.findCommand(id);
        const itemEl = document.createElement("div");
        itemEl.className = "mobile-option-setting-item";
        itemEl.addEventListener("dragover", (event) => event.preventDefault());
        itemEl.addEventListener("drop", (event) => {
          event.preventDefault();
          const draggedId = event.dataTransfer?.getData("text/plain") || "";
          reorderPinned(this.plugin.options.pinned ?? [], draggedId, index, this.plugin);
          renderPinned();
        });
        const nameEl = document.createElement("div");
        nameEl.className = "mobile-option-setting-item-name";
        nameEl.textContent = command?.name ?? id;
        const deleteEl = makeIconButton("lucide-x", "Delete", () => {
          removePinned(ids, id, this.plugin);
          renderPinned();
        });
        const dragEl = makeIconButton("lucide-menu", "Drag to rearrange");
        dragEl.classList.add("mobile-option-setting-drag-icon");
        dragEl.draggable = true;
        dragEl.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("text/plain", id);
        });
        itemEl.append(nameEl, deleteEl, dragEl);
        pinnedEl.appendChild(itemEl);
      }
    };

    const renderResults = () => {
      resultsEl.replaceChildren();
      const query = search.value.trim();
      if (!query) return;
      const pinned = new Set(this.plugin.options.pinned ?? []);
      const fuzzyQuery = prepareFuzzyQuery(query);
      const matches = this.plugin.getCommands().flatMap((command) => {
        if (pinned.has(command.id)) return [];
        const match = fuzzyMatch(fuzzyQuery, command.name);
        return match ? [{ item: command, match }] : [];
      });
      sortFuzzySuggestions(matches);
      for (const { item: command } of matches.slice(0, 20)) {
        const itemEl = document.createElement("div");
        itemEl.className = "suggestion-item";
        itemEl.textContent = command.name;
        itemEl.addEventListener("click", () => {
          this.plugin.setPinned([...(this.plugin.options.pinned ?? []), command.id]);
          search.value = "";
          renderResults();
          renderPinned();
        });
        resultsEl.appendChild(itemEl);
      }
    };

    search.addEventListener("input", renderResults);
    renderPinned();
  }

  hide(): void {
    this.containerEl.remove();
  }
}

export function getDisplayHotkeys(app: App, command: Command): readonly Hotkey[] {
  return app.hotkeys.hasHotkeyOverride(command.id)
    ? (app.hotkeys.getHotkeys(command.id) ?? [])
    : (app.hotkeys.getDefaultHotkeys(command.id) ?? []);
}

export function formatHotkey(hotkey: Hotkey): string {
  const labels = [];
  for (const modifier of ["Mod", "Ctrl", "Meta", "Alt", "Shift"]) {
    if (hotkey.modifiers.includes(modifier)) labels.push(formatModifier(modifier));
  }
  labels.push(formatHotkeyKey(hotkey.code ? normalizeCode(hotkey.code) : (hotkey.key ?? "")));
  return labels.join(isMacLike() ? " " : " + ");
}

function formatModifier(modifier: string): string {
  const macLabels: Record<string, string> = {
    Mod: "⌘",
    Ctrl: "⌃",
    Meta: "⌘",
    Alt: "⌥",
    Shift: "⇧",
  };
  const desktopLabels: Record<string, string> = {
    Mod: "Ctrl",
    Ctrl: "Ctrl",
    Meta: "Win",
    Alt: "Alt",
    Shift: "Shift",
  };
  return (isMacLike() ? macLabels : desktopLabels)[modifier] ?? modifier;
}

function formatHotkeyKey(key: string): string {
  const labels: Record<string, string> = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    " ": "Space",
  };
  if (labels[key]) return labels[key];
  const spaced = key.replace(/([A-Z])/g, " $1").trim();
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
}

function normalizeCode(code: string): string {
  return code.startsWith("Key") && code.length === 4 ? code.charAt(3) : code;
}

function isMacLike(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

function orderByIds(commands: Command[], ids: readonly string[]): void {
  const order = new Map(ids.map((id, index) => [id, index]));
  commands.sort(
    (a, b) =>
      (order.get(a.id) ?? Number.POSITIVE_INFINITY) - (order.get(b.id) ?? Number.POSITIVE_INFINITY),
  );
}

function makeIconButton(icon: string, label: string, onClick?: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "clickable-icon";
  setIcon(button, icon);
  setTooltip(button, label);
  if (onClick) button.addEventListener("click", onClick);
  return button;
}

function reorderPinned(
  ids: readonly string[],
  id: string,
  targetIndex: number,
  plugin: CommandPaletteCorePlugin,
): void {
  const next = [...ids];
  const from = next.indexOf(id);
  if (from === -1 || targetIndex < 0 || targetIndex >= next.length || from === targetIndex) return;
  const [item] = next.splice(from, 1);
  next.splice(targetIndex, 0, item);
  plugin.setPinned(next);
}

function removePinned(ids: readonly string[], id: string, plugin: CommandPaletteCorePlugin): void {
  plugin.setPinned(ids.filter((item) => item !== id));
}

export function createCommandPalettePluginDefinition(): InternalPluginDefinition {
  let controller: CommandPaletteCorePlugin | null = null;
  return {
    id: "command-palette",
    name: "Command palette",
    description: "Quickly run commands by typing their names.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new CommandPaletteCorePlugin(app);
      controller.init(plugin);
    },
    async onEnable(_app: App, plugin: InternalPluginWrapper) {
      await controller?.onEnable(plugin);
    },
    onDisable() {
      controller?.onDisable();
    },
  };
}
