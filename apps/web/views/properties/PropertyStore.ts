import type { App } from "../../app/App";
import { TFile } from "../../vault/TAbstractFile";
import {
  deleteFrontmatterProperty,
  parseFrontmatter,
  setFrontmatterProperty,
  updateFrontmatter,
} from "../../metadata/Frontmatter";
import type {
  FileProperties,
  PropertyDefinition,
  PropertyUsage,
  PropertyValue,
} from "./PropertyTypes";

export class PropertyStore {
  constructor(readonly app: App) {}

  getFileProperties(path: string | TFile): FileProperties {
    const file =
      path instanceof TFile
        ? path
        : (this.getMarkdownFile(path) ?? new TFile(this.app.vault, path));
    const cache = this.app.metadataCache.getCacheByPath(file.path);
    const frontmatter = cache?.frontmatter ?? {};
    const values: Record<string, PropertyValue> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      const normalized = normalize(value);
      values[key] = normalized;
      this.app.propertyRegistry.ensureDefinition(key, normalized);
    }
    return { file, path: file.path, values };
  }

  async setProperty(path: string, propertyId: string, value: PropertyValue): Promise<void> {
    const file = this.getMarkdownFile(path);
    if (!file) return;
    const definition = this.app.propertyRegistry.ensureDefinition(propertyId, value);
    const normalized = this.app.propertyRegistry.normalizeValue(definition.type, value);
    await this.app.vault.process(file, (source) =>
      setFrontmatterProperty(source, definition.id, normalized),
    );
    this.app.workspace.trigger("property-change", path, propertyId, value);
  }

  async clearProperty(path: string, propertyId: string): Promise<void> {
    const file = this.getMarkdownFile(path);
    if (!file) return;
    await this.app.vault.process(file, (source) => deleteFrontmatterProperty(source, propertyId));
    this.app.workspace.trigger("property-change", path, propertyId, null);
  }

  async clearFileProperties(path: string): Promise<void> {
    const file = this.getMarkdownFile(path);
    if (!file) return;
    await this.app.vault.process(file, (source) =>
      updateFrontmatter(source, (values) => {
        for (const key of Object.keys(values)) delete values[key];
      }),
    );
    this.app.workspace.trigger("property-clear-file", path);
  }

  async renameProperty(oldId: string, newId: string): Promise<number> {
    const trimmed = newId.trim();
    if (!trimmed || trimmed === oldId) return 0;
    const count = await this.app.fileManager.renameProperty(oldId, trimmed);
    this.app.workspace.trigger("property-rename", oldId, trimmed, count);
    return count;
  }

  async deleteProperty(propertyId: string): Promise<number> {
    let count = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const source = await this.app.vault.read(file);
      const values = parseFrontmatter(source).values;
      if (!(propertyId in values)) continue;
      await this.app.vault.modify(file, deleteFrontmatterProperty(source, propertyId));
      count += 1;
    }
    this.app.propertyRegistry.unregister(propertyId);
    this.app.workspace.trigger("property-delete", propertyId, count);
    return count;
  }

  async setPropertyType(propertyId: string, type: PropertyDefinition["type"]): Promise<void> {
    this.app.propertyRegistry.setPropertyType(propertyId, type);
    for (const file of this.app.vault.getMarkdownFiles()) {
      const properties = this.getFileProperties(file.path);
      if (!(propertyId in properties.values)) continue;
      await this.setProperty(file.path, propertyId, properties.values[propertyId]);
    }
    this.app.workspace.trigger("property-type-change", propertyId, type);
  }

  listFilesWithProperties(): FileProperties[] {
    return this.app.vault.getMarkdownFiles().map((file) => this.getFileProperties(file));
  }

  listPropertiesInVault(): PropertyUsage[] {
    const usage = new Map<string, { value: PropertyValue; files: string[] }>();
    for (const file of this.listFilesWithProperties()) {
      for (const [key, value] of Object.entries(file.values)) {
        const entry = usage.get(key) ?? { value, files: [] };
        entry.files.push(file.path);
        if (entry.value == null) entry.value = value;
        usage.set(key, entry);
      }
    }
    return [...usage.entries()]
      .map(([id, entry]) => ({
        property: this.app.propertyRegistry.ensureDefinition(id, entry.value),
        count: entry.files.length,
        files: entry.files,
      }))
      .sort((a, b) => a.property.name.localeCompare(b.property.name));
  }

  getPropertyValue(path: string, propertyId: string): PropertyValue {
    return this.getFileProperties(path).values[propertyId] ?? null;
  }

  private getMarkdownFile(path: string): TFile | null {
    const file = this.app.vault.getFileByPath(path);
    return file instanceof TFile && file.extension === "md" ? file : null;
  }
}

function normalize(value: unknown): PropertyValue {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return String(value);
}
