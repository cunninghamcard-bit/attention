import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import type { PluginPackageSource } from "./PluginLoader";
import type { PluginManifestInput } from "./PluginManifest";

class MemoryPluginSource implements PluginPackageSource {
  constructor(readonly files: Record<string, string | PluginManifestInput>) {}

  async list(path: string): Promise<{ folders: string[]; files: string[] }> {
    const prefix = `${path}/`;
    return {
      folders: [...new Set(Object.keys(this.files)
        .filter((file) => file.startsWith(prefix))
        .map((file) => file.slice(prefix.length).split("/", 1)[0]))],
      files: [],
    };
  }

  async readText(path: string): Promise<string | null> {
    const value = this.files[path];
    return typeof value === "string" ? value : null;
  }

  async readJson<T>(path: string): Promise<T | null> {
    const value = this.files[path];
    return value && typeof value === "object" ? structuredClone(value) as T : null;
  }
}

describe("community plugin manager facade", () => {
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
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
    document.body.classList.remove("emulate-mobile");
  });

  it("mirrors Obsidian $0 manifest, enabled and loaded plugin tables", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    await app.jsonStore.write("community-plugins.json", ["facade"]);
    app.pluginLoader.setPackageSource(new MemoryPluginSource({
      "plugins/facade/manifest.json": {
        id: "facade",
        name: "Facade Plugin",
        version: "1.0.0",
      },
      "plugins/facade/main.js": `
        const { Plugin } = require("obsidian");
        module.exports = class FacadePlugin extends Plugin {
          async onload() {
            this.addCommand({ id: "boot", name: "Boot", callback: () => {} });
          }
        };
      `,
    }));

    await app.pluginInstaller.initialize();

    expect(app.pluginInstaller.getPluginFolder()).toBe(".obsidian/plugins");
    expect(app.pluginInstaller.enabledPlugins.has("facade")).toBe(true);
    expect(app.pluginInstaller.manifests.facade.dir).toBe("plugins/facade");
    expect(app.pluginInstaller.plugins.facade).toBe(app.plugins.getPlugin("facade"));
    expect(app.pluginInstaller.getPlugin("facade")).toBe(app.plugins.getPlugin("facade"));
    expect(app.commands.findCommand("facade:boot")?.name).toBe("Facade Plugin: Boot");
  });

  it("separates pure load/unload from enable-and-save helpers", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    app.pluginLoader.setPackageSource(new MemoryPluginSource({
      "plugins/pure/manifest.json": {
        id: "pure",
        name: "Pure Plugin",
        version: "1.0.0",
      },
      "plugins/pure/main.js": `
        const { Plugin } = require("obsidian");
        module.exports = class PurePlugin extends Plugin {
          async onload() {
            this.addCommand({ id: "boot", name: "Boot", callback: () => {} });
          }
        };
      `,
    }));

    await app.pluginInstaller.loadManifests();
    await expect(app.pluginInstaller.enablePlugin("pure")).resolves.toBe(true);

    expect(app.pluginInstaller.enabledPlugins.has("pure")).toBe(false);
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toBeNull();
    expect(app.pluginInstaller.plugins.pure).toBe(app.plugins.getPlugin("pure"));

    await app.pluginInstaller.disablePlugin("pure", true);

    expect(app.plugins.getPlugin("pure")).toBeNull();
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toBeNull();

    await expect(app.pluginInstaller.enablePluginAndSave("pure")).resolves.toBe(true);

    expect(app.pluginInstaller.enabledPlugins.has("pure")).toBe(true);
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toEqual(["pure"]);

    await app.pluginInstaller.disablePluginAndSave("pure");

    expect(app.pluginInstaller.enabledPlugins.has("pure")).toBe(false);
    expect(app.plugins.getPlugin("pure")).toBeNull();
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toEqual([]);
  });

  it("loads a single manifest from an Obsidian-style config-dir path", async () => {
    const app = new App(document.createElement("div"));
    app.pluginLoader.setPackageSource(new MemoryPluginSource({
      "plugins/single/manifest.json": {
        id: "single",
        name: "Single",
        version: "1.0.0",
      },
      "plugins/single/main.js": `
        const { Plugin } = require("obsidian");
        module.exports = class SinglePlugin extends Plugin {};
      `,
    }));

    await app.pluginInstaller.loadManifest(".obsidian/plugins/single");

    expect(app.pluginInstaller.manifests.single.dir).toBe("plugins/single");
    expect(app.pluginLoader.getPackage("single")?.manifest.dir).toBe("plugins/single");
  });
  it("initializes with pure enablePlugin semantics and preserves configured ids", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    await app.jsonStore.write("community-plugins.json", ["startup", "missing"]);
    app.pluginLoader.setPackageSource(new MemoryPluginSource({
      "plugins/startup/manifest.json": {
        id: "startup",
        name: "Startup Plugin",
        version: "1.0.0",
      },
      "plugins/startup/main.js": `
        const { Plugin } = require("obsidian");
        module.exports = class StartupPlugin extends Plugin {
          async onload() {
            this.addCommand({ id: "boot", name: "Boot", callback: () => {} });
          }
        };
      `,
    }));

    await app.pluginInstaller.initialize();

    expect(app.commands.findCommand("startup:boot")?.name).toBe("Startup Plugin: Boot");
    expect(app.pluginInstaller.enabledPlugins.has("startup")).toBe(true);
    expect(app.pluginInstaller.enabledPlugins.has("missing")).toBe(true);
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toEqual(["startup", "missing"]);
  });

  it("treats non-array community plugin config as empty like Obsidian", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    await app.jsonStore.write("community-plugins.json", { legacy: { enabled: true } });
    app.pluginLoader.setPackageSource(new MemoryPluginSource({
      "plugins/legacy/manifest.json": {
        id: "legacy",
        name: "Legacy Config Plugin",
        version: "1.0.0",
      },
      "plugins/legacy/main.js": `
        const { Plugin } = require("obsidian");
        module.exports = class LegacyConfigPlugin extends Plugin {
          async onload() {
            this.addCommand({ id: "boot", name: "Boot", callback: () => {} });
          }
        };
      `,
    }));

    await app.pluginInstaller.initialize();

    expect(app.pluginInstaller.enabledPlugins.size).toBe(0);
    expect(app.plugins.getPlugin("legacy")).toBeNull();
    expect(app.commands.findCommand("legacy:boot")).toBeUndefined();
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toEqual([]);
  });

  it("setEnable(false) unloads loaded plugins while preserving the enabled plugin set", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    await app.jsonStore.write("community-plugins.json", ["switchable"]);
    app.pluginLoader.setPackageSource(new MemoryPluginSource({
      "plugins/switchable/manifest.json": {
        id: "switchable",
        name: "Switchable Plugin",
        version: "1.0.0",
      },
      "plugins/switchable/main.js": `
        const { Plugin } = require("obsidian");
        module.exports = class SwitchablePlugin extends Plugin {
          async onload() {
            this.addCommand({ id: "boot", name: "Boot", callback: () => {} });
          }
        };
      `,
    }));
    await app.pluginInstaller.initialize();

    await app.pluginInstaller.setEnable(false);

    expect(app.pluginInstaller.enabledPlugins.has("switchable")).toBe(true);
    expect(app.plugins.getPlugin("switchable")).toBeNull();
    expect(app.commands.findCommand("switchable:boot")).toBeUndefined();
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toEqual(["switchable"]);

    await app.pluginInstaller.setEnable(true);

    expect(app.pluginInstaller.enabledPlugins.has("switchable")).toBe(true);
    expect(app.commands.findCommand("switchable:boot")?.name).toBe("Switchable Plugin: Boot");
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toEqual(["switchable"]);
  });

});
