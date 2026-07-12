import { Events, type EventRef } from "../core/Events";
import type { JsonStore, JsonStoreWriteOptions } from "../storage/JsonStore";
import type { PluginDataStore } from "../storage/PluginDataStore";
import { InMemoryAdapter, type DataWriteOptions, type ListedFiles, type Stat } from "./DataAdapter";
import { validateVaultPath } from "./FileNameValidation";
import { TAbstractFile, TFile, TFolder, type FileStats } from "./TAbstractFile";

export interface VaultAdapterStat {
  type?: Stat["type"];
  ctime?: number;
  mtime?: number;
  size?: number;
}

export interface VaultAdapter {
  supportsEvents?: boolean;
  on?(name: string, handler: (...args: unknown[]) => void): EventRef;
  load?(): Promise<void>;
  watch?(handler: (event: string, path: string, oldPath?: string) => void): Promise<() => void>;
  watchHiddenRecursive?(path: string): Promise<() => void> | Promise<void>;
  exists?(path: string, sensitive?: boolean): Promise<boolean>;
  stat?(path: string): Promise<VaultAdapterStat | null>;
  read(path: string): Promise<string>;
  readBinary?(path: string): Promise<ArrayBuffer>;
  getName?(): string;
  getResourcePath?(path: string): string;
  getFullPath?(path: string): string;
  resolvePath?(urlOrPath: string): string | null;
  write(path: string, data: string, options?: DataWriteOptions): Promise<void>;
  writeBinary?(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>;
  append?(path: string, data: string, options?: DataWriteOptions): Promise<void>;
  appendBinary?(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>;
  process?(
    path: string,
    updater: (data: string) => string,
    options?: DataWriteOptions,
  ): Promise<string>;
  copy?(path: string, newPath: string): Promise<void>;
  delete(path: string): Promise<void>;
  mkdir?(path: string): Promise<void>;
  remove?(path: string): Promise<void>;
  rename?(path: string, newPath: string): Promise<void>;
  rmdir?(path: string, recursive?: boolean): Promise<void>;
  trashSystem?(path: string): Promise<boolean>;
  trashLocal?(path: string): Promise<void>;
  list(path: string): Promise<ListedFiles | string[]>;
}

export class Vault extends Events {
  cacheLimit = 65536;
  configDir = ".obsidian";
  readonly root = new TFolder(this, "/");
  private files = new Map<string, TAbstractFile>();
  private data = new Map<string, string>();
  private binaryData = new Map<string, Uint8Array>();
  private config: Record<string, unknown> = {};
  private configTs = 0;
  private savingConfig = false;
  private loaded = false;
  private unwatchAdapter: (() => void) | null = null;
  private unwatchHiddenConfig: (() => void) | null = null;
  private processQueues = new Map<string, Promise<unknown>>();
  readonly requestSaveConfig = createDebouncedRequest(
    () => this.saveConfig(),
    () => this.canPersistConfig(),
    1000,
  );
  readonly requestReloadConfig = createDebouncedRequest(
    () => this.reloadConfig(),
    () => this.canPersistConfig(),
    500,
  );

  override on(name: "create", callback: (file: TAbstractFile) => any, ctx?: any): EventRef;
  override on(name: "modify", callback: (file: TAbstractFile) => any, ctx?: any): EventRef;
  override on(name: "delete", callback: (file: TAbstractFile) => any, ctx?: any): EventRef;
  override on(
    name: "rename",
    callback: (file: TAbstractFile, oldPath: string) => any,
    ctx?: any,
  ): EventRef;
  override on<TArgs extends unknown[]>(
    name: string,
    callback: (...args: TArgs) => any,
    ctx?: object,
  ): EventRef<TArgs>;
  override on<TArgs extends unknown[]>(
    name: string,
    callback: (...args: TArgs) => any,
    ctx?: object,
  ): EventRef<TArgs> {
    return super.on(name, callback, ctx);
  }

  constructor(
    readonly adapter?: VaultAdapter,
    readonly pluginData?: PluginDataStore,
    readonly jsonStore?: JsonStore,
  ) {
    super();
    this.files.set(this.root.path, this.root);
    this.jsonStore?.setRoot(this.configDir);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (this.usesAdapterEvents()) {
      if (this.adapter?.watch)
        this.unwatchAdapter = await this.adapter.watch((event, path, oldPath) =>
          this.handleAdapterEvent(event, path, oldPath),
        );
      else {
        this.bindAdapterEvents(this.adapter);
        await this.adapter?.load?.();
      }
      if (this.adapter?.watchHiddenRecursive) {
        const unwatchHidden = await this.adapter.watchHiddenRecursive(this.configDir);
        this.unwatchHiddenConfig = typeof unwatchHidden === "function" ? unwatchHidden : null;
      }
    } else {
      await this.adapter?.load?.();
    }
  }

  unload(): void {
    this.requestSaveConfig.cancel();
    this.requestReloadConfig.cancel();
    this.unwatchHiddenConfig?.();
    this.unwatchHiddenConfig = null;
    this.unwatchAdapter?.();
    this.unwatchAdapter = null;
    this.loaded = false;
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.files.get(path) ?? null;
  }

  getName(): string {
    return this.adapter?.getName?.() ?? "Vault";
  }

  getRoot(): TFolder {
    return this.root;
  }

  getDirectParent(file: TAbstractFile): TFolder | null {
    const index = file.path.lastIndexOf("/");
    if (index === -1) return this.root;
    const parent = this.files.get(file.path.slice(0, index));
    return parent instanceof TFolder ? parent : null;
  }

  addChild(file: TAbstractFile): void {
    const previous = file.parent;
    const parent = this.getDirectParent(file);
    if (!parent || parent === previous) return;
    if (previous) previous.children = previous.children.filter((child) => child !== file);
    parent.children.push(file);
    file.parent = parent;
  }

  removeChild(file: TAbstractFile): void {
    const parent = file.parent;
    if (!parent) return;
    parent.children = parent.children.filter((child) => child !== file);
    file.parent = null;
  }

  async setupConfig(): Promise<void> {
    if (!this.canPersistConfig()) return;
    await this.ensureConfigDir();
    this.configTs = Date.now();
    const appConfig = (await this.readConfigJson<Record<string, unknown>>("app")) ?? {};
    const appearanceConfig =
      (await this.readConfigJson<Record<string, unknown>>("appearance")) ?? {};
    this.config = migrateVaultConfig({ ...appearanceConfig, ...appConfig, ...this.config });
    this.requestSaveConfig();
  }

  async saveConfig(): Promise<void> {
    if (!this.canPersistConfig()) return;
    this.savingConfig = true;
    await this.ensureConfigDir();
    const appConfig: Record<string, unknown> = {};
    const appearanceConfig: Record<string, unknown> = {};
    try {
      for (const key of Object.keys(this.config)) {
        if (!Object.prototype.hasOwnProperty.call(this.config, key)) continue;
        if (appearanceConfigKeys.has(key)) appearanceConfig[key] = this.config[key];
        else appConfig[key] = this.config[key];
      }
      await this.writeConfigJson("app", appConfig);
      await this.writeConfigJson("appearance", appearanceConfig);
      this.configTs = Date.now();
    } finally {
      this.savingConfig = false;
    }
  }

  async reloadConfig(): Promise<void> {
    this.requestReloadConfig.cancel();
    if (!this.canPersistConfig() || this.savingConfig || (await this.configFilesAreFresh())) return;
    this.configTs = Date.now();
    const next = migrateVaultConfig({
      ...((await this.readConfigJson<Record<string, unknown>>("appearance")) ?? {}),
      ...((await this.readConfigJson<Record<string, unknown>>("app")) ?? {}),
    });
    const previous = this.config;
    this.config = { ...previous };

    for (const [key, value] of Object.entries(next)) {
      if (hasEqualConfigValue(previous[key], value)) continue;
      this.config[key] = value;
      this.trigger("config-changed", key);
    }

    for (const key of Object.keys(previous)) {
      if (Object.prototype.hasOwnProperty.call(next, key)) continue;
      delete this.config[key];
      this.trigger("config-changed", key);
    }
  }

  getConfig<T = unknown>(key: string): T | undefined {
    const value = Object.prototype.hasOwnProperty.call(this.config, key)
      ? this.config[key]
      : defaultVaultConfig[key];
    return cloneConfigValue(value) as T | undefined;
  }

  setConfig(key: string, value: unknown): void {
    if (this.config[key] === value) return;
    if (value !== undefined) this.config[key] = value;
    else delete this.config[key];
    this.requestSaveConfig();
    this.trigger("config-changed", key);
  }

  setConfigDir(configDir: string): void {
    this.configDir = isValidConfigDir(configDir) ? configDir : ".obsidian";
    this.jsonStore?.setRoot(this.configDir);
    this.trigger("config-dir-change", this.configDir);
  }

  getAbstractFileByPathInsensitive(path: string): TAbstractFile | null {
    const normalized = path.toLowerCase();
    return (
      this.getAbstractFileByPath(path) ??
      [...this.files.values()].find((file) => file.path.toLowerCase() === normalized) ??
      null
    );
  }

  isEmpty(): boolean {
    return this.files.size === 1 && this.files.has(this.root.path);
  }

  checkForDuplicate(file: TAbstractFile, name: string): boolean {
    const existing = this.files.get(file.getNewPathAfterRename(name));
    return Boolean(existing && existing !== file);
  }

  checkPath(path: string): void {
    validateVaultPath(path);
  }

  async exists(path: string, sensitive = false): Promise<boolean> {
    const normalized = normalizeVaultPath(path);
    if (this.adapter?.exists) return this.adapter.exists(normalized, sensitive);
    if (sensitive) return this.files.has(normalized);
    return Boolean(this.getAbstractFileByPathInsensitive(normalized));
  }

  getFileByPath(path: string): TFile | null {
    const file = this.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  getFolderByPath(path: string): TFolder | null {
    const file = this.getAbstractFileByPath(path);
    return file instanceof TFolder ? file : null;
  }

  private getParentFolderByPath(path: string): TFolder | null {
    return path ? this.getFolderByPath(path) : this.root;
  }

  getAllLoadedFiles(): TAbstractFile[] {
    return [...this.files.values()];
  }

  setFileCacheLimit(limit: number): void {
    this.cacheLimit = limit;
    for (const file of this.getFiles()) file.updateCacheLimit();
  }

  async create(path: string, data: string, options?: DataWriteOptions): Promise<TFile> {
    path = normalizeVaultPath(path);
    this.checkPath(path);
    const existingPath = this.pathExistsForCreate(path);
    if (
      this.files.has(path) ||
      (typeof existingPath === "boolean" ? existingPath : await existingPath)
    )
      throw new Error("File already exists.");
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (parentPath && !this.files.has(parentPath)) await this.ensureFolder(parentPath);
    if (this.adapter) await this.adapter.write(path, data, options);
    if (this.usesAdapterEvents()) {
      const file = this.getFileByPath(path);
      if (file) await this.refreshFileStat(file);
      return file as TFile;
    }
    const file = new TFile(this, path, createFileStats(textSize(data), options));
    this.files.set(path, file);
    this.data.set(path, data);
    this.binaryData.delete(path);
    this.invalidateCachedRead(path);
    this.attachToParent(file);
    this.trigger("create", file);
    this.trigger("modify", file);
    return file;
  }

  async createBinary(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<TFile> {
    path = normalizeVaultPath(path);
    this.checkPath(path);
    const existingPath = this.pathExistsForCreate(path);
    if (
      this.files.has(path) ||
      (typeof existingPath === "boolean" ? existingPath : await existingPath)
    )
      throw new Error("File already exists.");
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (parentPath && !this.files.has(parentPath)) await this.ensureFolder(parentPath);
    if (this.adapter?.writeBinary) await this.adapter.writeBinary(path, data, options);
    else if (this.adapter) await this.adapter.write(path, new TextDecoder().decode(data), options);
    if (this.usesAdapterEvents()) {
      const file = this.getFileByPath(path);
      if (file) await this.refreshFileStat(file);
      return file as TFile;
    }
    const bytes = copyBytes(data);
    const file = new TFile(this, path, createFileStats(bytes.byteLength, options));
    this.files.set(path, file);
    this.binaryData.set(path, bytes);
    this.data.delete(path);
    this.invalidateCachedRead(path);
    this.attachToParent(file);
    this.trigger("create", file);
    this.trigger("modify", file);
    return file;
  }

  async createFolder(path: string): Promise<TFolder> {
    const normalized = normalizeVaultPath(path);
    this.checkPath(normalized);
    const existingPath = this.pathExistsForCreate(normalized);
    if (typeof existingPath === "boolean" ? existingPath : await existingPath)
      throw new Error("Folder already exists.");
    return this.createFolderAtPath(normalized);
  }

  private async ensureFolder(path: string): Promise<TFolder> {
    const folder = this.getFolderByPath(path);
    if (folder) return folder;
    return this.createFolderAtPath(path);
  }

  private async createFolderAtPath(normalized: string): Promise<TFolder> {
    const parentPath = normalized.includes("/")
      ? normalized.slice(0, normalized.lastIndexOf("/"))
      : "";
    if (parentPath && !this.files.has(parentPath)) await this.ensureFolder(parentPath);
    if (this.adapter?.mkdir) await this.adapter.mkdir(normalized);
    if (this.usesAdapterEvents()) {
      const folder = this.getFolderByPath(normalized);
      return folder as TFolder;
    }
    const folder = new TFolder(this, normalized);
    this.files.set(normalized, folder);
    this.attachToParent(folder);
    this.trigger("create", folder);
    return folder;
  }

  async read(file: TFile): Promise<string> {
    let text: string;
    if (this.adapter) text = await this.adapter.read(file.path);
    else {
      const stored = this.data.get(file.path);
      if (stored !== undefined) text = stored;
      else {
        const binary = this.binaryData.get(file.path);
        text = binary ? new TextDecoder().decode(binary) : "";
      }
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    file.cache(text);
    return text;
  }

  async readRaw(path: string): Promise<string> {
    return this.adapter?.read(normalizeVaultPath(path)) ?? "";
  }

  async cachedRead(file: TFile): Promise<string> {
    const cached = file.getCachedData();
    if (cached !== undefined) return cached;
    return this.read(file);
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    if (this.adapter?.readBinary) {
      const data = await this.adapter.readBinary(file.path);
      this.cacheBinaryMarkdown(file, data);
      return data;
    }
    const binary = this.binaryData.get(file.path);
    if (binary) {
      const data = toArrayBuffer(binary);
      this.cacheBinaryMarkdown(file, data);
      return data;
    }
    const text = await this.read(file);
    const bytes = new TextEncoder().encode(text);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  getResourcePath(file: TFile): string {
    return this.adapter?.getResourcePath?.(file.path) ?? "";
  }

  resolveFileUrl(urlOrPath: string): TFile | null {
    const path = this.resolveFilePath(urlOrPath);
    if (!path) return null;
    return this.getFileByPath(path);
  }

  resolveFilePath(urlOrPath: string): string | null {
    const path = this.adapter?.resolvePath?.(urlOrPath);
    if (!path) return null;
    return this.getFileByPath(path) ? path : null;
  }

  getConfigFile(name: string): string {
    return `${this.configDir}/${name}.json`;
  }

  readConfigJson<T = unknown>(name: string): Promise<T | null | undefined> {
    return this.readJson<T>(this.getConfigFile(name));
  }

  writeConfigJson<T = unknown>(
    name: string,
    data: T,
    options?: JsonStoreWriteOptions,
  ): Promise<void> {
    return this.writeJson(this.getConfigFile(name), data, options);
  }

  deleteConfigJson(name: string): Promise<void> {
    return this.deleteJson(this.getConfigFile(name));
  }

  async readJson<T = unknown>(path: string): Promise<T | null | undefined> {
    const normalized = normalizeJsonPath(path);
    if (this.jsonStore) return this.jsonStore.read<T>(this.toJsonStoreName(normalized));
    if (!this.adapter) return null;
    try {
      return JSON.parse(await this.adapter.read(normalized)) as T;
    } catch (error) {
      if (isNotFoundError(error)) return null;
      console.error("failed to read JSON", normalized, error);
      return undefined;
    }
  }

  async writeJson<T = unknown>(
    path: string,
    data: T,
    options?: JsonStoreWriteOptions,
  ): Promise<void> {
    const normalized = normalizeJsonPath(path);
    try {
      if (this.jsonStore) {
        await this.jsonStore.write(this.toJsonStoreName(normalized), data, options);
        return;
      }
      if (!this.adapter) throw new Error("Vault JSON store is not available");
      await this.adapter.write(normalized, JSON.stringify(data, undefined, 2), options);
    } catch {
      // Obsidian's writeJson swallows write failures at this layer.
    }
  }

  async deleteJson(path: string): Promise<void> {
    const normalized = normalizeJsonPath(path);
    if (this.jsonStore) {
      await this.jsonStore.delete(this.toJsonStoreName(normalized));
      return;
    }
    if (!this.adapter?.remove) throw new Error("Vault JSON delete is not available");
    await this.adapter.remove(normalized);
  }

  async readText(path: string): Promise<string | null> {
    const normalized = normalizeJsonPath(path);
    if (this.jsonStore) return this.jsonStore.readText(this.toJsonStoreName(normalized));
    if (!this.adapter) return null;
    try {
      return await this.adapter.read(normalized);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async writeText(path: string, data: string, options?: JsonStoreWriteOptions): Promise<void> {
    const normalized = normalizeJsonPath(path);
    if (this.jsonStore) {
      await this.jsonStore.writeText(this.toJsonStoreName(normalized), data, options);
      return;
    }
    if (!this.adapter) throw new Error("Vault text store is not available");
    await this.adapter.write(normalized, data, options);
  }

  async listConfigFolder(path: string): Promise<{ folders: string[]; files: string[] }> {
    const normalized = normalizeJsonPath(path);
    if (this.jsonStore) return this.jsonStore.list(this.toJsonStoreName(normalized));
    if (!this.adapter) return { folders: [], files: [] };
    try {
      const listed = await this.adapter.list(normalized);
      if (Array.isArray(listed)) return { folders: [], files: listed };
      return listed;
    } catch (error) {
      if (isNotFoundError(error)) return { folders: [], files: [] };
      throw error;
    }
  }

  async readPluginData<T = unknown>(pluginDir: string): Promise<T | null | undefined> {
    if (this.jsonStore || this.adapter) return this.readJson<T>(`${pluginDir}/data.json`);
    return this.pluginData?.load<T>(pluginDir) ?? null;
  }

  async writePluginData<T = unknown>(
    pluginDir: string,
    data: T,
    options?: JsonStoreWriteOptions,
  ): Promise<void> {
    if (this.jsonStore || this.adapter) {
      await this.writeJson(`${pluginDir}/data.json`, data, options);
      return;
    }
    if (!this.pluginData) throw new Error("Vault plugin data store is not available");
    await this.pluginData.save(pluginDir, data, options);
  }

  async modify(file: TFile, data: string, options?: DataWriteOptions): Promise<void> {
    const previousSaving = file.saving;
    file.saving = true;
    try {
      const writeOptions = withImmediate(options, () => file.cache(data));
      if (this.adapter) await this.adapter.write(file.path, data, writeOptions);
      file.cache(data);
      if (this.usesAdapterEvents()) {
        await this.refreshFileStat(file);
        return;
      }
      this.data.set(file.path, data);
      this.binaryData.delete(file.path);
      this.updateFileStat(file, textSize(data), options);
      this.trigger("modify", file);
    } catch (error) {
      file.cache(null);
      throw error;
    } finally {
      file.saving = previousSaving;
    }
  }

  async modifyBinary(file: TFile, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    const bytes = copyBytes(data);
    const previousSaving = file.saving;
    file.saving = true;
    try {
      const writeOptions = withImmediate(options, () => file.cache(null));
      if (this.adapter?.writeBinary)
        await this.adapter.writeBinary(file.path, toArrayBuffer(bytes), writeOptions);
      else if (this.adapter)
        await this.adapter.write(file.path, new TextDecoder().decode(bytes), writeOptions);
      file.cache(null);
      if (this.usesAdapterEvents()) {
        await this.refreshFileStat(file);
        return;
      }
      this.binaryData.set(file.path, bytes);
      this.data.delete(file.path);
      this.updateFileStat(file, bytes.byteLength, options);
      this.trigger("modify", file);
    } finally {
      file.saving = previousSaving;
    }
  }

  async append(file: TFile, data: string, options?: DataWriteOptions): Promise<void> {
    const previousSaving = file.saving;
    file.saving = true;
    let next: string;
    try {
      const writeOptions = withImmediate(options, () => file.cache(null));
      if (this.adapter?.append) {
        await this.adapter.append(file.path, data, writeOptions);
        next = await this.adapter.read(file.path);
      } else {
        next = `${await this.read(file)}${data}`;
        if (this.adapter) await this.adapter.write(file.path, next, writeOptions);
      }
      file.cache(null);
      if (this.usesAdapterEvents()) {
        await this.refreshFileStat(file);
        return;
      }
      this.data.set(file.path, next);
      this.binaryData.delete(file.path);
      this.updateFileStat(file, textSize(next), options);
      this.trigger("modify", file);
    } finally {
      file.saving = previousSaving;
    }
  }

  async appendBinary(file: TFile, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    const previousSaving = file.saving;
    file.saving = true;
    try {
      const current = copyBytes(await this.readBinary(file));
      const writeOptions = withImmediate(options, () => file.cache(null));
      if (!this.adapter?.appendBinary) {
        await this.modifyBinary(file, toArrayBuffer(concatBytes(current, data)), writeOptions);
        return;
      }
      await this.adapter.appendBinary(file.path, data, writeOptions);
      file.cache(null);
      if (this.usesAdapterEvents()) {
        await this.refreshFileStat(file);
        return;
      }
      const next = this.adapter.readBinary
        ? copyBytes(await this.adapter.readBinary(file.path))
        : concatBytes(current, data);
      this.binaryData.set(file.path, next);
      this.data.delete(file.path);
      this.updateFileStat(file, next.byteLength, options);
      this.trigger("modify", file);
    } finally {
      file.saving = previousSaving;
    }
  }

  async process(
    file: TFile,
    updater: (data: string) => string,
    options?: DataWriteOptions,
  ): Promise<string> {
    if (this.adapter?.process) {
      const previousSaving = file.saving;
      file.saving = true;
      try {
        const writeOptions = withImmediate(options, () => file.cache(null));
        const next = await this.adapter.process(file.path, updater, writeOptions);
        file.cache(next);
        if (this.usesAdapterEvents()) {
          await this.refreshFileStat(file);
          return next;
        }
        this.data.set(file.path, next);
        this.binaryData.delete(file.path);
        this.updateFileStat(file, textSize(next), options);
        this.trigger("modify", file);
        return next;
      } finally {
        file.saving = previousSaving;
      }
    }

    const path = file.path;
    const previous = this.processQueues.get(path) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        const current = await this.read(file);
        const next = updater(current);
        if (next === current) return next;
        await this.modify(file, next, options);
        return next;
      });
    this.processQueues.set(path, task);

    try {
      return await task;
    } finally {
      if (this.processQueues.get(path) === task) this.processQueues.delete(path);
    }
  }

  async delete(file: TAbstractFile, force = false): Promise<void> {
    if (file === this.root) return;
    if (this.usesAdapterEvents()) {
      this.invalidateCachedReadTree(file);
      if (file instanceof TFolder && this.adapter?.rmdir)
        await this.adapter.rmdir(file.path, force);
      else if (file instanceof TFile && this.adapter?.remove) await this.adapter.remove(file.path);
      else if (this.adapter) await this.adapter.delete(file.path);
      return;
    }
    const descendants =
      file instanceof TFolder
        ? this.getAllLoadedFiles().filter(
            (item) => item.path === file.path || item.path.startsWith(`${file.path}/`),
          )
        : [file];
    for (const item of descendants.sort((a, b) => b.path.length - a.path.length)) {
      this.invalidateCachedRead(item.path);
      if (this.adapter) await this.adapter.delete(item.path);
      this.files.delete(item.path);
      this.data.delete(item.path);
      this.binaryData.delete(item.path);
      this.detachFromParent(item);
      item.deleted = true;
      this.trigger("delete", item, force);
    }
  }

  async trash(file: TAbstractFile, system: boolean): Promise<void> {
    if (file === this.root) return;
    if (system && this.adapter?.trashSystem && (await this.adapter.trashSystem(file.path))) {
      if (this.usesAdapterEvents()) return;
      this.removeAfterExternalTrash(file);
      return;
    }
    if (this.usesAdapterEvents() && this.adapter?.trashLocal) {
      await this.adapter.trashLocal(file.path);
      return;
    }
    await this.trashLocal(file);
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    const normalized =
      file instanceof TFolder ? normalizeFolderPath(newPath) : normalizeFilePath(newPath);
    if (!normalized || normalized === file.path) return;
    this.checkPath(normalized);
    if (this.usesAdapterEvents() && this.adapter?.rename) {
      const oldPaths = this.collectDescendantPaths(file);
      await this.adapter.rename(file.path, normalized);
      for (const oldPath of oldPaths) this.invalidateCachedRead(oldPath);
      this.invalidateCachedRead(normalized);
      return;
    }
    // The adapter path surfaces fs ENOENT when the destination's parent
    // folder is missing; the in-memory tree must refuse identically instead
    // of silently reparenting.
    const slash = normalized.lastIndexOf("/");
    if (
      slash !== -1 &&
      !(this.getAbstractFileByPath(normalized.slice(0, slash)) instanceof TFolder)
    ) {
      throw new Error(
        `ENOENT: no such file or directory, rename '${file.path}' -> '${normalized}'`,
      );
    }
    if (file instanceof TFolder) await this.renameFolder(file, normalized);
    else if (file instanceof TFile) await this.renameFile(file, normalized);
  }

  async copy<T extends TAbstractFile>(file: T, newPath: string): Promise<T> {
    const normalized =
      file instanceof TFolder ? normalizeFolderPath(newPath) : normalizeFilePath(newPath);
    const existing = this.getAbstractFileByPathInsensitive(normalized);
    if (!normalized || (existing && !(file instanceof TFolder && existing instanceof TFolder)))
      throw new Error(`File already exists: ${normalized}`);
    if (file instanceof TFolder) {
      const folder = existing instanceof TFolder ? existing : await this.createFolder(normalized);
      for (const child of file.children) await this.copy(child, `${folder.path}/${child.name}`);
      return folder as unknown as T;
    }
    if (file instanceof TFile) {
      if (this.adapter?.copy) {
        await this.adapter.copy(file.path, normalized);
        if (!this.usesAdapterEvents()) this.handleAdapterCreate(normalized, "file");
        const copied = this.getFileByPath(normalized);
        if (!copied) throw new Error(`Adapter did not copy file: ${normalized}`);
        return copied as unknown as T;
      }
      const options = { ctime: file.stat.ctime, mtime: file.stat.mtime };
      const copied = this.binaryData.has(file.path)
        ? await this.createBinary(normalized, await this.readBinary(file), options)
        : await this.create(normalized, await this.read(file), options);
      return copied as unknown as T;
    }
    throw new Error(`Unsupported file type: ${file.path}`);
  }

  static recurseChildren(root: TFolder, cb: (file: TAbstractFile) => unknown): void {
    const stack: TAbstractFile[] = [root];
    while (stack.length > 0) {
      const file = stack.pop();
      if (!file) continue;
      cb(file);
      if (file instanceof TFolder) stack.push(...file.children);
    }
  }

  getMarkdownFiles(): TFile[] {
    const files: TFile[] = [];
    Vault.recurseChildren(this.root, (file) => {
      if (file instanceof TFile && file.extension === "md") files.push(file);
    });
    return files;
  }

  getFiles(): TFile[] {
    const files: TFile[] = [];
    Vault.recurseChildren(this.root, (file) => {
      if (file instanceof TFile) files.push(file);
    });
    return files;
  }

  async *iterateFiles(
    files: TFile[],
    useCache = false,
  ): AsyncGenerator<{ file: TFile; content: string }> {
    for (const file of files) {
      let content = "";
      if (file.extension === "md")
        content = useCache ? await this.cachedRead(file) : await this.read(file);
      yield { file, content };
    }
  }

  async *generateFiles(
    files: Iterable<TFile> | AsyncIterable<TFile>,
    useCache = false,
  ): AsyncGenerator<{ file: TFile; content: string }> {
    for await (const file of files) {
      let content = "";
      if (file.extension === "md" || file.extension === "canvas")
        content = useCache ? await this.cachedRead(file) : await this.read(file);
      yield { file, content };
    }
  }

  getAllFolders(includeRoot = false): TFolder[] {
    return [...this.files.values()].filter(
      (file): file is TFolder => file instanceof TFolder && (includeRoot || file !== this.root),
    );
  }

  getAvailablePath(path: string, extension = "md"): string {
    let candidate = extension ? `${path}.${extension}` : path;
    let index = 1;
    while (this.getAbstractFileByPathInsensitive(candidate)) {
      candidate = extension ? `${path} ${index}.${extension}` : `${path} ${index}`;
      index += 1;
    }
    return candidate;
  }

  async getAvailablePathForAttachments(
    filename: string,
    extension: string,
    sourceFile?: TFile | null,
  ): Promise<string> {
    const configuredPath = this.getConfig<string>("attachmentFolderPath") ?? "/";
    const folderPath = this.resolveAttachmentFolderPath(configuredPath, sourceFile ?? null);
    const clippedBase = sanitizeAttachmentName(filename).slice(0, 250);
    if (!folderPath) return this.getAvailablePath(clippedBase, extension);

    let folder = this.getAbstractFileByPathInsensitive(folderPath);
    if (!folder) folder = await this.createFolder(folderPath);
    if (!(folder instanceof TFolder)) return this.getAvailablePath(clippedBase, extension);
    return this.getAvailablePath(`${folder.path}/${clippedBase}`, extension);
  }

  private attachToParent(file: TAbstractFile): void {
    if (file === this.root) return;
    const parent = this.getDirectParent(file);
    if (!parent) return;
    if (!parent.children.includes(file)) {
      this.addChild(file);
      parent.children.sort((a, b) => {
        const folderDelta = Number(b instanceof TFolder) - Number(a instanceof TFolder);
        return folderDelta || a.name.localeCompare(b.name);
      });
    }
  }

  private bindAdapterEvents(adapter: VaultAdapter): void {
    adapter.on?.("folder-created", (path) => this.handleAdapterCreate(String(path), "folder"));
    adapter.on?.("file-created", (path, stat) =>
      this.handleAdapterCreate(String(path), "file", asAdapterStat(stat)),
    );
    adapter.on?.("modified", (path, stat) =>
      this.handleAdapterModify(String(path), asAdapterStat(stat)),
    );
    adapter.on?.("folder-removed", (path) => this.handleAdapterDelete(String(path)));
    adapter.on?.("file-removed", (path) => this.handleAdapterDelete(String(path)));
    adapter.on?.("renamed", (path, oldPath) =>
      this.handleAdapterRename(String(path), String(oldPath)),
    );
  }

  private handleAdapterEvent(event: string, path: string, oldPath?: string): void {
    if (event === "folder-created") this.handleAdapterCreate(path, "folder");
    else if (event === "file-created") this.handleAdapterCreate(path, "file");
    else if (event === "modified") this.handleAdapterModify(path);
    else if (event === "folder-removed" || event === "file-removed") this.handleAdapterDelete(path);
    else if (event === "renamed") this.handleAdapterRename(path, oldPath ?? "");
    else if (event === "raw") {
      this.trigger("raw", path);
      this.handleConfigRawEvent(path);
      if (path.startsWith(`${this.configDir}/`)) void this.adapter?.watchHiddenRecursive?.(path);
    }
  }

  private handleAdapterCreate(
    path: string,
    type: "file" | "folder",
    stat?: VaultAdapterStat,
  ): void {
    if (!path || path === "/") {
      this.files.set(this.root.path, this.root);
      return;
    }
    if (this.files.has(path)) return;
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (parentPath && !this.files.has(parentPath)) this.handleAdapterCreate(parentPath, "folder");
    // When the adapter's reconcile already read the entry's stat, apply it
    // synchronously instead of issuing a second stat per file (mtime 0 marks
    // the stat as unknown until the async refresh lands).
    const file =
      type === "folder"
        ? new TFolder(this, path)
        : new TFile(this, path, stat ? toFileStats(stat) : { ctime: 0, mtime: 0, size: 0 });
    this.files.set(path, file);
    this.attachToParent(file);
    if (file instanceof TFile && !stat) void this.refreshFileStat(file);
    this.trigger("create", file);
  }

  private handleAdapterModify(path: string, stat?: VaultAdapterStat): void {
    const file = this.getFileByPath(path);
    if (!file) return;
    if (!file.saving) this.invalidateCachedRead(path);
    if (stat) file.stat = toFileStats(stat, file.stat);
    else void this.refreshFileStat(file);
    this.trigger("modify", file);
  }

  private handleAdapterDelete(path: string): void {
    const file = this.getAbstractFileByPath(path);
    if (!file) return;
    const descendants =
      file instanceof TFolder
        ? this.getAllLoadedFiles().filter(
            (item) => item.path === file.path || item.path.startsWith(`${file.path}/`),
          )
        : [file];
    for (const item of descendants.sort((a, b) => b.path.length - a.path.length)) {
      this.invalidateCachedRead(item.path);
      this.files.delete(item.path);
      this.data.delete(item.path);
      this.binaryData.delete(item.path);
      this.detachFromParent(item);
      item.deleted = true;
      this.trigger("delete", item, false);
    }
  }

  private handleAdapterRename(path: string, oldPath: string): void {
    const file = this.getAbstractFileByPath(oldPath);
    if (!file) return;
    const descendants =
      file instanceof TFolder
        ? this.getAllLoadedFiles().filter(
            (item) => item.path === oldPath || item.path.startsWith(`${oldPath}/`),
          )
        : [file];
    const records = descendants
      .sort((a, b) => a.path.length - b.path.length)
      .map((item) => ({
        item,
        oldPath: item.path,
        newPath: item.path === oldPath ? path : `${path}/${item.path.slice(oldPath.length + 1)}`,
      }));

    this.detachFromParent(file);
    for (const record of records) {
      this.files.delete(record.oldPath);
      this.invalidateCachedRead(record.oldPath);
      this.invalidateCachedRead(record.newPath);
      if (record.item instanceof TFile) {
        this.data.delete(record.oldPath);
        this.binaryData.delete(record.oldPath);
      }
    }
    for (const record of records) {
      record.item.path = record.newPath;
      this.files.set(record.newPath, record.item);
    }
    this.attachToParent(file);
    for (const record of records) this.trigger("rename", record.item, record.oldPath);
  }

  private handleConfigRawEvent(path: string): void {
    if (path === this.getConfigFile("app") || path === this.getConfigFile("appearance"))
      this.requestReloadConfig();
  }

  private usesAdapterEvents(): boolean {
    return Boolean(this.adapter?.supportsEvents && this.adapter.on);
  }

  private pathExistsForCreate(path: string): boolean | Promise<boolean> {
    if (this.adapter instanceof InMemoryAdapter)
      return Boolean(this.getAbstractFileByPathInsensitive(path));
    if (this.adapter?.exists) return this.adapter.exists(path);
    return Boolean(this.getAbstractFileByPathInsensitive(path));
  }

  private canPersistConfig(): boolean {
    return Boolean(this.jsonStore || this.adapter);
  }

  private async ensureConfigDir(): Promise<void> {
    if (!this.adapter?.mkdir) return;
    if (this.adapter.exists) {
      if (!(await this.adapter.exists(this.configDir))) await this.adapter.mkdir(this.configDir);
      return;
    }
    try {
      await this.adapter.mkdir(this.configDir);
    } catch {
      // Some adapters create JSON parent folders lazily or throw when the folder already exists.
    }
  }

  private async configFilesAreFresh(): Promise<boolean> {
    if (!this.jsonStore) return false;
    const appStat = await this.jsonStore.stat("app.json");
    const appearanceStat = await this.jsonStore.stat("appearance.json");
    return Boolean(
      appStat &&
      appearanceStat &&
      appStat.mtime <= this.configTs &&
      appearanceStat.mtime <= this.configTs,
    );
  }

  private toJsonStoreName(path: string): string {
    const root = normalizeJsonPath(this.jsonStore?.root ?? this.configDir);
    return path === root ? "" : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  }

  private async refreshFileStat(file: TFile): Promise<void> {
    const stat = await this.adapter?.stat?.(file.path);
    if (!stat || stat.type === "folder") return;
    file.stat = toFileStats(stat, file.stat);
  }

  private updateFileStat(file: TFile, size: number, options?: DataWriteOptions): void {
    file.stat = createFileStats(size, options, file.stat);
  }

  private cacheBinaryMarkdown(file: TFile, data: ArrayBuffer): void {
    if (file.extension !== "md" || data.byteLength > this.cacheLimit) return;
    try {
      file.cache(new TextDecoder().decode(data));
    } catch {
      // Binary markdown reads are best-effort cached in Obsidian.
    }
  }

  private detachFromParent(file: TAbstractFile): void {
    this.removeChild(file);
  }

  private removeAfterExternalTrash(file: TAbstractFile): void {
    const descendants =
      file instanceof TFolder
        ? this.getAllLoadedFiles().filter(
            (item) => item.path === file.path || item.path.startsWith(`${file.path}/`),
          )
        : [file];
    for (const item of descendants.sort((a, b) => b.path.length - a.path.length)) {
      this.invalidateCachedRead(item.path);
      this.files.delete(item.path);
      this.data.delete(item.path);
      this.binaryData.delete(item.path);
      this.detachFromParent(item);
      item.deleted = true;
      this.trigger("delete", item, false);
    }
  }

  private async trashLocal(file: TAbstractFile): Promise<void> {
    const targetPath = this.getAvailableTrashPath(file);
    if (file instanceof TFile) {
      const binary = this.binaryData.has(file.path) ? await this.readBinary(file) : null;
      const data = binary ? "" : await this.read(file);
      await this.delete(file, false);
      if (binary) await this.createBinary(targetPath, binary);
      else await this.create(targetPath, data);
      return;
    }

    if (file instanceof TFolder) {
      const descendants = this.getAllLoadedFiles()
        .filter((item) => item.path === file.path || item.path.startsWith(`${file.path}/`))
        .sort((a, b) => a.path.length - b.path.length);
      const records: Array<{
        item: TAbstractFile;
        targetPath: string;
        data?: string;
        binary?: ArrayBuffer;
      }> = [];
      for (const item of descendants) {
        const suffix = item.path === file.path ? "" : item.path.slice(file.path.length + 1);
        const nextPath = suffix ? `${targetPath}/${suffix}` : targetPath;
        records.push({
          item,
          targetPath:
            item instanceof TFolder ? normalizeFolderPath(nextPath) : normalizeFilePath(nextPath),
          ...(item instanceof TFile && this.binaryData.has(item.path)
            ? { binary: await this.readBinary(item) }
            : item instanceof TFile
              ? { data: await this.read(item) }
              : {}),
        });
      }
      await this.delete(file, false);
      for (const record of records) {
        if (record.item instanceof TFolder) await this.createFolder(record.targetPath);
        else if (record.binary) await this.createBinary(record.targetPath, record.binary);
        else await this.create(record.targetPath, record.data ?? "");
      }
    }
  }

  private getAvailableTrashPath(file: TAbstractFile): string {
    const filename = file.name;
    const dotIndex = file instanceof TFile ? filename.lastIndexOf(".") : -1;
    const stem = dotIndex === -1 ? filename : filename.slice(0, dotIndex);
    const extension = dotIndex === -1 ? "" : filename.slice(dotIndex);
    let candidate = `.trash/${stem}${extension}`;
    let index = 1;
    while (this.getAbstractFileByPath(candidate)) {
      index += 1;
      candidate = `.trash/${stem} ${index}${extension}`;
    }
    return candidate;
  }

  private async renameFile(file: TFile, newPath: string): Promise<TFile> {
    const oldPath = file.path;
    this.ensureRenameTargetAvailable(file, newPath, new Set([oldPath]));
    const binary = this.binaryData.get(oldPath);
    const data = binary ? "" : await this.read(file);
    if (this.adapter) {
      if (binary && this.adapter.writeBinary)
        await this.adapter.writeBinary(newPath, toArrayBuffer(binary));
      else await this.adapter.write(newPath, binary ? new TextDecoder().decode(binary) : data);
      await this.adapter.delete(oldPath);
    }

    this.detachFromParent(file);
    this.files.delete(oldPath);
    this.data.delete(oldPath);
    this.binaryData.delete(oldPath);
    this.invalidateCachedRead(oldPath);
    this.invalidateCachedRead(newPath);
    file.path = newPath;
    this.files.set(newPath, file);
    if (!this.adapter) {
      if (binary) this.binaryData.set(newPath, copyBytes(toArrayBuffer(binary)));
      else this.data.set(newPath, data);
    }
    this.attachToParent(file);
    this.trigger("rename", file, oldPath);
    return file;
  }

  private async renameFolder(folder: TFolder, newPath: string): Promise<TFolder> {
    const oldRootPath = folder.path;
    const descendants = this.getAllLoadedFiles()
      .filter((item) => item.path === oldRootPath || item.path.startsWith(`${oldRootPath}/`))
      .sort((a, b) => a.path.length - b.path.length);
    const oldPaths = new Set(descendants.map((item) => item.path));
    const records: Array<{
      item: TAbstractFile;
      oldPath: string;
      newPath: string;
      data?: string;
      binary?: Uint8Array;
    }> = [];

    for (const item of descendants) {
      const nextPath =
        item.path === oldRootPath
          ? newPath
          : `${newPath}/${item.path.slice(oldRootPath.length + 1)}`;
      this.ensureRenameTargetAvailable(item, nextPath, oldPaths);
      records.push({
        item,
        oldPath: item.path,
        newPath:
          item instanceof TFolder ? normalizeFolderPath(nextPath) : normalizeFilePath(nextPath),
        ...(item instanceof TFile && this.binaryData.has(item.path)
          ? { binary: copyBytes(await this.readBinary(item)) }
          : item instanceof TFile
            ? { data: await this.read(item) }
            : {}),
      });
    }

    if (this.adapter) {
      for (const record of records) {
        if (record.item instanceof TFile && record.binary && this.adapter.writeBinary)
          await this.adapter.writeBinary(record.newPath, toArrayBuffer(record.binary));
        else if (record.item instanceof TFile)
          await this.adapter.write(
            record.newPath,
            record.binary ? new TextDecoder().decode(record.binary) : (record.data ?? ""),
          );
      }
      for (const record of [...records].reverse()) {
        if (record.item instanceof TFile) await this.adapter.delete(record.oldPath);
      }
    }

    this.detachFromParent(folder);
    for (const record of records) {
      this.files.delete(record.oldPath);
      this.invalidateCachedRead(record.oldPath);
      this.invalidateCachedRead(record.newPath);
      if (record.item instanceof TFile) {
        this.data.delete(record.oldPath);
        this.binaryData.delete(record.oldPath);
      }
    }

    for (const record of records) {
      record.item.path = record.newPath;
      this.files.set(record.newPath, record.item);
      if (record.item instanceof TFile && !this.adapter) {
        if (record.binary) this.binaryData.set(record.newPath, record.binary);
        else this.data.set(record.newPath, record.data ?? "");
      }
    }

    this.attachToParent(folder);
    for (const record of records) this.trigger("rename", record.item, record.oldPath);
    return folder;
  }

  private ensureRenameTargetAvailable(
    file: TAbstractFile,
    newPath: string,
    oldPaths: Set<string>,
  ): void {
    const existing = this.files.get(newPath);
    if (existing && existing !== file && !oldPaths.has(newPath))
      throw new Error(`File already exists: ${newPath}`);
    const insensitiveExisting = this.getAbstractFileByPathInsensitive(newPath);
    if (
      insensitiveExisting &&
      insensitiveExisting !== file &&
      !oldPaths.has(insensitiveExisting.path) &&
      insensitiveExisting.path.toLowerCase() !== file.path.toLowerCase()
    ) {
      throw new Error(`File already exists: ${newPath}`);
    }
  }

  private invalidateCachedRead(path: string): void {
    this.getFileByPath(path)?.cache(null);
  }

  private invalidateCachedReadTree(file: TAbstractFile): void {
    for (const path of this.collectDescendantPaths(file)) this.invalidateCachedRead(path);
  }

  private collectDescendantPaths(file: TAbstractFile): string[] {
    if (!(file instanceof TFolder)) return [file.path];
    return this.getAllLoadedFiles()
      .filter((item) => item.path === file.path || item.path.startsWith(`${file.path}/`))
      .map((item) => item.path);
  }

  private resolveAttachmentFolderPath(configuredPath: string, sourceFile: TFile | null): string {
    const normalized = configuredPath.replace(/\\/g, "/");
    if (normalized === "/" || normalized === "") return "";
    if (normalized === "." || normalized === "./") return sourceFile?.parentPath ?? "";
    if (normalized.startsWith("./")) {
      const subfolder = normalizeFolderPath(normalized.slice(2));
      const parentPath = sourceFile?.parentPath ?? "";
      return parentPath ? `${parentPath}/${subfolder}` : subfolder;
    }
    return normalizeFolderPath(normalized.replace(/^\/+/, ""));
  }
}

function normalizeFilePath(path: string): string {
  return normalizeVaultPath(path).replace(/\/+$/, "");
}

function normalizeFolderPath(path: string): string {
  return normalizeVaultPath(path).replace(/\/+$/, "");
}

function normalizeVaultPath(path: string): string {
  const normalized = path.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
  return (normalized === "" ? "/" : normalized).replace(/[\u00a0\u202f]/g, " ").normalize("NFC");
}

function normalizeJsonPath(path: string): string {
  return normalizeVaultPath(path);
}

function sanitizeAttachmentName(filename: string): string {
  return normalizeVaultPath(filename)
    .replace(/([:#|^\\\r\n]|%%|\[\[|]])/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createFileStats(
  size: number,
  options?: DataWriteOptions,
  previous?: FileStats,
): FileStats {
  const now = Date.now();
  return {
    ctime: options?.ctime ?? previous?.ctime ?? now,
    mtime: options?.mtime ?? now,
    size,
  };
}

/** Accept an adapter event's optional stat payload only when it carries a real mtime. */
function asAdapterStat(value: unknown): VaultAdapterStat | undefined {
  if (!value || typeof value !== "object") return undefined;
  const stat = value as VaultAdapterStat;
  return typeof stat.mtime === "number" && stat.mtime > 0 ? stat : undefined;
}

function toFileStats(stat: VaultAdapterStat, previous?: FileStats): FileStats {
  const now = Date.now();
  return {
    ctime: stat.ctime ?? previous?.ctime ?? now,
    mtime: stat.mtime ?? previous?.mtime ?? now,
    size: stat.size ?? previous?.size ?? 0,
  };
}

function textSize(data: string): number {
  return new TextEncoder().encode(data).byteLength;
}

function copyBytes(data: ArrayBuffer): Uint8Array {
  const bytes = new Uint8Array(data);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function concatBytes(left: Uint8Array, right: ArrayBuffer): Uint8Array {
  const rightBytes = new Uint8Array(right);
  const merged = new Uint8Array(left.byteLength + rightBytes.byteLength);
  merged.set(left, 0);
  merged.set(rightBytes, left.byteLength);
  return merged;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function withImmediate(
  options: DataWriteOptions | undefined,
  immediate: () => void,
): DataWriteOptions {
  return {
    ...options,
    immediate,
  };
}

function isValidConfigDir(path: string): boolean {
  return path !== "." && path.startsWith(".") && !/[\\/:*?"<>|]/.test(path);
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

const defaultVaultConfig: Record<string, unknown> = {
  alwaysUpdateLinks: false,
  attachmentFolderPath: "/",
  defaultViewMode: "preview",
  deleteUnlinkedAttachments: "ask",
  foldHeading: true,
  foldIndent: true,
  livePreview: true,
  mobilePullAction: "command-palette:open",
  mobileToolbarCommands: [
    "editor:undo",
    "editor:redo",
    "editor:insert-wikilink",
    "editor:insert-embed",
    "editor:insert-tag",
    "editor:attach-file",
    "editor:set-heading",
    "editor:toggle-bold",
    "editor:toggle-italics",
    "editor:toggle-strikethrough",
    "editor:toggle-highlight",
    "editor:toggle-code",
    "editor:toggle-blockquote",
    "editor:toggle-comment",
    "editor:insert-link",
    "editor:toggle-bullet-list",
    "editor:toggle-numbered-list",
    "editor:toggle-checklist-status",
    "editor:indent-list",
    "editor:unindent-list",
    "editor:configure-toolbar",
  ],
  newFileFolderPath: "/",
  newFileLocation: "root",
  newLinkFormat: "shortest",
  openBehavior: "",
  promptDelete: true,
  propertiesInDocument: "visible",
  readableLineLength: true,
  showRibbon: true,
  showLineNumber: false,
  showUnsupportedFiles: false,
  spellcheck: true,
  trashOption: "system",
  useMarkdownLinks: false,
  uriCallbacks: false,
  userIgnoreFilters: null,
  theme: "system",
  accentColor: "",
  cssTheme: "",
  enabledCssSnippets: [],
  translucency: false,
  textFontFamily: "",
  interfaceFontFamily: "",
  monospaceFontFamily: "",
  baseFontSize: 16,
  baseFontSizeAction: false,
  types: {},
};

const appearanceConfigKeys = new Set([
  "accentColor",
  "theme",
  "cssTheme",
  "enabledCssSnippets",
  "showViewHeader",
  "showRibbon",
  "nativeMenus",
  "translucency",
  "textFontFamily",
  "interfaceFontFamily",
  "monospaceFontFamily",
  "baseFontSize",
  "baseFontSizeAction",
  "slidingSidebar",
  "floatingNavigation",
  "autoFullScreen",
]);

function migrateVaultConfig(config: Record<string, unknown>): Record<string, unknown> {
  const editorFontFamily = config.editorFontFamily;
  delete config.editorFontFamily;
  if (!Object.prototype.hasOwnProperty.call(config, "textFontFamily") && editorFontFamily)
    config.textFontFamily = editorFontFamily;
  return config;
}

function cloneConfigValue(value: unknown): unknown {
  if (Array.isArray(value) || (value && typeof value === "object"))
    return JSON.parse(JSON.stringify(value));
  return value;
}

function hasEqualConfigValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createDebouncedRequest(
  save: () => Promise<void>,
  canRun: () => boolean,
  delay: number,
): (() => void) & { run: () => Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = (): void => {
    if (timer == null) return;
    clearTimeout(timer);
    timer = null;
  };
  const request = (() => {
    if (!canRun()) return;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      void save();
    }, delay);
  }) as (() => void) & { run: () => Promise<void>; cancel: () => void };
  request.run = async () => {
    cancel();
    if (canRun()) await save();
  };
  request.cancel = cancel;
  return request;
}
