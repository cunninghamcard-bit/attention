import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { Events } from "@web/core/Events";
import { SimpleEditor } from "@web/editor/Editor";
import { HotkeyManager } from "@web/app/hotkeys/HotkeyManager";
import { Platform } from "@web/platform/Platform";
import { DynamicScope, Scope } from "@web/app/hotkeys/Scope";
import { Menu } from "@web/ui/Menu";
import type { View } from "@web/views/View";
import { MarkdownView } from "@web/views/MarkdownView";
import { CommandManager } from "@web/app/commands/CommandManager";

function markdownViewStub(fields: Record<string, unknown>): MarkdownView {
  return Object.assign(Object.create(MarkdownView.prototype), fields) as MarkdownView;
}

describe("CommandManager plugin command behavior", () => {
  it("filters and executes editor commands through the active editor context", async () => {
    const commands = new CommandManager();
    const editor = new SimpleEditor();
    const view = { getViewType: () => "markdown" } as unknown as View;
    const callback = vi.fn();

    commands.addCommand({
      id: "plugin:editor-command",
      name: "Editor command",
      editorCheckCallback: (checking, activeEditor, activeView) => {
        expect(activeEditor).toBe(editor);
        expect(activeView).toBe(view);
        if (!checking) callback();
        return true;
      },
    });

    expect(commands.listCommands()).toHaveLength(0);

    commands.setEditorContextProvider(() => ({ editor, view }));

    expect(commands.listCommands().map((command) => command.id)).toEqual(["plugin:editor-command"]);
    expect(await commands.executeCommandById("plugin:editor-command")).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("treats checkCallback execution as handled even when the callback returns false", async () => {
    const commands = new CommandManager();
    const callback = vi.fn(() => false);
    commands.addCommand({ id: "guarded", name: "Guarded", checkCallback: callback });

    expect(commands.listCommands()).toEqual([]);
    expect(await commands.executeCommandById("guarded")).toBe(true);
    expect(callback).toHaveBeenCalledWith(false);
  });

  it("uses JavaScript truthiness for command availability checks", () => {
    const commands = new CommandManager();
    commands.addCommand({
      id: "truthy",
      name: "Truthy",
      checkCallback: (() => 1) as unknown as (checking: boolean) => boolean,
    });

    expect(commands.listCommands().map((command) => command.id)).toEqual(["truthy"]);
  });

  it("uses JavaScript truthiness for async command checks", () => {
    const commands = new CommandManager();

    commands.addCommand({
      id: "async-check",
      name: "Async Check",
      checkCallback: (() => Promise.resolve(false)) as unknown as () => boolean,
    });

    expect(commands.listCommands().map((command) => command.id)).toEqual(["async-check"]);
  });

  it("uses JavaScript truthiness for async editor command checks", () => {
    const commands = new CommandManager();
    const editor = new SimpleEditor();
    const view = { getViewType: () => "markdown" } as unknown as View;
    commands.setEditorContextProvider(() => ({ editor, view }));

    commands.addCommand({
      id: "async-editor-check",
      name: "Async Editor Check",
      editorCheckCallback: (() => Promise.resolve(false)) as unknown as () => boolean,
    });

    expect(commands.listCommands().map((command) => command.id)).toEqual(["async-editor-check"]);
  });

  it("exposes Obsidian-style command and editor command indexes", () => {
    const commands = new CommandManager();
    commands.addCommand({ id: "plain", name: "Plain", callback: () => {} });
    commands.addCommand({ id: "editor", name: "Editor", editorCallback: () => {} });
    commands.addCommand({ id: "toolbar", name: "Toolbar", showOnMobileToolbar: true, callback: () => {} });

    expect(commands.commands.plain?.name).toBe("Plain");
    expect(commands.commands.editor).toBe(commands.findCommand("editor"));
    expect(commands.editorCommands.editor).toBe(commands.findCommand("editor"));
    expect(commands.editorCommands.toolbar).toBe(commands.findCommand("toolbar"));
    expect(commands.findCommand("missing")).toBeUndefined();
    expect("lastExecuted" in commands).toBe(false);
    expect(Object.keys(commands.commands)).toEqual(["plain", "editor", "toolbar"]);

    commands.removeCommand("editor");

    expect(commands.commands.editor).toBeUndefined();
    expect(commands.editorCommands.editor).toBeUndefined();
  });

  it("only notifies hotkey changes when Obsidian command hotkeys actually change", () => {
    const hotkeys = new HotkeyManager();
    const onCommandsChanged = vi.spyOn(hotkeys, "onCommandsChanged");
    const commands = new CommandManager(hotkeys);

    commands.addCommand({ id: "plain", name: "Plain", callback: () => {} });
    commands.removeCommand("missing");

    expect(onCommandsChanged).not.toHaveBeenCalled();
  });

  it("executes commands synchronously and records only explicit command events", async () => {
    const app = { lastEvent: null };
    const commands = new CommandManager(undefined, app);
    const log: string[] = [];
    const event = new MouseEvent("click");
    commands.addCommand({
      id: "async",
      name: "Async",
      callback: () => Promise.resolve().then(() => {
        log.push("settled");
      }),
    });
    commands.addCommand({ id: "empty", name: "Empty" });

    expect(commands.executeCommandById("async", event)).toBe(true);
    expect(app.lastEvent).toBe(event);
    expect(log).toEqual([]);
    await Promise.resolve();
    expect(log).toEqual(["settled"]);
    expect(commands.executeCommandById("empty")).toBe(true);
    expect(app.lastEvent).toBeNull();
  });

  it("gates editor commands in preview, inline title and metadata focus contexts", async () => {
    const editor = new SimpleEditor();
    const callback = vi.fn();
    const commands = new CommandManager();
    const previewView = { getMode: () => "preview" } as unknown as View;
    commands.setEditorContextProvider(() => ({ editor, view: previewView }));
    commands.addCommand({ id: "editor", name: "Editor", editorCallback: callback });
    commands.addCommand({ id: "preview", name: "Preview", allowPreview: true, editorCallback: callback });

    expect(commands.listCommands().map((command) => command.id)).toEqual(["preview"]);
    expect(await commands.executeCommandById("editor")).toBe(true);
    expect(callback).not.toHaveBeenCalled();
    expect(await commands.executeCommandById("preview")).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);

    const inlineTitleEl = document.createElement("div");
    inlineTitleEl.tabIndex = -1;
    document.body.appendChild(inlineTitleEl);
    inlineTitleEl.focus();
    const inlineTitleView = markdownViewStub({ getMode: () => "source", inlineTitleEl });
    commands.setEditorContextProvider(() => ({ editor, view: inlineTitleView }));

    expect(commands.listCommands().map((command) => command.id)).toEqual([]);

    const metadataContainerEl = document.createElement("div");
    metadataContainerEl.className = "metadata-container";
    const metadataInput = document.createElement("input");
    metadataContainerEl.appendChild(metadataInput);
    document.body.appendChild(metadataContainerEl);
    metadataInput.focus();
    const metadataView = markdownViewStub({ getMode: () => "source" });
    commands.setEditorContextProvider(() => ({ editor, view: metadataView }));
    commands.addCommand({ id: "properties", name: "Properties", allowProperties: true, editorCallback: callback });

    expect(commands.listCommands().map((command) => command.id)).toEqual(["properties"]);

    inlineTitleEl.remove();
    metadataContainerEl.remove();
  });

  it("limits title and metadata focus suppression to markdown editor views", () => {
    const editor = new SimpleEditor();
    const callback = vi.fn();
    const commands = new CommandManager();
    const titleEl = document.createElement("div");
    titleEl.tabIndex = -1;
    document.body.appendChild(titleEl);
    titleEl.focus();
    commands.addCommand({ id: "editor", name: "Editor", editorCallback: callback });
    commands.setEditorContextProvider(() => ({
      editor,
      view: { getMode: () => "source", getViewType: () => "custom", titleEl } as unknown as View,
    }));

    expect(commands.listCommands().map((command) => command.id)).toEqual(["editor"]);

    titleEl.remove();
  });

  it("uses active metadata-container fallback for markdown editor command gating", () => {
    const editor = new SimpleEditor();
    const commands = new CommandManager();
    const metadataContainerEl = document.createElement("div");
    metadataContainerEl.className = "metadata-container";
    const input = document.createElement("input");
    metadataContainerEl.appendChild(input);
    document.body.appendChild(metadataContainerEl);
    input.focus();
    commands.addCommand({ id: "editor", name: "Editor", editorCallback: () => {} });
    commands.addCommand({ id: "properties", name: "Properties", allowProperties: true, editorCallback: () => {} });
    commands.setEditorContextProvider(() => ({
      editor,
      view: markdownViewStub({ getMode: () => "source" }),
    }));

    expect(commands.listCommands().map((command) => command.id)).toEqual(["properties"]);

    metadataContainerEl.remove();
  });

  it("uses the markdown view document when blocking metadata-focused editor commands", () => {
    const popout = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
    try {
      const editor = new SimpleEditor();
      const commands = new CommandManager();
      const titleEl = popout.window.document.createElement("div");
      const metadataContainerEl = popout.window.document.createElement("div");
      metadataContainerEl.className = "metadata-container";
      const input = popout.window.document.createElement("input");
      metadataContainerEl.appendChild(input);
      popout.window.document.body.append(titleEl, metadataContainerEl);
      input.focus();
      commands.addCommand({ id: "editor", name: "Editor", editorCallback: () => {} });
      commands.addCommand({ id: "properties", name: "Properties", allowProperties: true, editorCallback: () => {} });
      commands.setEditorContextProvider(() => ({
        editor,
        view: markdownViewStub({ getMode: () => "source", titleEl }),
      }));

      expect(commands.listCommands().map((command) => command.id)).toEqual(["properties"]);
    } finally {
      popout.window.close();
    }
  });

  it("matches explicit control/meta modifiers and platform mod hotkeys", () => {
    const manager = new HotkeyManager();
    const commands = [
      { id: "ctrl", name: "Control", hotkeys: [{ modifiers: ["Ctrl"], key: "K" }] },
      { id: "meta", name: "Meta", hotkeys: [{ modifiers: ["Meta"], key: "K" }] },
      { id: "mod", name: "Mod", hotkeys: [{ modifiers: ["Mod", "Shift"], key: "P" }] },
    ];

    expect(manager.findMatchingCommand(keyboardEvent("k", { ctrlKey: true }), commands)?.id).toBe("ctrl");
    expect(manager.findMatchingCommand(keyboardEvent("k", { metaKey: true }), commands)?.id).toBe("meta");
    const modEvent = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
      ? keyboardEvent("p", { metaKey: true, shiftKey: true })
      : keyboardEvent("p", { ctrlKey: true, shiftKey: true });
    expect(manager.findMatchingCommand(modEvent, commands)?.id).toBe("mod");
  });

  it("bakes custom hotkeys over defaults before matching commands", () => {
    const manager = new HotkeyManager();
    const commands = [{ id: "open", name: "Open" }];
    manager.addDefaultHotkeys("open", [{ modifiers: ["Mod"], key: "O" }]);

    expect(manager.findMatchingCommand(modKey("o"), commands)?.id).toBe("open");

    manager.setHotkeys("open", [{ modifiers: ["Mod", "Shift"], key: "O" }]);

    expect(manager.findMatchingCommand(modKey("o"), commands)).toBeNull();
    expect(manager.findMatchingCommand(modKey("o", { shiftKey: true }), commands)?.id).toBe("open");
    expect(manager.getDefaultHotkeys("open")).toEqual([{ modifiers: ["Mod"], key: "O" }]);
    expect(manager.getCustomHotkeys("open")).toEqual([{ modifiers: ["Mod", "Shift"], key: "O" }]);
  });

  it("prioritizes custom hotkeys before conflicting default hotkeys across commands", () => {
    const manager = new HotkeyManager();
    const commands = [
      { id: "default-open", name: "Default open" },
      { id: "custom-open", name: "Custom open" },
    ];
    manager.addDefaultHotkeys("default-open", [{ modifiers: ["Mod"], key: "O" }]);
    manager.setHotkeys("custom-open", [{ modifiers: ["Mod"], key: "O" }]);

    expect(manager.findMatchingCommand(modKey("o"), commands)?.id).toBe("custom-open");
  });

  it("prints Obsidian hotkey labels from custom keys before defaults", () => {
    const manager = new HotkeyManager();
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
    manager.addDefaultHotkeys("open", [{ modifiers: ["Mod"], key: "O" }]);

    expect(manager.printHotkeyForCommand("missing")).toBe("");
    expect(manager.printHotkeyForCommand("open")).toBe(isMac ? "⌘ O" : "Ctrl + O");

    manager.setHotkeys("open", [{ modifiers: ["Mod", "Shift"], code: "KeyP" }]);

    expect(manager.printHotkeyForCommand("open")).toBe(isMac ? "⌘ ⇧ P" : "Ctrl + Shift + P");
    expect(manager.customKeys).toEqual({ open: [{ modifiers: ["Mod", "Shift"], code: "KeyP" }] });

    const customKeys = manager.customKeys;
    customKeys.open = [];

    expect(manager.getCustomHotkeys("open")).toEqual([{ modifiers: ["Mod", "Shift"], code: "KeyP" }]);

    manager.clearHotkeys("open");

    expect(manager.printHotkeyForCommand("open")).toBe("");
  });

  it("routes root-scope key events through HotkeyManager onTrigger", () => {
    const scope = new Scope();
    const vaultEvents = new Events();
    const command = { id: "open", name: "Open", hotkeys: [{ modifiers: ["Mod"], key: "O" }] };
    const executeCommand = vi.fn((_command: unknown, _event?: Event) => true);
    const manager = new HotkeyManager({
      scope,
      vault: vaultEvents,
      commands: {
        listCommands: () => [command],
        getCommands: () => [command],
        findCommand: (id: string) => id === command.id ? command : null,
        executeCommand,
      },
    } as never);
    manager.registerListeners();

    const event = modKey("o");

    expect(scope.handleKey(event)).toBe(false);
    expect(executeCommand).toHaveBeenCalledWith(command);

    manager.unregisterListeners();
    expect(scope.keys).toHaveLength(1);
  });

  it("matches Obsidian scope propagation for generic and specific handlers", () => {
    const parent = new Scope();
    const child = new Scope(parent);
    const generic = vi.fn();
    const specific = vi.fn();
    const parentHandler = vi.fn(() => false);
    child.register(null, null, generic);
    child.register(["Mod"], "O", specific);
    parent.register(["Mod"], "O", parentHandler);

    expect(child.handleKey(modKey("o"))).toBeUndefined();
    expect(generic).toHaveBeenCalledTimes(1);
    expect(specific).toHaveBeenCalledTimes(1);
    expect(parentHandler).not.toHaveBeenCalled();

    child.unregister(child.keys[1]);
    expect(child.handleKey(modKey("o"))).toBe(false);
    expect(parentHandler).toHaveBeenCalledTimes(1);
  });

  it("does not fall back from DynamicScope when the provided scope returns undefined", () => {
    const parent = new Scope();
    const provided = new Scope();
    const dynamic = new DynamicScope(parent, () => provided);
    const parentHandler = vi.fn(() => false);
    parent.register(["Mod"], "O", parentHandler);

    expect(dynamic.handleKey(modKey("o"))).toBeUndefined();
    expect(parentHandler).not.toHaveBeenCalled();
  });

  it("executes the first matching hotkey command without availability prefiltering", () => {
    const scope = new Scope();
    const vaultEvents = new Events();
    const blocked = { id: "blocked", name: "Blocked", hotkeys: [{ modifiers: ["Mod"], key: "O" }] };
    const open = { id: "open", name: "Open", hotkeys: [{ modifiers: ["Mod"], key: "O" }] };
    const executeCommand = vi.fn((_command: unknown, _event?: Event) => true);
    const manager = new HotkeyManager({
      scope,
      vault: vaultEvents,
      commands: {
        listCommands: () => [open],
        getCommands: () => [blocked, open],
        findCommand: (id: string) => [blocked, open].find((command) => command.id === id) ?? null,
        executeCommand,
      },
    } as never);
    manager.registerListeners();

    const event = modKey("o");

    expect(scope.handleKey(event)).toBe(false);
    expect(executeCommand).toHaveBeenCalledWith(blocked);

    manager.unregisterListeners();
  });

  it("does not record the keyboard event as app.lastEvent when a hotkey runs a command", () => {
    const scope = new Scope();
    const vaultEvents = new Events();
    const app = { lastEvent: null as Event | null, scope, vault: vaultEvents };
    const hotkeys = new HotkeyManager(app as never);
    const commands = new CommandManager(hotkeys, app);
    Object.assign(app, { commands });
    commands.addCommand({
      id: "open",
      name: "Open",
      hotkeys: [{ modifiers: ["Mod"], key: "O" }],
      callback: () => {},
    });
    hotkeys.registerListeners();

    const event = modKey("o");

    expect(scope.handleKey(event)).toBe(false);
    expect(app.lastEvent).toBeNull();

    hotkeys.unregisterListeners();
  });

  it("matches Obsidian by handling hotkeys even when the keyboard event is defaultPrevented", () => {
    const scope = new Scope();
    const vaultEvents = new Events();
    const app = { lastEvent: null as Event | null, scope, vault: vaultEvents };
    const hotkeys = new HotkeyManager(app as never);
    const commands = new CommandManager(hotkeys, app);
    Object.assign(app, { commands });
    const callback = vi.fn();
    commands.addCommand({
      id: "open",
      name: "Open",
      hotkeys: [{ modifiers: ["Mod"], key: "O" }],
      callback,
    });
    hotkeys.registerListeners();

    const event = modKey("o", { cancelable: true });
    event.preventDefault();

    expect(scope.handleKey(event)).toBe(false);
    expect(callback).toHaveBeenCalledTimes(1);

    hotkeys.unregisterListeners();
  });

  it("does not rebake custom hotkey overrides for commands without default hotkeys", () => {
    const scope = new Scope();
    const vaultEvents = new Events();
    const app = { lastEvent: null as Event | null, scope, vault: vaultEvents };
    const hotkeys = new HotkeyManager(app as never);
    const commands = new CommandManager(hotkeys, app);
    Object.assign(app, { commands });
    const callback = vi.fn();
    hotkeys.setHotkeys("plugin:late", [{ modifiers: ["Mod"], key: "P" }]);
    hotkeys.registerListeners();

    expect(scope.handleKey(modKey("p"))).toBeUndefined();

    commands.addCommand({ id: "plugin:late", name: "Late Plugin Command", callback });

    expect(scope.handleKey(modKey("p"))).toBeUndefined();
    expect(callback).not.toHaveBeenCalled();

    commands.removeCommand("plugin:late");

    expect(scope.handleKey(modKey("p"))).toBeUndefined();
    expect(callback).not.toHaveBeenCalled();

    hotkeys.unregisterListeners();
  });

  it("matches hotkey code entries and ignores key repeat unless the command is repeatable", () => {
    const scope = new Scope();
    const normal = { id: "normal", name: "Normal", hotkeys: [{ modifiers: ["Mod"], code: "KeyJ" }] };
    const repeatable = { id: "repeatable", name: "Repeatable", repeatable: true, hotkeys: [{ modifiers: ["Mod"], key: "K" }] };
    const executeCommand = vi.fn((_command: unknown, _event?: Event) => true);
    const manager = new HotkeyManager({
      scope,
      vault: { on: () => vi.fn() },
      commands: {
        listCommands: () => [normal, repeatable],
        getCommands: () => [normal, repeatable],
        findCommand: (id: string) => [normal, repeatable].find((command) => command.id === id) ?? null,
        executeCommand,
      },
    } as never);
    manager.registerListeners();

    expect(scope.handleKey(modKey("x", { code: "KeyJ" }))).toBe(false);
    expect(executeCommand).toHaveBeenCalledWith(normal);

    expect(scope.handleKey(modKey("j", { code: "KeyJ", repeat: true }))).toBeUndefined();
    expect(executeCommand).toHaveBeenCalledTimes(1);

    expect(scope.handleKey(modKey("k", { repeat: true }))).toBe(false);
    expect(executeCommand).toHaveBeenCalledTimes(2);
    expect(executeCommand.mock.calls[1]?.[0]).toBe(repeatable);
  });

  it("keeps missing hotkey lookups undefined and preserves default hotkeys when custom hotkeys are removed", () => {
    const manager = new HotkeyManager();

    expect(manager.getHotkeys("open")).toBeUndefined();
    expect(manager.getDefaultHotkeys("open")).toBeUndefined();

    manager.addDefaultHotkeys("open", [{ modifiers: ["Mod"], key: "O" }]);
    manager.setHotkeys("open", []);

    expect(manager.getHotkeys("open")).toEqual([]);
    expect(manager.getEffectiveHotkeys("open")).toEqual([]);

    manager.removeHotkeys("open");

    expect(manager.getHotkeys("open")).toBeUndefined();
    expect(manager.getDefaultHotkeys("open")).toEqual([{ modifiers: ["Mod"], key: "O" }]);
    expect(manager.getEffectiveHotkeys("open")).toEqual([{ modifiers: ["Mod"], key: "O" }]);
  });

  it("supports menu submenu, checked state and onHide hooks", () => {
    const menu = new Menu();
    const onHide = vi.fn();
    let submenu: Menu | null = null;

    menu.onHide(onHide);
    menu.addItem((item) => {
      submenu = item.setTitle("Parent").setChecked(true).setSubmenu();
      submenu.addItem((child) => child.setTitle("Child"));
    });

    menu.showAtPosition({ x: 10, y: 20 });

    expect(menu.dom.parentElement).toBe(document.body);
    expect(menu.dom.querySelector(".menu-item")?.classList.contains("mod-checked")).toBe(true);
    expect(submenu).not.toBeNull();

    menu.hide();

    expect(menu.dom.parentElement).toBeNull();
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("skips mobile-only commands on desktop runtime", () => {
    const commands = new CommandManager();

    commands.addCommand({ id: "desktop", name: "Desktop" });
    commands.addCommand({ id: "mobile", name: "Mobile", mobileOnly: true });

    expect(commands.getCommands().map((command) => command.id)).toEqual(["desktop"]);
  });

  it("uses the centralized Platform mobile flag for mobile-only commands", () => {
    const original = Platform.isMobile;
    Object.defineProperty(Platform, "isMobile", { configurable: true, value: true });
    try {
      const commands = new CommandManager();

      commands.addCommand({ id: "mobile", name: "Mobile", mobileOnly: true });

      expect(commands.getCommands().map((command) => command.id)).toEqual(["mobile"]);
    } finally {
      Object.defineProperty(Platform, "isMobile", { configurable: true, value: original });
    }
  });
});

function keyboardEvent(key: string, init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ...init });
}

function modKey(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
    ? keyboardEvent(key, { metaKey: true, ...init })
    : keyboardEvent(key, { ctrlKey: true, ...init });
}
