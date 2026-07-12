import type { App } from "../app/App";
import type { Plugin } from "./Plugin";
import { SettingTab, type SettingDefinitionItem, type SettingTab as SettingTabShape } from "../app/SettingTab";
import type { InternalPluginWrapper } from "./InternalPluginWrapper";

export class PluginSettingTab extends SettingTab {
  readonly section = "community-plugins" as const;
  plugin: Plugin;
  declare id: string;
  declare name: string;

  constructor(app: App, plugin: Plugin) {
    super(app, app.setting);
    this.plugin = plugin;
    this.id = plugin.manifest.id;
    this.name = plugin.manifest.name;
  }

  override getControlValue(key: string): unknown {
    const settings = this.plugin.settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return undefined;
    return (settings as Record<string, unknown>)[key];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.getMutableSettings();
    if (value === undefined) delete settings[key];
    else settings[key] = value;
    await this.plugin.saveData(this.plugin.settings);
  }

  display(): void {}

  private getMutableSettings(): Record<string, unknown> {
    if (!this.plugin.settings || typeof this.plugin.settings !== "object" || Array.isArray(this.plugin.settings)) this.plugin.settings = {};
    return this.plugin.settings as Record<string, unknown>;
  }
}

export class CorePluginSettingTab extends SettingTab {
  readonly section = "core-plugins" as const;
  declare id: string;
  declare name: string;
  declare icon?: string;

  constructor(app: App, readonly plugin: InternalPluginWrapper, readonly delegate?: SettingTabShape) {
    super(app, app.setting);
    const instance = plugin.instance as { id?: string; name?: string } | null;
    this.id = instance?.id ?? plugin.definition.id;
    this.name = instance?.name ?? plugin.definition.name;
    this.icon = delegate?.icon;
    if (delegate?.containerEl) this.containerEl = delegate.containerEl;
    this.containerEl.classList.add("vertical-tab-content");
  }

  setQuery(query: string): void {
    this.delegate?.setQuery?.(query);
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return this.delegate?.getSettingDefinitions?.() ?? [];
  }

  override update(): void {
    this.delegate?.update?.();
    this.settingItems = this.delegate?.settingItems ?? this.getSettingDefinitions();
  }

  override getControlValue(key: string): unknown {
    return this.delegate?.getControlValue?.(key) ?? super.getControlValue(key);
  }

  override setControlValue(key: string, value: unknown): void | Promise<void> {
    return this.delegate?.setControlValue?.(key, value) ?? super.setControlValue(key, value);
  }

  override refreshDomState(): void {
    if (this.delegate?.refreshDomState) this.delegate.refreshDomState();
    else super.refreshDomState();
  }

  display(): void {
    this.delegate?.display?.();
  }

  hide(): void {
    if (this.delegate?.hide) this.delegate.hide();
    else this.containerEl.remove();
  }
}
