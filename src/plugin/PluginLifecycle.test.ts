import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import { SimpleEditor, type Editor, type EditorPosition } from "../editor/Editor";
import { editorDomClass, editorTransactionFilter, editorUpdateListener, editorViewPlugin } from "../editor/EditorExtension";
import { editorEditorField, editorInfoField, editorLivePreviewField, editorViewField, StateEffect, Transaction } from "../editor/EditorStateField";
import { MarkdownRenderChild } from "../markdown/MarkdownRenderChild";
import { MarkdownPreviewRenderer } from "../markdown/MarkdownPreviewRenderer";
import { MarkdownRenderer, type MarkdownCodeBlockProcessor, type MarkdownPostProcessor } from "../markdown/MarkdownRenderer";
import { EditorSuggest, type EditorSuggestTriggerInfo } from "../suggest/EditorSuggest";
import { ItemView } from "../views/ItemView";
import { MarkdownView } from "../views/MarkdownView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { InternalPluginWrapper } from "./InternalPluginWrapper";
import { Plugin } from "./Plugin";
import type { PluginManifest, PluginPackage } from "./PluginManifest";
import { CorePluginSettingTab, PluginSettingTab } from "./PluginSettingTab";
import {
  NO_SOURCE_MAP_MARKER,
  appendPluginSourceUrl,
  prepareDownloadedMainJs,
  prepareLoadedMainJs,
  wrapCommonJsPluginSource,
} from "./PluginSource";

type InternalMarkdownCodeBlockContext = Parameters<MarkdownCodeBlockProcessor>[2] & {
  replaceCode?(source: string): Promise<void>;
};

class LifecyclePlugin extends Plugin {
  didLoad = false;
  didUnload = false;
  sawStyleDuringLoad = false;

  async onload(): Promise<void> {
    await Promise.resolve();
    this.didLoad = true;
    this.sawStyleDuringLoad = document.head.querySelector('style[data-obsidian-reconstructed-css="plugin:life"]') !== null;
    this.addCommand({ id: "hello", name: "Hello", callback: () => {} });
    this.addRibbonIcon("lucide-star", "Run", () => {});
    await this.saveData({ loaded: true });
  }

  async onunload(): Promise<void> {
    await Promise.resolve();
    this.didUnload = true;
  }
}

class CssLifecyclePlugin extends Plugin {
  onload(): void {
    this.registerCss(".plugin-css-one { color: red; }");
    this.registerCss(".plugin-css-two { color: blue; }");
  }
}

class FailingPlugin extends Plugin {
  async onload(): Promise<void> {
    throw new Error("boom");
  }
}

class UserEnablePlugin extends Plugin {
  didLoad = false;
  didUnload = false;
  userEnableCount = 0;

  async onload(): Promise<void> {
    this.didLoad = true;
  }

  async onunload(): Promise<void> {
    this.didUnload = true;
  }

  onUserEnable(): void {
    this.userEnableCount += 1;
  }
}

class ExternalSettingsPlugin extends Plugin {
  changes = 0;

  async onload(): Promise<void> {
    await this.saveData({ value: 1 });
  }

  onExternalSettingsChange(): void {
    this.changes += 1;
  }
}

class AsyncUnloadPlugin extends Plugin {
  didFinishUnload = false;
  resolveUnload: (() => void) | null = null;

  async onunload(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.resolveUnload = resolve;
    });
    this.didFinishUnload = true;
  }
}

class ThrowingUnloadPlugin extends Plugin {
  async onload(): Promise<void> {
    this.addCommand({ id: "still-loaded", name: "Still loaded", callback: () => {} });
  }

  onunload(): void {
    throw new Error("unload failed");
  }
}

class PluginRegisteredView extends ItemView {
  getViewType(): string {
    return "plugin-view";
  }

  getDisplayText(): string {
    return "Plugin view";
  }
}

class ViewRegistrationPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView("plugin-view", (leaf: WorkspaceLeaf) => new PluginRegisteredView(leaf));
    this.registerExtensions(["pluginview"], "plugin-view");
  }
}

class ChromeSuggest extends EditorSuggest<string> {
  onTrigger(cursor: EditorPosition): EditorSuggestTriggerInfo {
    return { start: cursor, end: cursor, query: "chrome" };
  }

  getSuggestions(): string[] {
    return ["Plugin suggestion"];
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.textContent = value;
  }

  selectSuggestion(): void {}
}

class ChromeApiPlugin extends Plugin {
  removedCommandId = "";
  keptCommandId = "";
  protocolHits = 0;
  suggest: ChromeSuggest | null = null;
  statusEl: HTMLElement | null = null;
  ribbonClickType = "";
  cliHits: Array<Record<string, string>> = [];
  protocolPayload: Record<string, unknown> | null = null;

  async onload(): Promise<void> {
    const removed = this.addCommand({
      id: "manual-remove",
      name: "Manual Remove",
      hotkeys: [{ modifiers: ["Mod"], key: "m" }],
      callback: () => {},
    });
    this.removedCommandId = removed.id;
    this.removeCommand("manual-remove");
    const kept = this.addCommand({
      id: "kept",
      name: "Kept",
      hotkeys: [{ modifiers: ["Mod"], key: "k" }],
      callback: () => {},
    });
    this.keptCommandId = kept.id;
    this.addRibbonIcon("lucide-mouse-pointer-click", "Mouse event", (event) => {
      this.ribbonClickType = event.type;
    });
    this.statusEl = this.addStatusBarItem();
    this.statusEl.textContent = "Plugin status";
    this.registerObsidianProtocolHandler("chrome-api", (payload) => {
      this.protocolHits += 1;
      this.protocolPayload = { ...payload };
    });
    this.suggest = new ChromeSuggest(this.app);
    this.registerEditorSuggest(this.suggest);
    this.registerCliHandler("chrome-api", "Run the Chrome API plugin", {
      "dry-run": {
        description: "Run without changing state",
      },
    }, (params) => {
      this.cliHits.push(params);
      return params["dry-run"] === "true" ? "chrome-cli" : "wrong-flags";
    });
  }
}

class MarkdownProcessorPlugin extends Plugin {
  postOrder: string[] = [];
  sectionLines: Array<{ lineStart: number; lineEnd: number }> = [];
  codeSources: string[] = [];
  renderChildLoads = 0;
  renderChildUnloads = 0;
  replaceCodeAvailable = false;
  originalProcessor: MarkdownCodeBlockProcessor | null = null;
  wrappedProcessor: MarkdownPostProcessor | null = null;

  async onload(): Promise<void> {
    this.registerMarkdownPostProcessor(() => {
      this.postOrder.push("late");
    }, 50);
    this.registerMarkdownPostProcessor((el, context) => {
      this.postOrder.push("early");
      const info = context.getSectionInfo(el);
      if (info) this.sectionLines.push({ lineStart: info.lineStart, lineEnd: info.lineEnd });
    }, -50);
    const processor: MarkdownCodeBlockProcessor = (source, el, context) => {
      this.codeSources.push(source);
      this.replaceCodeAvailable = typeof (context as InternalMarkdownCodeBlockContext).replaceCode === "function";
      context.addChild(new CountingMarkdownRenderChild(el, this));
      el.classList.add("plugin-code-block");
      el.textContent = `plugin:${source}`;
    };
    this.originalProcessor = processor;
    this.wrappedProcessor = this.registerMarkdownCodeBlockProcessor("plugin-block", processor);
  }
}

class CountingMarkdownRenderChild extends MarkdownRenderChild {
  constructor(containerEl: HTMLElement, readonly plugin: MarkdownProcessorPlugin) {
    super(containerEl);
  }

  override onload(): void {
    this.plugin.renderChildLoads += 1;
  }

  override onunload(): void {
    this.plugin.renderChildUnloads += 1;
  }
}

class EditorExtensionPlugin extends Plugin {
  extension = [
    editorDomClass("plugin-editor-extension"),
    editorViewPlugin((view) => {
      view.dom.dataset.pluginViewPlugin = "mounted";
      return {
        update: (update) => {
          view.dom.dataset.pluginViewPluginUpdate = `${update.docChanged}:${update.selectionSet}:${update.transactions.length}`;
        },
        destroy: () => {
          view.dom.dataset.pluginViewPlugin = "destroyed";
        },
      };
    }),
    editorUpdateListener((update) => {
      update.view.dom.dataset.pluginUpdateListener = update.transactions.length > 0
        ? "dispatch"
        : update.docChanged ? "doc" : "selection";
    }),
    editorTransactionFilter((transaction) => new Transaction([...transaction.effects, new StateEffect("filtered")])),
  ];

  async onload(): Promise<void> {
    this.registerEditorExtension(this.extension);
  }
}

class LiveSettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, readonly owner: LiveSettingsPlugin) {
    super(app, plugin);
    this.containerEl.textContent = "Live plugin settings";
  }

  override display(): void {
    this.containerEl.textContent = "Live plugin settings";
  }

  override hide(): void {
    this.owner.hideCount += 1;
    super.hide();
  }
}

class LiveSettingsPlugin extends Plugin {
  tab: LiveSettingsTab | null = null;
  hideCount = 0;

  async onload(): Promise<void> {
    this.tab = new LiveSettingsTab(this.app, this, this);
    this.addSettingTab(this.tab);
  }
}

describe("community plugin lifecycle", () => {
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
    delete (window as Window & { require?: unknown }).require;
    document.body.classList.remove("emulate-mobile");
  });

  it("installs, enables and disables a community plugin package with cleanup", async () => {
    const app = new App(document.createElement("div"));
    const manifest = manifestFor("life");
    let instance: LifecyclePlugin | null = null;
    const pkg: PluginPackage = {
      manifest,
      entry: "plugins/life/main.js",
      styles: ".plugin-life { color: red; }",
      factory: (pluginApp, pluginManifest) => {
        instance = new LifecyclePlugin(pluginApp, pluginManifest);
        return instance;
      },
    };

    app.pluginSecurity.setCommunityPluginsEnabled(true);
    const record = await app.pluginInstaller.install(pkg);

    expect(record.enabled).toBe(false);
    expect(app.communityPlugins.get("life")?.installed).toBe(true);

    await app.pluginInstaller.enable("life");

    expect(instance?.didLoad).toBe(true);
    expect(instance?.sawStyleDuringLoad).toBe(false);
    expect(document.head.querySelector('style[data-obsidian-reconstructed-css="plugin:life"]')).not.toBeNull();
    expect(app.plugins.getPlugin("life")).toBe(instance);
    expect(app.commands.findCommand("life:hello")?.name).toBe("Lifecycle: Hello");
    expect(app.workspace.leftRibbon.containerEl.querySelector('.side-dock-ribbon-action[aria-label="Run"]')).not.toBeNull();
    await expect(instance?.loadData()).resolves.toEqual({ loaded: true });
    await expect(app.vault.readPluginData("plugins/life")).resolves.toEqual({ loaded: true });
    await expect(app.jsonStore.read("plugins/life/data.json")).resolves.toEqual({ loaded: true });
    expect(app.communityPlugins.get("life")?.enabled).toBe(true);
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toEqual(["life"]);

    await app.pluginInstaller.disable("life");

    expect(instance?.didUnload).toBe(true);
    expect(app.plugins.getPlugin("life")).toBeNull();
    expect(app.commands.findCommand("life:hello")).toBeNull();
    expect(app.workspace.leftRibbon.containerEl.querySelector('.side-dock-ribbon-action[aria-label="Run"]')).toBeNull();
    expect(document.head.querySelector('style[data-obsidian-reconstructed-css="plugin:life"]')).toBeNull();
    expect(app.communityPlugins.get("life")?.enabled).toBe(false);
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toEqual([]);
  });

  it("records enable failures and leaves failed plugins disabled", async () => {
    const app = new App(document.createElement("div"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const manifest = manifestFor("fail");
    const pkg: PluginPackage = {
      manifest,
      entry: "plugins/fail/main.js",
      factory: (pluginApp, pluginManifest) => new FailingPlugin(pluginApp, pluginManifest),
    };

    app.pluginSecurity.setCommunityPluginsEnabled(true);
    await app.pluginInstaller.install(pkg);
    await expect(app.pluginInstaller.enable("fail")).resolves.toBe(false);

    expect(app.plugins.getPlugin("fail")).toBeNull();
    expect(app.communityPlugins.get("fail")?.enabled).toBe(false);
    expect(app.communityPlugins.get("fail")?.error).toBe("boom");
    expect(app.plugins.getState("fail")?.error).toBe("boom");
    expect(document.body.textContent).toContain("Failed to enable plugin fail");
    expect(errorSpy).toHaveBeenCalledWith("Plugin failure: fail", expect.any(Error));
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toBeNull();
  });

  it("only calls onUserEnable for user-initiated community plugin enables", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    const instances: UserEnablePlugin[] = [];
    await app.pluginInstaller.install({
      manifest: {
        id: "user-enable",
        name: "User Enable",
        version: "1.0.0",
      },
      entry: "plugins/user-enable/main.js",
      factory: (pluginApp, pluginManifest) => {
        const instance = new UserEnablePlugin(pluginApp, pluginManifest);
        instances.push(instance);
        return instance;
      },
    });

    await app.pluginInstaller.enable("user-enable");

    expect(instances[0].didLoad).toBe(true);
    expect(instances[0].userEnableCount).toBe(0);

    await app.pluginInstaller.disable("user-enable", true);
    await app.pluginInstaller.enable("user-enable", true);

    expect(instances[0].didUnload).toBe(true);
    expect(instances[0]._userDisabled).toBe(true);
    expect(instances[1].didLoad).toBe(true);
    expect(instances[1].userEnableCount).toBe(1);
  });

  it("debounces external data.json changes into onExternalSettingsChange", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    let instance: ExternalSettingsPlugin | null = null;
    await app.pluginInstaller.install({
      manifest: {
        id: "external-settings",
        name: "External Settings",
        version: "1.0.0",
      },
      entry: "plugins/external-settings/main.js",
      factory: (pluginApp, pluginManifest) => {
        instance = new ExternalSettingsPlugin(pluginApp, pluginManifest);
        return instance;
      },
    });

    await app.pluginInstaller.enable("external-settings");
    await new Promise((resolve) => window.setTimeout(resolve, 70));

    expect(instance?.changes).toBe(0);

    await app.jsonStore.write("plugins/external-settings/data.json", { value: 2 });
    await app.jsonStore.write("plugins/external-settings/data.json", { value: 3 });
    await new Promise((resolve) => window.setTimeout(resolve, 70));

    expect(instance?.changes).toBe(1);

    await app.jsonStore.write("plugins/external-settings/manifest.json", { id: "external-settings" });
    await app.jsonStore.writeText("plugins/external-settings/main.js", "module.exports = class {};");
    await app.jsonStore.writeText("plugins/external-settings/styles.css", ".external-settings {}");
    await new Promise((resolve) => window.setTimeout(resolve, 70));

    expect(instance?.changes).toBe(1);
  });

  it("keeps plugin CSS registrations as independent style nodes cleaned by plugin unload", async () => {
    const app = new App(document.createElement("div"));
    const plugin = new CssLifecyclePlugin(app, {
      id: "css-life",
      name: "CSS Life",
      version: "1.0.0",
      dir: "plugins/css-life",
    });

    await plugin.load();
    await plugin.loadCSS(".plugin-css-three { color: green; }");

    const styles = getPluginStyleEls("css-life");
    expect(styles.map((style) => style.textContent)).toEqual([
      ".plugin-css-one { color: red; }",
      ".plugin-css-two { color: blue; }",
      ".plugin-css-three { color: green; }",
    ]);
    expect(styles.every((style) => isBefore(style, app.customCss.styleEl))).toBe(true);

    plugin.unload();

    expect(getPluginStyleEls("css-life")).toHaveLength(0);
  });

  it("loads repeated plugin styles.css reads without replacing earlier plugin CSS", async () => {
    const app = new App(document.createElement("div"));
    const plugin = new Plugin(app, {
      id: "css-file",
      name: "CSS File",
      version: "1.0.0",
      dir: "plugins/css-file",
    });
    await plugin.load();

    await app.jsonStore.writeText("plugins/css-file/styles.css", ".css-file-one {}");
    await plugin.loadCSS();
    await app.jsonStore.writeText("plugins/css-file/styles.css", ".css-file-two {}");
    await plugin.loadCSS();

    expect(getPluginStyleEls("css-file").map((style) => style.textContent)).toEqual([
      ".css-file-one {}",
      ".css-file-two {}",
    ]);

    plugin.unload();

    expect(getPluginStyleEls("css-file")).toHaveLength(0);
  });

  it("routes internal plugin config json raw changes into onExternalSettingsChange with mtime gating", async () => {
    const app = new App(document.createElement("div"));
    let changes = 0;
    app.internalPlugins.register({
      id: "internal-settings",
      name: "Internal Settings",
      defaultOn: false,
      init: () => {},
      onEnable: async (_app, plugin) => {
        await plugin.saveData({ value: 1 });
      },
      onExternalSettingsChange: async (_app, plugin) => {
        changes += 1;
        await plugin.loadData();
      },
    });

    await app.internalPlugins.enable("internal-settings");
    const wrapper = app.internalPlugins.getPluginById("internal-settings");
    expect(await app.jsonStore.read("internal-settings.json")).toEqual({ value: 1 });

    await app.jsonStore.write("internal-settings.json", { value: 2 });

    await vi.waitFor(() => expect(changes).toBe(1));

    await wrapper?.saveData({ value: 3 });
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(changes).toBe(1);
  });

  it("removes a community plugin immediately without waiting for async onunload", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    let instance: AsyncUnloadPlugin | null = null;
    await app.pluginInstaller.install({
      manifest: {
        id: "async-unload",
        name: "Async Unload",
        version: "1.0.0",
      },
      entry: "plugins/async-unload/main.js",
      factory: (pluginApp, pluginManifest) => {
        instance = new AsyncUnloadPlugin(pluginApp, pluginManifest);
        return instance;
      },
    });
    await app.pluginInstaller.enable("async-unload");

    await app.pluginInstaller.disable("async-unload", true);

    expect(app.plugins.getPlugin("async-unload")).toBeNull();
    expect(app.communityPlugins.get("async-unload")?.enabled).toBe(false);
    expect(instance?.didFinishUnload).toBe(false);

    instance?.resolveUnload?.();
    await Promise.resolve();

    expect(instance?.didFinishUnload).toBe(true);
  });

  it("saves disabled config and keeps the plugin instance when unload throws", async () => {
    const app = new App(document.createElement("div"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    await app.pluginInstaller.install({
      manifest: {
        id: "throw-unload",
        name: "Throw Unload",
        version: "1.0.0",
      },
      entry: "plugins/throw-unload/main.js",
      factory: (pluginApp, pluginManifest) => new ThrowingUnloadPlugin(pluginApp, pluginManifest),
    });
    await app.pluginInstaller.enable("throw-unload");

    await expect(app.pluginInstaller.disable("throw-unload", true)).resolves.toBeUndefined();

    expect(app.plugins.getPlugin("throw-unload")).not.toBeNull();
    expect(app.communityPlugins.get("throw-unload")?.enabled).toBe(false);
    expect(app.communityPlugins.get("throw-unload")?.error).toBe("unload failed");
    expect(app.commands.findCommand("throw-unload:still-loaded")).toBeNull();
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toEqual([]);
    expect(document.body.textContent).toContain("Failed to disable plugin throw-unload");
    expect(errorSpy).toHaveBeenCalledWith("Plugin failure: throw-unload", expect.any(Error));
  });

  it("detaches registered view leaves only when a community plugin is user-disabled", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    await app.pluginInstaller.install({
      manifest: {
        id: "view-plugin",
        name: "View Plugin",
        version: "1.0.0",
      },
      entry: "plugins/view-plugin/main.js",
      factory: (pluginApp, pluginManifest) => new ViewRegistrationPlugin(pluginApp, pluginManifest),
    });
    await app.pluginInstaller.enable("view-plugin");
    const leaf = app.workspace.getLeaf(true);
    await leaf.setViewState({ type: "plugin-view", state: {}, active: true });

    expect(app.workspace.getLeavesOfType("plugin-view")).toHaveLength(1);
    expect(app.viewRegistry.getTypeByExtension("pluginview")).toBe("plugin-view");

    await app.pluginInstaller.install({
      manifest: {
        id: "view-plugin",
        name: "View Plugin",
        version: "2.0.0",
      },
      entry: "plugins/view-plugin/main.js",
      factory: (pluginApp, pluginManifest) => new ViewRegistrationPlugin(pluginApp, pluginManifest),
    });

    expect(app.workspace.getLeavesOfType("plugin-view")).toHaveLength(1);
    expect(app.viewRegistry.getTypeByExtension("pluginview")).toBe("plugin-view");

    await app.pluginInstaller.disable("view-plugin", true);

    expect(app.workspace.getLeavesOfType("plugin-view")).toHaveLength(0);
    expect(app.viewRegistry.getTypeByExtension("pluginview")).toBeUndefined();
  });

  it("routes plugin-owned file extensions through the registered view type", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    await app.pluginInstaller.install({
      manifest: {
        id: "view-plugin",
        name: "View Plugin",
        version: "1.0.0",
      },
      entry: "plugins/view-plugin/main.js",
      factory: (pluginApp, pluginManifest) => new ViewRegistrationPlugin(pluginApp, pluginManifest),
    });
    await app.pluginInstaller.enable("view-plugin");
    const file = await app.vault.create("Custom.pluginview", "plugin view payload");

    const leaf = await app.workspace.openFile(file, { active: true });

    expect(leaf.view).toBeInstanceOf(PluginRegisteredView);
    expect(leaf.view.getViewType()).toBe("plugin-view");
    expect(app.workspace.getLeavesOfType("plugin-view")).toContain(leaf);

    await app.pluginInstaller.disable("view-plugin", true);
    const openWithDefaultApp = vi.fn();
    (app as unknown as { openWithDefaultApp: (path: string) => void }).openWithDefaultApp = openWithDefaultApp;

    await app.workspace.openFile(file, { active: true });

    expect(app.viewRegistry.getTypeByExtension("pluginview")).toBeUndefined();
    expect(app.workspace.getLeavesOfType("plugin-view")).toHaveLength(0);
    expect(openWithDefaultApp).toHaveBeenCalledWith("Custom.pluginview");
  });

  it("restores unknown plugin view leaves when the registering plugin loads", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    const leaf = app.workspace.getLeaf(true);

    await leaf.setViewState({ type: "plugin-view", state: { value: 42 }, active: true });

    expect(leaf.view.getViewType()).toBe("plugin-view");
    expect(leaf.view.constructor.name).toBe("UnknownView");

    await app.pluginInstaller.install({
      manifest: {
        id: "view-plugin",
        name: "View Plugin",
        version: "1.0.0",
      },
      entry: "plugins/view-plugin/main.js",
      factory: (pluginApp, pluginManifest) => new ViewRegistrationPlugin(pluginApp, pluginManifest),
    });
    await app.pluginInstaller.enable("view-plugin");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(leaf.view).toBeInstanceOf(PluginRegisteredView);
    expect(app.workspace.getLeavesOfType("plugin-view")).toContain(leaf);
  });

  it("cleans command hotkeys and status bar items through plugin UI APIs", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    let instance: ChromeApiPlugin | null = null;
    await app.pluginInstaller.install({
      manifest: {
        id: "chrome-api",
        name: "Chrome API",
        version: "1.0.0",
      },
      entry: "plugins/chrome-api/main.js",
      factory: (pluginApp, pluginManifest) => {
        instance = new ChromeApiPlugin(pluginApp, pluginManifest);
        return instance;
      },
    });

    await app.pluginInstaller.enable("chrome-api");

    expect(instance?.removedCommandId).toBe("chrome-api:manual-remove");
    expect(app.commands.findCommand("chrome-api:manual-remove")).toBeNull();
    expect(app.hotkeys.getHotkeys("chrome-api:manual-remove")).toBeUndefined();
    expect(app.commands.findCommand("chrome-api:kept")?.name).toBe("Chrome API: Kept");
    expect(app.hotkeys.getDefaultHotkeys("chrome-api:kept")).toEqual([{ modifiers: ["Mod"], key: "k" }]);
    const ribbonEl = app.workspace.leftRibbon.containerEl.querySelector<HTMLButtonElement>('.side-dock-ribbon-action[aria-label="Mouse event"]');
    expect(ribbonEl?.classList.contains("clickable-icon")).toBe(true);
    expect(ribbonEl?.classList.contains("side-dock-ribbon-action")).toBe(true);
    ribbonEl?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(instance?.ribbonClickType).toBe("click");
    expect(instance?.statusEl?.classList.contains("status-bar-item")).toBe(true);
    expect(instance?.statusEl?.classList.contains("plugin-chrome-api")).toBe(true);
    expect(instance?.statusEl?.textContent).toBe("Plugin status");
    expect(instance?.statusEl?.parentElement).toBe(app.statusBar.containerEl);
    await app.uriRouter.handleUri("obsidian://chrome-api?file=Folder%2FNote.md&empty&dry-run=true");
    expect(instance?.protocolHits).toBe(1);
    expect(instance?.protocolPayload).toMatchObject({
      action: "chrome-api",
      file: "Folder/Note.md",
      empty: "true",
      "dry-run": "true",
    });
    expect(instance?.protocolPayload?.params).toBeUndefined();
    expect(app.cliHandlers.find((handler) => handler.command === "chrome-api")).toMatchObject({
      description: "Run the Chrome API plugin",
      flags: { "dry-run": { description: "Run without changing state" } },
      owner: "chrome-api",
    });
    await expect(app.runCliHandler("chrome-api", ["--dry-run"])).resolves.toEqual(["chrome-cli"]);
    expect(instance?.cliHits).toEqual([{ "dry-run": "true" }]);
    expect(() => app.workspace.registerObsidianProtocolHandler("chrome-api", () => {})).toThrow(
      'Action "chrome-api" is already registered as a handler.',
    );
    const editor = new SimpleEditor();
    const anchorEl = document.createElement("textarea");
    document.body.appendChild(anchorEl);
    await app.workspace.editorSuggest.trigger(editor, anchorEl);
    expect(document.body.textContent).toContain("Plugin suggestion");

    await app.pluginInstaller.disable("chrome-api", true);

    expect(app.commands.findCommand("chrome-api:kept")).toBeNull();
    expect(app.hotkeys.getDefaultHotkeys("chrome-api:kept")).toBeUndefined();
    expect(instance?.statusEl?.parentElement).toBeNull();
    await expect(app.uriRouter.handleUri("obsidian://chrome-api")).resolves.toBe(false);
    await expect(app.runCliHandler("chrome-api", ["--dry-run"])).resolves.toEqual([]);
    await app.workspace.editorSuggest.trigger(editor, anchorEl);
    expect(document.body.textContent).not.toContain("Plugin suggestion");
    anchorEl.remove();
  });

  it("runs plugin markdown processors through the registered post processor pipeline", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    let instance: MarkdownProcessorPlugin | null = null;
    await app.pluginInstaller.install({
      manifest: {
        id: "markdown-api",
        name: "Markdown API",
        version: "1.0.0",
      },
      entry: "plugins/markdown-api/main.js",
      factory: (pluginApp, pluginManifest) => {
        instance = new MarkdownProcessorPlugin(pluginApp, pluginManifest);
        return instance;
      },
    });

    await app.pluginInstaller.enable("markdown-api");

    expect(instance?.wrappedProcessor).not.toBe(instance?.originalProcessor);
    expect(() => MarkdownRenderer.registerCodeBlockPostProcessor("plugin-block", () => {})).toThrow(
      "Code block postprocessor for language plugin-block is already registered",
    );
    const container = document.createElement("div");
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md", instance ?? undefined);
    renderer.set("Before\n\n```plugin-block\nhello\n```");
    await renderer.whenIdle();

    expect(instance?.postOrder).toEqual(["early", "late", "early", "late"]);
    expect(instance?.sectionLines).toEqual([
      { lineStart: 0, lineEnd: 0 },
      { lineStart: 2, lineEnd: 4 },
    ]);
    expect(instance?.codeSources).toEqual(["hello"]);
    expect(instance?.renderChildLoads).toBe(1);
    expect(instance?.renderChildUnloads).toBe(0);
    expect(instance?.replaceCodeAvailable).toBe(true);
    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector(".block-language-plugin-block")?.textContent).toBe("plugin:hello");

    renderer.set("After");
    await renderer.whenIdle();

    expect(instance?.renderChildUnloads).toBe(1);

    await app.pluginInstaller.disable("markdown-api", true);

    const afterUnload = document.createElement("div");
    await MarkdownRenderer.render(app, "```plugin-block\nhello\n```", afterUnload, "note.md");

    expect(afterUnload.querySelector("pre code.language-plugin-block")?.textContent).toBe("hello");
    expect(afterUnload.querySelector(".block-language-plugin-block")).toBeNull();
  });

  it("updates already-open markdown editors when plugin editor extensions change", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    await app.ready;
    const file = await app.vault.create("note.md", "hello");
    const leaf = app.workspace.getLeaf();
    await leaf.openFile(file, { active: true });
    expect(leaf.view).toBeInstanceOf(MarkdownView);
    const view = leaf.view as MarkdownView;
    const hostEl = view.editorContainerEl.querySelector<HTMLElement>("[data-extension-count]");

    expect(hostEl?.dataset.extensionCount).toBe("0");
    expect(view.editorViewHost.getStateField(editorEditorField)).toBe(view.editorViewHost);
    expect(view.editorViewHost.getStateField(editorInfoField)).toBe(view);
    expect(view.editorViewHost.getStateField(editorViewField)).toBe(view);
    expect(view.editorViewHost.getStateField(editorLivePreviewField)).toBe(true);
    let instance: EditorExtensionPlugin | null = null;

    await app.pluginInstaller.install({
      manifest: {
        id: "editor-extension",
        name: "Editor Extension",
        version: "1.0.0",
      },
      entry: "plugins/editor-extension/main.js",
      factory: (pluginApp, pluginManifest) => {
        instance = new EditorExtensionPlugin(pluginApp, pluginManifest);
        return instance;
      },
    });

    await app.pluginInstaller.enable("editor-extension");

    expect(hostEl?.dataset.extensionCount).toBe("4");
    expect(view.editorViewHost.getExtensions().at(-1)?.source).toBe("plugin");
    expect(hostEl?.classList.contains("plugin-editor-extension")).toBe(true);
    expect(hostEl?.dataset.viewPluginCount).toBe("1");
    expect(hostEl?.dataset.updateListenerCount).toBe("1");
    expect(hostEl?.dataset.pluginViewPlugin).toBe("mounted");

    view.editor.setValue("changed", "plugin-test");
    expect(hostEl?.dataset.pluginUpdateListener).toBe("doc");
    expect(hostEl?.dataset.pluginViewPluginUpdate).toBe("true:false:0");

    view.editorViewHost.dispatch(new Transaction([new StateEffect("original")]));
    expect(hostEl?.dataset.lastTransactionEffects).toBe("2");
    expect(hostEl?.dataset.pluginUpdateListener).toBe("dispatch");
    expect(hostEl?.dataset.pluginViewPluginUpdate).toBe("false:false:1");

    instance?.extension.push(editorDomClass("plugin-dynamic-extension"));
    app.workspace.updateOptions();
    expect(hostEl?.classList.contains("plugin-dynamic-extension")).toBe(true);

    instance?.extension.pop();
    app.workspace.updateOptions();
    expect(hostEl?.classList.contains("plugin-dynamic-extension")).toBe(false);

    await app.pluginInstaller.disable("editor-extension", true);

    expect(hostEl?.dataset.extensionCount).toBe("0");
    expect(hostEl?.classList.contains("plugin-editor-extension")).toBe(false);
    expect(hostEl?.dataset.pluginViewPlugin).toBe("destroyed");
  });

  it("updates an already-open settings modal when plugin setting tabs are added or removed", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    let instance: LiveSettingsPlugin | null = null;
    app.setting.open();

    await app.pluginInstaller.install({
      manifest: {
        id: "live-settings",
        name: "Live Settings",
        version: "1.0.0",
      },
      entry: "plugins/live-settings/main.js",
      factory: (pluginApp, pluginManifest) => {
        instance = new LiveSettingsPlugin(pluginApp, pluginManifest);
        return instance;
      },
    });

    await app.pluginInstaller.enable("live-settings");

    expect(instance?.tab?.navEl?.parentElement).not.toBeNull();
    expect(instance?.tab?.navEl?.dataset.settingId).toBe("live-settings");
    expect(instance?.tab).toBeInstanceOf(PluginSettingTab);
    expect(instance?.tab?.navEl?.closest("[data-section]")?.getAttribute("data-section")).toBe("community-plugins");

    const openedTab = app.setting.openTabById("live-settings");

    expect(openedTab).toBe(instance?.tab);
    expect(instance?.tab?.containerEl?.parentElement).not.toBeNull();
    expect(instance?.tab?.containerEl?.textContent).toBe("Live plugin settings");

    await app.pluginInstaller.disable("live-settings", true);

    expect(instance?.tab?.navEl?.parentElement).toBeNull();
    expect(instance?.tab?.containerEl?.parentElement).toBeNull();
    expect(instance?.hideCount).toBe(1);
  });

  it("keeps concrete internal plugin setting tabs in the core plugin section", () => {
    const app = new App(document.createElement("div"));
    const delegate: SettingTab = {
      id: "delegate-id",
      name: "Delegate",
      containerEl: document.createElement("div"),
      display: vi.fn(),
      hide: vi.fn(),
    };
    const wrapper = new InternalPluginWrapper(app, {
      id: "core-identity",
      name: "Core Identity",
      defaultOn: true,
      init: () => {},
    }, app.internalPlugins);
    const coreTab = new CorePluginSettingTab(app, wrapper, delegate);

    wrapper.addSettingTab(coreTab);

    const tab = app.setting.getTabById("core-identity");
    expect(tab).toBeInstanceOf(CorePluginSettingTab);
    expect(tab?.name).toBe("Core Identity");
    expect(app.setting.getTabById("delegate-id")).toBeNull();

    app.setting.open();
    const openedTab = app.setting.openTabById("core-identity");

    expect(openedTab).toBe(tab);
    expect(delegate.display).toHaveBeenCalled();
    expect((tab as SettingTab).navEl?.closest("[data-section]")?.getAttribute("data-section")).toBe("core-plugins");
  });

  it("registers and cleans internal plugin CLI handlers with core plugin enablement", async () => {
    const app = new App(document.createElement("div"));
    const hits: string[][] = [];
    const wrapper = new InternalPluginWrapper(app, {
      id: "core-cli",
      name: "Core CLI",
      defaultOn: false,
      init: (_app, plugin) => {
        plugin.registerCliHandler("core-cli", "Run core CLI", null, (params) => {
          hits.push(Object.keys(params));
          return "core-cli";
        });
      },
    }, app.internalPlugins);

    wrapper.init();
    await wrapper.enable();

    await expect(app.runCliHandler("core-cli", ["--list"])).resolves.toEqual(["core-cli"]);
    expect(hits).toEqual([["list"]]);

    await wrapper.disable(true);

    await expect(app.runCliHandler("core-cli", ["--list"])).resolves.toEqual([]);
  });

  it("enforces unique CLI commands and required flag metadata", async () => {
    const app = new App(document.createElement("div"));
    app.registerCliHandler("sample", "Run sample", {
      path: {
        value: "<path>",
        description: "Path to open",
        required: true,
      },
    }, (params) => params.path);

    expect(() => app.registerCliHandler("sample", "Duplicate sample", null, () => "duplicate")).toThrow(
      'CLI command "sample" is already registered.',
    );
    await expect(app.runCliHandler("sample", [])).rejects.toThrow('Missing required CLI flag "path" for command "sample".');
    await expect(app.runCliHandler("sample", ["--path=Daily.md"])).resolves.toEqual(["Daily.md"]);
  });

  it("downloads marketplace source packages into the plugins folder before enabling", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    app.pluginInstaller.setPackageDownloader({
      async fetchJson<T>(url: string): Promise<T> {
        expect(url).toBe("https://github.com/ada/remote/releases/download/1.0.0/manifest.json");
        return {
          id: "remote",
          name: "Remote Plugin",
          version: "1.0.0",
          author: "Ada",
        } as T;
      },
      async fetchText(url: string): Promise<string> {
        expect(url).toBe("https://github.com/ada/remote/releases/download/1.0.0/main.js");
        return `
          const { Plugin } = require("obsidian");
          module.exports = class RemotePlugin extends Plugin {
            async onload() {
              this.addCommand({ id: "downloaded", name: "Downloaded", callback: () => {} });
            }
          };
        `;
      },
      async fetchOptionalText(url: string): Promise<string | null> {
        if (url.endsWith("main.js")) {
          return [
            'const { Plugin } = require("obsidian");',
            "module.exports = class RemotePlugin extends Plugin {",
            "  async onload() {",
            '    this.addCommand({ id: "downloaded", name: "Downloaded", callback: () => {} });',
            "  }",
            "};",
            "//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozfQ==",
          ].join("\n");
        }
        expect(url).toBe("https://github.com/ada/remote/releases/download/1.0.0/styles.css");
        return ".remote-plugin { color: green; }";
      },
    });
    app.pluginMarketplace.registerEntry({
      manifest: {
        id: "remote",
        name: "Remote Plugin",
        version: "1.0.0",
        author: "Ada",
      },
      repo: "ada/remote",
    });

    const pkg = app.pluginMarketplace.createPackage("remote");
    if (!pkg) throw new Error("Expected marketplace package");
    const record = await app.pluginInstaller.install(pkg);

    expect(record.version).toBe("1.0.0");
    await expect(app.jsonStore.read("plugins/remote/manifest.json")).resolves.toMatchObject({ id: "remote", version: "1.0.0" });
    const installedMainJs = await app.jsonStore.readText("plugins/remote/main.js");
    expect(installedMainJs).toContain("RemotePlugin");
    expect(installedMainJs).not.toContain("sourceMappingURL=data:application/json");
    expect(installedMainJs).toContain("\n/* nosourcemap */");
    await expect(app.jsonStore.readText("plugins/remote/styles.css")).resolves.toContain("remote-plugin");

    await app.pluginInstaller.enable("remote");

    expect(app.commands.findCommand("remote:downloaded")?.name).toBe("Remote Plugin: Downloaded");
    expect(document.head.querySelector('style[data-obsidian-reconstructed-css="plugin:remote"]')?.textContent).toContain("remote-plugin");
  });

  it("continues installing marketplace source packages when optional plugin files are missing", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    app.pluginInstaller.setPackageDownloader({
      async fetchJson<T>(): Promise<T> {
        return {
          id: "manifest-only",
          name: "Manifest Only",
          version: "1.0.0",
        } as T;
      },
      async fetchText(): Promise<string> {
        throw new Error("missing");
      },
      async fetchOptionalText(): Promise<string | null> {
        return null;
      },
    });
    app.pluginMarketplace.registerEntry({
      manifest: {
        id: "manifest-only",
        name: "Manifest Only",
        version: "1.0.0",
      },
      repo: "ada/manifest-only",
    });

    const pkg = app.pluginMarketplace.createPackage("manifest-only");
    if (!pkg) throw new Error("Expected marketplace package");
    await expect(app.pluginInstaller.install(pkg)).resolves.toMatchObject({ id: "manifest-only", version: "1.0.0" });

    await expect(app.jsonStore.read("plugins/manifest-only/manifest.json")).resolves.toMatchObject({ id: "manifest-only" });
    await expect(app.jsonStore.readText("plugins/manifest-only/main.js")).resolves.toBeNull();
    await expect(app.jsonStore.readText("plugins/manifest-only/styles.css")).resolves.toBeNull();
  });

  it("hot reloads a running plugin when install writes a new package for the same id", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    let oldInstance: LifecyclePlugin | null = null;
    let newInstance: LifecyclePlugin | null = null;
    await app.pluginInstaller.install({
      manifest: {
        id: "hot-reload",
        name: "Hot Reload",
        version: "1.0.0",
      },
      entry: "plugins/hot-reload/main.js",
      factory: (pluginApp, pluginManifest) => {
        oldInstance = new LifecyclePlugin(pluginApp, pluginManifest);
        return oldInstance;
      },
    });
    await app.pluginInstaller.enable("hot-reload");

    await app.pluginInstaller.install({
      manifest: {
        id: "hot-reload",
        name: "Hot Reload",
        version: "2.0.0",
      },
      entry: "plugins/hot-reload/main.js",
      factory: (pluginApp, pluginManifest) => {
        newInstance = new LifecyclePlugin(pluginApp, pluginManifest);
        return newInstance;
      },
    });

    expect(oldInstance?.didUnload).toBe(true);
    expect(oldInstance?._userDisabled).toBe(false);
    expect(newInstance?.didLoad).toBe(true);
    expect(app.plugins.getPlugin("hot-reload")).toBe(newInstance);
    expect(app.communityPlugins.get("hot-reload")?.enabled).toBe(true);
    expect(app.communityPlugins.get("hot-reload")?.manifest.version).toBe("2.0.0");
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toEqual(["hot-reload"]);
  });

  it("exposes common Obsidian runtime APIs to CommonJS community plugins", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    await app.vault.create("folder/note.md", "hello");
    await app.pluginInstaller.install({
      manifest: {
        id: "api",
        name: "API Plugin",
        version: "1.0.0",
      },
      entry: "plugins/api/main.js",
      mainJs: `
        const {
          Plugin,
          Notice,
          Modal,
          Menu,
          Setting,
          MarkdownView,
          TFile,
          DataAdapter,
          FileSystemAdapter,
          FileManager,
          MetadataCache,
          FuzzySuggestModal,
          Scope,
          Keymap,
          Platform,
          createDiv,
          createSpan,
          setIcon,
          normalizePath,
          debounce,
        } = require("obsidian");

        module.exports = class ApiPlugin extends Plugin {
          async onload() {
            const notice = new Notice("Loaded", 0);
            notice.hide();
            const modal = new Modal(this.app);
            modal.setTitle("API");
            const settingHost = createDiv("settings-host");
            new Setting(settingHost).setName("API setting");
            const span = createSpan("api-span");
            setIcon(span, "lucide-star");
            let count = 0;
            const debounced = debounce(() => count++, 0);
            debounced();
            await new Promise((resolve) => window.setTimeout(resolve, 1));
            await this.saveData({
              normalized: normalizePath("\\\\folder//note.md/"),
              icon: span.querySelector("svg")?.classList.contains("lucide-star") ? "lucide-star" : null,
              isTFile: this.app.vault.getFileByPath("folder/note.md") instanceof TFile,
              isFileManager: this.app.fileManager instanceof FileManager,
              isMetadataCache: this.app.metadataCache instanceof MetadataCache,
              markdownType: MarkdownView.VIEW_TYPE,
              constructors: {
                dataAdapter: typeof DataAdapter,
                fileSystemAdapter: typeof FileSystemAdapter,
                fuzzySuggestModal: typeof FuzzySuggestModal,
                scope: typeof Scope,
                keymap: typeof Keymap,
              },
              platformDesktop: Platform.isDesktopApp,
              menu: typeof Menu.forEvent,
              count,
              modalTitle: modal.titleEl.textContent,
              settingName: settingHost.textContent,
            });
          }
        };
      `,
    });

    await app.pluginInstaller.enable("api");

    await expect(app.jsonStore.read("plugins/api/data.json")).resolves.toMatchObject({
      normalized: "folder/note.md",
      icon: "lucide-star",
      isTFile: true,
      isFileManager: true,
      isMetadataCache: true,
      markdownType: "markdown",
      constructors: {
        dataAdapter: "function",
        fileSystemAdapter: "function",
        fuzzySuggestModal: "function",
        scope: "function",
        keymap: "function",
      },
      platformDesktop: true,
      menu: "function",
      count: 1,
      modalTitle: "API",
      settingName: "API setting",
    });
  });

  it("falls back to desktop window.require and blocks Node packages in mobile emulation", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    Object.defineProperty(window, "require", {
      configurable: true,
      value: (id: string) => id === "node:magic" ? { answer: 42 } : undefined,
    });
    await app.pluginInstaller.install({
      manifest: {
        id: "desktop-require",
        name: "Desktop Require",
        version: "1.0.0",
      },
      entry: "plugins/desktop-require/main.js",
      mainJs: `
        const { Plugin } = require("obsidian");
        const native = require("node:magic");
        module.exports = class DesktopRequirePlugin extends Plugin {
          async onload() {
            await this.saveData({ answer: native.answer });
          }
        };
      `,
    });

    await app.pluginInstaller.enable("desktop-require");

    await expect(app.jsonStore.read("plugins/desktop-require/data.json")).resolves.toEqual({ answer: 42 });

    document.body.classList.add("emulate-mobile");
    await app.pluginInstaller.install({
      manifest: {
        id: "mobile-require",
        name: "Mobile Require",
        version: "1.0.0",
      },
      entry: "plugins/mobile-require/main.js",
      mainJs: `
        const { Plugin } = require("obsidian");
        const native = require("node:magic");
        module.exports = class MobileRequirePlugin extends Plugin {
          async onload() {
            await this.saveData({ blocked: native === null });
          }
        };
      `,
    });

    await app.pluginInstaller.enable("mobile-require");

    await expect(app.jsonStore.read("plugins/mobile-require/data.json")).resolves.toEqual({ blocked: true });
    expect(document.body.textContent).toContain('mobile-require attempted to load NodeJS package: "node:magic"');
  });

  it("provides Obsidian's CodeMirror and Lezer require mappings", async () => {
    const app = new App(document.createElement("div"));
    const deprecatedSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    await app.pluginInstaller.install({
      manifest: {
        id: "cm-require",
        name: "CM Require",
        version: "1.0.0",
      },
      entry: "plugins/cm-require/main.js",
      mainJs: `
        const { Plugin } = require("obsidian");
        const autocomplete = require("@codemirror/autocomplete");
        const commands = require("@codemirror/commands");
        const language = require("@codemirror/language");
        const state = require("@codemirror/state");
        const text = require("@codemirror/text");
        const view = require("@codemirror/view");
        const lezerCommon = require("@lezer/common");
        const lezerLr = require("@lezer/lr");
        const lezerHighlight = require("@lezer/highlight");
        const deprecatedRangeset = require("@codemirror/rangeset");
        const deprecatedTooltip = require("@codemirror/tooltip");
        module.exports = class CMRequirePlugin extends Plugin {
          async onload() {
            await this.saveData({
              autocomplete: typeof autocomplete.autocompletion,
              commands: Array.isArray(commands.defaultKeymap),
              language: typeof language.syntaxTree,
              state: typeof state.EditorState,
              textIsState: text === state,
              view: typeof view.EditorView,
              lezerCommon: typeof lezerCommon.NodeType,
              lezerLr: typeof lezerLr.LRParser,
              lezerHighlight: typeof lezerHighlight.tags,
              deprecatedRangesetIsState: deprecatedRangeset === state,
              deprecatedTooltipIsView: deprecatedTooltip === view,
            });
          }
        };
      `,
    });

    await app.pluginInstaller.enable("cm-require");

    await expect(app.jsonStore.read("plugins/cm-require/data.json")).resolves.toMatchObject({
      autocomplete: "function",
      commands: true,
      language: "function",
      state: "function",
      textIsState: true,
      view: "function",
      lezerCommon: "function",
      lezerLr: "function",
      lezerHighlight: "object",
      deprecatedRangesetIsState: true,
      deprecatedTooltipIsView: true,
    });
    expect(deprecatedSpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('[CM6][cm-require] Using a deprecated package: "@codemirror/rangeset".'),
    }));
    expect(deprecatedSpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("https://discuss.codemirror.net/t/release-0-20-0/4302"),
    }));
  });

  it("blocks deprecated community plugin versions when enabling", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    const manifest = manifestFor("deprecated");
    app.pluginMarketplace.registerEntry({
      manifest,
      deprecatedVersions: [manifest.version],
    });
    await app.pluginInstaller.install({
      manifest,
      entry: "plugins/deprecated/main.js",
      factory: (pluginApp, pluginManifest) => new LifecyclePlugin(pluginApp, pluginManifest),
    });

    await expect(app.pluginInstaller.enable("deprecated")).resolves.toBe(false);

    expect(app.plugins.getPlugin("deprecated")).toBeNull();
    expect(app.communityPlugins.get("deprecated")?.error).toContain("reported to cause issues");
    expect(document.body.textContent).toContain("Unable to load plugin");
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toBeNull();
  });

  it("disables already loaded plugins when their installed version is deprecated", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    app.pluginMarketplace.setDataSource({
      async fetchJson<T>(): Promise<T> {
        return {} as T;
      },
    });
    const manifest = manifestFor("loaded-deprecated");
    await app.pluginInstaller.install({
      manifest,
      entry: "plugins/loaded-deprecated/main.js",
      factory: (pluginApp, pluginManifest) => new LifecyclePlugin(pluginApp, pluginManifest),
    });
    await app.pluginInstaller.enable("loaded-deprecated");
    app.pluginMarketplace.registerEntry({
      manifest,
      deprecatedVersions: [manifest.version],
    });

    await expect(app.pluginInstaller.checkForDeprecations()).resolves.toEqual(["loaded-deprecated"]);

    expect(app.plugins.getPlugin("loaded-deprecated")).toBeNull();
    expect(app.commands.findCommand("loaded-deprecated:hello")).toBeNull();
    expect(app.communityPlugins.get("loaded-deprecated")?.enabled).toBe(false);
    expect(app.communityPlugins.get("loaded-deprecated")?.error).toContain("has been disabled");
    expect(document.body.textContent).toContain("has been disabled");
    await expect(app.jsonStore.read("community-plugins.json")).resolves.toEqual([]);
  });

  it("loads deprecation data independently of the marketplace catalog", async () => {
    const app = new App(document.createElement("div"));
    app.pluginSecurity.setCommunityPluginsEnabled(true);
    app.pluginMarketplace.setDataSource({
      async fetchJson<T>(url: string): Promise<T> {
        expect(url).toBe("https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-deprecation.json");
        return { "remote-deprecated": ["1.0.0"] } as T;
      },
    });
    app.pluginMarketplace.registerEntry({
      manifest: {
        id: "local-deprecated",
        name: "Local Deprecated",
        version: "1.0.0",
      },
      deprecatedVersions: ["1.0.0"],
    });
    const manifest = {
      ...manifestFor("remote-deprecated"),
      version: "1.0.0",
    };
    await app.pluginInstaller.install({
      manifest,
      entry: "plugins/remote-deprecated/main.js",
      factory: (pluginApp, pluginManifest) => new LifecyclePlugin(pluginApp, pluginManifest),
    });
    await app.pluginInstaller.enable("remote-deprecated");

    await expect(app.pluginInstaller.checkForDeprecations()).resolves.toEqual(["remote-deprecated"]);

    expect(app.plugins.getPlugin("remote-deprecated")).toBeNull();
    expect(app.communityPlugins.get("remote-deprecated")?.enabled).toBe(false);
  });
});

describe("community plugin source processing", () => {
  it("matches Obsidian's inline sourcemap and sourceURL rules", () => {
    const inlineMap = [
      'module.exports = class Demo {};',
      "//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozfQ==",
    ].join("\n");
    const externalMap = ['module.exports = class Demo {};', "//# sourceMappingURL=main.js.map"].join("\n");

    const downloaded = prepareDownloadedMainJs(inlineMap);

    expect(downloaded).not.toContain("sourceMappingURL=data:application/json");
    expect(downloaded.endsWith(NO_SOURCE_MAP_MARKER)).toBe(true);
    expect(prepareLoadedMainJs(downloaded)).toBe(downloaded);
    expect(prepareLoadedMainJs(externalMap)).toBe(externalMap);
    expect(appendPluginSourceUrl("module.exports = {}", "space plugin")).toContain("sourceURL=plugin:space%20plugin");
    expect(wrapCommonJsPluginSource(inlineMap, "demo")).toBe(
      [
        "(function anonymous(require,module,exports){module.exports = class Demo {};",
        "\n})",
        "//# sourceURL=plugin:demo",
        "",
      ].join("\n"),
    );
  });
});

function getPluginStyleEls(pluginId: string): HTMLStyleElement[] {
  return [...document.head.querySelectorAll<HTMLStyleElement>(`style[data-obsidian-reconstructed-css="plugin:${pluginId}"]`)];
}

function isBefore(left: HTMLElement, right: HTMLElement): boolean {
  return Boolean(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function manifestFor(id: string): PluginManifest {
  return {
    id,
    name: id === "life" ? "Lifecycle" : "Failing",
    version: "1.0.0",
    minAppVersion: "1.0.0",
    author: "Test",
    description: "Test plugin",
  };
}
