import { describe, expect, it, vi } from "vitest";
import type { App } from "@web/app/App";
import { JsonStore } from "@web/storage/JsonStore";
import { Vault } from "@web/vault/Vault";
import { CorePluginManager } from "@web/plugin/CorePluginManager";

describe("Core plugin config", () => {
  it("loads core plugin enablement from core-plugins.json through the vault", async () => {
    const { manager, vault } = createCorePluginHarness();
    await vault.writeConfigJson("core-plugins", {
      "command-palette": false,
      "slash-command": true,
      "scoped-hidden": true,
    });

    await manager.enableDefaults();

    expect(manager.list().find((plugin) => plugin.id === "command-palette")?.enabled).toBe(false);
    expect(manager.list().find((plugin) => plugin.id === "slash-command")?.enabled).toBe(true);
    expect(manager.list().find((plugin) => plugin.id === "scoped-hidden")?.enabled).toBe(false);
  });

  it("writes core plugin enablement back to core-plugins.json through the vault", async () => {
    const { manager, vault } = createCorePluginHarness();
    await manager.enableDefaults();
    vi.useFakeTimers();
    try {
      await manager.disable("command-palette", true);
      await vi.advanceTimersByTimeAsync(500);
    } finally {
      vi.useRealTimers();
    }

    await expect(
      vault.readConfigJson<Record<string, boolean>>("core-plugins"),
    ).resolves.toMatchObject({
      "command-palette": false,
    });
  });

  it("migrates legacy core plugin arrays with core-plugins-migration.json as the object base", async () => {
    const { manager, vault } = createCorePluginHarness();
    await vault.writeConfigJson("core-plugins", ["command-palette", "bookmarks"]);
    await vault.writeConfigJson("core-plugins-migration", { bookmarks: false });

    await manager.enableDefaults();

    expect(manager.list().find((plugin) => plugin.id === "command-palette")?.enabled).toBe(true);
    expect(manager.list().find((plugin) => plugin.id === "bookmarks")?.enabled).toBe(true);
    expect(manager.list().find((plugin) => plugin.id === "slash-command")?.enabled).toBe(false);
  });
});

function createCorePluginHarness(): { manager: CorePluginManager; vault: Vault } {
  const store = new JsonStore();
  const vault = new Vault(undefined, undefined, store);
  const app = {
    vault,
    workspace: {
      leftRibbon: {
        addRibbonIcon: () => document.createElement("button"),
        removeRibbonAction: () => {},
      },
      trigger: () => {},
      detachLeavesOfType: () => {},
    },
    commands: {
      addCommand: () => {},
      removeCommand: () => {},
    },
    statusBar: {
      registerStatusBarItem: () => document.createElement("div"),
    },
    viewRegistry: {
      registerView: () => {},
      unregisterView: () => {},
      registerExtensions: () => {},
      unregisterExtensions: () => {},
    },
    setting: {
      addSettingTab: () => {},
      removeSettingTab: () => {},
    },
  } as unknown as App;
  const manager = new CorePluginManager(app);
  for (const definition of [
    { id: "command-palette", name: "Command palette", defaultOn: true },
    { id: "slash-command", name: "Slash command", defaultOn: false },
    { id: "bookmarks", name: "Bookmarks", defaultOn: true },
    { id: "scoped-hidden", name: "Scoped hidden", defaultOn: false, hiddenFromList: true },
  ]) {
    manager.register({
      ...definition,
      description: "",
      init: () => {},
    });
  }
  return { manager, vault };
}
