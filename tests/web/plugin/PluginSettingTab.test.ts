import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import type { SettingDefinitionItem } from "@web/app/SettingTab";
import type { SettingTab } from "@web/app/SettingRegistry";
import { SettingsRenderer } from "@web/builtin/SettingsRenderer";
import { Plugin } from "@web/plugin/Plugin";
import { PluginSettingTab } from "@web/plugin/PluginSettingTab";

class RuntimeSettingTab extends PluginSettingTab {
  displayCount = 0;
  hideCount = 0;

  override display(): void {
    this.displayCount += 1;
    this.containerEl.textContent = `Displayed ${this.name}`;
  }

  override hide(): void {
    this.hideCount += 1;
  }
}

class SettingsPlugin extends Plugin {
  settingTab: RuntimeSettingTab | null = null;

  override async onload(): Promise<void> {
    this.settingTab = new RuntimeSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
  }
}

class DeclarativeSettingTab extends PluginSettingTab {
  displayCount = 0;
  cleanupCount = 0;
  actionCount = 0;
  addCount = 0;
  deletes: number[] = [];
  reorders: Array<[number, number]> = [];
  pageDisplay = "Careful";
  pageStatus: "warning" | null = "warning";
  showAdvanced = true;
  actionDisabled = false;

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "Chat",
        cls: "chat-settings",
        search: {
          placeholder: "Filter chat settings",
          match: (definition, query) => definition.name.toLowerCase().includes(query.toLowerCase()),
        },
        items: [
          {
            name: "Enabled",
            desc: "Turn chat on",
            aliases: ["switch"],
            control: { type: "toggle", key: "enabled", defaultValue: false },
          },
          {
            name: "Name",
            control: {
              type: "text",
              key: "name",
              defaultValue: "Pi",
              validate: (value) => (value.trim().length > 0 ? undefined : "Required"),
            },
          },
          {
            name: "Mode",
            control: {
              type: "dropdown",
              key: "mode",
              defaultValue: "fast",
              options: { fast: "Fast", careful: "Careful" },
            },
          },
          {
            name: "Limit",
            control: { type: "number", key: "limit", defaultValue: 4, min: 1, max: 10 },
          },
          {
            name: "Prompt",
            control: { type: "textarea", key: "prompt", defaultValue: "Hello", rows: 3 },
          },
          {
            name: "Accent",
            control: { type: "color", key: "accent", defaultValue: "#ff0000" },
          },
          {
            name: "Source file",
            control: {
              type: "file",
              key: "sourceFile",
              placeholder: "Pick a note",
              filter: (file) => file.extension === "md",
            },
          },
          {
            name: "Vault folder",
            control: {
              type: "folder",
              key: "vaultFolder",
              placeholder: "Pick a folder",
              includeRoot: true,
              filter: (folder) => folder.path === "/" || folder.path.startsWith("Notes"),
            },
          },
          {
            name: "Temperature",
            visible: () => this.showAdvanced,
            control: {
              type: "slider",
              key: "temperature",
              defaultValue: 1,
              min: 0,
              max: 2,
              step: 0.5,
            },
          },
          {
            name: "Run action",
            action: () => {
              this.actionCount += 1;
            },
            disabled: () => this.actionDisabled,
          },
          {
            name: "Rendered",
            render: (setting) => {
              setting.setDesc("Custom row");
              return () => {
                this.cleanupCount += 1;
              };
            },
          },
        ],
      },
      {
        type: "list",
        heading: "Agents",
        cls: "agent-list",
        emptyState: "No agents",
        addItem: {
          name: "Add agent",
          action: () => {
            this.addCount += 1;
          },
        },
        onDelete: (index) => {
          this.deletes.push(index);
        },
        onReorder: (oldIndex, newIndex) => {
          this.reorders.push([oldIndex, newIndex]);
        },
        items: [
          {
            name: "Planner",
            action: () => {},
          },
          {
            name: "Reviewer",
            action: () => {},
          },
          {
            type: "page",
            name: "Agent detail",
            desc: "Nested settings",
            displayValue: () => this.pageDisplay,
            status: () => this.pageStatus,
            items: [
              {
                name: "Agent model",
                control: { type: "text", key: "agentModel", defaultValue: "gpt-5" },
              },
            ],
          },
        ],
      },
    ];
  }

  override display(): void {
    this.displayCount += 1;
  }
}

function settingRow(host: HTMLElement, name: string): HTMLElement {
  const row = Array.from(host.querySelectorAll<HTMLElement>(".setting-item")).find((item) => {
    return item.querySelector(".setting-item-name")?.textContent === name;
  });
  if (!row) throw new Error(`Missing setting row ${name}`);
  return row;
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function dispatchDrag(source: HTMLElement, target: HTMLElement): void {
  const store = new Map<string, string>();
  const dataTransfer = {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
  };
  const startEvent = new Event("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(startEvent, "dataTransfer", { value: dataTransfer });
  source.dispatchEvent(startEvent);
  const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(dropEvent, "dataTransfer", { value: dataTransfer });
  target.dispatchEvent(dropEvent);
}

describe("PluginSettingTab", () => {
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
  });

  it("lets the settings renderer create community plugin navigation", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    let plugin: SettingsPlugin | null = null;
    await app.pluginInstaller.install({
      manifest: {
        id: "settings-runtime",
        name: "Settings Runtime",
        version: "1.0.0",
      },
      entry: "plugins/settings-runtime/main.js",
      factory: (pluginApp, manifest) => {
        plugin = new SettingsPlugin(pluginApp, manifest);
        return plugin;
      },
    });
    await app.pluginInstaller.enable("settings-runtime");

    const tab = plugin?.settingTab;
    if (!tab) throw new Error("Expected plugin setting tab");
    expect(tab.id).toBe("settings-runtime");
    expect(tab.name).toBe("Settings Runtime");
    expect(tab.section).toBe("community-plugins");
    expect((tab as SettingTab).navEl).toBeNull();
    expect(tab.containerEl.className).toBe("vertical-tab-content");

    const host = document.createElement("div");
    const renderer = new SettingsRenderer(app, host);
    renderer.render("settings-runtime");
    const navEl = host.querySelector<HTMLElement>(
      '[data-section="community-plugins"] [data-setting-id="settings-runtime"]',
    );

    expect(navEl).not.toBeNull();
    expect(navEl?.classList.contains("tappable")).toBe(true);
    expect(navEl?.querySelector(".vertical-tab-nav-item-title")?.textContent).toBe(
      "Settings Runtime",
    );
    expect(navEl?.querySelector(".vertical-tab-nav-item-chevron")).not.toBeNull();

    await app.pluginInstaller.disable("settings-runtime", true);

    expect(app.setting.getTabById("settings-runtime")).toBeNull();
  });

  it("closes the active plugin setting tab when the plugin unloads", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    let plugin: SettingsPlugin | null = null;
    await app.pluginInstaller.install({
      manifest: {
        id: "active-settings-runtime",
        name: "Active Settings Runtime",
        version: "1.0.0",
      },
      entry: "plugins/active-settings-runtime/main.js",
      factory: (pluginApp, manifest) => {
        plugin = new SettingsPlugin(pluginApp, manifest);
        return plugin;
      },
    });
    await app.pluginInstaller.enable("active-settings-runtime");

    app.setting.open("active-settings-runtime");

    const tab = plugin?.settingTab;
    if (!tab) throw new Error("Expected plugin setting tab");
    expect(tab.displayCount).toBe(1);
    expect(document.body.textContent).toContain("Displayed Active Settings Runtime");
    expect(
      document.body
        .querySelector('[data-setting-id="active-settings-runtime"]')
        ?.classList.contains("is-active"),
    ).toBe(true);

    await app.pluginInstaller.disable("active-settings-runtime", true);

    expect(tab.hideCount).toBe(1);
    expect(document.body.textContent).not.toContain("Displayed Active Settings Runtime");
    expect(document.body.querySelector('[data-setting-id="active-settings-runtime"]')).toBeNull();
  });

  it("reads and persists declarative control values through plugin settings by default", async () => {
    const app = new App(document.createElement("div"));
    const plugin = new SettingsPlugin(app, {
      id: "declarative-storage",
      name: "Declarative Storage",
      version: "1.0.0",
    });
    const tab = new PluginSettingTab(app, plugin);
    const saveData = vi.spyOn(plugin, "saveData").mockResolvedValue(undefined);

    plugin.settings = { enabled: false };

    expect(tab.getControlValue("enabled")).toBe(false);

    await tab.setControlValue("enabled", true);
    await tab.setControlValue("name", "Pi");

    expect(plugin.settings).toEqual({ enabled: true, name: "Pi" });
    expect(saveData).toHaveBeenLastCalledWith(plugin.settings);
  });

  it("renders declarative plugin settings before falling back to imperative display", async () => {
    const app = new App(document.createElement("div"));
    const plugin = new SettingsPlugin(app, {
      id: "declarative-render",
      name: "Declarative Render",
      version: "1.0.0",
    });
    plugin.settings = {
      enabled: true,
      name: "Ada",
      mode: "careful",
      limit: 3,
      prompt: "Hello",
      accent: "#00ff00",
      temperature: 1.5,
    };
    await app.vault.createFolder("Notes");
    await app.vault.createFolder("Archive");
    await app.vault.create("Notes/Alpha.md", "alpha");
    await app.vault.create("Archive/Beta.canvas", "{}");
    vi.spyOn(plugin, "saveData").mockResolvedValue(undefined);
    const tab = new DeclarativeSettingTab(app, plugin);
    app.setting.addSettingTab(tab);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const renderer = new SettingsRenderer(app, host);
    renderer.render("declarative-render");

    expect(tab.displayCount).toBe(0);
    expect(tab.settingItems).toHaveLength(2);
    expect(host.querySelector(".setting-group.chat-settings")).not.toBeNull();
    expect(
      host.querySelector(".setting-group.agent-list.setting-list.mod-reorderable"),
    ).not.toBeNull();
    expect(
      settingRow(host, "Enabled")
        .querySelector(".checkbox-container")
        ?.classList.contains("is-enabled"),
    ).toBe(true);
    expect(settingRow(host, "Name").querySelector<HTMLInputElement>("input")?.value).toBe("Ada");
    expect(settingRow(host, "Mode").querySelector<HTMLSelectElement>("select")?.value).toBe(
      "careful",
    );
    expect(settingRow(host, "Prompt").querySelector<HTMLTextAreaElement>("textarea")?.rows).toBe(3);

    const chatSearch = host.querySelector<HTMLInputElement>(
      ".chat-settings .setting-group-search input",
    );
    if (!chatSearch) throw new Error("Missing chat settings search");
    expect(chatSearch.placeholder).toBe("Filter chat settings");
    chatSearch.value = "mode";
    chatSearch.dispatchEvent(new Event("input", { bubbles: true }));
    expect(settingRow(host, "Enabled").style.display).toBe("none");
    expect(settingRow(host, "Mode").style.display).toBe("");

    renderer.render("declarative-render");
    const restoredChatSearch = host.querySelector<HTMLInputElement>(
      ".chat-settings .setting-group-search input",
    );
    if (!restoredChatSearch) throw new Error("Missing restored chat settings search");
    expect(restoredChatSearch.value).toBe("mode");
    expect(settingRow(host, "Enabled").style.display).toBe("none");
    restoredChatSearch.value = "";
    restoredChatSearch.dispatchEvent(new Event("input", { bubbles: true }));
    expect(settingRow(host, "Enabled").style.display).toBe("");

    renderer.setQuery("switch");
    expect(settingRow(host, "Enabled").style.display).toBe("");
    expect(settingRow(host, "Mode").style.display).toBe("none");
    renderer.setQuery("");
    expect(settingRow(host, "Mode").style.display).toBe("");

    const fileInput = settingRow(host, "Source file").querySelector<HTMLInputElement>("input");
    if (!fileInput) throw new Error("Missing file input");
    fileInput.focus();
    fileInput.value = "alpha";
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.body.querySelector<HTMLElement>(".suggestion-item")?.textContent).toBe(
      "Notes/Alpha.md",
    );
    document.body.querySelector<HTMLElement>(".suggestion-item")?.click();
    await flushAsync();
    expect((plugin.settings as Record<string, unknown>).sourceFile).toBe("Notes/Alpha.md");

    const folderInput = settingRow(host, "Vault folder").querySelector<HTMLInputElement>("input");
    if (!folderInput) throw new Error("Missing folder input");
    folderInput.focus();
    folderInput.value = "Notes";
    folderInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.body.querySelector<HTMLElement>(".suggestion-item")?.textContent).toBe("Notes");
    document.body.querySelector<HTMLElement>(".suggestion-item")?.click();
    await flushAsync();
    expect((plugin.settings as Record<string, unknown>).vaultFolder).toBe("Notes");

    const enabledInput = settingRow(host, "Enabled").querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    if (!enabledInput) throw new Error("Missing enabled input");
    enabledInput.checked = false;
    enabledInput?.dispatchEvent(new Event("change", { bubbles: true }));
    await flushAsync();
    expect((plugin.settings as Record<string, unknown>).enabled).toBe(false);

    const nameInput = settingRow(host, "Name").querySelector<HTMLInputElement>("input");
    if (!nameInput) throw new Error("Missing name input");
    nameInput.value = "";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flushAsync();
    expect(settingRow(host, "Name").querySelector(".setting-item-error")?.textContent).toBe(
      "Required",
    );
    expect((plugin.settings as Record<string, unknown>).name).toBe("Ada");

    nameInput.value = "Grace";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flushAsync();
    expect((plugin.settings as Record<string, unknown>).name).toBe("Grace");

    const modeSelect = settingRow(host, "Mode").querySelector<HTMLSelectElement>("select");
    if (!modeSelect) throw new Error("Missing mode select");
    modeSelect.value = "fast";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await flushAsync();
    expect((plugin.settings as Record<string, unknown>).mode).toBe("fast");

    const limitInput = settingRow(host, "Limit").querySelector<HTMLInputElement>(
      'input[type="number"]',
    );
    if (!limitInput) throw new Error("Missing limit input");
    limitInput.value = "99";
    limitInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flushAsync();
    expect((plugin.settings as Record<string, unknown>).limit).toBe(10);

    const actionRow = settingRow(host, "Run action");
    actionRow.click();
    expect(tab.actionCount).toBe(1);
    tab.actionDisabled = true;
    tab.refreshDomState();
    expect(actionRow.classList.contains("is-disabled")).toBe(true);
    actionRow.click();
    expect(tab.actionCount).toBe(1);

    const temperatureRow = settingRow(host, "Temperature");
    tab.showAdvanced = false;
    tab.refreshDomState();
    expect(temperatureRow.style.display).toBe("none");

    host
      .querySelector<HTMLElement>(".agent-list .setting-item-heading .extra-setting-button")
      ?.click();
    expect(tab.addCount).toBe(1);

    const plannerRow = settingRow(host, "Planner");
    const detailRow = settingRow(host, "Agent detail");
    expect(detailRow.classList.contains("mod-warning")).toBe(true);
    expect(detailRow.querySelector(".setting-item-display-value")?.textContent).toBe("Careful");
    expect(
      detailRow.querySelector(".setting-item-display-value")?.classList.contains("mod-warning"),
    ).toBe(true);

    dispatchDrag(plannerRow, detailRow);
    expect(tab.reorders).toEqual([[0, 2]]);

    plannerRow.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    detailRow.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(tab.deletes).toEqual([0, 2]);

    tab.pageDisplay = "Fast";
    tab.pageStatus = null;
    tab.refreshDomState();
    expect(detailRow.classList.contains("mod-warning")).toBe(false);
    expect(detailRow.querySelector(".setting-item-display-value")?.textContent).toBe("Fast");
    expect(
      detailRow.querySelector(".setting-item-display-value")?.classList.contains("mod-warning"),
    ).toBe(false);

    detailRow.click();
    expect(host.querySelector(".setting-page-title")?.textContent).toBe("Agent detail");
    expect(settingRow(host, "Agent model").querySelector<HTMLInputElement>("input")?.value).toBe(
      "gpt-5",
    );

    renderer.render("declarative-render");
    expect(tab.cleanupCount).toBeGreaterThan(0);
  });
});
