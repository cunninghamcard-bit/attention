import { beforeEach, describe, expect, it } from "vitest";
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

describe("PluginLoader discovery", () => {
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
    document.body.classList.remove("emulate-mobile");
    document.querySelectorAll(".modal-container, .notice").forEach((el) => el.remove());
  });

  it("discovers manifest, main.js and styles.css from the plugins folder", async () => {
    const app = new App(document.createElement("div"));
    app.pluginLoader.setPackageSource(new MemoryPluginSource({
      "plugins/disk/manifest.json": {
        id: "disk",
        name: "Disk Plugin",
        version: "1.0.0",
        minAppVersion: "1.0.0",
        author: "Obsidian",
        description: "Loaded from plugin folder",
      },
      "plugins/disk/main.js": `
        const { Plugin } = require("obsidian");
        module.exports = class DiskPlugin extends Plugin {
          async onload() {
            this.addCommand({ id: "hello", name: "Hello", callback: () => {} });
            this.addRibbonIcon("lucide-disc", "Disk", () => {});
            await this.saveData({ dir: this.manifest.dir });
          }
        };
      `,
      "plugins/disk/styles.css": ".disk-plugin { color: blue; }",
    }));

    const packages = await app.pluginLoader.discoverPackages();

    expect(packages).toHaveLength(1);
    expect(packages[0].manifest.dir).toBe("plugins/disk");
    expect(packages[0].manifest.author).toBe("");
    expect(app.communityPlugins.get("disk")?.installed).toBe(true);

    app.pluginSecurity.setCommunityPluginsEnabled(true);
    await app.pluginInstaller.enable("disk");

    expect(app.plugins.getPlugin("disk")?.manifest.dir).toBe("plugins/disk");
    expect(app.commands.findCommand("disk:hello")?.name).toBe("Disk Plugin: Hello");
    expect(app.workspace.leftRibbon.containerEl.querySelector('.side-dock-ribbon-action[aria-label="Disk"]')).not.toBeNull();
    expect(document.head.querySelector('style[data-obsidian-reconstructed-css="plugin:disk"]')?.textContent).toContain("disk-plugin");
    await expect(app.jsonStore.read("plugins/disk/data.json")).resolves.toEqual({ dir: "plugins/disk" });
  });

  it("discovers a single plugin folder like Obsidian loadManifest", async () => {
    const app = new App(document.createElement("div"));
    app.pluginLoader.setPackageSource(new MemoryPluginSource({
      "plugins/single/manifest.json": {
        id: "single",
        name: "Single Plugin",
        version: "1.0.0",
        author: "Ada",
      },
      "plugins/single/main.js": `
        const { Plugin } = require("obsidian");
        module.exports = class SinglePlugin extends Plugin {};
      `,
    }));

    const pkg = await app.pluginLoader.discoverPackage("plugins/single");

    expect(pkg?.manifest.dir).toBe("plugins/single");
    expect(pkg?.manifest.author).toBe("Ada");
    expect(app.pluginLoader.getPackage("single")).toBe(pkg);
    expect(app.communityPlugins.get("single")?.installed).toBe(true);
  });

  it("does not enable desktop-only community plugins while running in mobile emulation", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    document.body.classList.add("emulate-mobile");
    app.pluginLoader.setPackageSource(new MemoryPluginSource({
      "plugins/desktop-only/manifest.json": {
        id: "desktop-only",
        name: "Desktop Only",
        version: "1.0.0",
        isDesktopOnly: true,
      },
      "plugins/desktop-only/main.js": `
        const { Plugin } = require("obsidian");
        module.exports = class DesktopOnlyPlugin extends Plugin {
          async onload() {
            this.addCommand({ id: "boot", name: "Boot", callback: () => {} });
          }
        };
      `,
    }));
    await app.pluginLoader.discoverPackages();

    await expect(app.pluginInstaller.enable("desktop-only")).resolves.toBe(false);

    expect(app.plugins.getPlugin("desktop-only")).toBeNull();
    expect(app.commands.findCommand("desktop-only:boot")).toBeUndefined();
    expect(app.communityPlugins.get("desktop-only")?.enabled).toBe(false);
  });

  it("initializes community plugins from startup config when the global switch is enabled", async () => {
    const values = new Map<string, string>([["enable-plugin-obsidian-reconstructed", "true"]]);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    void app.jsonStore.write("community-plugins.json", ["auto"]);
    app.pluginLoader.setPackageSource(new MemoryPluginSource({
      "plugins/auto/manifest.json": {
        id: "auto",
        name: "Auto Plugin",
        version: "1.0.0",
        minAppVersion: "1.0.0",
        author: "Test",
      },
      "plugins/auto/main.js": `
        const { Plugin } = require("obsidian");
        module.exports.default = class AutoPlugin extends Plugin {
          async onload() {
            this.addCommand({ id: "boot", name: "Boot", callback: () => {} });
          }
        };
      `,
    }));

    await app.ready;

    expect(app.communityPlugins.get("auto")?.enabled).toBe(true);
    expect(app.commands.findCommand("auto:boot")?.name).toBe("Auto Plugin: Boot");
  });

  it("discovers but does not enable startup plugins while restricted mode is on", async () => {
    const app = new App(document.createElement("div"));
    void app.jsonStore.write("community-plugins.json", ["blocked"]);
    app.pluginLoader.setPackageSource(new MemoryPluginSource({
      "plugins/blocked/manifest.json": {
        id: "blocked",
        name: "Blocked Plugin",
        version: "1.0.0",
        minAppVersion: "1.0.0",
      },
      "plugins/blocked/main.js": `
        const { Plugin } = require("obsidian");
        module.exports = class BlockedPlugin extends Plugin {
          async onload() {
            this.addCommand({ id: "boot", name: "Boot", callback: () => {} });
          }
        };
      `,
    }));

    await app.ready;

    expect(app.communityPlugins.get("blocked")?.installed).toBe(true);
    expect(app.communityPlugins.get("blocked")?.enabled).toBe(true);
    expect(app.plugins.getPlugin("blocked")).toBeNull();
    expect(app.commands.findCommand("blocked:boot")).toBeUndefined();
    expect(document.body.querySelector(".modal.mod-trust-folder")).not.toBeNull();
    expect(document.body.textContent).toContain("Do you trust the author of this vault?");
  });

  it("enables startup community plugins from the first-open trust modal", async () => {
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
    const app = new App(document.createElement("div"));
    void app.jsonStore.write("community-plugins.json", ["trusted"]);
    app.pluginLoader.setPackageSource(new MemoryPluginSource({
      "plugins/trusted/manifest.json": {
        id: "trusted",
        name: "Trusted Plugin",
        version: "1.0.0",
      },
      "plugins/trusted/main.js": `
        const { Plugin } = require("obsidian");
        module.exports = class TrustedPlugin extends Plugin {
          async onload() {
            this.addCommand({ id: "boot", name: "Boot", callback: () => {} });
          }
        };
      `,
    }));
    await app.ready;

    expect(app.commands.findCommand("trusted:boot")).toBeUndefined();
    clickButton(document.body, "Trust author and enable plugins");
    await flushAsync();
    await flushAsync();

    expect(values.get("enable-plugin-obsidian-reconstructed")).toBe("true");
    expect(app.commands.findCommand("trusted:boot")?.name).toBe("Trusted Plugin: Boot");
    expect(document.body.querySelector(".modal.mod-settings")).not.toBeNull();
    expect(document.body.querySelector('.vertical-tab-nav-item.is-active[data-setting-id="community-plugins"]')).not.toBeNull();
  });

  it("toggles the global community plugin switch without deleting enabled plugin config", async () => {
    const values = new Map<string, string>([["enable-plugin-obsidian-reconstructed", "true"]]);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    void app.jsonStore.write("community-plugins.json", ["toggle"]);
    app.pluginLoader.setPackageSource(new MemoryPluginSource({
      "plugins/toggle/manifest.json": {
        id: "toggle",
        name: "Toggle Plugin",
        version: "1.0.0",
      },
      "plugins/toggle/main.js": `
        const { Plugin } = require("obsidian");
        module.exports = class TogglePlugin extends Plugin {
          async onload() {
            this.addCommand({ id: "boot", name: "Boot", callback: () => {} });
          }
        };
      `,
    }));
    await app.ready;

    expect(app.commands.findCommand("toggle:boot")).not.toBeUndefined();

    await app.pluginInstaller.setCommunityPluginsEnabled(false);

    expect(app.commands.findCommand("toggle:boot")).toBeUndefined();
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toEqual(["toggle"]);
    expect(values.get("enable-plugin-obsidian-reconstructed")).toBe("false");

    await app.pluginInstaller.setCommunityPluginsEnabled(true);

    expect(app.commands.findCommand("toggle:boot")).not.toBeUndefined();
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toEqual(["toggle"]);
    expect(values.get("enable-plugin-obsidian-reconstructed")).toBe("true");
  });
});

function clickButton(root: HTMLElement, text: string): void {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text);
  if (!button) throw new Error(`Button not found: ${text}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
