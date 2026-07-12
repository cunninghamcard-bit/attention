import { Component } from "../core/Component";
import type { App } from "../app/App";
import type { CliFlags, CliHandler } from "../cli/Cli";
import type { Command } from "../commands/CommandManager";
import type { SettingTab } from "../app/SettingRegistry";
import type { ViewCreator } from "../workspace/ViewRegistry";
import type { InternalPluginDefinition } from "./InternalPlugin";
import type { CorePluginManager } from "./CorePluginManager";

export interface InternalRibbonItem {
  id: string;
  title: string;
  icon: string;
  callback: (event: MouseEvent) => unknown;
}

export class InternalPluginWrapper extends Component {
  instance: unknown = null;
  readonly commands: Command[] = [];
  readonly ribbonItems: InternalRibbonItem[] = [];
  readonly cliHandlers: InternalCliHandler[] = [];
  readonly mobileFileInfo: Array<{ renderCallback: (el: HTMLElement) => void }> = [];
  readonly views = new Map<string, ViewCreator>();
  readonly extensions = new Map<string, string[]>();
  private addedRibbonEls: HTMLElement[] = [];
  private addedCliHandlers: InternalCliHandler[] = [];
  private hasStatusBarItem = false;
  lastSave = 0;
  lastDataModifiedTime = 0;
  statusBarEl: HTMLElement | null = null;
  enabled = false;
  private configFileChangeTimer: number | null = null;

  constructor(readonly app: App, readonly definition: InternalPluginDefinition, readonly manager: CorePluginManager) {
    super();
  }

  init(): void {
    void this.definition.init(this.app, this);
  }

  async enable(userInitiated = false): Promise<void> {
    if (this.enabled) return;
    this.enabled = true;

    for (const command of this.commands) {
      this.app.commands.addCommand(command);
    }
    for (const item of this.ribbonItems) {
      this.addedRibbonEls.push(this.app.workspace.leftRibbon.addRibbonIcon(item.icon, item.title, item.callback, item.id));
    }
    if (this.hasStatusBarItem) {
      this.statusBarEl = this.app.statusBar.registerStatusBarItem();
      this.statusBarEl.classList.add(`plugin-${this.definition.id.toLowerCase().replace(/[^_a-z0-9-]/g, "-")}`);
    }
    for (const [type, creator] of this.views) this.app.viewRegistry.registerView(type, creator);
    for (const [type, extensions] of this.extensions) this.app.viewRegistry.registerExtensions(extensions, type);
    for (const entry of this.cliHandlers) {
      this.app.cli.registerHandler(entry.id, entry.description, entry.flags, entry.handler);
      this.addedCliHandlers.push(entry);
    }

    await this.definition.onEnable?.(this.app, this);
    if (userInitiated) this.definition.onUserEnable?.(this.app, this);
    this.load();
    this.manager.requestSaveConfig();
    this.manager.trigger("change", this);
    this.app.workspace.trigger("core-plugin-enabled", this.definition.id);
  }

  async disable(userInitiated = false): Promise<void> {
    if (!this.enabled) return;
    this.enabled = false;

    this.definition.onDisable?.(this.app, this);
    if (userInitiated) this.definition.onUserDisable?.(this.app, this);

    for (const command of this.commands) {
      this.app.commands.removeCommand(command.id);
    }
    for (const el of this.addedRibbonEls) el.remove();
    this.addedRibbonEls = [];
    for (const item of this.ribbonItems) this.app.workspace.leftRibbon.removeRibbonAction(item.id);
    for (const entry of this.addedCliHandlers) this.app.cli.unregisterHandler(entry.id, entry.handler);
    this.addedCliHandlers = [];
    this.statusBarEl?.remove();
    this.statusBarEl = null;
    for (const [type, extensions] of this.extensions) this.app.viewRegistry.unregisterExtensions(extensions);
    for (const type of this.views.keys()) {
      this.app.viewRegistry.unregisterView(type);
      if (userInitiated) this.app.workspace.detachLeavesOfType(type);
    }

    this.unload();
    this.manager.requestSaveConfig();
    this.manager.trigger("change", this);
    this.app.workspace.trigger("core-plugin-disabled", this.definition.id);
  }

  registerViewType(type: string, creator: ViewCreator): void {
    this.views.set(type, creator);
  }

  registerExtensions(extensions: string[], viewType: string): void {
    this.extensions.set(viewType, extensions);
  }

  registerGlobalCommand(command: Command): Command {
    const normalized = {
      ...command,
      name: `${this.definition.name}: ${command.name}`,
    };
    this.commands.push(normalized);
    return normalized;
  }

  registerRibbonItem(title: string, icon: string, callback: (event: MouseEvent) => unknown): void {
    this.ribbonItems.push({ id: `${this.definition.id}:${title}`, title, icon, callback });
  }

  registerStatusBarItem(): void {
    this.hasStatusBarItem = true;
  }

  registerCliHandler(command: string, description: string, flags: CliFlags | null, handler: CliHandler): void {
    const entry = { id: command, description, flags, handler };
    this.cliHandlers.push(entry);
    if (this.enabled) {
      this.app.cli.registerHandler(command, description, flags, handler);
      this.addedCliHandlers.push(entry);
    }
  }

  registerMobileFileInfo(renderCallback: (el: HTMLElement) => void): void {
    this.mobileFileInfo.push({ renderCallback });
  }

  addCommand(command: Command): Command {
    const id = command.id.includes(":") ? command.id : `${this.definition.id}:${command.id}`;
    return this.registerGlobalCommand({ ...command, id });
  }

  addRibbonIcon(icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
    this.registerRibbonItem(title, icon, callback);
    if (!this.enabled) {
      const placeholder = document.createElement("button");
      placeholder.className = "clickable-icon side-dock-ribbon-action";
      placeholder.title = title;
      placeholder.setAttribute("aria-label", title);
      return placeholder;
    }
    const id = `${this.definition.id}:${title}`;
    const el = this.app.workspace.leftRibbon.addRibbonIcon(icon, title, callback, id);
    this.addedRibbonEls.push(el);
    return el;
  }

  addStatusBarItem(): HTMLElement {
    this.registerStatusBarItem();
    const placeholder = document.createElement("div");
    placeholder.className = "status-bar-item";
    return placeholder;
  }

  addSettingTab(tab: SettingTab): void {
    this.app.setting.addSettingTab(tab);
    this.register(() => this.app.setting.removeSettingTab(tab));
  }

  async loadData<T = unknown>(): Promise<T | null> {
    const data = await this.app.vault.readConfigJson<T>(this.definition.id);
    if (data !== null && this.definition.onExternalSettingsChange) this.lastDataModifiedTime = await this.getModifiedTime();
    return data;
  }

  async saveData<T = unknown>(data: T): Promise<void> {
    this.lastSave = Date.now();
    this.lastDataModifiedTime = this.lastSave;
    await this.app.vault.writeConfigJson(this.definition.id, data, { mtime: this.lastSave });
  }

  async deleteData(): Promise<void> {
    this.lastSave = Date.now();
    this.lastDataModifiedTime = this.lastSave;
    await this.app.vault.deleteConfigJson(this.definition.id);
  }

  onConfigFileChange(): void {
    if (this.configFileChangeTimer !== null) window.clearTimeout(this.configFileChangeTimer);
    this.configFileChangeTimer = window.setTimeout(() => {
      this.configFileChangeTimer = null;
      void this.handleConfigFileChange();
    }, 50);
  }

  private async handleConfigFileChange(): Promise<void> {
    if (!this.definition.onExternalSettingsChange) return;
    const mtime = await this.getModifiedTime();
    if (this.lastSave < mtime) await this.definition.onExternalSettingsChange(this.app, this);
    this.lastSave = mtime;
    this.lastDataModifiedTime = mtime;
  }

  async getModifiedTime(): Promise<number> {
    return (await this.app.jsonStore.stat(this.getConfigFileName()))?.mtime ?? 0;
  }

  private getConfigFileName(): string {
    return this.app.vault.getConfigFile(this.definition.id);
  }
}

interface InternalCliHandler {
  id: string;
  description: string;
  flags: CliFlags | null;
  handler: CliHandler;
}
