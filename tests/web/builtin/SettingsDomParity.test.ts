import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import type { SettingDefinitionItem } from "@web/app/SettingTab";
import { Plugin } from "@web/plugin/Plugin";
import { PluginSettingTab } from "@web/plugin/PluginSettingTab";
import { closeTopActiveCloseable, getActiveCloseables } from "@web/ui/ActiveCloseableRegistry";
import { SettingsModal } from "@web/builtin/SettingsModal";
import { SettingsRenderer } from "@web/builtin/SettingsRenderer";

class EmptyPlugin extends Plugin {}

class IndexedSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly definitions: SettingDefinitionItem[],
  ) {
    super(app, plugin);
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return this.definitions;
  }
}

function setupBrowserState(): void {
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
}

describe("Settings DOM parity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setupBrowserState();
    document.body.replaceChildren();
  });

  afterEach(() => {
    while (closeTopActiveCloseable()) {
      // Drain Obsidian's mobile back closeable stack between isolated settings tests.
    }
  });

  it("uses the modal content element as the vertical tabs container", () => {
    const app = new App(document.createElement("div"));
    const modal = new SettingsModal(app);

    modal.open();

    expect(modal.modalEl.classList.contains("mod-settings")).toBe(true);
    expect(modal.modalEl.classList.contains("mod-sidebar-layout")).toBe(true);
    expect(modal.titleEl.textContent).not.toBe("");
    expect(modal.contentEl.classList.contains("vertical-tabs-container")).toBe(true);
    expect([...modal.contentEl.children].map((el) => el.className)).toEqual([
      "vertical-tab-header",
      "vertical-tab-content-container",
    ]);
    expect(modal.contentEl.querySelector(":scope > .vertical-tabs-container")).toBeNull();
  });

  it("creates fixed header groups with data-section on item containers", () => {
    const app = new App(document.createElement("div"));
    const host = document.createElement("div");
    const renderer = new SettingsRenderer(app, host);

    renderer.render();

    const containerEl = host.querySelector<HTMLElement>(".vertical-tabs-container");
    const groups = [
      ...host.querySelectorAll<HTMLElement>(".vertical-tab-header > .vertical-tab-header-group"),
    ];
    expect(containerEl).toBe(renderer.containerEl);
    expect(groups).toHaveLength(3);
    expect(
      groups.map((group) => group.querySelector(".vertical-tab-header-group-title")?.textContent),
    ).toEqual(["Options", "Core plugins", "Community plugins"]);
    expect(
      groups.map(
        (group) =>
          group.querySelector<HTMLElement>(".vertical-tab-header-group-items")?.dataset.section,
      ),
    ).toEqual(["options", "core-plugins", "community-plugins"]);
    expect(groups.some((group) => group.dataset.section)).toBe(false);
    expect(
      host.querySelector(".vertical-tab-header-search .search-input-container"),
    ).not.toBeNull();
  });

  it("generates plugin setting nav items with Obsidian chevron icon DOM", () => {
    const app = new App(document.createElement("div"));
    const plugin = new EmptyPlugin(app, { id: "dom-plugin", name: "DOM Plugin", version: "1.0.0" });
    const tab = new PluginSettingTab(app, plugin);
    app.setting.addSettingTab(tab);
    const host = document.createElement("div");
    const renderer = new SettingsRenderer(app, host);

    renderer.render("dom-plugin");

    const navEl = host.querySelector<HTMLElement>(
      '[data-section="community-plugins"] [data-setting-id="dom-plugin"]',
    );
    expect(navEl?.classList.contains("vertical-tab-nav-item")).toBe(true);
    expect(navEl?.classList.contains("tappable")).toBe(true);
    expect(navEl?.querySelector(".vertical-tab-nav-item-title")?.textContent).toBe("DOM Plugin");
    expect(navEl?.querySelector(".vertical-tab-nav-item-chevron svg")).not.toBeNull();
    expect(tab.containerEl.parentElement).toBe(renderer.contentContainerEl);
  });

  it("registers the active settings tab above the settings modal in the closeable stack", () => {
    const app = new App(document.createElement("div"));
    const plugin = new EmptyPlugin(app, {
      id: "closeable-plugin",
      name: "Closeable Plugin",
      version: "1.0.0",
    });
    const tab = new PluginSettingTab(app, plugin);
    app.setting.addSettingTab(tab);
    const modal = new SettingsModal(app, "closeable-plugin");

    modal.open();

    expect(getActiveCloseables()).toHaveLength(2);
    expect(tab.containerEl.parentElement).toBe(
      modal.contentEl.querySelector(".vertical-tab-content-container"),
    );

    expect(closeTopActiveCloseable()).toBe(true);

    expect(modal.containerEl.isConnected).toBe(true);
    expect(modal.titleEl.textContent).toBe("Settings");
    expect(tab.containerEl.parentElement).toBeNull();
    expect(tab.navEl?.classList.contains("is-active")).toBe(false);
    expect(getActiveCloseables()).toEqual([modal]);

    modal.openTabById("closeable-plugin");

    expect(tab.containerEl.parentElement).toBe(
      modal.contentEl.querySelector(".vertical-tab-content-container"),
    );
    expect(getActiveCloseables()).toHaveLength(2);

    modal.close();

    expect(getActiveCloseables()).toEqual([]);
  });

  it("filters setting navigation from the header search box", () => {
    const app = new App(document.createElement("div"));
    const firstPlugin = new EmptyPlugin(app, {
      id: "alpha-plugin",
      name: "Alpha Plugin",
      version: "1.0.0",
    });
    const secondPlugin = new EmptyPlugin(app, {
      id: "beta-plugin",
      name: "Beta Plugin",
      version: "1.0.0",
    });
    app.setting.addSettingTab(new PluginSettingTab(app, firstPlugin));
    app.setting.addSettingTab(new PluginSettingTab(app, secondPlugin));
    const host = document.createElement("div");
    const renderer = new SettingsRenderer(app, host);

    renderer.render("alpha-plugin");

    const searchInput = host.querySelector<HTMLInputElement>(".vertical-tab-header-search input");
    if (!searchInput) throw new Error("Missing settings search input");
    searchInput.value = "beta";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(host.querySelector('[data-setting-id="alpha-plugin"]')).toBeNull();
    expect(host.querySelector('[data-setting-id="beta-plugin"]')).not.toBeNull();
    expect(renderer.contentContainerEl.textContent).not.toContain("Alpha Plugin");
  });

  it("indexes declarative settings while respecting visible and searchable flags", () => {
    const app = new App(document.createElement("div"));
    const hiddenPlugin = new EmptyPlugin(app, {
      id: "indexed-hidden",
      name: "Indexed A",
      version: "1.0.0",
    });
    const visiblePlugin = new EmptyPlugin(app, {
      id: "indexed-visible",
      name: "Indexed B",
      version: "1.0.0",
    });
    const fragment = document.createDocumentFragment();
    fragment.append("fragment-index");
    app.setting.addSettingTab(
      new IndexedSettingTab(app, hiddenPlugin, [
        { name: "Secret row", aliases: ["secret-index"], searchable: false },
        {
          type: "group",
          heading: "Hidden group",
          visible: false,
          items: [{ name: "hidden-index" }],
        },
      ]),
    );
    app.setting.addSettingTab(
      new IndexedSettingTab(app, visiblePlugin, [
        {
          type: "page",
          name: "Visible page",
          desc: fragment,
          displayValue: () => "function-index",
          items: [{ name: "child-index" }],
        },
      ]),
    );
    const host = document.createElement("div");
    const renderer = new SettingsRenderer(app, host);

    renderer.render("indexed-hidden");

    const searchInput = host.querySelector<HTMLInputElement>(".vertical-tab-header-search input");
    if (!searchInput) throw new Error("Missing settings search input");
    searchInput.value = "fragment-index";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(host.querySelector('[data-setting-id="indexed-hidden"]')).toBeNull();
    expect(host.querySelector('[data-setting-id="indexed-visible"]')).not.toBeNull();

    searchInput.value = "function-index";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(host.querySelector('[data-setting-id="indexed-visible"]')).not.toBeNull();

    searchInput.value = "secret-index";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(host.querySelector('[data-setting-id="indexed-hidden"]')).toBeNull();

    searchInput.value = "hidden-index";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(host.querySelector('[data-setting-id="indexed-hidden"]')).toBeNull();
  });
});
