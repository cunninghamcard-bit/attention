import { describe, expect, it, vi } from "vitest";

import { App } from "@web/app/App";
import { createCommandPalettePluginDefinition } from "@web/app/commands/CommandPalette";
import type { Command } from "@web/app/commands/CommandManager";
import type { Editor } from "@web/editor/Editor";
import type { EditorSuggestContext } from "@web/ui/suggest/EditorSuggest";
import type { FuzzySuggestion } from "@web/ui/suggest/SuggestModal";
import { createSlashCommandPluginDefinition } from "@web/builtin/SlashCommand";

interface SlashSuggestHarness {
  context: EditorSuggestContext | null;
  getSuggestions(context: EditorSuggestContext): FuzzySuggestion<Command>[];
  renderSuggestion(value: FuzzySuggestion<Command>, el: HTMLElement): void;
  selectSuggestion(value: FuzzySuggestion<Command>, event: MouseEvent | KeyboardEvent): void;
}

describe("SlashCommand Obsidian command-palette bridge", () => {
  it("uses the registered command-palette instance as its suggestion source", () => {
    const app = createAppWithCorePlugins();
    const palette = app.internalPlugins.getPluginById("command-palette")?.instance as { getCommands: () => Command[] };
    const slash = getSlashSuggest(app);
    const command: Command = { id: "palette-only", name: "Palette Only", callback: () => {} };
    const getCommands = vi.fn(() => [command]);
    palette.getCommands = getCommands;

    const suggestions = slash.getSuggestions(makeContext("palette"));

    expect(getCommands).toHaveBeenCalledTimes(1);
    expect(suggestions.map((suggestion) => suggestion.item.id)).toEqual(["palette-only"]);
  });

  it("renders fuzzy command suggestions with default hotkeys and pinned flair", () => {
    const app = createAppWithCorePlugins();
    const palette = app.internalPlugins.getPluginById("command-palette")?.instance as { options: { pinned?: string[] | null } };
    const slash = getSlashSuggest(app);
    app.commands.addCommand({
      id: "palette:custom",
      name: "Palette: Custom",
      callback: () => {},
      hotkeys: [{ modifiers: ["Mod"], key: "P" }],
    });
    palette.options.pinned = ["palette:custom"];

    const [suggestion] = slash.getSuggestions(makeContext("custom"));
    const el = document.createElement("div");
    slash.renderSuggestion(suggestion, el);

    expect(el.querySelector(".suggestion-prefix")?.textContent).toBe("Palette");
    expect(el.querySelector(".suggestion-hotkey")?.textContent).toMatch(/P$/);
    expect(el.querySelector(".suggestion-flair .svg-icon.lucide-pin")).not.toBeNull();
  });

  it("selects by clearing the slash text and running the raw command helper without recording recent commands", () => {
    const app = createAppWithCorePlugins();
    const palette = app.internalPlugins.getPluginById("command-palette")?.instance as { recentCommands: string[] };
    const slash = getSlashSuggest(app);
    const callback = vi.fn();
    const editor = { replaceRange: vi.fn() } as unknown as Editor;
    const context = makeContext("raw", editor);
    const command: Command = { id: "raw-command", name: "Raw command", callback };
    const event = new KeyboardEvent("keydown", { key: "Enter" });
    slash.context = context;

    slash.selectSuggestion({ item: command, match: { score: 1, matches: [] } }, event);

    expect(editor.replaceRange).toHaveBeenCalledWith("", context.start, context.end);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(app.lastEvent).toBe(event);
    expect(palette.recentCommands).toEqual([]);
  });
});

function createAppWithCorePlugins(): App {
  const app = new App(document.createElement("div"));
  if (!app.internalPlugins.getPluginById("command-palette")) {
    app.internalPlugins.register(createCommandPalettePluginDefinition());
  }
  if (!app.internalPlugins.getPluginById("slash-command")) {
    app.internalPlugins.register(createSlashCommandPluginDefinition());
  }
  return app;
}

function getSlashSuggest(app: App): SlashSuggestHarness {
  const instance = app.internalPlugins.getPluginById("slash-command")?.instance;
  if (!instance) throw new Error("missing slash-command instance");
  return instance as SlashSuggestHarness;
}

function makeContext(query: string, editor: Editor = { replaceRange: vi.fn() } as unknown as Editor): EditorSuggestContext {
  return {
    editor,
    file: null,
    query,
    start: { line: 0, ch: 0 },
    end: { line: 0, ch: query.length + 1 },
  };
}
