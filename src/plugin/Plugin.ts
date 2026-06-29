import { Component } from "../core/Component";
import type { App, CliFlags, CliHandler } from "../app/App";
import type { Command } from "../commands/CommandManager";
import type { ThemeDefinition } from "../theme/ThemeManager";
import type { CssSnippet } from "../theme/CssSnippetManager";
import type { SettingsSectionDefinition } from "../settings/SettingsSection";
import type { ViewCreator } from "../workspace/ViewRegistry";
import type { HoverLinkSource, HoverLinkSourceConfig } from "../workspace/WorkspaceHover";
import type { ObsidianProtocolHandler } from "../protocol/UriRouter";
import type { Menu } from "../ui/Menu";
import type { Editor } from "../editor/Editor";
import type { MarkdownFileInfo } from "../editor/EditorStateField";
import type { TAbstractFile } from "../vault/TAbstractFile";
import type { MarkdownView } from "../views/MarkdownView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import type { BasesViewRegistration } from "../bases/BasesRegistry";
import type { BasesFunction, BasesValueType } from "../bases/BasesFunctionRegistry";
import type { EditorSuggest } from "../suggest/EditorSuggest";
import { MarkdownRenderer, type MarkdownCodeBlockProcessor, type MarkdownPostProcessor } from "../markdown/MarkdownRenderer";
import { MarkdownPreviewRenderer } from "../markdown/MarkdownPreviewRenderer";
import { createPluginContext, type PluginContext } from "./PluginContext";
import { normalizePluginManifest, type PluginManifest, type PluginManifestInput } from "./PluginManifest";
import type { PluginSettingTab } from "./PluginSettingTab";
export type { PluginManifest, PluginManifestInput } from "./PluginManifest";

export class Plugin extends Component {
  app: App;
  manifest: PluginManifest;
  readonly ctx: PluginContext;
  settings?: unknown;
  _userDisabled = false;
  _lastDataModifiedTime = 0;
  private configFileChangeTimer: number | null = null;

  constructor(app: App, manifest: PluginManifestInput) {
    super();
    this.app = app;
    this.manifest = normalizePluginManifest(manifest);
    this.ctx = createPluginContext(app);
  }

  onload(): Promise<void> | void {}
  onUserEnable(): void | Promise<void> {}
  onExternalSettingsChange?(): any;

  override async load(): Promise<void> {
    if (this._loaded) return;
    this._loaded = true;
    await this.onload();
    for (const child of this._children.slice()) void child.load();
  }

  async loadData<T = any>(): Promise<T> {
    const data = await this.app.vault.readPluginData<T>(this.getPluginDataDir());
    if (data && this.onExternalSettingsChange) this._lastDataModifiedTime = await this.getModifiedTime();
    return data as T;
  }

  async saveData(data: any): Promise<void> {
    const mtime = Date.now();
    this._lastDataModifiedTime = mtime;
    await this.app.vault.writePluginData(this.getPluginDataDir(), data, { mtime });
  }

  onConfigFileChange(): void {
    if (this.configFileChangeTimer !== null) window.clearTimeout(this.configFileChangeTimer);
    this.configFileChangeTimer = window.setTimeout(() => {
      this.configFileChangeTimer = null;
      void this._onConfigFileChange();
    }, 50);
  }

  async getModifiedTime(): Promise<number> {
    return (await this.app.jsonStore.stat(`${this.getPluginDataDir()}/data.json`))?.mtime ?? 0;
  }

  private async _onConfigFileChange(): Promise<void> {
    if (!this.onExternalSettingsChange) return;
    const mtime = await this.getModifiedTime();
    if (this._lastDataModifiedTime < mtime) this.onExternalSettingsChange();
    this._lastDataModifiedTime = mtime;
  }

  addCommand(command: Command): Command {
    command.id = this.getFullCommandId(command.id);
    command.name = `${this.manifest.name}: ${command.name}`;
    this.app.commands.addCommand(command);
    this.register(() => {
      this.app.commands.removeCommand(command.id);
    });
    return command;
  }

  removeCommand(id: string): void {
    const commandId = this.getFullCommandId(id);
    this.app.commands.removeCommand(commandId);
  }

  addRibbonIcon(icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
    const id = `${this.manifest.id}:${title}`;
    const el = this.app.workspace.leftRibbon.addRibbonIcon(icon, title, callback, id);
    this.register(() => {
      this.app.workspace.leftRibbon.removeRibbonAction(id);
      el.remove();
    });
    return el;
  }

  addStatusBarItem(): HTMLElement {
    const el = this.app.statusBar.registerStatusBarItem();
    el.classList.add(`plugin-${this.manifest.id.toLowerCase().replace(/[^_a-zA-Z0-9-]/, "-")}`);
    this.register(() => el.remove());
    return el;
  }

  registerView(type: string, creator: ViewCreator): void {
    this.app.viewRegistry.registerView(type, creator);
    this.register(() => {
      this.app.viewRegistry.unregisterView(type);
      if (this._userDisabled) this.app.workspace.detachLeavesOfType(type);
    });
  }

  registerExtensions(extensions: string[], viewType: string): void {
    this.app.viewRegistry.registerExtensions(extensions, viewType);
    this.register(() => this.app.viewRegistry.unregisterExtensions(extensions));
  }

  registerHoverLinkSource(id: string, info: HoverLinkSourceConfig): void;
  registerHoverLinkSource(source: HoverLinkSource): void;
  registerHoverLinkSource(idOrSource: string | HoverLinkSource, info?: HoverLinkSourceConfig): void {
    const source = typeof idOrSource === "string"
      ? { id: idOrSource, display: info?.display ?? idOrSource, defaultMod: info?.defaultMod }
      : idOrSource;
    this.app.workspace.registerHoverLinkSource(source.id, { display: source.display, defaultMod: source.defaultMod });
    this.register(() => this.app.workspace.unregisterHoverLinkSource(source.id));
  }

  registerFileMenu(handler: (menu: Menu, file: TAbstractFile, source: string, leaf?: WorkspaceLeaf) => void): void {
    this.registerEvent(this.app.workspace.on("file-menu", handler));
  }

  registerEditorMenu(handler: (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => void): void {
    this.registerEvent(this.app.workspace.on("editor-menu", handler));
  }

  registerLinkMenu(handler: (menu: Menu, linktext: string, sourcePath: string, source: string) => void): void {
    this.registerEvent(this.app.workspace.on("link-menu", handler));
  }

  registerObsidianProtocolHandler(action: string, handler: ObsidianProtocolHandler): void {
    this.app.workspace.registerObsidianProtocolHandler(action, handler);
    this.register(() => this.app.workspace.unregisterObsidianProtocolHandler(action, handler));
  }

  registerMarkdownPostProcessor(processor: MarkdownPostProcessor, sortOrder?: number): MarkdownPostProcessor {
    MarkdownPreviewRenderer.registerPostProcessor(processor, sortOrder);
    this.app.workspace.trigger("post-processor-change");
    this.register(() => {
      MarkdownPreviewRenderer.unregisterPostProcessor(processor);
      this.app.workspace.trigger("post-processor-change");
    });
    return processor;
  }

  registerMarkdownCodeBlockProcessor(language: string, processor: MarkdownCodeBlockProcessor, sortOrder?: number): MarkdownPostProcessor {
    const wrapper = MarkdownPreviewRenderer.createCodeBlockPostProcessor(language, processor);
    MarkdownPreviewRenderer.registerPostProcessor(wrapper, sortOrder);
    MarkdownPreviewRenderer.registerCodeBlockPostProcessor(language, processor);
    this.app.workspace.trigger("post-processor-change");
    this.register(() => {
      MarkdownPreviewRenderer.unregisterCodeBlockPostProcessor(language);
      MarkdownPreviewRenderer.unregisterPostProcessor(wrapper);
      this.app.workspace.trigger("post-processor-change");
    });
    return wrapper;
  }

  registerEditorExtension(extension: unknown): void {
    this.app.workspace.registerEditorExtension(extension);
    this.register(() => this.app.workspace.unregisterEditorExtension(extension));
  }

  registerCodeMirror(_callback: unknown): void {}

  registerGlobalFunc(func: BasesFunction): void {
    this.app.functionRegistry.addGlobal(func);
    const name = func.name;
    this.register(() => this.app.functionRegistry.removeGlobal(name));
  }

  registerInstanceFunc(type: BasesValueType, func: BasesFunction): void {
    this.app.functionRegistry.addForType(type, func);
    const name = func.name;
    this.register(() => this.app.functionRegistry.removeForType(type, name));
  }

  registerEditorSuggest(suggest: EditorSuggest<unknown>): void {
    this.app.workspace.editorSuggest.addSuggest(suggest);
    this.register(() => this.app.workspace.editorSuggest.removeSuggest(suggest));
  }

  registerCliHandler(command: string, description: string, flags: CliFlags | null, handler: CliHandler): void {
    const registration = this.app.registerCliHandler(command, description, flags, handler, this.manifest.id);
    this.register(() => this.app.unregisterCliHandler(registration));
  }

  registerBasesView(viewId: string, registration: BasesViewRegistration): boolean {
    const bases = this.app.internalPlugins.getEnabledPluginById<{
      registerView(viewId: string, registration: BasesViewRegistration): void;
      deregisterView(viewId: string): void;
    }>("bases");
    if (!bases) return false;
    bases.registerView(viewId, registration);
    this.register(() => bases.deregisterView(viewId));
    return true;
  }

  async loadCSS(cssText = ""): Promise<void> {
    if (cssText.trim()) {
      this.registerCss(cssText);
      return;
    }

    if (!this.manifest.dir) return;
    const vault = this.app.vault as unknown as {
      readText?: (path: string) => Promise<string | null>;
      adapter?: { read?: (path: string) => Promise<string> };
    };
    const path = `${this.manifest.dir}/styles.css`;
    let loaded = "";
    if (vault.readText) loaded = await vault.readText(path) ?? "";
    else if (vault.adapter?.read) loaded = await vault.adapter.read(path);
    if (loaded.trim()) this.registerCss(loaded);
  }

  registerCss(cssText: string): void {
    const style = this.app.customCss.registerPluginStyle(this.manifest.id, cssText);
    this.register(() => this.app.customCss.unregisterPluginStyle(this.manifest.id, style));
  }

  registerCssSnippet(snippet: Omit<CssSnippet, "id"> & { id?: string }): void {
    const id = snippet.id ?? `${this.manifest.id}:snippet`;
    this.app.cssSnippets.registerSnippet({ ...snippet, id });
    this.register(() => this.app.cssSnippets.unregisterSnippet(id));
  }

  registerTheme(theme: ThemeDefinition): void {
    this.app.themes.registerTheme(theme);
    this.register(() => this.app.themes.unregisterTheme(theme.id));
  }

  registerSettingsSection(section: SettingsSectionDefinition): void {
    this.app.settingSections.register(section);
    this.register(() => this.app.settingSections.unregister(section.id));
  }

  addSettingTab(tab: PluginSettingTab): void {
    this.app.setting.addSettingTab(tab);
    this.register(() => this.app.setting.removeSettingTab(tab));
  }

  private getFullCommandId(id: string): string {
    return `${this.manifest.id}:${id}`;
  }

  private getPluginDataDir(): string {
    return this.manifest.dir ?? `plugins/${this.manifest.id}`;
  }
}
