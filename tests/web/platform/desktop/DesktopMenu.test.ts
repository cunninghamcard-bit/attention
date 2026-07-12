import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { formatElectronAccelerator } from "@web/platform/desktop/DesktopMenu";
import type { SystemMenuItem } from "@web/platform/desktop/SystemMenuBuilder";

describe("DesktopMenu Obsidian application menu bridge", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as Window & { electron?: unknown }).electron;
    delete (globalThis as { electron?: unknown }).electron;
  });

  it("builds the Obsidian desktop Insert menu around appCommand items", async () => {
    const send = vi.fn();
    (window as Window & { electron?: unknown }).electron = { ipcRenderer: { send } };
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Menu.md", "Alpha");
    await app.workspace.openFile(file, { active: true, state: { mode: "source" } });

    const template = app.desktopMenu.refresh();
    const insert = findTopLevelMenu(template, "insert");
    const insertItems = insert.submenu ?? [];

    expect(insertItems.map(describeMenuItem)).toEqual([
      "editor:insert-wikilink",
      "editor:insert-link",
      "editor:insert-callout",
      "editor:insert-blockquote",
      "separator",
      "editor:insert-codeblock",
      "editor:insert-mathblock",
      "editor:insert-table",
      "editor:insert-footnote",
      "separator",
      "separator",
      "editor:toggle-bullet-list",
      "editor:toggle-numbered-list",
      "editor:toggle-checklist-status",
      "separator",
      "editor:attach-file",
      "separator",
      "submenu:Folding",
    ]);
    expect(findCommandItem(insertItems, "editor:insert-link").accelerator).toBe("CmdOrCtrl+K");
    expect(findCommandItem(insertItems, "editor:insert-link").registerAccelerator).toBe(false);
    expect(findCommandItem(insertItems, "editor:insert-link").enabled).toBeUndefined();
    expect(findCommandItem(insertItems, "editor:insert-blockquote").visible).toBe(false);
    expect(findCommandItem(insertItems, "editor:attach-file").visible).toBe(false);
    expect(app.desktopMain.systemMenu.getMenu()).toBe(template);
    expect(send).toHaveBeenLastCalledWith("set-menu", { template });
  });

  it("adds Edit, Format, View, and Help appCommand entries with command state", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Format.md", "**Bold**");
    await app.workspace.openFile(file, { active: true, state: { mode: "source" } });

    const template = app.desktopMenu.refresh();
    const editItems = findTopLevelMenu(template, "edit").submenu ?? [];
    const formatItems = findTopLevelMenu(template, "format").submenu ?? [];
    const viewItems = findTopLevelMenu(template, "view").submenu ?? [];
    const helpItems = findTopLevelMenu(template, "help").submenu ?? [];

    expect(findCommandItem(editItems, "editor:open-search")).toMatchObject({
      before: ["speech-section"],
      accelerator: "CmdOrCtrl+F",
      registerAccelerator: false,
    });
    expect(findCommandItem(formatItems, "editor:set-heading-1")).toMatchObject({
      type: "radio",
    });
    expect(findCommandItem(formatItems, "editor:toggle-bold")).toMatchObject({
      accelerator: "CmdOrCtrl+B",
      registerAccelerator: false,
    });
    expect(findCommandItem(formatItems, "editor:clear-formatting").visible).toBeUndefined();
    expect(findCommandItem(viewItems, "markdown:toggle-preview").visible).toBeUndefined();
    expect(findCommandItem(helpItems, "app:show-release-notes").visible).toBeUndefined();
  });

  it("sends native menu item state updates separately from template rendering", () => {
    const send = vi.fn();
    (window as Window & { electron?: unknown }).electron = { ipcRenderer: { send } };
    const app = new App(document.createElement("div"));

    app.desktopMenu.updateMenuItems(
      [{ itemId: "toggle-preview", eState: { checked: true, enabled: true } }],
      true,
    );

    expect(send).toHaveBeenLastCalledWith(
      "update-menu-items",
      [{ itemId: "toggle-preview", eState: { checked: true, enabled: true } }],
      true,
    );
  });

  it("honors nativeMenus=false without sending a renderer menu template", () => {
    const send = vi.fn();
    (window as Window & { electron?: unknown }).electron = { ipcRenderer: { send } };
    const app = new App(document.createElement("div"));

    send.mockClear();
    app.vault.setConfig("nativeMenus", false);
    app.desktopMenu.refresh();

    expect(send).not.toHaveBeenCalled();
  });

  it("formats Electron accelerators from Obsidian hotkeys", () => {
    expect(formatElectronAccelerator({ modifiers: ["Mod", "Shift"], key: "t" })).toBe(
      "CmdOrCtrl+Shift+T",
    );
    expect(formatElectronAccelerator({ modifiers: ["Ctrl"], key: "Tab" })).toBe("Ctrl+Tab");
    expect(formatElectronAccelerator({ modifiers: ["Mod"], key: " " })).toBe("CmdOrCtrl+Space");
  });
});

function findTopLevelMenu(template: SystemMenuItem[], id: string): SystemMenuItem {
  const item = template.find((entry) => entry.id === id);
  if (!item) throw new Error(`Missing top-level menu ${id}`);
  return item;
}

function findCommandItem(items: SystemMenuItem[], commandId: string): SystemMenuItem {
  const item = items.find((entry) => entry.appCommand === commandId);
  if (!item) throw new Error(`Missing command item ${commandId}`);
  return item;
}

function describeMenuItem(item: SystemMenuItem): string {
  if (item.type === "separator") return "separator";
  if (item.appCommand) return item.appCommand;
  if (item.submenu) return `submenu:${item.label}`;
  return item.id ?? item.label ?? "";
}
