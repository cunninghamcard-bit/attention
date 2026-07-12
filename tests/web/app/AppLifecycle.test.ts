import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import type { ObsidianProtocolData } from "@web/app/protocol/UriRouter";

describe("AppLifecycle opening behavior", () => {
  beforeEach(() => {
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
    delete (window as { OBS_ACT?: unknown }).OBS_ACT;
  });

  afterEach(() => {
    delete (window as { OBS_ACT?: unknown }).OBS_ACT;
    vi.restoreAllMocks();
  });

  it("keeps restored layout for the last opened behavior", async () => {
    const app = new App(document.createElement("div"));
    const restore = vi.spyOn(app.workspace, "loadLayout").mockResolvedValue(null);
    app.vault.setConfig("openBehavior", "");

    await app.ready;

    expect(restore).toHaveBeenCalledOnce();
    expect(app.workspace.activeEditor?.file).toBeUndefined();
  });

  it("creates and opens a new note for the new behavior", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("openBehavior", "new");
    app.vault.setConfig("newFileLocation", "folder");
    app.vault.setConfig("newFileFolderPath", "Inbox");

    await app.ready;

    expect(app.vault.getFileByPath("Inbox/Untitled.md")).not.toBeNull();
    expect(app.workspace.activeEditor?.file?.path).toBe("Inbox/Untitled.md");
  });

  it("skips opening behavior and replays pending URL action during startup", async () => {
    const pending: ObsidianProtocolData = { action: "plugin-action", source: "startup" };
    (window as { OBS_ACT?: ObsidianProtocolData }).OBS_ACT = pending;
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = new App(document.createElement("div"));
    const handler = vi.fn();
    app.workspace.registerObsidianProtocolHandler("plugin-action", handler);
    app.vault.setConfig("openBehavior", "new");
    app.vault.setConfig("newFileLocation", "folder");
    app.vault.setConfig("newFileFolderPath", "Inbox");

    await app.ready;

    expect(app.vault.getFileByPath("Inbox/Untitled.md")).toBeNull();
    expect(handler).toHaveBeenCalledWith(pending);
    expect(typeof (window as { OBS_ACT?: unknown }).OBS_ACT).toBe("function");
  });

  it("keeps daily opening behavior inactive when the scoped Daily Notes plugin is disabled", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("openBehavior", "daily");

    await app.ready;

    expect(app.internalPlugins.getPluginById("daily-notes")?.definition.defaultOn).toBe(false);
    expect(app.workspace.activeEditor?.file).toBeUndefined();
  });

  it("opens an existing file for the file behavior and ignores missing files", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Start.md", "start");
    app.vault.setConfig("openBehavior", "file:start");

    await app.ready;

    expect(app.workspace.activeEditor?.file).toBe(file);

    const second = new App(document.createElement("div"));
    second.vault.setConfig("openBehavior", "file:Missing.md");

    await second.ready;

    expect(second.workspace.activeEditor?.file).toBeUndefined();
  });

  it("reloads vault config from raw app and appearance file changes", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const changed: string[] = [];
    app.vault.on("config-changed", (key) => changed.push(String(key)));

    await app.jsonStore.write("appearance.json", { theme: "obsidian", accentColor: "#123456" }, { mtime: Date.now() + 1_000 });

    await vi.waitFor(() => {
      expect(app.vault.getConfig("theme")).toBe("obsidian");
      expect(app.vault.getConfig("accentColor")).toBe("#123456");
      expect(changed).toContain("theme");
      expect(changed).toContain("accentColor");
    });
  });

  it("reloads hotkey overrides from hotkeys.json changes", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    vi.useFakeTimers();
    try {
      await app.jsonStore.write("hotkeys.json", { "app:open": [{ modifiers: ["Mod"], key: "O" }] }, { mtime: Date.now() + 1_000 });

      await vi.advanceTimersByTimeAsync(49);
      expect(app.hotkeys.getHotkeys("app:open")).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      expect(app.hotkeys.getHotkeys("app:open")).toEqual([{ modifiers: ["Mod"], key: "O" }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
