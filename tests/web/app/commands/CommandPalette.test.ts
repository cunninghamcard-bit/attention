import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { CommandPalette, CommandPaletteCorePlugin } from "@web/app/commands/CommandPalette";
import type { Command } from "@web/app/commands/CommandManager";
import type { InternalPluginWrapper } from "@web/plugin/InternalPluginWrapper";
import type { SettingTab } from "@web/app/SettingRegistry";

describe("CommandPalette Obsidian command execution behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
  });

  it("keeps the choosing event as app.lastEvent while executing the command", () => {
    const app = new App(document.createElement("div"));
    const plugin = new CommandPaletteCorePlugin(app);
    const palette = new CommandPalette(app, plugin);
    const callback = vi.fn();
    const command: Command = { id: "test-command", name: "Test command", callback };
    const event = new KeyboardEvent("keydown", { key: "Enter" });

    palette.onChooseItem(command, event);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(app.lastEvent).toBe(event);
    expect(plugin.recentCommands).toEqual(["test-command"]);
    expect(window.localStorage.getItem("obsidian-reconstructed-recent-commands")).toBe(
      JSON.stringify(["test-command"]),
    );
  });

  it("runs commands through the palette helper without recording recent commands when they throw", () => {
    const app = new App(document.createElement("div"));
    const plugin = new CommandPaletteCorePlugin(app);
    const palette = new CommandPalette(app, plugin);
    const error = new Error("boom");
    const command: Command = {
      id: "throws",
      name: "Throws",
      callback: () => {
        throw error;
      },
    };
    const event = new KeyboardEvent("keydown", { key: "Enter" });

    expect(() => palette.onChooseItem(command, event)).toThrow(error);
    expect(app.lastEvent).toBe(event);
    expect(plugin.recentCommands).toEqual([]);
    expect(window.localStorage.getItem("obsidian-reconstructed-recent-commands")).toBeNull();
  });

  it("orders pinned commands before recent commands and persists recent ids in the app namespace", () => {
    const app = new App(document.createElement("div"));
    const plugin = new CommandPaletteCorePlugin(app);
    app.commands.addCommand({ id: "zeta", name: "Zeta", callback: () => {} });
    app.commands.addCommand({ id: "alpha", name: "Alpha", callback: () => {} });
    app.commands.addCommand({ id: "beta", name: "Beta", callback: () => {} });
    app.commands.addCommand({ id: "pinned", name: "Pinned", callback: () => {} });
    plugin.options.pinned = ["pinned"];
    plugin.recentCommands = ["beta"];

    const commandIds = plugin.getCommands().map((command) => command.id);
    expect(commandIds[0]).toBe("pinned");
    expect(commandIds.indexOf("beta")).toBeLessThan(commandIds.indexOf("alpha"));
    expect(commandIds.indexOf("alpha")).toBeLessThan(commandIds.indexOf("zeta"));

    for (let index = 0; index < 105; index++)
      plugin.recordRecent({ id: `recent-${index}`, name: `Recent ${index}` });

    expect(plugin.recentCommands).toHaveLength(100);
    expect(plugin.recentCommands[0]).toBe("recent-104");
    expect(plugin.recentCommands).not.toContain("recent-4");
    expect(window.localStorage.getItem("obsidian-reconstructed-recent-commands")).toBe(
      JSON.stringify(plugin.recentCommands),
    );
  });

  it("removes app localStorage keys when saving null values", () => {
    const app = new App(document.createElement("div"));

    app.saveLocalStorage("recent-commands", ["alpha"]);
    app.saveLocalStorage("recent-commands", null);

    expect(window.localStorage.getItem("obsidian-reconstructed-recent-commands")).toBeNull();
    expect(app.loadLocalStorage("recent-commands")).toBeNull();
  });

  it("renders default hotkeys from the hotkey manager and custom hotkeys when overridden", () => {
    const app = new App(document.createElement("div"));
    const plugin = new CommandPaletteCorePlugin(app);
    const palette = new CommandPalette(app, plugin);
    app.commands.addCommand({
      id: "hotkey-default",
      name: "Hotkey Default",
      hotkeys: [{ modifiers: ["Mod"], key: "P" }],
    });
    const command = app.commands.findCommand("hotkey-default");
    if (!command) throw new Error("missing command");

    const defaultEl = document.createElement("div");
    palette.renderSuggestion({ item: command, match: { score: 1, matches: [] } }, defaultEl);

    expect(defaultEl.querySelector(".suggestion-hotkey")?.textContent).toBe(
      isMacLike() ? "⌘ P" : "Ctrl + P",
    );
    expect(app.hotkeys.getHotkeys(command.id)).toBeUndefined();
    expect(app.hotkeys.getDefaultHotkeys(command.id)).toEqual([{ modifiers: ["Mod"], key: "P" }]);

    app.hotkeys.setHotkeys(command.id, [{ modifiers: ["Mod", "Shift"], code: "KeyK" }]);
    const customEl = document.createElement("div");
    palette.renderSuggestion({ item: command, match: { score: 1, matches: [] } }, customEl);

    expect(customEl.querySelector(".suggestion-hotkey")?.textContent).toBe(
      isMacLike() ? "⌘ ⇧ K" : "Ctrl + Shift + K",
    );
  });

  it("renders pinned command settings with Obsidian mobile-option rows and drag handles", async () => {
    const app = new App(document.createElement("div"));
    const plugin = new CommandPaletteCorePlugin(app);
    let settingTab: SettingTab | null = null;
    app.commands.addCommand({ id: "alpha", name: "Alpha", callback: () => {} });
    app.commands.addCommand({ id: "beta", name: "Beta", callback: () => {} });
    app.commands.addCommand({ id: "graph-open", name: "Open graph view", callback: () => {} });
    const wrapper = {
      loadData: async () => ({ pinned: ["alpha", "beta"] }),
      saveData: vi.fn(),
      addSettingTab: (tab: SettingTab) => {
        settingTab = tab;
      },
    } as unknown as InternalPluginWrapper;

    await plugin.onEnable(wrapper);
    if (!settingTab) throw new Error("missing setting tab");
    settingTab.display();

    const rows = [
      ...settingTab.containerEl.querySelectorAll<HTMLElement>(".mobile-option-setting-item"),
    ];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".mobile-option-setting-item-name")?.textContent).toBe("Alpha");
    expect(rows[0].querySelector(".clickable-icon .svg-icon.lucide-x")).not.toBeNull();
    expect(
      rows[0].querySelector(".mobile-option-setting-drag-icon .svg-icon.lucide-menu"),
    ).not.toBeNull();
    expect(rows[0].querySelector<HTMLElement>(".clickable-icon")?.dataset.icon).toBeUndefined();

    rows[0].querySelector<HTMLElement>(".clickable-icon")?.click();
    expect(plugin.options.pinned).toEqual(["beta"]);

    const search = settingTab.containerEl.querySelector<HTMLInputElement>(".prompt-input");
    if (!search) throw new Error("missing search");
    search.value = "ogv";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(
      [
        ...settingTab.containerEl.querySelectorAll<HTMLElement>(
          ".command-palette-pin-results .suggestion-item",
        ),
      ].map((item) => item.textContent),
    ).toEqual(["Open graph view"]);

    plugin.setPinned(["alpha", "beta"]);
    settingTab.display();
    const dragHandle = settingTab.containerEl.querySelector<HTMLElement>(
      ".mobile-option-setting-drag-icon",
    );
    const targetRow = settingTab.containerEl.querySelectorAll<HTMLElement>(
      ".mobile-option-setting-item",
    )[1];
    if (!dragHandle || !targetRow) throw new Error("missing drag controls");
    const dataTransfer = createDataTransfer();
    dispatchDragEvent(dragHandle, "dragstart", dataTransfer);
    dispatchDragEvent(targetRow, "drop", dataTransfer);

    expect(plugin.options.pinned).toEqual(["beta", "alpha"]);
  });
});

function isMacLike(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => {
      values.set(type, value);
    },
  } as unknown as DataTransfer;
}

function dispatchDragEvent(target: HTMLElement, type: string, dataTransfer: DataTransfer): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  target.dispatchEvent(event);
}
