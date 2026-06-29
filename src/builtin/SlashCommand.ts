import type { App } from "../app/App";
import { formatHotkey, getDisplayHotkeys } from "../commands/CommandPalette";
import { runCommandCallback, type Command } from "../commands/CommandManager";
import type { Editor, EditorPosition } from "../editor/Editor";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { EditorSuggest, type EditorSuggestContext, type EditorSuggestTriggerInfo } from "../suggest/EditorSuggest";
import { fuzzyMatch, prepareFuzzyQuery, renderFuzzyText, sortFuzzySuggestions, type FuzzySuggestion } from "../suggest/SuggestModal";
import { setIcon } from "../ui/Icon";

const TRIGGER = /(^|\s)\/([^\s/]*)$/;

type SlashCommandSuggestion = FuzzySuggestion<Command>;

class SlashCommandSuggest extends EditorSuggest<SlashCommandSuggestion> {
  constructor(app: App) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const prefix = editor.getLine(cursor.line).slice(0, cursor.ch);
    const match = prefix.match(TRIGGER);
    if (!match) return null;
    const query = match[2] ?? "";
    const startCh = cursor.ch - query.length - 1;
    return {
      query,
      start: { line: cursor.line, ch: startCh },
      end: cursor,
    };
  }

  getSuggestions(context: EditorSuggestContext): SlashCommandSuggestion[] {
    const commands = getCommandPaletteCommands(this.app);
    const fuzzyQuery = prepareFuzzyQuery(context.query);
    const suggestions = commands.flatMap((command) => {
      const match = fuzzyMatch(fuzzyQuery, command.name);
      return match ? [{ item: command, match }] : [];
    });
    sortFuzzySuggestions(suggestions);
    return suggestions;
  }

  renderSuggestion(value: SlashCommandSuggestion, el: HTMLElement): void {
    el.classList.add("mod-complex");
    const contentEl = document.createElement("span");
    contentEl.className = "suggestion-content";
    const auxEl = document.createElement("span");
    auxEl.className = "suggestion-aux";
    const titleEl = document.createElement("div");
    titleEl.className = "suggestion-title";
    const command = value.item;
    const split = command.name.indexOf(": ");
    if (split !== -1) {
      const prefixEl = document.createElement("span");
      prefixEl.className = "suggestion-prefix";
      renderFuzzyText(prefixEl, command.name.slice(0, split), value.match);
      titleEl.appendChild(prefixEl);
      renderFuzzyText(titleEl, command.name.slice(split + 2), value.match, -(split + 2));
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
    const plugin = getCommandPalettePlugin(this.app);
    if (plugin.options.pinned?.includes(command.id)) {
      const pinnedEl = document.createElement("span");
      pinnedEl.className = "suggestion-flair";
      setIcon(pinnedEl, "lucide-pin");
      auxEl.appendChild(pinnedEl);
    }
    el.append(contentEl, auxEl);
  }

  selectSuggestion(value: SlashCommandSuggestion, event: MouseEvent | KeyboardEvent): void {
    const context = this.context;
    if (!context) return;
    this.close();
    this.app.lastEvent = event;
    context.editor.replaceRange("", context.start, context.end);
    runCommandCallback(value.item);
  }
}

export function createSlashCommandPluginDefinition(): InternalPluginDefinition {
  let suggest: SlashCommandSuggest | null = null;
  return {
    id: "slash-command",
    name: "Slash commands",
    description: "Use slash commands in the editor.",
    defaultOn: false,
    init(app: App, plugin: InternalPluginWrapper) {
      suggest = new SlashCommandSuggest(app);
      plugin.instance = suggest;
    },
    onEnable(app: App) {
      if (suggest) app.workspace.editorSuggest.addSuggest(suggest);
    },
    onDisable(app: App) {
      if (suggest) app.workspace.editorSuggest.removeSuggest(suggest);
    },
  };
}

interface CommandPalettePluginLike {
  getCommands?: () => Command[];
  options: { pinned?: string[] | null };
}

function getCommandPalettePlugin(app: App): CommandPalettePluginLike {
  const wrapper = app.internalPlugins.getPluginById("command-palette");
  const instance = wrapper?.instance as Partial<CommandPalettePluginLike> | null | undefined;
  return {
    getCommands: instance?.getCommands?.bind(instance),
    options: instance?.options ?? {},
  };
}

function getCommandPaletteCommands(app: App): Command[] {
  return getCommandPalettePlugin(app).getCommands?.() ?? app.commands.listCommands();
}
