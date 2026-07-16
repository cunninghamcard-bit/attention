import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { Plugin } from "@web/plugin/Plugin";
import { PluginSettingTab } from "@web/plugin/PluginSettingTab";
import { CommunityPluginsSettingTab } from "@web/builtin/CommunityPluginsSettingTab";

class SettingsCommunityPlugin extends Plugin {
  async onload(): Promise<void> {
    this.addCommand({ id: "run", name: "Run", callback: () => {} });
    this.addSettingTab(new PluginSettingTab(this.app, this));
  }
}

describe("CommunityPluginsSettingTab", () => {
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
    Object.defineProperty(window, "open", { configurable: true, value: vi.fn() });
    document.querySelectorAll(".modal-container, .notice").forEach((el) => el.remove());
  });

  it("renders Obsidian restricted-mode disclaimer and exits from the CTA", async () => {
    const app = new App(document.createElement("div"));
    const tab = new CommunityPluginsSettingTab(app);
    tab.display();

    expect(tab.containerEl.querySelector(".community-plugins-disclaimer")).not.toBeNull();
    expect(tab.containerEl.querySelectorAll(".setting-icon")).toHaveLength(4);
    expect(tab.containerEl.textContent).toContain(
      "Community plugins, like any other software you install, could potentially cause data integrity and security issues.",
    );
    expect(tab.containerEl.textContent).toContain("Initial code review");
    expect(tab.containerEl.textContent).toContain("Open source");
    expect(tab.containerEl.textContent).toContain("Peer audit");
    expect(tab.containerEl.textContent).toContain("Report mechanism");
    expect(tab.containerEl.textContent).toContain("Turn on community plugins");
    expect(tab.containerEl.textContent).toContain("Learn more about plugin security");

    clickButton(tab.containerEl, "Turn on community plugins");
    await flushAsync();

    expect(app.pluginSecurity.isRestrictedMode()).toBe(false);
    expect(tab.containerEl.querySelector(".community-plugins-disclaimer")).toBeNull();
    expect(tab.containerEl.textContent).toContain("Restricted mode is off");
    expect(tab.containerEl.textContent).toContain("Community plugins");
  });

  it("renders enabled settings in Obsidian order with installed plugin controls", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    const manifest = {
      id: "sample",
      name: "Sample Plugin",
      version: "1.2.3",
      author: "Ada",
      description: "Adds sample behavior",
    };
    app.pluginMarketplace.registerEntry({
      manifest,
      downloads: 1200,
      stars: 42,
      updatedAt: "2026-06-01",
      repository: "https://example.com/repo",
      fundingUrl: "https://example.com/fund",
    });
    await app.pluginInstaller.install({
      manifest,
      entry: "plugins/sample/main.js",
      factory: (pluginApp, pluginManifest) =>
        new SettingsCommunityPlugin(pluginApp, pluginManifest),
    });
    await app.pluginInstaller.enable("sample");
    app.communityPlugins.setEnabled("sample", true);

    const tab = new CommunityPluginsSettingTab(app);
    tab.display();

    const rootNames = [
      ...tab.containerEl.querySelectorAll<HTMLElement>(
        ".setting-group:first-child > .setting-items > .setting-item > .setting-item-info > .setting-item-name",
      ),
    ].map((element) => element.textContent);
    expect(rootNames).toEqual([
      "Restricted mode",
      "Community plugins",
      "Current plugins",
      "Automatically check for plugin updates",
    ]);
    expect(buttonTexts(tab.containerEl)).toContain("Turn on and reload");
    expect(buttonTexts(tab.containerEl)).toContain("Browse");
    expect(buttonTexts(tab.containerEl)).toContain("Check for updates");

    const installedGroup = tab.containerEl.querySelector<HTMLElement>(
      ".installed-plugins-container",
    );
    expect(installedGroup?.querySelector(".setting-item-heading")?.textContent).toContain(
      "Installed plugins",
    );
    expect(installedGroup?.querySelector('[aria-label="Reload plugins"]')).not.toBeNull();
    expect(installedGroup?.querySelector('[aria-label="Open plugins folder"]')).not.toBeNull();
    expect(installedGroup?.querySelector(".setting-group-search input")).not.toBeNull();

    const row = installedGroup?.querySelector<HTMLElement>(
      '.installed-community-plugin[data-plugin-id="sample"]',
    );
    expect(row?.querySelector(".setting-item-name")?.textContent).toBe("Sample Plugin");
    expect(row?.querySelector(".setting-item-description")?.textContent).toContain(
      "Version: 1.2.3",
    );
    expect(row?.querySelector(".setting-item-description")?.textContent).toContain("By Ada");
    expect(row?.querySelector(".setting-item-description")?.textContent).toContain(
      "Adds sample behavior",
    );
    expect(
      [...(row?.querySelectorAll<HTMLElement>(".extra-setting-button") ?? [])].map((element) =>
        element.getAttribute("aria-label"),
      ),
    ).toEqual(["Options", "Hotkeys", "Donate to support Sample Plugin", "Uninstall"]);
    expect(row?.querySelector(".checkbox-container")?.classList.contains("is-enabled")).toBe(true);
  });

  it("shows loaded plugin options, hotkeys and uninstall confirmation controls", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    await app.pluginInstaller.install({
      manifest: {
        id: "settings-plugin",
        name: "Settings Plugin",
        version: "1.0.0",
      },
      entry: "plugins/settings-plugin/main.js",
      factory: (pluginApp, manifest) => new SettingsCommunityPlugin(pluginApp, manifest),
    });
    await app.pluginInstaller.enable("settings-plugin");

    const tab = new CommunityPluginsSettingTab(app);
    tab.display();

    expect(
      tab.containerEl.querySelector(
        '.installed-community-plugin[data-plugin-id="settings-plugin"] .extra-setting-button[aria-label="Options"]',
      ),
    ).not.toBeNull();
    expect(
      tab.containerEl.querySelector(
        '.installed-community-plugin[data-plugin-id="settings-plugin"] .extra-setting-button[aria-label="Hotkeys"]',
      ),
    ).not.toBeNull();

    tab.containerEl
      .querySelector<HTMLElement>(
        '.installed-community-plugin[data-plugin-id="settings-plugin"] .extra-setting-button[aria-label="Uninstall"]',
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.body.querySelector(".modal .modal-title")?.textContent).toBe(
      "Uninstall plugin",
    );
    expect(document.body.textContent).toContain("Are you sure you want to uninstall this plugin?");
  });

  it("opens the marketplace details for an installed plugin from the settings list", () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    app.pluginMarketplace.registerEntry({
      manifest: {
        id: "open-me",
        name: "Open Me",
        version: "1.0.0",
        description: "Marketplace detail target",
      },
      downloads: 10,
      readme: "Details",
    });
    app.communityPlugins.add({
      manifest: {
        id: "open-me",
        name: "Open Me",
        version: "1.0.0",
      },
      installed: true,
      enabled: false,
    });

    const tab = new CommunityPluginsSettingTab(app);
    tab.display();
    tab.containerEl
      .querySelector<HTMLElement>(
        '.installed-community-plugin[data-plugin-id="open-me"] .setting-item-info',
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.body.querySelector(".modal.mod-community-plugin")).not.toBeNull();
    expect(document.body.querySelector(".community-item.is-selected")?.textContent).toContain(
      "Open Me",
    );
    expect(document.body.querySelector(".community-modal-details")?.textContent).toContain(
      "Marketplace detail target",
    );
  });

  it("checks for updates and updates all installed plugins from the marketplace", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    await app.pluginInstaller.install({
      manifest: {
        id: "updates",
        name: "Updates Plugin",
        version: "1.0.0",
      },
      entry: "plugins/updates/main.js",
      factory: (pluginApp, manifest) =>
        ({ app: pluginApp, manifest, load: () => {}, unload: () => {} }) as never,
    });
    app.pluginMarketplace.registerEntry({
      manifest: {
        id: "updates",
        name: "Updates Plugin",
        version: "1.2.0",
      },
      package: {
        manifest: {
          id: "updates",
          name: "Updates Plugin",
          version: "1.2.0",
        },
        entry: "plugins/updates/main.js",
        factory: (pluginApp, manifest) =>
          ({ app: pluginApp, manifest, load: () => {}, unload: () => {} }) as never,
      },
    });

    const tab = new CommunityPluginsSettingTab(app);
    tab.display();

    clickButton(tab.containerEl, "Check for updates");
    await flushAsync();

    expect(app.communityPlugins.get("updates")?.updateAvailable).toBe(true);
    expect(tab.containerEl.textContent).toContain("Update all");

    clickButton(tab.containerEl, "Update all");
    await flushAsync();

    expect(app.communityPlugins.get("updates")?.manifest.version).toBe("1.2.0");
    expect(app.communityPlugins.get("updates")?.updateAvailable).toBe(false);
  });
});

function clickButton(root: HTMLElement, text: string): void {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function buttonTexts(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].map(
    (button) => button.textContent?.trim() ?? "",
  );
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
