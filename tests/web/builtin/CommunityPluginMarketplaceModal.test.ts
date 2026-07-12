import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { Plugin } from "@web/plugin/Plugin";
import { PluginSettingTab } from "@web/plugin/PluginSettingTab";
import type { PluginManifestInput } from "@web/plugin/PluginManifest";
import { closeTopActiveCloseable, getActiveCloseables } from "@web/ui/ActiveCloseableRegistry";
import { CommunityPluginMarketplaceModal } from "@web/builtin/CommunityPluginMarketplaceModal";

class MarketplaceTestPlugin extends Plugin {
  async onload(): Promise<void> {
    this.addCommand({ id: "run", name: "Run", callback: () => {} });
  }
}

describe("CommunityPluginMarketplaceModal", () => {
  beforeEach(() => {
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
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
    Object.defineProperty(window, "open", { configurable: true, value: vi.fn() });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    document.querySelectorAll(".modal-container, .notice").forEach((el) => el.remove());
  });

  afterEach(() => {
    while (closeTopActiveCloseable()) {
      // Drain Obsidian's active closeable stack between marketplace tests.
    }
  });

  it("opens a searchable marketplace modal and installs/enables a plugin", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    const manifest: PluginManifestInput = {
      id: "market",
      name: "Market Plugin",
      version: "1.0.0",
      author: "Ada",
      description: "Marketplace plugin",
    };
    app.pluginMarketplace.registerEntry({
      manifest,
      downloads: 9876,
      updatedAt: "2026-06-01",
      repository: "https://example.com/market",
      fundingUrl: "https://example.com/fund",
      readme: "Read me",
      package: {
        manifest,
        entry: "plugins/market/main.js",
        factory: (pluginApp, pluginManifest) =>
          new MarketplaceTestPlugin(pluginApp, pluginManifest),
      },
    });

    const modal = new CommunityPluginMarketplaceModal(app);
    modal.open();

    expect(modal.modalEl.classList.contains("mod-community-modal")).toBe(true);
    expect(modal.contentEl.querySelector(".modal-sidebar")).not.toBeNull();
    expect(modal.contentEl.querySelector(".community-modal-details")).not.toBeNull();
    expect(modal.contentEl.querySelector(".community-modal-controls")).not.toBeNull();
    expect(modal.contentEl.querySelector(".community-item")).not.toBeNull();
    expect(modal.contentEl.textContent).toContain("Market Plugin");
    expect(modal.contentEl.textContent).toContain("9,876 downloads");
    expect(modal.contentEl.textContent).toContain("Read me");
    expect(buttonTexts(modal.contentEl)).toContain("Install");
    expect(buttonTexts(modal.contentEl)).toContain("Copy share link");
    expect(buttonTexts(modal.contentEl)).toContain("Donate");

    clickButton(modal.contentEl, "Copy share link");
    await flushAsync();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("workbench://show-plugin?id=market");

    clickButton(modal.contentEl, "Donate");

    expect(modalTitles()).toContain("Donate to Market Plugin");
    expect(document.body.textContent).toContain("Support this plugin");

    clickButton(modal.contentEl, "Install");
    await flushAsync();

    expect(app.communityPlugins.get("market")?.installed).toBe(true);
    expect(modal.contentEl.textContent).toContain("Installed");
    expect(buttonTexts(modal.contentEl)).not.toContain("Install");
    expect(buttonTexts(modal.contentEl)).not.toContain("Update");
    expect(modal.contentEl.textContent).toContain("Enable");

    clickButton(modal.contentEl, "Enable");
    await flushAsync();

    expect(app.communityPlugins.get("market")?.enabled).toBe(true);
    expect(app.commands.findCommand("market:run")?.name).toBe("Market Plugin: Run");
    expect(modal.contentEl.textContent).toContain("Disable");
  });

  it("installs directly without a per-plugin trust prompt when marketplace install is invoked", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(false);
    let downloaded = false;
    app.pluginInstaller.setPackageDownloader({
      async fetchJson<T>(): Promise<T> {
        downloaded = true;
        return {
          id: "secure",
          name: "Secure Plugin",
          version: "1.0.0",
          author: "Ada",
        } as T;
      },
      async fetchText(): Promise<string> {
        downloaded = true;
        return `
          const { Plugin } = require("obsidian");
          module.exports = class SecurePlugin extends Plugin {};
        `;
      },
      async fetchOptionalText(): Promise<string | null> {
        return null;
      },
    });
    app.pluginMarketplace.registerEntry({
      manifest: {
        id: "secure",
        name: "Secure Plugin",
        version: "1.0.0",
        author: "Ada",
      },
      repo: "ada/secure",
    });

    const modal = new CommunityPluginMarketplaceModal(app);
    modal.open();
    clickButton(modal.contentEl, "Install");
    await flushAsync();

    expect(downloaded).toBe(true);
    expect(document.body.querySelector(".modal.mod-community-plugin-security")).toBeNull();
    expect(app.pluginSecurity.isRestrictedMode()).toBe(true);
    expect(app.communityPlugins.get("secure")?.installed).toBe(true);
  });

  it("filters marketplace entries from the search input", () => {
    const app = new App(document.createElement("div"));
    app.pluginMarketplace.registerEntry({
      manifest: {
        id: "alpha",
        name: "Alpha Plugin",
        version: "1.0.0",
        description: "Alpha detail",
      },
    });
    app.pluginMarketplace.registerEntry({
      manifest: {
        id: "beta",
        name: "Beta Plugin",
        version: "1.0.0",
        description: "Beta list item",
      },
    });
    const modal = new CommunityPluginMarketplaceModal(app);
    modal.open();

    const searchEl = modal.contentEl.querySelector<HTMLInputElement>(".community-plugin-search");
    expect(searchEl).not.toBeNull();
    searchEl!.value = "beta";
    searchEl!.dispatchEvent(new Event("input"));

    expect(modal.contentEl.querySelector(".community-modal-search-results")?.textContent).toContain(
      "Beta Plugin",
    );
    expect(
      modal.contentEl.querySelector(".community-modal-search-results")?.textContent,
    ).not.toContain("Alpha Plugin");
    expect(modal.contentEl.querySelector(".community-modal-details")?.textContent).toContain(
      "Alpha detail",
    );
  });

  it("keeps selected details when installed-only hides the selected plugin from the list", () => {
    const app = new App(document.createElement("div"));
    app.pluginMarketplace.registerEntry({
      manifest: {
        id: "alpha",
        name: "Alpha Plugin",
        version: "1.0.0",
        description: "Selected detail",
      },
    });
    app.pluginMarketplace.registerEntry({
      manifest: {
        id: "beta",
        name: "Beta Plugin",
        version: "1.0.0",
        description: "Installed list item",
      },
    });
    app.communityPlugins.add({
      manifest: { id: "beta", name: "Beta Plugin", version: "1.0.0" },
      installed: true,
      enabled: false,
    });
    const modal = new CommunityPluginMarketplaceModal(app);
    modal.open();

    const installedOnlyEl = modal.contentEl.querySelector<HTMLInputElement>(
      ".community-plugin-installed-only input",
    );
    if (!installedOnlyEl) throw new Error("Installed-only toggle not found");
    installedOnlyEl.checked = true;
    installedOnlyEl.dispatchEvent(new Event("change", { bubbles: true }));

    expect(modal.contentEl.querySelector(".community-modal-search-results")?.textContent).toContain(
      "Beta Plugin",
    );
    expect(
      modal.contentEl.querySelector(".community-modal-search-results")?.textContent,
    ).not.toContain("Alpha Plugin");
    expect(modal.contentEl.querySelector(".community-modal-details")?.textContent).toContain(
      "Selected detail",
    );
  });

  it("returns from selected plugin details through the active closeable stack", () => {
    const app = new App(document.createElement("div"));
    app.pluginMarketplace.registerEntry({
      manifest: {
        id: "alpha",
        name: "Alpha Plugin",
        version: "1.0.0",
        description: "Alpha detail",
      },
    });
    app.pluginMarketplace.registerEntry({
      manifest: { id: "beta", name: "Beta Plugin", version: "1.0.0", description: "Beta detail" },
    });
    const modal = new CommunityPluginMarketplaceModal(app);
    modal.open();

    expect(modal.contentEl.querySelector(".community-modal-details")?.textContent).toContain(
      "Alpha detail",
    );
    expect(getActiveCloseables()).toHaveLength(2);

    expect(closeTopActiveCloseable()).toBe(true);

    expect(modal.containerEl.isConnected).toBe(true);
    expect(modal.contentEl.querySelector(".community-modal-details")).toBeNull();
    expect(modal.contentEl.querySelector(".community-item.is-selected")).toBeNull();
    expect(getActiveCloseables()).toEqual([modal]);

    modal.contentEl.querySelector<HTMLButtonElement>('[data-plugin-id="beta"]')?.click();

    expect(modal.contentEl.querySelector(".community-modal-details")?.textContent).toContain(
      "Beta detail",
    );
    expect(getActiveCloseables()).toHaveLength(2);

    modal.close();

    expect(getActiveCloseables()).toEqual([]);
  });

  it("sets the search query from a missing auto-open plugin id instead of selecting the first item", () => {
    const app = new App(document.createElement("div"));
    app.pluginMarketplace.registerEntry({
      manifest: { id: "other-plugin", name: "Other Plugin", version: "1.0.0" },
    });
    const modal = new CommunityPluginMarketplaceModal(app).setAutoOpen("missing-plugin");
    modal.open();

    expect(modal.contentEl.querySelector<HTMLInputElement>(".community-plugin-search")?.value).toBe(
      "missing plugin",
    );
    expect(modal.contentEl.querySelector(".community-modal-details")).toBeNull();
  });

  it("opens a sort menu and persists communityPluginSortOrder", () => {
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
    app.pluginMarketplace.registerEntry({
      manifest: { id: "alpha", name: "Alpha Plugin", version: "1.0.0" },
      downloads: 1,
      updatedAt: "2026-01-01",
    });
    const modal = new CommunityPluginMarketplaceModal(app);
    modal.open();

    modal.contentEl
      .querySelector<HTMLButtonElement>(".community-plugin-sort")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    clickButton(document.body, "Alphabetical");

    expect(values.get("communityPluginSortOrder")).toBe("alphabetical");
  });

  it("updates an installed plugin from the marketplace detail view", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    const installedManifest: PluginManifestInput = {
      id: "updatable",
      name: "Updatable Plugin",
      version: "1.0.0",
    };
    await app.pluginInstaller.install({
      manifest: installedManifest,
      entry: "plugins/updatable/main.js",
      factory: (pluginApp, pluginManifest) => new MarketplaceTestPlugin(pluginApp, pluginManifest),
    });
    const latestManifest: PluginManifestInput = {
      id: "updatable",
      name: "Updatable Plugin",
      version: "2.0.0",
    };
    app.pluginMarketplace.registerEntry({
      manifest: latestManifest,
      package: {
        manifest: latestManifest,
        entry: "plugins/updatable/main.js",
        factory: (pluginApp, pluginManifest) =>
          new MarketplaceTestPlugin(pluginApp, pluginManifest),
      },
    });
    await app.pluginInstaller.checkForUpdates(["updatable"]);

    const modal = new CommunityPluginMarketplaceModal(app);
    modal.open();

    expect(modal.contentEl.textContent).toContain("Update");
    clickButton(modal.contentEl, "Update");
    await flushAsync();

    expect(app.communityPlugins.get("updatable")?.manifest.version).toBe("2.0.0");
    expect(app.communityPlugins.get("updatable")?.updateAvailable).toBe(false);
  });

  it("opens plugin options and filtered hotkeys for installed plugins", async () => {
    class SettingsPlugin extends MarketplaceTestPlugin {
      async onload(): Promise<void> {
        await super.onload();
        this.addSettingTab(new PluginSettingTab(this.app, this));
      }
    }

    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    const manifest: PluginManifestInput = {
      id: "settings-plugin",
      name: "Settings Plugin",
      version: "1.0.0",
    };
    app.pluginMarketplace.registerEntry({
      manifest,
      package: {
        manifest,
        entry: "plugins/settings-plugin/main.js",
        factory: (pluginApp, pluginManifest) => new SettingsPlugin(pluginApp, pluginManifest),
      },
    });

    const modal = new CommunityPluginMarketplaceModal(app);
    modal.open();
    clickButton(modal.contentEl, "Install");
    await flushAsync();
    clickButton(modal.contentEl, "Enable");
    await flushAsync();

    expect(modal.contentEl.textContent).toContain("Options");
    expect(modal.contentEl.textContent).toContain("Hotkeys");

    clickButton(modal.contentEl, "Options");

    expect(document.body.querySelector(".modal.mod-settings")).not.toBeNull();
    expect(
      document.body.querySelector(
        '.vertical-tab-nav-item.is-active[data-setting-id="settings-plugin"]',
      ),
    ).not.toBeNull();
    expect(document.body.querySelector(".modal.mod-community-plugin")).toBeNull();

    const hotkeysModal = new CommunityPluginMarketplaceModal(app);
    hotkeysModal.open();
    clickButton(hotkeysModal.contentEl, "Hotkeys");

    expect(
      document.body.querySelector('.vertical-tab-nav-item.is-active[data-setting-id="hotkeys"]'),
    ).not.toBeNull();
    expect(
      document.body.querySelector<HTMLInputElement>(".hotkeys-settings .setting-group-search")
        ?.value,
    ).toBe("settings-plugin");
    expect(document.body.textContent).toContain("Settings Plugin: Run");
    expect(document.body.querySelector(".modal.mod-community-plugin")).toBeNull();
  });

  it("loads and renders README markdown for the selected marketplace plugin", async () => {
    const app = new App(document.createElement("div"));
    app.pluginMarketplace.setDataSource({
      async fetchJson<T>(): Promise<T> {
        return {} as T;
      },
      async fetchText(url: string): Promise<string> {
        expect(url).toBe("https://raw.githubusercontent.com/ada/readme/HEAD/README.md");
        return "# Plugin README\n\nUseful details.";
      },
    });
    app.pluginMarketplace.registerEntry({
      manifest: {
        id: "readme",
        name: "Readme Plugin",
        version: "1.0.0",
        description: "Loads README",
      },
      repo: "ada/readme",
    });

    const modal = new CommunityPluginMarketplaceModal(app);
    modal.open();

    expect(modal.contentEl.textContent).toContain("Loading README");
    await flushAsync();

    expect(modal.contentEl.querySelector(".community-modal-readme h1")?.textContent).toBe(
      "Plugin README",
    );
    expect(modal.contentEl.textContent).toContain("Useful details.");
  });

  it("loads the Obsidian community catalog when opened empty", async () => {
    const app = new App(document.createElement("div"));
    app.pluginMarketplace.setDataSource({
      async fetchJson<T>(url: string): Promise<T> {
        if (url.endsWith("community-plugins.json")) {
          return [
            {
              id: "catalog",
              name: "Catalog Plugin",
              author: "Ada",
              description: "Loaded from catalog",
              repo: "ada/catalog",
            },
          ] as T;
        }
        if (url.endsWith("community-plugin-stats.json")) {
          return { catalog: { downloads: 12, updated: Date.UTC(2026, 5, 20), "1.0.0": 1 } } as T;
        }
        return {} as T;
      },
    });

    const modal = new CommunityPluginMarketplaceModal(app);
    modal.open();

    expect(modal.contentEl.textContent).toContain("Loading community plugins");
    await flushAsync();

    expect(modal.contentEl.textContent).toContain("Catalog Plugin");
    expect(modal.contentEl.textContent).toContain("12 downloads");
    expect(app.pluginMarketplace.loadState).toBe("loaded");
  });

  it("shows catalog load errors and retries from the modal", async () => {
    let failed = false;
    const app = new App(document.createElement("div"));
    app.pluginMarketplace.setDataSource({
      async fetchJson<T>(url: string): Promise<T> {
        if (!failed) {
          failed = true;
          throw new Error("offline");
        }
        if (url.endsWith("community-plugins.json")) {
          return [
            {
              id: "retry",
              name: "Retry Plugin",
              author: "Ada",
              description: "Loaded after retry",
              repo: "ada/retry",
            },
          ] as T;
        }
        return {} as T;
      },
    });

    const modal = new CommunityPluginMarketplaceModal(app);
    modal.open();
    await flushAsync();

    expect(modal.contentEl.querySelector(".community-modal-empty-state.mod-error")).not.toBeNull();
    expect(modal.contentEl.textContent).toContain("Failed to load community plugins: offline");

    clickButton(modal.contentEl, "Retry");
    await flushAsync();

    expect(modal.contentEl.textContent).toContain("Retry Plugin");
  });
});

function clickButton(root: HTMLElement, text: string): void {
  const button = [...root.querySelectorAll<HTMLElement>("button, .menu-item")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function buttonTexts(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].map(
    (button) => button.textContent?.trim() ?? "",
  );
}

function modalTitles(): string[] {
  return [...document.body.querySelectorAll<HTMLElement>(".modal .modal-title")].map(
    (title) => title.textContent ?? "",
  );
}
