import { normalizePluginManifest, type PluginManifest, type PluginManifestInput, type PluginPackage } from "./PluginManifest";
import { compareVersions, latestVersion } from "../utils/Version";

export interface MarketplacePluginEntry {
  manifest: PluginManifestInput;
  package?: PluginPackage;
  repo?: string;
  downloads?: number;
  stars?: number;
  updatedAt?: string;
  releasedAt?: string;
  repository?: string;
  fundingUrl?: string;
  readme?: string;
  readmeUrl?: string;
  readmeState?: MarketplaceLoadState;
  readmeError?: string | null;
  deprecatedVersions?: string[];
  latestCompatibleVersion?: string;
  latestManifest?: PluginManifestInput;
}

export interface MarketplaceSearchQuery {
  query?: string;
  author?: string;
  installedOnly?: boolean;
}

export interface ObsidianCommunityPluginListItem {
  id: string;
  name: string;
  author: string;
  description: string;
  repo: string;
}

export type ObsidianCommunityPluginStats = Record<string, number | undefined> & {
  downloads?: number;
  updated?: number;
};

export type ObsidianCommunityPluginStatsMap = Record<string, ObsidianCommunityPluginStats | undefined>;
export type ObsidianCommunityPluginDeprecations = Record<string, string[] | undefined>;

export interface MarketplaceDataSource {
  fetchJson<T>(url: string): Promise<T>;
  fetchText?(url: string): Promise<string>;
}

export type MarketplaceLoadState = "idle" | "loading" | "loaded" | "error";

export const OBSIDIAN_RELEASES_COMMUNITY_PLUGINS_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";
export const OBSIDIAN_RELEASES_COMMUNITY_PLUGIN_STATS_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json";
export const OBSIDIAN_RELEASES_COMMUNITY_PLUGIN_DEPRECATION_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-deprecation.json";

export class PluginMarketplace {
  private entries = new Map<string, MarketplacePluginEntry>();
  private deprecations = new Map<string, Set<string>>();
  private loadPromise: Promise<void> | null = null;
  private deprecationLoadPromise: Promise<void> | null = null;
  private deprecationsLoaded = false;
  private readmePromises = new Map<string, Promise<string | null>>();
  loadState: MarketplaceLoadState = "idle";
  loadedAt: string | null = null;
  loadError: string | null = null;

  constructor(private dataSource: MarketplaceDataSource = new FetchMarketplaceDataSource()) {}

  setDataSource(dataSource: MarketplaceDataSource): void {
    this.dataSource = dataSource;
    this.loadPromise = null;
    this.deprecationLoadPromise = null;
    this.deprecationsLoaded = false;
    this.loadState = "idle";
    this.loadError = null;
  }

  registerEntry(entry: MarketplacePluginEntry): void {
    const normalized = normalizeMarketplaceEntry(entry);
    this.entries.set(normalized.manifest.id, normalized);
    this.rememberDeprecations(normalized.manifest.id, normalized.deprecatedVersions);
  }

  registerObsidianReleaseData(
    plugins: readonly ObsidianCommunityPluginListItem[],
    stats: ObsidianCommunityPluginStatsMap = {},
    deprecations: ObsidianCommunityPluginDeprecations = {},
  ): void {
    for (const plugin of plugins) {
      this.registerEntry(createObsidianMarketplaceEntry(plugin, stats[plugin.id], deprecations[plugin.id]));
    }
    this.deprecationsLoaded = true;
  }

  async loadObsidianReleases(): Promise<void> {
    if (this.loadState === "loaded") return;
    if (this.loadPromise) return this.loadPromise;
    this.loadState = "loading";
    this.loadError = null;
    this.loadPromise = this.loadObsidianReleasesNow().finally(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  async reloadObsidianReleases(): Promise<void> {
    this.loadState = "idle";
    this.loadPromise = null;
    await this.loadObsidianReleases();
  }

  async loadDeprecations(force = false): Promise<void> {
    if (!force && this.deprecationsLoaded) return;
    if (!force && this.deprecationLoadPromise) return this.deprecationLoadPromise;
    this.deprecationLoadPromise = this.loadDeprecationsNow().finally(() => {
      this.deprecationLoadPromise = null;
    });
    return this.deprecationLoadPromise;
  }

  hasEntries(): boolean {
    return this.entries.size > 0;
  }

  private async loadObsidianReleasesNow(): Promise<void> {
    try {
      const [plugins, stats, deprecations] = await Promise.all([
        this.dataSource.fetchJson<ObsidianCommunityPluginListItem[]>(OBSIDIAN_RELEASES_COMMUNITY_PLUGINS_URL),
        this.dataSource.fetchJson<ObsidianCommunityPluginStatsMap>(OBSIDIAN_RELEASES_COMMUNITY_PLUGIN_STATS_URL),
        this.dataSource.fetchJson<ObsidianCommunityPluginDeprecations>(OBSIDIAN_RELEASES_COMMUNITY_PLUGIN_DEPRECATION_URL),
      ]);
      this.registerObsidianReleaseData(plugins, stats, deprecations);
      this.loadState = "loaded";
      this.loadedAt = new Date().toISOString();
    } catch (error) {
      this.loadState = "error";
      this.loadError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  removeEntry(id: string): void {
    this.entries.delete(id);
  }

  getEntry(id: string): MarketplacePluginEntry | null {
    return this.entries.get(id) ?? null;
  }

  async loadReadme(id: string): Promise<string | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.readme !== undefined) {
      entry.readmeState = "loaded";
      entry.readmeError = null;
      return entry.readme;
    }
    if (!entry.readmeUrl) {
      entry.readmeState = "loaded";
      entry.readmeError = null;
      return null;
    }
    const existing = this.readmePromises.get(id);
    if (existing) return existing;
    entry.readmeState = "loading";
    entry.readmeError = null;
    const promise = this.loadReadmeNow(entry).finally(() => this.readmePromises.delete(id));
    this.readmePromises.set(id, promise);
    return promise;
  }

  private async loadReadmeNow(entry: MarketplacePluginEntry): Promise<string | null> {
    try {
      const readme = await loadText(this.dataSource, entry.readmeUrl!);
      entry.readme = readme;
      entry.readmeState = "loaded";
      entry.readmeError = null;
      return readme;
    } catch (error) {
      entry.readmeState = "error";
      entry.readmeError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  search(query: MarketplaceSearchQuery = {}): MarketplacePluginEntry[] {
    const text = query.query?.toLowerCase() ?? "";
    return [...this.entries.values()].filter((entry) => {
      if (query.author && entry.manifest.author !== query.author) return false;
      if (!text) return true;
      return entry.manifest.name.toLowerCase().includes(text)
        || entry.manifest.description?.toLowerCase().includes(text)
        || entry.manifest.id.toLowerCase().includes(text)
        || Boolean(entry.repo?.toLowerCase().includes(text));
    });
  }

  createPackage(id: string): PluginPackage | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.package) return entry.package;
    const version = entry.latestCompatibleVersion ?? entry.manifest.version;
    return {
      manifest: { ...entry.manifest, version },
      entry: `plugins/${entry.manifest.id}/main.js`,
      styles: undefined,
      source: entry.repo ? {
        repo: entry.repo,
        version,
        manifestUrl: githubReleaseAssetUrl(entry.repo, version, "manifest.json"),
        mainJsUrl: githubReleaseAssetUrl(entry.repo, version, "main.js"),
        stylesUrl: githubReleaseAssetUrl(entry.repo, version, "styles.css"),
      } : undefined,
    };
  }

  isDeprecated(manifest: PluginManifest | null | undefined): boolean {
    if (!manifest?.id || !manifest.version) return false;
    return this.deprecations.get(manifest.id)?.has(manifest.version) ?? false;
  }

  async resolveLatestCompatibleVersion(id: string, appVersion = "1.0.0"): Promise<string | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (!entry.repo) return entry.manifest.version;
    const manifest = normalizePluginManifest(await this.dataSource.fetchJson<PluginManifestInput>(githubRawUrl(entry.repo, "HEAD", "manifest.json")));
    if (!manifest?.id || manifest.id !== id) return null;
    entry.latestManifest = manifest;
    const version = await this.selectCompatibleVersion(entry.repo, manifest, appVersion);
    if (!version) return null;
    entry.latestCompatibleVersion = version;
    entry.manifest = version === manifest.version
      ? { ...entry.manifest, ...manifest }
      : { ...entry.manifest, version };
    return version;
  }

  private async selectCompatibleVersion(repo: string, manifest: PluginManifest, appVersion: string): Promise<string | null> {
    const version = manifest.version || null;
    if (!version) return null;
    if (!appVersion || !manifest.minAppVersion || compareVersions(appVersion, manifest.minAppVersion) >= 0) {
      return version;
    }
    try {
      const versions = await this.dataSource.fetchJson<Record<string, string>>(githubRawUrl(repo, "HEAD", "versions.json"));
      return latestVersion(Object.entries(versions)
        .filter(([, minAppVersion]) => compareVersions(appVersion, minAppVersion) >= 0)
        .map(([candidate]) => candidate));
    } catch {
      return null;
    }
  }

  private rememberDeprecations(id: string, versions: readonly string[] | undefined): void {
    if (!versions) return;
    this.deprecations.set(id, new Set(versions));
  }

  private async loadDeprecationsNow(): Promise<void> {
    const deprecations = await this.dataSource.fetchJson<ObsidianCommunityPluginDeprecations>(OBSIDIAN_RELEASES_COMMUNITY_PLUGIN_DEPRECATION_URL);
    this.deprecations.clear();
    for (const [id, versions] of Object.entries(deprecations)) {
      this.rememberDeprecations(id, versions);
    }
    for (const entry of this.entries.values()) {
      this.rememberDeprecations(entry.manifest.id, entry.deprecatedVersions);
    }
    this.deprecationsLoaded = true;
  }
}

class FetchMarketplaceDataSource implements MarketplaceDataSource {
  async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load marketplace data: ${url}`);
    return response.json() as Promise<T>;
  }

  async fetchText(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load marketplace text: ${url}`);
    return response.text();
  }
}

function normalizeMarketplaceEntry(entry: MarketplacePluginEntry): MarketplacePluginEntry {
  return {
    ...entry,
    manifest: normalizePluginManifest(entry.manifest),
    latestManifest: entry.latestManifest ? normalizePluginManifest(entry.latestManifest) : undefined,
    readmeUrl: entry.readmeUrl ?? (entry.repo ? githubRawUrl(entry.repo, "HEAD", "README.md") : undefined),
    readmeState: entry.readme !== undefined ? "loaded" : entry.readmeState,
    readmeError: entry.readme !== undefined ? null : entry.readmeError,
  };
}

function createObsidianMarketplaceEntry(
  plugin: ObsidianCommunityPluginListItem,
  stats: ObsidianCommunityPluginStats | undefined,
  deprecatedVersions: readonly string[] | undefined,
): MarketplacePluginEntry {
  const usableVersions = marketplaceVersions(stats).filter((version) => !deprecatedVersions?.includes(version));
  const version = latestVersion(usableVersions) ?? latestVersion(marketplaceVersions(stats)) ?? "0.0.0";
  const updatedAt = formatMarketplaceDate(stats?.updated);
  return {
    manifest: {
      id: plugin.id,
      name: plugin.name,
      version,
      author: plugin.author,
      minAppVersion: "0.0.0",
      description: plugin.description,
    },
    repo: plugin.repo,
    downloads: stats?.downloads,
    updatedAt,
    releasedAt: updatedAt,
    repository: `https://github.com/${plugin.repo}`,
    readmeUrl: githubRawUrl(plugin.repo, "HEAD", "README.md"),
    deprecatedVersions: deprecatedVersions ? [...deprecatedVersions] : undefined,
  };
}

async function loadText(dataSource: MarketplaceDataSource, url: string): Promise<string> {
  if (!dataSource.fetchText) throw new Error(`Marketplace data source cannot load text: ${url}`);
  return dataSource.fetchText(url);
}

function marketplaceVersions(stats: ObsidianCommunityPluginStats | undefined): string[] {
  if (!stats) return [];
  return Object.entries(stats)
    .filter(([key, value]) => key !== "downloads" && key !== "updated" && typeof value === "number")
    .map(([key]) => key);
}

function formatMarketplaceDate(value: number | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function githubRawUrl(repo: string, version: string, file: string): string {
  return `https://raw.githubusercontent.com/${repo}/${version}/${file}`;
}

function githubReleaseAssetUrl(repo: string, version: string, file: string): string {
  return `https://github.com/${repo}/releases/download/${version}/${file}`;
}
