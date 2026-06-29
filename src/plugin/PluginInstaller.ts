import type { App } from "../app/App";
import { CommunityPluginTrustModal } from "../builtin/CommunityPluginTrustModal";
import { Platform } from "../platform/Platform";
import { Notice } from "../ui/Notice";
import type { UpdateCheckResult } from "../updates/UpdateManager";
import { normalizePluginManifest, type PluginManifest, type PluginManifestInput, type PluginPackage } from "./PluginManifest";
import type { Plugin } from "./Plugin";
import { prepareDownloadedMainJs } from "./PluginSource";

export interface PluginInstallRecord {
  id: string;
  version: string;
  installedAt: string;
  enabled: boolean;
  latestVersion?: string;
  checkedAt?: string;
}

export interface PluginUpdateRecord extends UpdateCheckResult {
  installed: boolean;
  packageAvailable: boolean;
}

export interface PluginPackageDownloader {
  fetchJson<T>(url: string): Promise<T>;
  fetchText(url: string): Promise<string>;
  fetchOptionalText?(url: string): Promise<string | null>;
}

const AUTO_UPDATE_CHECK_KEY = "plugin-automatically-check-for-updates";
const LAST_UPDATE_CHECK_KEY = "last-plugin-update-check";
const AUTO_UPDATE_CHECK_INTERVAL = 259_200_000;
const DEPRECATION_CHECK_INTERVAL = 43_200_000;
const COMMUNITY_PLUGINS_CONFIG = "community-plugins";

export class PluginInstaller {
  readonly manifests: Record<string, PluginManifestInput> = {};
  readonly plugins: Record<string, Plugin> = {};
  readonly enabledPlugins = new Set<string>();
  readonly updates: Record<string, PluginUpdateRecord> = {};
  loadingPluginId: string | null = null;
  private installed = new Map<string, PluginInstallRecord>();
  private packages = new Map<string, PluginPackage>();
  private autoUpdateListenerRegistered = false;
  private deprecationCheckRegistered = false;
  private trustModalOpen = false;

  constructor(readonly app: App, private downloader: PluginPackageDownloader = new FetchPluginPackageDownloader()) {
    this.app.vault.on<[string]>("raw", (path) => this.onRaw(path));
  }

  setPackageDownloader(downloader: PluginPackageDownloader): void {
    this.downloader = downloader;
  }

  async initialize(pluginRoot = "plugins"): Promise<void> {
    const enabledIds = await this.readEnabledPluginIds();
    this.replaceEnabledPlugins(enabledIds);
    const packages = await this.app.pluginLoader.discoverPackages(pluginRoot);
    this.syncDiscoveredPackages(packages, enabledIds);
    if (packages.length === 0) return;
    if (!this.app.pluginSecurity.isCommunityPluginsEnabled()) {
      this.openTrustModalIfNeeded();
      this.app.workspace.trigger("community-plugins-restricted");
      return;
    }
    for (const id of enabledIds) {
      try {
        await this.enablePlugin(id);
      } catch {
        // Enable failures are recorded on the community plugin record by enablePlugin().
      }
    }
    await this.saveConfig();
    this.app.workspace.trigger("community-plugins-loaded");
    void this.checkForDeprecations();
    this.registerAutomaticUpdateCheck();
    this.registerDeprecationCheck();
    void this.maybeAutoCheckForUpdates(true);
  }

  get autoCheckForUpdates(): boolean {
    return this.app.loadLocalStorage<boolean>(AUTO_UPDATE_CHECK_KEY) ?? true;
  }

  get lastUpdateCheck(): number {
    const value = this.app.loadLocalStorage<number | string>(LAST_UPDATE_CHECK_KEY);
    return typeof value === "number" ? value : Number(value) || 0;
  }

  setAutomaticUpdateCheck(enabled: boolean): void {
    this.app.saveLocalStorage(AUTO_UPDATE_CHECK_KEY, enabled);
    this.app.workspace.trigger("community-plugin-automatic-update-check-changed", enabled);
  }

  async maybeAutoCheckForUpdates(silent = true): Promise<PluginUpdateRecord[]> {
    if (!this.autoCheckForUpdates) return [];
    if (Date.now() <= this.lastUpdateCheck + AUTO_UPDATE_CHECK_INTERVAL) return [];
    return this.checkForUpdates(silent);
  }

  async setCommunityPluginsEnabled(enabled: boolean): Promise<void> {
    this.app.pluginSecurity.setCommunityPluginsEnabled(enabled);
    if (!enabled) {
      for (const plugin of [...this.app.plugins.listPlugins()]) {
        await this.app.plugins.disablePlugin(plugin.manifest.id, false);
        const record = this.installed.get(plugin.manifest.id);
        if (record) record.enabled = false;
      }
      this.syncLoadedPlugins();
      this.app.workspace.trigger("community-plugins-disabled");
      return;
    }
    await this.initialize();
  }

  async setEnable(enabled: boolean): Promise<void> {
    await this.setCommunityPluginsEnabled(enabled);
  }

  isEnabled(): boolean {
    return this.app.pluginSecurity.isCommunityPluginsEnabled();
  }

  getPluginFolder(): string {
    return `${this.app.vault.configDir}/plugins`;
  }

  async loadManifests(): Promise<void> {
    clearRecord(this.manifests);
    const packages = await this.app.pluginLoader.discoverPackages(this.toPluginLoaderRoot(this.getPluginFolder()));
    this.syncDiscoveredPackages(packages, [...this.enabledPlugins]);
  }

  async loadManifest(dir: string): Promise<void> {
    const pkg = await this.app.pluginLoader.discoverPackage(this.toPluginLoaderRoot(dir));
    if (pkg) this.syncDiscoveredPackages([pkg], [...this.enabledPlugins]);
  }

  async loadPlugin(id: string, userInitiated = false): Promise<Plugin | null | undefined> {
    if (!this.isEnabled()) return undefined;
    const pkg = this.packages.get(id) ?? this.app.pluginLoader.getPackage(id);
    if (!pkg) return null;
    this.loadingPluginId = id;
    try {
      const plugin = await this.app.pluginLoader.loadPackage(pkg, userInitiated);
      this.syncLoadedPlugins();
      return plugin;
    } finally {
      this.loadingPluginId = null;
    }
  }

  async unloadPlugin(id: string, userDisabled = false): Promise<void> {
    await this.app.plugins.unloadPlugin(id, userDisabled);
    this.syncLoadedPlugins();
  }

  async enablePlugin(id: string, userInitiated = false): Promise<boolean> {
    const pkg = this.packages.get(id) ?? this.app.pluginLoader.getPackage(id) ?? this.app.pluginMarketplace.createPackage(id);
    if (!pkg) return false;
    const record = this.installed.get(id) ?? this.createInstallRecord(pkg);
    if (!this.app.pluginSecurity.isCommunityPluginsEnabled()) {
      const reason = `Community plugins are disabled: ${id}`;
      this.app.communityPlugins.setError(id, reason);
      return false;
    }
    const manifest = normalizePluginManifest(pkg.manifest);
    if (this.app.pluginMarketplace.isDeprecated(manifest)) {
      const reason = `Unable to load plugin ${pkg.manifest.name}. This version has been reported to cause issues. Please check for a newer version of the plugin.`;
      new Notice(reason);
      this.app.communityPlugins.setError(id, reason);
      return false;
    }
    if (isDesktopOnlyBlocked(manifest)) return false;
    const registered = this.packages.get(id) ?? this.app.pluginLoader.getPackage(id) ?? this.app.pluginLoader.registerPackage(pkg);
    this.rememberPackage(registered);
    try {
      const plugin = await this.loadPlugin(id, userInitiated);
      if (!plugin) return false;
      record.enabled = true;
      this.app.communityPlugins.setEnabled(id, true);
      this.app.workspace.trigger("plugin-enabled", record);
      return true;
    } catch (error) {
      record.enabled = false;
      this.app.communityPlugins.setError(id, error instanceof Error ? error.message : String(error));
      this.app.workspace.trigger("plugin-enable-failed", record, error);
      new Notice(`Failed to enable plugin ${id}`);
      console.error(`Plugin failure: ${id}`, error);
      return false;
    }
  }

  async disablePlugin(id: string, userInitiated = false): Promise<void> {
    const record = this.installed.get(id)
      ?? (this.app.pluginLoader.getPackage(id) ? this.createInstallRecord(this.app.pluginLoader.getPackage(id)!) : null);
    if (!record) return;
    record.enabled = false;
    this.app.communityPlugins.setEnabled(id, false);
    try {
      await this.unloadPlugin(id, userInitiated);
    } catch (error) {
      new Notice(`Failed to disable plugin ${id}`);
      console.error(`Plugin failure: ${id}`, error);
      this.app.communityPlugins.setError(id, error instanceof Error ? error.message : String(error));
    } finally {
      this.app.workspace.trigger("plugin-disabled", record);
    }
  }

  async enablePluginAndSave(id: string): Promise<boolean> {
    const enabled = await this.enablePlugin(id, true);
    if (!enabled) return false;
    this.enabledPlugins.add(id);
    await this.saveConfig();
    return true;
  }

  async disablePluginAndSave(id: string): Promise<void> {
    this.enabledPlugins.delete(id);
    await this.saveConfig();
    await this.disablePlugin(id, true);
  }

  saveConfig(): Promise<void> {
    return this.writeEnabledPluginIds([...this.enabledPlugins]);
  }

  getPlugin(id: string): Plugin | null {
    return this.app.plugins.getPlugin(id);
  }

  async install(pkg: PluginPackage): Promise<PluginInstallRecord> {
    const materialized = await this.materializePackage(pkg);
    const wasLoaded = Boolean(this.app.plugins.getPlugin(materialized.manifest.id));
    const normalized = this.app.pluginLoader.registerPackage(materialized);
    this.rememberPackage(normalized);
    const existingRecord = this.installed.get(normalized.manifest.id);
    const installedAt = existingRecord?.installedAt ?? new Date().toISOString();

    const record: PluginInstallRecord = {
      id: normalized.manifest.id,
      version: normalized.manifest.version,
      installedAt,
      enabled: wasLoaded || Boolean(existingRecord?.enabled),
      latestVersion: normalized.manifest.version,
    };
    this.installed.set(record.id, record);
    this.app.communityPlugins.add({
      manifest: normalized.manifest,
      installed: true,
      enabled: record.enabled,
      installedAt: record.installedAt,
      updateAvailable: false,
      latestVersion: normalized.manifest.version,
      error: null,
    });
    await this.persistPackage(normalized);
    if (wasLoaded) {
      await this.app.plugins.unloadPlugin(normalized.manifest.id, false);
      record.enabled = false;
      this.app.communityPlugins.setEnabled(normalized.manifest.id, false);
      await this.enable(normalized.manifest.id, true);
    }
    this.app.workspace.trigger("plugin-installed", record);
    return record;
  }

  async checkForUpdates(idsOrSilent?: readonly string[] | boolean): Promise<PluginUpdateRecord[]> {
    const ids = Array.isArray(idsOrSilent) ? idsOrSilent : undefined;
    const silent = typeof idsOrSilent === "boolean" ? idsOrSilent : false;
    const targets = new Set(ids);
    this.app.saveLocalStorage(LAST_UPDATE_CHECK_KEY, Date.now());
    const checkedAt = new Date().toISOString();
    const results: PluginUpdateRecord[] = [];
    for (const record of this.listInstalled().filter((record) => targets.size === 0 || targets.has(record.id))) {
      const currentVersion = this.app.communityPlugins.get(record.id)?.manifest.version ?? record.version;
      const compatibleVersion = await this.app.pluginMarketplace.resolveLatestCompatibleVersion(record.id).catch(() => null);
      if (compatibleVersion) this.app.updates.setLatestVersion(record.id, compatibleVersion);
      const result = this.app.updates.checkPlugin(record.id, currentVersion);
      const packageAvailable = Boolean(this.app.pluginMarketplace.createPackage(record.id));
      record.latestVersion = result.latestVersion;
      record.checkedAt = checkedAt;
      this.app.communityPlugins.setUpdateStatus(record.id, result.updateAvailable, result.latestVersion, checkedAt);
      const updateRecord = {
        ...result,
        installed: true,
        packageAvailable,
      };
      this.updates[record.id] = updateRecord;
      results.push(updateRecord);
    }
    this.app.workspace.trigger("community-plugin-updates-checked", results, silent);
    return results;
  }

  async update(id: string): Promise<PluginInstallRecord> {
    const record = this.installed.get(id);
    if (!record) throw new Error(`Plugin is not installed: ${id}`);
    const pkg = this.app.pluginMarketplace.createPackage(id);
    if (!pkg) throw new Error(`Plugin update is not available: ${id}`);

    const materialized = await this.materializePackage(pkg);
    const wasEnabled = record.enabled || Boolean(this.app.communityPlugins.get(id)?.enabled);
    try {
      if (wasEnabled) {
        await this.app.plugins.unloadPlugin(id, false);
        record.enabled = false;
        this.app.communityPlugins.setEnabled(id, false);
      }

      const normalized = this.app.pluginLoader.registerPackage(materialized);
      this.rememberPackage(normalized);
      record.version = normalized.manifest.version;
      record.latestVersion = normalized.manifest.version;
      record.checkedAt = new Date().toISOString();
      this.app.communityPlugins.add({
        manifest: normalized.manifest,
        installed: true,
        enabled: false,
        installedAt: record.installedAt,
        updateAvailable: false,
        latestVersion: normalized.manifest.version,
        checkedAt: record.checkedAt,
        error: null,
      });
      await this.persistPackage(normalized);

      if (wasEnabled) await this.enable(id, true);
      this.app.workspace.trigger("plugin-updated", record);
      return record;
    } catch (error) {
      record.enabled = false;
      this.app.communityPlugins.setError(id, error instanceof Error ? error.message : String(error));
      this.app.workspace.trigger("plugin-update-failed", record, error);
      throw error;
    }
  }

  async updateAll(): Promise<PluginInstallRecord[]> {
    const checked = await this.checkForUpdates();
    const updated: PluginInstallRecord[] = [];
    for (const result of checked) {
      if (result.updateAvailable && result.packageAvailable) {
        updated.push(await this.update(result.id));
      }
    }
    this.app.workspace.trigger("community-plugins-updated", updated);
    return updated;
  }

  async checkForDeprecations(): Promise<string[]> {
    await this.app.pluginMarketplace.loadDeprecations().catch((error) => {
      console.error(error);
    });
    const disabled: string[] = [];
    for (const plugin of [...this.app.plugins.listPlugins()]) {
      if (!this.app.pluginMarketplace.isDeprecated(plugin.manifest)) continue;
      const reason = `The plugin ${plugin.manifest.name} has been disabled. This version has been reported to cause issues. Please check for a newer version of the plugin.`;
      await this.disable(plugin.manifest.id);
      new Notice(reason, 0);
      this.app.communityPlugins.setError(plugin.manifest.id, reason);
      disabled.push(plugin.manifest.id);
    }
    if (disabled.length > 0) this.app.workspace.trigger("community-plugin-deprecations-found", disabled);
    return disabled;
  }

  async enable(id: string, userInitiated = false): Promise<boolean> {
    const enabled = await this.enablePlugin(id, userInitiated);
    if (!enabled) return false;
    this.enabledPlugins.add(id);
    await this.saveConfig();
    return true;
  }

  async disable(id: string, userInitiated = true): Promise<void> {
    this.enabledPlugins.delete(id);
    await this.saveConfig();
    await this.disablePlugin(id, userInitiated);
  }

  async uninstall(id: string): Promise<void> {
    await this.disable(id);
    this.installed.delete(id);
    this.packages.delete(id);
    delete this.manifests[id];
    delete this.updates[id];
    this.app.pluginLoader.unregisterPackage(id);
    this.app.communityPlugins.remove(id);
    await this.app.jsonStore.deleteFolder(`plugins/${id}`);
    this.app.workspace.trigger("plugin-uninstalled", id);
  }

  listInstalled(): readonly PluginInstallRecord[] {
    return [...this.installed.values()];
  }

  private replaceEnabledPlugins(ids: readonly string[]): void {
    this.enabledPlugins.clear();
    for (const id of ids) this.enabledPlugins.add(id);
  }

  private rememberPackage(pkg: PluginPackage): void {
    this.packages.set(pkg.manifest.id, pkg);
    this.manifests[pkg.manifest.id] = pkg.manifest;
  }

  private syncLoadedPlugins(): void {
    clearRecord(this.plugins);
    for (const plugin of this.app.plugins.listPlugins()) this.plugins[plugin.manifest.id] = plugin;
  }

  private toPluginLoaderRoot(path: string): string {
    const configPrefix = `${this.app.vault.configDir}/`;
    return path.startsWith(configPrefix) ? path.slice(configPrefix.length) : path;
  }

  private createInstallRecord(pkg: PluginPackage): PluginInstallRecord {
    const record: PluginInstallRecord = {
      id: pkg.manifest.id,
      version: pkg.manifest.version,
      installedAt: new Date().toISOString(),
      enabled: false,
      latestVersion: pkg.manifest.version,
    };
    this.installed.set(record.id, record);
    if (!this.app.communityPlugins.get(record.id)) {
      this.app.communityPlugins.add({
        manifest: pkg.manifest,
        installed: true,
        enabled: false,
        installedAt: record.installedAt,
        updateAvailable: false,
        latestVersion: pkg.manifest.version,
        error: null,
      });
    }
    return record;
  }

  private registerAutomaticUpdateCheck(): void {
    if (this.autoUpdateListenerRegistered) return;
    this.autoUpdateListenerRegistered = true;
    window.addEventListener("focus", () => {
      void this.maybeAutoCheckForUpdates(true);
    });
  }

  private registerDeprecationCheck(): void {
    if (this.deprecationCheckRegistered) return;
    this.deprecationCheckRegistered = true;
    window.setInterval(() => {
      void this.checkForDeprecations();
    }, DEPRECATION_CHECK_INTERVAL);
  }

  private openTrustModalIfNeeded(): void {
    if (this.trustModalOpen || this.app.pluginSecurity.hasCommunityPluginsDecision()) return;
    this.trustModalOpen = true;
    new CommunityPluginTrustModal(this.app)
      .setCloseCallback(() => {
        this.trustModalOpen = false;
      })
      .open();
  }

  private onRaw(path: string): void {
    const pluginRoot = `${this.app.vault.configDir}/plugins/`;
    if (!path.startsWith(pluginRoot)) return;
    const [pluginId, filename, ...rest] = path.slice(pluginRoot.length).split("/");
    if (!pluginId || filename !== "data.json" || rest.length > 0) return;
    if (!this.installed.get(pluginId)?.enabled) return;
    this.app.plugins.getPlugin(pluginId)?.onConfigFileChange();
  }

  private syncDiscoveredPackages(packages: readonly PluginPackage[], enabledIds: readonly string[]): void {
    const enabled = new Set(enabledIds);
    for (const pkg of packages) {
      this.rememberPackage(pkg);
      const existing = this.app.communityPlugins.get(pkg.manifest.id);
      this.app.communityPlugins.add({
        ...existing,
        manifest: pkg.manifest,
        installed: true,
        enabled: enabled.has(pkg.manifest.id),
        error: existing?.error ?? null,
      });
    }
  }

  private async readEnabledPluginIds(): Promise<string[]> {
    return enabledPluginIds(await this.app.vault.readConfigJson(COMMUNITY_PLUGINS_CONFIG));
  }

  private writeEnabledPluginIds(ids: readonly string[]): Promise<void> {
    return this.app.vault.writeConfigJson(COMMUNITY_PLUGINS_CONFIG, [...ids]);
  }

  private async materializePackage(pkg: PluginPackage): Promise<PluginPackage> {
    if (!pkg.source || pkg.mainJs || pkg.factory) return pkg;
    if (!pkg.source.manifestUrl) return pkg;

    const manifest = normalizePluginManifest(await this.downloader.fetchJson<PluginManifestInput>(pkg.source.manifestUrl));
    const [mainJs, styles] = await Promise.all([
      pkg.source.mainJsUrl ? this.fetchOptionalText(pkg.source.mainJsUrl) : Promise.resolve(null),
      pkg.source.stylesUrl ? this.fetchOptionalText(pkg.source.stylesUrl) : Promise.resolve(null),
    ]);
    if (manifest.id !== pkg.manifest.id) {
      throw new Error(`Downloaded plugin manifest id mismatch: expected ${pkg.manifest.id}, got ${manifest.id}`);
    }
    const dir = pkg.dir ?? pkg.manifest.dir ?? `plugins/${manifest.id}`;
    return {
      ...pkg,
      dir,
      entry: `${dir}/main.js`,
      manifest: normalizePluginManifest({ ...pkg.manifest, ...manifest }, dir),
      mainJs: mainJs === null ? undefined : prepareDownloadedMainJs(mainJs),
      styles: styles ?? undefined,
    };
  }

  private async fetchOptionalText(url: string): Promise<string | null> {
    if (this.downloader.fetchOptionalText) return this.downloader.fetchOptionalText(url);
    try {
      return await this.downloader.fetchText(url);
    } catch {
      return null;
    }
  }

  private async persistPackage(pkg: PluginPackage): Promise<void> {
    const dir = pkg.dir ?? pkg.manifest.dir ?? `plugins/${pkg.manifest.id}`;
    await this.app.jsonStore.write(`${dir}/manifest.json`, pkg.manifest);
    if (pkg.mainJs !== undefined) await this.app.jsonStore.writeText(`${dir}/main.js`, pkg.mainJs);
    if (pkg.styles !== undefined) await this.app.jsonStore.writeText(`${dir}/styles.css`, pkg.styles);
  }
}

class FetchPluginPackageDownloader implements PluginPackageDownloader {
  async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download plugin manifest: ${url}`);
    return response.json() as Promise<T>;
  }

  async fetchText(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download plugin file: ${url}`);
    return response.text();
  }

  async fetchOptionalText(url: string): Promise<string | null> {
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Failed to download plugin file: ${url}`);
    return response.text();
  }
}

function withEnabledPlugin(config: unknown, id: string): string[] {
  const ids = enabledPluginIds(config);
  return ids.includes(id) ? ids : [...ids, id];
}

function withoutEnabledPlugin(config: unknown, id: string): string[] {
  return enabledPluginIds(config).filter((item) => item !== id);
}

function enabledPluginIds(config: unknown): string[] {
  return Array.isArray(config) ? config.filter((item): item is string => typeof item === "string") : [];
}

function clearRecord<T>(record: Record<string, T>): void {
  for (const key of Object.keys(record)) delete record[key];
}

function isDesktopOnlyBlocked(manifest: PluginManifestInput): boolean {
  return Boolean(manifest.isDesktopOnly && (!Platform.isDesktopApp || document.body.classList.contains("emulate-mobile")));
}
