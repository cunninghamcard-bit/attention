import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import {
  BooleanValue,
  DateValue,
  DurationValue,
  FileValue,
  HTMLValue,
  IconValue,
  ImageValue,
  LinkValue,
  ListValue,
  NotNullValue,
  NullValue,
  NumberValue,
  ObjectValue,
  PrimitiveValue,
  RegExpValue,
  RelativeDateValue,
  StringValue,
  TagValue,
  UrlValue,
  Value,
} from "../bases/BasesValues";
import { parsePropertyId } from "../bases/BasesProperty";
import { BasesView } from "../bases/BasesView";
import { BasesViewConfig } from "../bases/BasesViewConfig";
import { BasesEntry, BasesEntryGroup, BasesQueryResult } from "../bases/BasesQueryResult";
import { QueryController } from "../bases/QueryController";
import {
  finishRenderMath,
  loadMathJax,
  loadMermaid,
  loadPdfJs,
  loadPrism,
  getLanguage,
  moment,
  parseYaml,
  renderMath,
  stringifyYaml,
} from "../api/ApiUtils";
import { Tasks } from "../app/QuitEvent";
import { Component } from "../core/Component";
import { Keymap } from "../hotkeys/Keymap";
import { Scope } from "../hotkeys/Scope";
import { MarkdownPreviewRenderer } from "../markdown/MarkdownPreviewRenderer";
import { MarkdownPreviewSection } from "../markdown/MarkdownPreviewSection";
import { MarkdownPreviewView } from "../markdown/MarkdownPreviewView";
import { iterateCacheRefs, iterateRefs, MetadataCache } from "../metadata/MetadataCache";
import { MobileDrawer as WorkspaceMobileDrawer } from "../mobile/MobileDrawer";
import { fuzzySearch, prepareQuery } from "../search/SearchHelpers";
import { FuzzySuggestModal } from "../suggest/SuggestModal";
import { addIcon, getIcon, getIconIds, removeIcon } from "../ui/Icon";
import { Menu } from "../ui/Menu";
import { ConfirmationButton, ConfirmationModal } from "../ui/Modal";
import { DisplayValueComponent, SecretComponent } from "../ui/Setting";
import { HoverPopover, HoverPopoverState, PopoverState } from "../ui/Popover";
import { CapacitorAdapter, DataAdapter } from "../vault/DataAdapter";
import { FileManager } from "../vault/FileManager";
import { FileSystemAdapter } from "../vault/FileSystemAdapter";
import { Workspace } from "../workspace/Workspace";
import { WorkspaceContainer } from "../workspace/WorkspaceContainer";
import { WorkspaceFloating } from "../workspace/WorkspaceFloating";
import { WorkspaceItem } from "../workspace/WorkspaceItem";
import { ViewRegistry } from "../workspace/ViewRegistry";
import { WorkspaceParent } from "../workspace/WorkspaceParent";
import { WorkspaceRibbon } from "../workspace/WorkspaceRibbon";
import { WorkspaceRoot } from "../workspace/WorkspaceRoot";
import { WorkspaceSidedock } from "../workspace/WorkspaceSidedock";
import { WorkspaceSplit } from "../workspace/WorkspaceSplit";
import { WorkspaceTabs } from "../workspace/WorkspaceTabs";
import { WorkspaceWindow } from "../workspace/WorkspaceWindow";
import { MarkdownEditView, MarkdownView } from "../views/MarkdownView";
import { Plugin } from "./Plugin";
import { createObsidianPluginModule } from "../api/ObsidianPluginModule";
import { editorDomClass, editorTransactionFilter, editorUpdateListener, editorViewPlugin } from "../editor/EditorExtension";
import { editorEditorField, editorInfoField, editorLivePreviewField, editorViewField, livePreviewState, StateEffect, StateField, Transaction } from "../editor/EditorStateField";
import { RenderContext } from "../markdown/RenderContext";
import { Platform } from "../platform/Platform";
import { AbstractTextComponent } from "../ui/Setting";
import { SettingPage, SettingTab } from "../app/SettingTab";
import { PluginSettingTab } from "./PluginSettingTab";
import { normalizePluginManifest, type PluginManifest } from "./PluginManifest";

function manifest(id: string): PluginManifest {
  return normalizePluginManifest({ id, name: "Parity", version: "1.0.0" });
}

class EmptyPlugin extends Plugin {}

class SyncShapePlugin extends Plugin {
  didLoad = false;

  override onload(): void {
    this.didLoad = true;
  }

  override onExternalSettingsChange(): string {
    return "changed";
  }
}

class SlowChild extends Component {
  started = false;
  finish: (() => void) | null = null;

  override async onload(): Promise<void> {
    this.started = true;
    await new Promise<void>((resolve) => {
      this.finish = resolve;
    });
  }
}

describe("Obsidian plugin API parity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    removeIcon("plugin-api-test-icon");
    vi.stubGlobal("fetch", undefined);
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
  it("exposes SettingTab as a runtime base class with Obsidian container defaults", () => {
    const app = new App(document.createElement("div"));
    const tab = new SettingTab(app, app.setting);

    expect(tab.app).toBe(app);
    expect(tab.setting).toBe(app.setting);
    expect(tab.containerEl.className).toBe("vertical-tab-content");
    expect(tab.navEl).toBeNull();
    expect(tab.settingItems).toEqual([]);
    expect(tab.getSettingDefinitions()).toEqual([]);
    expect(() => tab.update()).not.toThrow();
    app.vault.setConfig("theme", "moonstone");
    expect(tab.getControlValue("theme")).toBe("moonstone");
    tab.setControlValue("theme", "obsidian");
    expect(app.vault.getConfig("theme")).toBe("obsidian");
    expect(() => tab.refreshDomState()).not.toThrow();
    expect(() => tab.hide()).not.toThrow();
  });

  it("makes PluginSettingTab inherit from SettingTab and keeps hide as the base no-op", () => {
    const app = new App(document.createElement("div"));
    const plugin = new EmptyPlugin(app, manifest("settings-plugin"));
    const tab = new PluginSettingTab(app, plugin);
    const nextPlugin = new EmptyPlugin(app, manifest("settings-plugin-next"));

    expect(tab).toBeInstanceOf(SettingTab);
    expect(tab.id).toBe("settings-plugin");
    expect(tab.name).toBe("Parity");
    expect(tab.section).toBe("community-plugins");
    tab.plugin = nextPlugin;
    expect(tab.plugin).toBe(nextPlugin);

    const host = document.createElement("div");
    host.appendChild(tab.containerEl);
    tab.hide();
    expect(tab.containerEl.parentElement).toBe(host);
  });

  it("lets Plugin.registerFileMenu receive abstract files and leaf payloads", async () => {
    const app = new App(document.createElement("div"));
    const plugin = new EmptyPlugin(app, manifest("file-menu-helper"));
    const folder = await app.vault.createFolder("Folder Menu");
    const leaf = app.workspace.getLeaf();
    const seen: string[] = [];

    plugin.registerFileMenu((menu, file, source, menuLeaf) => {
      menu.addSeparator();
      seen.push(`${file.path}:${source}:${menuLeaf === leaf}`);
    });
    app.workspace.trigger("file-menu", new Menu(), folder, "file-explorer-context-menu", leaf);

    expect(seen).toEqual(["Folder Menu:file-explorer-context-menu:true"]);
  });

  it("lets Plugin.registerEditorMenu receive MarkdownFileInfo-compatible payloads", async () => {
    const app = new App(document.createElement("div"));
    const plugin = new EmptyPlugin(app, manifest("editor-menu-helper"));
    const file = await app.vault.create("Editor Menu.md", "editor menu");
    const leaf = await app.workspace.openFile(file, { active: true });
    const view = leaf.view as MarkdownView;
    const seen: string[] = [];

    plugin.registerEditorMenu((menu, editor, info) => {
      menu.addSeparator();
      seen.push(`${editor.getValue()}:${info.app === app}:${info.file === file}`);
    });
    app.workspace.trigger("editor-menu", new Menu(), view.editor, view);

    expect(seen).toEqual(["editor menu:true:true"]);
  });

  it("exposes the official mutable Plugin.settings field", async () => {
    const app = new App(document.createElement("div"));
    const plugin = new EmptyPlugin(app, manifest("settings-field"));

    await plugin.saveData({ enabled: true });
    plugin.settings = await plugin.loadData();

    expect(plugin.settings).toEqual({ enabled: true });
  });

  it("matches Obsidian by storing plugin data under manifest.dir", async () => {
    const app = new App(document.createElement("div"));
    const plugin = new EmptyPlugin(app, { ...manifest("dir-id"), dir: "plugins/custom-dir" });

    await plugin.saveData({ enabled: true });

    await expect(app.jsonStore.read("plugins/custom-dir/data.json")).resolves.toEqual({ enabled: true });
    await expect(app.jsonStore.read("plugins/dir-id/data.json")).resolves.toBeNull();
    await expect(plugin.loadData()).resolves.toEqual({ enabled: true });
  });

  it("matches Obsidian's mutable Plugin class shape and sync lifecycle hooks", async () => {
    const app = new App(document.createElement("div"));
    const plugin = new SyncShapePlugin(app, manifest("sync-shape"));

    await plugin.load();

    expect(Object.hasOwn(Plugin.prototype, "onunload")).toBe(false);
    expect(Object.hasOwn(Plugin.prototype, "onConfigFileChange")).toBe(false);
    expect(Object.hasOwn(plugin, "onConfigFileChange")).toBe(true);
    expect(plugin.didLoad).toBe(true);
    await expect(plugin.loadData()).resolves.toBeNull();
    expect(plugin.onExternalSettingsChange?.()).toBe("changed");

    const nextManifest = manifest("sync-shape-next");
    plugin.app = app;
    plugin.manifest = nextManifest;

    expect(plugin.app).toBe(app);
    expect(plugin.manifest).toBe(nextManifest);
  });

  it("uses Obsidian's status bar plugin class sanitization", () => {
    const app = new App(document.createElement("div"));
    const plugin = new EmptyPlugin(app, manifest("Mixed_ID.One?"));
    const statusEl = plugin.addStatusBarItem();

    expect(statusEl.classList.contains("plugin-mixed_id-one?")).toBe(true);
  });

  it("waits for plugin onload but does not await child component loads", async () => {
    const app = new App(document.createElement("div"));
    const plugin = new EmptyPlugin(app, manifest("child-load"));
    const child = plugin.addChild(new SlowChild());

    const loadPromise = plugin.load();
    await Promise.resolve();
    await Promise.resolve();

    let resolved = false;
    loadPromise.then(() => {
      resolved = true;
    });
    await Promise.resolve();

    expect(child.started).toBe(true);
    expect(resolved).toBe(true);

    child.finish?.();
    await loadPromise;
  });

  it("exports SettingTab through the plugin module facade", () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);

    expect(module.SettingTab).toBe(SettingTab);
    expect(new module.SettingTab(app, app.setting)).toBeInstanceOf(SettingTab);
    expect(new module.SimpleEditor()).toBeInstanceOf(module.Editor);
  });

  it("exports common public runtime constructors through the plugin module facade", () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);

    expect(module.App).toBe(App);
    expect(module.CapacitorAdapter).toBe(CapacitorAdapter);
    expect(module.DataAdapter).toBe(DataAdapter);
    expect(module.FileSystemAdapter).toBe(FileSystemAdapter);
    expect(module.FileManager).toBe(FileManager);
    expect(module.MetadataCache).toBe(MetadataCache);
    expect(module.iterateCacheRefs).toBe(iterateCacheRefs);
    expect(module.iterateRefs).toBe(iterateRefs);
    expect(module.FuzzySuggestModal).toBe(FuzzySuggestModal);
    expect(module.Scope).toBe(Scope);
    expect(module.Keymap).toBe(Keymap);
    expect(module.Workspace).toBe(Workspace);
    expect(module.ViewRegistry).toBe(ViewRegistry);
    expect(module.WorkspaceContainer).toBe(WorkspaceContainer);
    expect(module.WorkspaceFloating).toBe(WorkspaceFloating);
    expect(module.WorkspaceItem).toBe(WorkspaceItem);
    expect(module.WorkspaceParent).toBe(WorkspaceParent);
    expect(module.WorkspaceRibbon).toBe(WorkspaceRibbon);
    expect(module.WorkspaceRoot).toBe(WorkspaceRoot);
    expect(module.WorkspaceSidedock).toBe(WorkspaceSidedock);
    expect(module.WorkspaceSplit).toBe(WorkspaceSplit);
    expect(module.WorkspaceTabs).toBe(WorkspaceTabs);
    expect(module.WorkspaceWindow).toBe(WorkspaceWindow);
    expect(module.WorkspaceMobileDrawer).toBe(WorkspaceMobileDrawer);
    expect(module.Tasks).toBe(Tasks);
    expect(module.MarkdownPreviewRenderer).toBe(MarkdownPreviewRenderer);
    expect(module.MarkdownPreviewSection).toBe(MarkdownPreviewSection);
    expect(module.MarkdownPreviewView).toBe(MarkdownPreviewView);
    expect(module.MarkdownEditView).toBe(MarkdownEditView);
    expect(module.RenderContext).toBe(RenderContext);
    expect(module.HoverPopover).toBe(HoverPopover);
    expect(module.PopoverState).toBe(PopoverState);
    expect(module.SettingPage).toBe(SettingPage);
    expect(module.AbstractTextComponent).toBe(AbstractTextComponent);
    expect(module.DisplayValueComponent).toBe(DisplayValueComponent);
    expect(module.SecretComponent).toBe(SecretComponent);
    expect(module.ConfirmationButton).toBe(ConfirmationButton);
    expect(module.ConfirmationModal).toBe(ConfirmationModal);
    expect(module.Value).toBe(Value);
    expect(module.NotNullValue).toBe(NotNullValue);
    expect(module.NullValue).toBe(NullValue);
    expect(module.PrimitiveValue).toBe(PrimitiveValue);
    expect(module.StringValue).toBe(StringValue);
    expect(module.NumberValue).toBe(NumberValue);
    expect(module.BooleanValue).toBe(BooleanValue);
    expect(module.DateValue).toBe(DateValue);
    expect(module.DurationValue).toBe(DurationValue);
    expect(module.FileValue).toBe(FileValue);
    expect(module.HTMLValue).toBe(HTMLValue);
    expect(module.IconValue).toBe(IconValue);
    expect(module.ImageValue).toBe(ImageValue);
    expect(module.LinkValue).toBe(LinkValue);
    expect(module.ListValue).toBe(ListValue);
    expect(module.ObjectValue).toBe(ObjectValue);
    expect(module.RegExpValue).toBe(RegExpValue);
    expect(module.RelativeDateValue).toBe(RelativeDateValue);
    expect(module.TagValue).toBe(TagValue);
    expect(module.UrlValue).toBe(UrlValue);
    expect(module.parsePropertyId).toBe(parsePropertyId);
    expect(module.BasesView).toBe(BasesView);
    expect(module.BasesViewConfig).toBe(BasesViewConfig);
    expect(module.BasesEntry).toBe(BasesEntry);
    expect(module.BasesEntryGroup).toBe(BasesEntryGroup);
    expect(module.BasesQueryResult).toBe(BasesQueryResult);
    expect(module.QueryController).toBe(QueryController);
    expect(module.addIcon).toBe(addIcon);
    expect(module.getIcon).toBe(getIcon);
    expect(module.getIconIds).toBe(getIconIds);
    expect(module.removeIcon).toBe(removeIcon);
    expect(app.renderContext).toBeInstanceOf(RenderContext);
    expect(app.renderContext.hoverPopover).toBeNull();
  });

  it("exposes Obsidian Keymap modifier helpers through the plugin API", () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);
    const modKey = Platform.isMacOS ? { metaKey: true } : { ctrlKey: true };
    const modifiers = module.Keymap.compileModifiers(["Mod", "Shift"]);
    const event = new KeyboardEvent("keydown", { key: "P", code: "KeyP", shiftKey: true, ...modKey });
    const keymap = new module.Keymap(null);

    expect(module.Keymap.getModifiers(event)).toBe(modifiers);
    expect(module.Keymap.decompileModifiers(modifiers)).toEqual(["Mod", "Shift"]);

    keymap.updateModifiers(event);
    expect(keymap.matchModifiers(modifiers)).toBe(true);
    expect(keymap.hasModifier("Mod")).toBe(true);
    expect(module.Keymap.isMatch({ modifiers, key: "p" }, { modifiers, key: "P", vkey: "KeyP" })).toBe(true);

    expect(module.Keymap.isModEvent(new MouseEvent("click", { button: 1 }))).toBe("tab");
    expect(module.Keymap.isModEvent(new MouseEvent("click", modKey))).toBe("tab");
    expect(module.Keymap.isModEvent(new MouseEvent("click", { altKey: true, ...modKey }))).toBe("split");
    expect(module.Keymap.isModEvent(new MouseEvent("click", { altKey: true, shiftKey: true, ...modKey }))).toBe("window");
    expect(module.Keymap.isModEvent(new MouseEvent("click"))).toBe(false);
  });

  it("exposes a usable DataAdapter on app.vault for plugin raw vault access", async () => {
    const app = new App(document.createElement("div"));
    const adapter = app.vault.adapter;

    expect(adapter).toBeInstanceOf(DataAdapter);
    if (!adapter) throw new Error("missing vault adapter");
    await adapter.write("raw-plugin-data.json", "{\"ok\":true}");

    await expect(adapter.read("raw-plugin-data.json")).resolves.toBe("{\"ok\":true}");
    await expect(adapter.stat("raw-plugin-data.json")).resolves.toMatchObject({ type: "file", size: 11 });
  });

  it("exposes mobile and markdown edit runtime shims with usable behavior", async () => {
    const adapter = new CapacitorAdapter();
    const app = new App(document.createElement("div"));
    await app.ready;
    const file = await app.vault.create("edit.md", "hello world");
    const leaf = app.workspace.getLeaf();
    await leaf.openFile(file);
    const view = leaf.view;

    await adapter.write("mobile.txt", "mobile");

    expect(adapter).toBeInstanceOf(DataAdapter);
    expect(adapter.getName()).toBe("Capacitor");
    expect(adapter.getFullPath("Folder/mobile.txt")).toBe("capacitor://Folder%2Fmobile.txt");
    expect(adapter.getResourcePath("Folder/mobile.txt")).toBe("capacitor://Folder%2Fmobile.txt");
    await expect(adapter.read("mobile.txt")).resolves.toBe("mobile");
    expect(view).toBeInstanceOf(MarkdownView);
    if (!(view instanceof MarkdownView)) throw new Error("expected markdown view");
    expect(view.editMode).toBeInstanceOf(MarkdownEditView);
    expect(view.editMode.file).toBe(file);
    expect(view.editMode.get()).toBe("hello world");
    view.editMode.set("changed", false);
    expect(view.editMode.getSelection()).toBe("");
    expect(view.editMode.get()).toBe("changed");
    view.editMode.applyScroll(12);
    expect(view.editMode.getScroll()).toBe(12);
  });

  it("exports editor extension fields and helpers through the plugin module facade", () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);

    expect(module.StateEffect).toBe(StateEffect);
    expect(module.StateField).toBe(StateField);
    expect(module.Transaction).toBe(Transaction);
    expect(module.editorEditorField).toBe(editorEditorField);
    expect(module.editorInfoField).toBe(editorInfoField);
    expect(module.editorLivePreviewField).toBe(editorLivePreviewField);
    expect(module.editorViewField).toBe(editorViewField);
    expect(module.livePreviewState).toBe(livePreviewState);
    expect(module.livePreviewState.instantiate()).toMatchObject({ mousedown: false });
    expect(module.editorDomClass).toBe(editorDomClass);
    expect(module.editorTransactionFilter).toBe(editorTransactionFilter);
    expect(module.editorUpdateListener).toBe(editorUpdateListener);
    expect(module.editorViewPlugin).toBe(editorViewPlugin);
    expect(module.editorDomClass("plugin-editor")).toEqual({ type: "dom-class", className: "plugin-editor" });
    expect(module.editorUpdateListener(() => {})).toMatchObject({ type: "update-listener" });
    expect(module.editorTransactionFilter((transaction) => transaction)).toMatchObject({ type: "transaction-filter" });
    expect(module.editorViewPlugin(() => {})).toMatchObject({ type: "view-plugin" });
  });

  it("exposes HoverPopover as a Component-compatible Obsidian popover", () => {
    vi.useFakeTimers();
    const app = new App(document.createElement("div"));
    const parent = app.workspace.getLeaf();
    const targetEl = document.createElement("button");
    document.body.appendChild(targetEl);

    const popover = new HoverPopover(parent, targetEl, 0, { x: 10, y: 20 });

    expect(popover).toBeInstanceOf(Component);
    expect(parent.hoverPopover).toBeNull();
    expect(popover.waitTime).toBe(0);
    expect(popover.staticPos).toEqual({ x: 10, y: 20 });
    expect(popover.state).toBe(HoverPopoverState.Showing);
    expect(PopoverState.Hidden).toBe(HoverPopoverState.Hidden);

    vi.advanceTimersByTime(0);

    expect(parent.hoverPopover).toBe(popover);
    expect(popover.state).toBe(HoverPopoverState.Shown);

    popover.hide();

    expect(parent.hoverPopover).toBeNull();
    vi.useRealTimers();
  });

  it("exports official YAML helpers and moment through the plugin module facade", () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);

    expect(module.moment).toBe(moment);
    expect(module.moment.isMoment(module.moment())).toBe(true);
    expect(module.moment("2026-06-25").format("YYYY-MM-DD")).toBe("2026-06-25");
    expect(module.parseYaml).toBe(parseYaml);
    expect(module.stringifyYaml).toBe(stringifyYaml);
    expect(module.parseYaml("title: Hello\ncount: 2\nitems:\n  - alpha\n  - beta\n")).toEqual({
      title: "Hello",
      count: 2,
      items: ["alpha", "beta"],
    });
    expect(module.parseYaml(module.stringifyYaml({ title: "Hello", count: 2 }))).toEqual({
      title: "Hello",
      count: 2,
    });
  });

  it("exports the official mutable Platform singleton through the plugin module facade", () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);
    const originalMobile = Platform.isMobile;

    expect(module.Platform).toBe(Platform);
    expect(Object.keys(module.Platform).sort()).toEqual([
      "build",
      "canDisplayRibbon",
      "canExportPdf",
      "canPinSidebar",
      "canPopoutWindow",
      "canSplit",
      "canStackTabs",
      "deviceName",
      "hasPhysicalKeyboard",
      "isAndroidApp",
      "isDesktop",
      "isDesktopApp",
      "isIosApp",
      "isLinux",
      "isMacOS",
      "isMobile",
      "isMobileApp",
      "isPhone",
      "isSafari",
      "isTablet",
      "isWin",
      "manufacturer",
      "mobileSoftKeyboardVisible",
      "model",
      "osName",
      "osVersion",
      "resourcePathPrefix",
      "supportsIndexedDb",
      "version",
    ].sort());
    expect(typeof module.Platform.resourcePathPrefix).toBe("string");
    expect(module.Platform.canExportPdf).toBe(module.Platform.isDesktopApp);
    expect(module.Platform.canPopoutWindow).toBe(module.Platform.isDesktopApp && module.Platform.isDesktop);
    expect(module.Platform.canStackTabs).toBe(!module.Platform.isPhone);
    expect(module.Platform.canSplit).toBe(!module.Platform.isPhone);
    expect(module.Platform.canDisplayRibbon).toBe(!module.Platform.isPhone);
    expect(module.Platform.canPinSidebar).toBe(module.Platform.isMobile && !module.Platform.isPhone);

    Platform.isMobile = !originalMobile;
    expect(module.Platform.isMobile).toBe(!originalMobile);
    Platform.isMobile = originalMobile;
  });

  it("exports Markdown rendering loaders and math helpers through the plugin module facade", async () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);
    delete (globalThis as { mermaid?: unknown }).mermaid;
    delete (globalThis as { pdfjsLib?: unknown }).pdfjsLib;
    delete (globalThis as { Prism?: unknown }).Prism;

    expect(module.loadMathJax).toBe(loadMathJax);
    expect(module.loadMermaid).toBe(loadMermaid);
    expect(module.loadPdfJs).toBe(loadPdfJs);
    expect(module.loadPrism).toBe(loadPrism);
    expect(module.renderMath).toBe(renderMath);
    expect(module.finishRenderMath).toBe(finishRenderMath);

    await expect(module.loadMathJax()).resolves.toBeUndefined();
    await expect(module.loadMermaid()).resolves.toBe((globalThis as { mermaid?: unknown }).mermaid);
    await expect(module.loadPdfJs()).resolves.toBe((globalThis as { pdfjsLib?: unknown }).pdfjsLib);
    await expect(module.loadPrism()).resolves.toBe((globalThis as { Prism?: unknown }).Prism);

    const inline = module.renderMath("x^2", false);
    const block = module.renderMath("\\int x dx", true);

    expect(inline.tagName).toBe("SPAN");
    expect(inline.className).toBe("math math-inline");
    expect(inline.textContent).toBe("x^2");
    expect(block.tagName).toBe("DIV");
    expect(block.className).toBe("math math-block");
    await expect(module.finishRenderMath()).resolves.toBeUndefined();
  });

  it("exports the Obsidian icon registry helpers through the plugin module facade", () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);
    const host = document.createElement("div");

    module.addIcon("plugin-api-test-icon", '<path d="M4 4h16v16H4z"/>');

    expect(module.getIconIds()).toContain("plugin-api-test-icon");
    expect(module.getIcon("missing-plugin-api-test-icon")).toBeNull();
    const icon = module.getIcon("plugin-api-test-icon");
    expect(icon).toBeInstanceOf(SVGSVGElement);
    expect(icon?.classList.contains("plugin-api-test-icon")).toBe(true);
    expect(icon?.querySelector("path")?.getAttribute("d")).toBe("M4 4h16v16H4z");

    module.setIcon(host, "plugin-api-test-icon");
    expect(host.querySelector("svg.plugin-api-test-icon path")?.getAttribute("d")).toBe("M4 4h16v16H4z");

    module.setIcon(host, "missing-plugin-api-test-icon");
    expect(host.querySelector("svg")).toBeNull();

    module.removeIcon("plugin-api-test-icon");
    expect(module.getIcon("plugin-api-test-icon")).toBeNull();
    expect(module.getIconIds()).not.toContain("plugin-api-test-icon");
  });

  it("exports common public utility functions through the plugin module facade", async () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);
    const bytes = new Uint8Array([0, 15, 16, 255]).buffer;

    expect(module.apiVersion).toBe("1.12.7");
    expect(module.requireApiVersion("1.0.0")).toBe(true);
    expect(module.requireApiVersion("99.0.0")).toBe(false);
    const previousLanguage = navigator.language;
    Object.defineProperty(navigator, "language", { configurable: true, value: "zh" });
    expect(module.getLanguage).toBe(getLanguage);
    expect(module.getLanguage()).toBe("zh");
    Object.defineProperty(navigator, "language", { configurable: true, value: previousLanguage });
    expect(module.parseLinktext(" Target#Heading#Child | Alias ")).toEqual({ path: " Target", subpath: "#Heading#Child | Alias " });
    expect(module.getLinkpath(" Target#Heading | Alias ")).toBe(" Target");
    expect(module.arrayBufferToHex(bytes)).toBe("000f10ff");
    expect(new Uint8Array(module.hexToArrayBuffer("000f10ff"))).toEqual(new Uint8Array(bytes));
    expect(new Uint8Array(module.hexToArrayBuffer("0ff"))).toEqual(new Uint8Array([0x0f]));
    expect(new Uint8Array(module.hexToArrayBuffer(" 0f"))).toEqual(new Uint8Array([0x00]));
    expect(module.arrayBufferToBase64(bytes)).toBe("AA8Q/w==");
    expect(new Uint8Array(module.base64ToArrayBuffer("AA8Q/w=="))).toEqual(new Uint8Array(bytes));
    await expect(module.getBlobArrayBuffer(new Blob(["hi"]))).resolves.toEqual(new TextEncoder().encode("hi").buffer);
    const fallbackBlob = new Blob(["fallback"]);
    Object.defineProperty(fallbackBlob, "arrayBuffer", { value: undefined });
    await expect(module.getBlobArrayBuffer(fallbackBlob)).resolves.toEqual(new TextEncoder().encode("fallback").buffer);
  });

  it("matches Obsidian debounce Debouncer chaining cancel and run semantics", async () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);
    const calls: string[] = [];
    vi.useFakeTimers();
    try {
      const debounced = module.debounce((value: string) => {
        calls.push(value);
        return `ran:${value}`;
      }, 10);

      expect(debounced("first")).toBe(debounced);
      await vi.advanceTimersByTimeAsync(5);
      expect(debounced("second")).toBe(debounced);
      await vi.advanceTimersByTimeAsync(5);
      expect(calls).toEqual(["second"]);

      expect(debounced("third").cancel()).toBe(debounced);
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toEqual(["second"]);

      debounced("run-now");
      expect(debounced.run()).toBe("ran:run-now");
      expect(calls).toEqual(["second", "run-now"]);

      const resetCalls: string[] = [];
      const resetDebounced = module.debounce((value: string) => resetCalls.push(value), 10, true);
      resetDebounced("first");
      await vi.advanceTimersByTimeAsync(5);
      resetDebounced("second");
      await vi.advanceTimersByTimeAsync(9);
      expect(resetCalls).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(resetCalls).toEqual(["second"]);
      expect(debounced.run()).toBeUndefined();

      const firstOnly = module.debounce((value: string) => {
        calls.push(value);
      }, 10, false);
      expect(firstOnly("first-pending")).toBe(firstOnly);
      expect(firstOnly("latest-pending")).toBe(firstOnly);
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toEqual(["second", "run-now", "latest-pending"]);

      const receiver = {
        prefix: "ctx",
        debounced: module.debounce(function (this: { prefix: string }, value: string) {
          calls.push(`${this.prefix}:${value}`);
          return `${this.prefix}:${value}`;
        }, 10),
      };
      receiver.debounced("method-first");
      receiver.debounced("method-second");
      expect(receiver.debounced.run()).toBe("ctx:method-second");
    } finally {
      vi.useRealTimers();
    }
  });

  it("exports frontmatter and HTML utility helpers through the plugin module facade", () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);
    const frontmatter = { alias: "Ignored", aliases: ["Alias", " "], tag: "ignored", tags: ["alpha", "#beta", "two words", " "], other: 42 };

    expect(module.parseFrontMatterEntry(frontmatter, "OTHER")).toBeNull();
    expect(module.parseFrontMatterEntry(frontmatter, "other")).toBe(42);
    expect(module.parseFrontMatterAliases(frontmatter)).toEqual(["Alias"]);
    expect(module.parseFrontMatterTags(frontmatter)).toEqual(["#alpha", "#beta"]);
    expect(module.parseFrontMatterAliases({ alias: "Alias" })).toBeNull();
    expect(module.parseFrontMatterTags({ tag: "alpha" })).toBeNull();
    expect(module.parseFrontMatterStringArray({ cssclasses: "wide" }, "cssclasses")).toEqual(["wide"]);
    expect(module.getAllTags(null)).toBeNull();
    expect(module.getAllTags({
      tags: [
        { tag: "#beta", position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 5, offset: 5 } } },
        { tag: "#inline", position: { start: { line: 0, col: 6, offset: 6 }, end: { line: 0, col: 13, offset: 13 } } },
      ],
      frontmatter,
    })).toEqual(["#alpha", "#beta", "#beta", "#inline"]);
    expect(module.getAllTags({})).toEqual([]);
    expect(module.getFrontMatterInfo("---\na: 1\n---\nBody")).toEqual({
      exists: true,
      frontmatter: "a: 1\n",
      from: 4,
      to: 9,
      contentStart: 13,
    });
    expect(module.getFrontMatterInfo("Body")).toEqual({
      exists: false,
      frontmatter: "",
      from: 0,
      to: 0,
      contentStart: 0,
    });

    const fragment = module.sanitizeHTMLToDom("<p onclick=\"evil()\">Hi<script>bad()</script></p>");
    expect(fragment.querySelector("script")).toBeNull();
    expect(fragment.querySelector("p")?.getAttribute("onclick")).toBeNull();
    expect(module.htmlToMarkdown("<h1>Title</h1><p><strong>Body</strong></p>")).toBe("# Title\n\n**Body**");
  });

  it("exports heading cleanup and subpath resolution helpers through the plugin module facade", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const module = createObsidianPluginModule(app);
    const file = await app.vault.create("Resolve.md", "# Parent\n## Child\nBody ^abc\n\n[^note]: Footnote\n# Next");

    await app.metadataCache.computeFileMetadataAsync(file);
    const cache = app.metadataCache.getFileCache(file);
    if (!cache) throw new Error("Expected metadata cache");

    expect(module.stripHeading(" A#B/C^[D]\\\\E: F\nG ")).toBe("A B C D E F G");
    expect(module.stripHeading("don't-keep_under")).toBe("don't-keep_under");
    expect(module.stripHeadingForLink("[[A]] %% B / C !")).toBe("A B / C !");
    expect(module.stripHeadingForLink("A#B:C|D^E\\\\F\nG")).toBe("A B C D E F G");

    expect(module.resolveSubpath(cache, "#")).toBeNull();
    expect(module.resolveSubpath(cache, "#^")).toBeNull();

    const block = module.resolveSubpath(cache, "#^ABC");
    expect(block).toMatchObject({ type: "block", block: { id: "abc" } });

    const footnote = module.resolveSubpath(cache, "#[^note]");
    expect(footnote).toMatchObject({ type: "footnote", footnote: { id: "note" } });
    expect(module.resolveSubpath(cache, "#[^Note]")).toBeNull();

    const heading = module.resolveSubpath(cache, "#Parent#Child");
    expect(heading).toMatchObject({
      type: "heading",
      current: { heading: "Child", level: 2 },
      next: { heading: "Next", level: 1 },
    });
  });

  it("exposes Obsidian-style requestUrl response sub-promises and throw semantics", async () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response('{"ok":true}', {
      status: 201,
      headers: {
        "content-type": init?.headers && typeof init.headers === "object" && "Content-Type" in init.headers
          ? String((init.headers as Record<string, string>)["Content-Type"])
          : "application/json",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const responsePromise = module.requestUrl({
      url: "https://example.com/api",
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });

    await expect(responsePromise.text).resolves.toBe('{"ok":true}');
    await expect(responsePromise.json).resolves.toEqual({ ok: true });
    await expect(responsePromise.arrayBuffer).resolves.toBeInstanceOf(ArrayBuffer);
    await expect(responsePromise).resolves.toMatchObject({
      status: 201,
      headers: { "content-type": "application/json" },
      text: '{"ok":true}',
      json: { ok: true },
    });
    await expect(module.request("https://example.com/api")).resolves.toBe('{"ok":true}');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    await module.requestUrl({
      url: "https://example.com/headers",
      headers: { "X-Test": "ignored" },
    });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      headers: undefined,
    });
  });

  it("routes requestUrl through the app shell bridge before fetch fallback", async () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);
    const fetchMock = vi.fn(async () => {
      throw new Error("browser fetch should not run");
    });
    let nativePayload: unknown = null;
    vi.stubGlobal("fetch", fetchMock);
    app.shell.bridge.handle("request-url", (payload) => {
      nativePayload = payload;
      return {
        status: 202,
        headers: { "x-native": "yes" },
        text: "{\"native\":true}",
      };
    });

    const response = await module.requestUrl({
      url: "https://api.example.test/private",
      method: "POST",
      contentType: "application/json",
      body: "{\"ok\":true}",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(nativePayload).toMatchObject({
      url: "https://api.example.test/private",
      method: "POST",
      contentType: "application/json",
      body: "{\"ok\":true}",
    });
    expect((nativePayload as { headers?: unknown }).headers).toBeUndefined();
    expect(response).toMatchObject({
      status: 202,
      headers: { "x-native": "yes" },
      text: "{\"native\":true}",
      json: { native: true },
    });
    await expect(module.request("https://api.example.test/private")).resolves.toBe("{\"native\":true}");
  });

  it("rejects requestUrl on HTTP errors unless throw is false", async () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));

    await expect(module.requestUrl("https://example.com/missing")).rejects.toMatchObject({
      status: 404,
      response: { status: 404, text: "missing" },
    });

    await expect(module.requestUrl({ url: "https://example.com/missing", throw: false })).resolves.toMatchObject({
      status: 404,
      text: "missing",
      json: null,
    });
    await expect(module.requestUrl({ url: "https://example.com/missing", throw: false }).text).resolves.toBe("missing");
  });

  it("exports search helper functions for fuzzy/simple matching, sorting, and highlight rendering", () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);

    const fuzzy = module.prepareFuzzySearch("qs");
    const fuzzyMatch = fuzzy("Quick Switcher");
    expect(fuzzyMatch).toMatchObject({ matches: [[0, 1], [6, 7]] });
    expect(fuzzy("Command Palette")).toBeNull();

    const prepared = module.prepareQuery("qs");
    expect(module.prepareQuery).toBe(prepareQuery);
    expect(module.fuzzySearch).toBe(fuzzySearch);
    expect(prepared).toEqual({ query: "qs", tokens: ["qs"], fuzzy: ["q", "s"] });
    expect(module.fuzzySearch(prepared, "Quick Switcher")).toEqual(fuzzyMatch);

    const simple = module.prepareSimpleSearch("quick switch");
    expect(simple("Open Quick Switcher")).toMatchObject({ matches: [[5, 10], [11, 17]] });
    expect(simple("Open Quick Panel")).toBeNull();

    const results = [
      { match: { score: -10, matches: [] } },
      { match: { score: -1, matches: [] } },
      { match: { score: -5, matches: [] } },
    ];
    module.sortSearchResults(results);
    expect(results.map((item) => item.match.score)).toEqual([-1, -5, -10]);

    const matchesEl = document.createElement("div");
    module.renderMatches(matchesEl, "Quick Switcher", [[0, 5], [6, 14]]);
    expect(matchesEl.innerHTML).toBe('<span class="suggestion-highlight">Quick</span> <span class="suggestion-highlight">Switcher</span>');

    const resultEl = document.createElement("div");
    module.renderResults(resultEl, "Quick Switcher", fuzzyMatch);
    expect(resultEl.querySelectorAll(".suggestion-highlight")).toHaveLength(2);
  });

  it("keeps registerCodeMirror as a no-op compatibility shim", () => {
    const app = new App(document.createElement("div"));
    const plugin = new EmptyPlugin(app, manifest("legacy-codemirror"));
    const callback = vi.fn();

    plugin.registerCodeMirror(callback);

    expect(callback).not.toHaveBeenCalled();
    expect(app.workspace.editorExtensions).toEqual([]);
  });

  it("registers global and instance functions with Obsidian cleanup semantics", async () => {
    const app = new App(document.createElement("div"));
    const globalFunc = { name: "MiXeD", apply: () => "global" };
    const parentFunc = { name: "format", apply: () => "parent" };
    const childFunc = { name: "format", apply: () => "child" };
    class FunctionPlugin extends Plugin {
      override onload(): void {
        this.registerGlobalFunc(globalFunc);
        this.registerInstanceFunc(PrimitiveValue, parentFunc);
        this.registerInstanceFunc(StringValue, childFunc);
      }
    }
    const plugin = new FunctionPlugin(app, manifest("functions"));

    await plugin.load();

    expect(app.functionRegistry.findGlobal("mixed")).toBe(globalFunc);
    expect(app.functionRegistry.findGlobal("MIXED")).toBe(globalFunc);
    expect(app.functionRegistry.getAllGlobal()).toEqual([globalFunc]);
    const value = new StringValue("alpha");
    expect(app.functionRegistry.findForValue(value, "FORMAT")).toBe(childFunc);
    expect(app.functionRegistry.getAllForValue(value).format).toBe(childFunc);
    expect(app.functionRegistry.findForValue(new NumberValue(1), "format")).toBe(parentFunc);

    plugin.unload();

    expect(app.functionRegistry.findGlobal("mixed")).toBeNull();
    expect(app.functionRegistry.findForValue(value, "format")).toBeNull();
    expect(app.functionRegistry.findForValue(new NumberValue(1), "format")).toBeNull();
  });

  it("returns false when registering Bases views before the Bases core plugin is enabled", () => {
    const app = new App(document.createElement("div"));
    const plugin = new EmptyPlugin(app, manifest("bases-disabled"));

    expect(plugin.registerBasesView("plugin-card-grid", {
      name: "Plugin card grid",
      icon: "lucide-grid",
      factory: () => null as never,
    })).toBe(false);
    expect(app.bases.getView("plugin-card-grid")).toBeNull();
  });

  it("registers Bases views through the enabled Bases core plugin controller", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    await app.internalPlugins.enable("bases");
    const plugin = new EmptyPlugin(app, manifest("bases-enabled"));
    await plugin.load();
    const registration = {
      name: "Plugin card grid",
      icon: "lucide-grid",
      factory: () => null as never,
    };

    expect(plugin.registerBasesView("plugin-card-grid", registration)).toBe(true);

    expect(app.bases.getView("plugin-card-grid")).toMatchObject({
      id: "plugin-card-grid",
      name: "Plugin card grid",
      icon: "lucide-grid",
    });

    plugin.unload();

    expect(app.bases.getView("plugin-card-grid")).toBeNull();
  });
});
