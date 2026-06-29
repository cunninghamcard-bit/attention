import type { App } from "../app/App";
import type { EventRef } from "../core/Events";
import { unregisterEventRef } from "../core/EventRefInternal";
import type { FrontmatterPropertyInfo } from "../metadata/MetadataCache";
import { PropertyRegistry } from "./PropertyRegistry";
import type { PropertyType } from "./PropertyTypes";

export interface TypesConfig {
  types?: Record<string, string>;
}

export interface MetadataPropertyInfo extends FrontmatterPropertyInfo {
}

const reservedTypes: Record<string, { name: string; widget: PropertyType }> = {
  aliases: { name: "aliases", widget: "aliases" },
  cssclasses: { name: "cssclasses", widget: "multitext" },
  tags: { name: "tags", widget: "tags" },
};

export class MetadataTypeManager extends PropertyRegistry<MetadataPropertyInfo, Record<string, MetadataPropertyInfo>> {
  private properties: Record<string, MetadataPropertyInfo> = {};
  private loaded = false;
  private lastSave = 0;
  private configFileChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private unregisterRefs: EventRef[] = [];

  constructor(readonly app: App) {
    super();
  }

  async load(): Promise<void> {
    await this.loadData();
    this.loaded = true;
  }

  async loadData(): Promise<void> {
    const previous = new Map(this.assignedWidgets);
    this.assignedWidgets.clear();
    this.definitions.clear();
    const config = await this.app.vault.readConfigJson<TypesConfig>("types");
    if (config?.types && typeof config.types === "object" && !Array.isArray(config.types)) {
      for (const [name, widget] of Object.entries(config.types)) {
        const type = this.normalizeWidget(widget);
        if (!type) continue;
        const id = name.toLowerCase();
        this.register({ id, name, type, icon: this.getType(type)?.icon });
        if (this.loaded && previous.get(id)?.widget !== type) this.trigger("changed", id);
      }
    }
    this.applyReservedTypes(previous);
    if (this.loaded) {
      for (const id of previous.keys()) {
        if (!this.assignedWidgets.has(id)) this.trigger("changed", id);
      }
    }
  }

  async save(): Promise<void> {
    const types: Record<string, PropertyType> = {};
    for (const [id, assigned] of this.assignedWidgets) {
      const name = this.definitions.get(id)?.name ?? assigned.name ?? reservedTypes[id]?.name ?? id;
      types[name] = assigned.widget;
    }
    const mtime = Date.now();
    this.lastSave = mtime;
    await this.app.vault.writeConfigJson("types", { types }, { mtime });
  }

  registerListeners(): void {
    if (this.unregisterRefs.length > 0) return;
    this.unregisterRefs.push(
      this.app.vault.on<[string]>("raw", (path) => this.onRaw(path)),
      this.app.metadataCache.on("finished", () => this.updatePropertyInfoCache()),
      this.on("changed", () => this.updatePropertyInfoCache()),
    );
  }

  unregisterListeners(): void {
    for (const ref of this.unregisterRefs) unregisterEventRef(ref);
    this.unregisterRefs = [];
    this.cancelConfigFileChange();
  }

  onRaw(path: string): void {
    if (path === `${this.app.vault.configDir}/types.json`) this.onConfigFileChange();
  }

  onConfigFileChange(): void {
    this.cancelConfigFileChange();
    this.configFileChangeTimer = setTimeout(() => {
      this.configFileChangeTimer = null;
      void this.handleConfigFileChange();
    }, 50);
  }

  updatePropertyInfoCache(): void {
    this.properties = this.app.metadataCache.getAllPropertyInfos();
  }

  getAllProperties(): Record<string, MetadataPropertyInfo> {
    return structuredClone(this.properties);
  }

  getPropertyInfo(id: string): MetadataPropertyInfo | null {
    const normalized = id.toLowerCase();
    return this.properties[normalized] ? structuredClone(this.properties[normalized]) : { name: id, widget: "text", occurrences: 0 };
  }

  getAssignedWidget(id: string): PropertyType | null {
    return super.getAssignedWidget(id.toLowerCase());
  }

  setType(id: string, type: PropertyType): void {
    const normalized = id.toLowerCase();
    this.register({ id: normalized, name: id, type, icon: this.getType(type)?.icon });
    void this.save();
    this.trigger("changed", normalized);
  }

  setPropertyType(id: string, type: PropertyType): void {
    this.setType(id, type);
  }

  unsetType(id: string): void {
    const normalized = id.toLowerCase();
    if (reservedTypes[normalized]) return;
    this.assignedWidgets.delete(normalized);
    this.definitions.delete(normalized);
    void this.save();
    this.trigger("changed", normalized);
  }

  private async handleConfigFileChange(): Promise<void> {
    const stat = await this.app.jsonStore.stat(this.app.vault.getConfigFile("types"));
    const mtime = stat?.mtime ?? 0;
    if (this.lastSave < mtime) await this.loadData();
    this.lastSave = mtime;
  }

  private applyReservedTypes(previous: Map<string, { name: string; widget: PropertyType }>): void {
    for (const [id, { name, widget }] of Object.entries(reservedTypes)) {
      this.register({ id: name, name, type: widget, icon: this.getType(widget)?.icon });
      if (this.loaded && previous.get(id)?.widget !== widget) this.trigger("changed", id);
    }
  }

  private normalizeWidget(widget: string): PropertyType | null {
    return this.getType(widget as PropertyType) ? widget as PropertyType : null;
  }

  private cancelConfigFileChange(): void {
    if (this.configFileChangeTimer == null) return;
    clearTimeout(this.configFileChangeTimer);
    this.configFileChangeTimer = null;
  }
}
