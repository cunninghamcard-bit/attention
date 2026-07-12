import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import type { Hotkey } from "@web/app/hotkeys/Keymap";
import { HotkeysSettingTab } from "@web/builtin/HotkeysSettingTab";

describe("HotkeysSettingTab Obsidian settings contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
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
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  it("renders command hotkeys with Obsidian hotkey settings classes", async () => {
    const { app, tab } = await createHotkeysTab();

    tab.setQuery("alpha");
    tab.display();

    const controlsEl = tab.containerEl.querySelector<HTMLElement>(".setting-command-hotkeys");
    const hotkeyEl = controlsEl?.querySelector<HTMLElement>(".setting-hotkey");
    expect(controlsEl).not.toBeNull();
    expect(hotkeyEl?.textContent).toMatch(/A/);
    expect(controlsEl?.querySelector(".setting-add-hotkey-button .svg-icon")).not.toBeNull();
    expect(app.hotkeys.getDefaultHotkeys("alpha-command")).toEqual([
      { modifiers: ["Mod"], key: "A" },
    ]);
  });

  it("appends newly recorded hotkeys instead of replacing the existing default hotkey", async () => {
    const { app, tab } = await createHotkeysTab();
    tab.setQuery("alpha");
    tab.display();

    tab.containerEl.querySelector<HTMLElement>(".setting-add-hotkey-button")?.click();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "K", metaKey: true, bubbles: true, cancelable: true }),
    );

    expect(app.hotkeys.getHotkeys("alpha-command")).toEqual([
      { modifiers: ["Mod"], key: "A" },
      { modifiers: ["Mod"], key: "K" },
    ]);
    expect(tab.containerEl.querySelectorAll(".setting-hotkey")).toHaveLength(2);
  });

  it("removes individual hotkeys and restores defaults through the restore control", async () => {
    const { app, tab } = await createHotkeysTab();
    app.hotkeys.setHotkeys("alpha-command", [
      { modifiers: ["Mod"], key: "A" },
      { modifiers: ["Mod"], key: "K" },
    ]);
    tab.setQuery("alpha");
    tab.display();

    tab.containerEl.querySelector<HTMLElement>(".setting-delete-hotkey")?.click();

    expect(app.hotkeys.getHotkeys("alpha-command")).toEqual([{ modifiers: ["Mod"], key: "K" }]);
    expect(
      tab.containerEl.querySelector(".setting-restore-hotkey-button.mod-active"),
    ).not.toBeNull();

    tab.containerEl.querySelector<HTMLElement>(".setting-restore-hotkey-button")?.click();

    expect(app.hotkeys.hasHotkeyOverride("alpha-command")).toBe(false);
    expect(
      [...tab.containerEl.querySelectorAll(".setting-hotkey")].map((el) => el.textContent?.trim()),
    ).toEqual([expect.stringMatching(/A/)]);
  });

  it("marks conflicting hotkey chips with the app.css conflict class", async () => {
    const { tab } = await createHotkeysTab([
      { id: "conflict-alpha", name: "Conflict Alpha", hotkeys: [{ modifiers: ["Mod"], key: "J" }] },
      { id: "conflict-beta", name: "Conflict Beta", hotkeys: [{ modifiers: ["Mod"], key: "J" }] },
    ]);
    tab.setQuery("conflict");
    tab.display();

    const conflicts = [
      ...tab.containerEl.querySelectorAll<HTMLElement>(".setting-hotkey.has-conflict"),
    ];

    expect(conflicts).toHaveLength(2);
    expect(conflicts[0]?.title).toContain("Conflict");
  });
});

async function createHotkeysTab(
  extraCommands: Array<{ id: string; name: string; hotkeys: Hotkey[] }> = [],
): Promise<{
  app: App;
  tab: HotkeysSettingTab;
}> {
  const app = new App(document.createElement("div"));
  await app.ready;
  app.commands.addCommand({
    id: "alpha-command",
    name: "Alpha Command",
    hotkeys: [{ modifiers: ["Mod"], key: "A" }],
    callback: () => {},
  });
  app.commands.addCommand({
    id: "beta-command",
    name: "Beta Command",
    hotkeys: [{ modifiers: ["Mod"], key: "B" }],
    callback: () => {},
  });
  for (const command of extraCommands) {
    app.commands.addCommand({ ...command, callback: () => {} });
  }
  return { app, tab: new HotkeysSettingTab(app) };
}
