import type { ThemeManifest, ThemePackage } from "./ThemeManifest";
import { compareVersions } from "../../core/Version";

export interface ThemeMarketplaceEntry {
  manifest: ThemeManifest;
  downloads?: number;
  updatedAt?: string;
  repository?: string;
  screenshot?: string;
  readme?: string;
  detailsState?: "loading" | "loaded";
}

/** The official community theme catalog (same source real Obsidian uses). */
const CATALOG_URL =
  "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-css-themes.json";
const STATS_URL = "https://releases.obsidian.md/stats/theme";

interface CommunityCatalogEntry {
  name: string;
  author: string;
  repo: string;
  screenshot?: string;
  modes?: Array<"light" | "dark">;
}

type ThemeStats = Record<string, { download?: number }>;

export type MarketplaceFetcher = (
  url: string,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class ThemeMarketplace {
  private entries = new Map<string, ThemeMarketplaceEntry>();
  private detailLoads = new Map<string, Promise<ThemeMarketplaceEntry>>();
  private catalogLoaded = false;

  constructor(private readonly fetcher: MarketplaceFetcher = (url) => fetch(url)) {}

  /** Fetches the community catalog once; re-fetch with force. */
  async loadCatalog(force = false): Promise<number> {
    if (this.catalogLoaded && !force) return this.entries.size;
    const [response, statsResponse] = await Promise.all([
      this.fetcher(CATALOG_URL),
      this.fetcher(STATS_URL).catch(() => null),
    ]);
    if (!response.ok) throw new Error(`Theme catalog request failed: ${response.status}`);
    const catalog = JSON.parse(await response.text()) as CommunityCatalogEntry[];
    let stats: ThemeStats = {};
    if (statsResponse?.ok) {
      try {
        stats = JSON.parse(await statsResponse.text()) as ThemeStats;
      } catch {
        // Download counts are optional; the catalog remains usable without them.
      }
    }
    if (force) this.entries.clear();
    for (const item of catalog) {
      if (!item?.name || !item.repo) continue;
      this.registerEntry({
        manifest: {
          id: item.name,
          name: item.name,
          author: item.author,
          version: "",
          modes: item.modes ?? ["light", "dark"],
        },
        repository: item.repo,
        screenshot: item.screenshot,
        downloads: stats[item.name]?.download ?? 0,
      });
    }
    this.catalogLoaded = true;
    return this.entries.size;
  }

  registerEntry(entry: ThemeMarketplaceEntry): void {
    this.entries.set(entry.manifest.id, entry);
  }

  getEntry(id: string): ThemeMarketplaceEntry | null {
    return this.entries.get(id) ?? null;
  }

  search(query = ""): ThemeMarketplaceEntry[] {
    const q = query.toLowerCase();
    return [...this.entries.values()].filter(
      (entry) =>
        !q ||
        entry.manifest.name.toLowerCase().includes(q) ||
        entry.manifest.author?.toLowerCase().includes(q) ||
        entry.manifest.description?.toLowerCase().includes(q) ||
        entry.manifest.id.toLowerCase().includes(q),
    );
  }

  async findUpdates(
    installed: readonly { id: string; version?: string }[],
  ): Promise<ThemeMarketplaceEntry[]> {
    await this.loadCatalog();
    const candidates = installed.filter((theme) => theme.version && this.entries.has(theme.id));
    const entries = await Promise.all(candidates.map((theme) => this.loadDetails(theme.id)));
    return entries.filter((entry, index) => {
      const current = candidates[index].version ?? "";
      const latest = entry.manifest.version;
      return Boolean(latest && compareVersions(latest, current) > 0);
    });
  }

  async loadDetails(id: string): Promise<ThemeMarketplaceEntry> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unknown community theme: ${id}`);
    if (entry.detailsState === "loaded") return entry;
    const pending = this.detailLoads.get(id);
    if (pending) return pending;

    entry.detailsState = "loading";
    const load = (async (): Promise<ThemeMarketplaceEntry> => {
      if (!entry.repository) {
        entry.readme = "No README provided.";
        entry.detailsState = "loaded";
        return entry;
      }
      const base = `https://raw.githubusercontent.com/${entry.repository}/HEAD`;
      const [manifestResponse, readmeResponse] = await Promise.all([
        this.fetcher(`${base}/manifest.json`).catch(() => null),
        this.fetcher(`${base}/README.md`).catch(() => null),
      ]);
      if (manifestResponse?.ok) {
        try {
          const remote = JSON.parse(await manifestResponse.text()) as Partial<ThemeManifest>;
          entry.manifest = {
            ...entry.manifest,
            name: remote.name ?? entry.manifest.name,
            version: remote.version ?? entry.manifest.version,
            author: remote.author ?? entry.manifest.author,
            description: remote.description ?? entry.manifest.description,
            modes: remote.modes ?? entry.manifest.modes,
          };
        } catch {
          // The catalog metadata is enough when a repository manifest is malformed.
        }
      }
      entry.readme = readmeResponse?.ok ? await readmeResponse.text() : "No README provided.";
      entry.detailsState = "loaded";
      return entry;
    })();
    this.detailLoads.set(id, load);
    try {
      return await load;
    } finally {
      this.detailLoads.delete(id);
    }
  }

  /** Downloads theme.css (+ optional manifest.json) from the theme's repo. */
  async downloadPackage(id: string): Promise<ThemePackage> {
    const entry = this.entries.get(id);
    if (!entry?.repository) throw new Error(`Unknown community theme: ${id}`);
    const base = `https://raw.githubusercontent.com/${entry.repository}/HEAD`;
    const cssResponse = await this.fetcher(`${base}/theme.css`);
    if (!cssResponse.ok) throw new Error(`theme.css download failed: ${cssResponse.status}`);
    const cssText = await cssResponse.text();
    let manifest = entry.manifest;
    const manifestResponse = await this.fetcher(`${base}/manifest.json`).catch(() => null);
    if (manifestResponse?.ok) {
      try {
        const remote = JSON.parse(await manifestResponse.text()) as Partial<ThemeManifest>;
        manifest = {
          ...manifest,
          version: remote.version ?? manifest.version,
          author: remote.author ?? manifest.author,
        };
      } catch {
        // Malformed remote manifest: the catalog entry is enough.
      }
    }
    return { manifest, cssText };
  }
}
