import type { ThemeManifest, ThemePackage } from "./ThemeManifest";

export interface ThemeMarketplaceEntry {
  manifest: ThemeManifest;
  downloads?: number;
  updatedAt?: string;
  repository?: string;
  screenshot?: string;
}

/** The official community theme catalog (same source real Obsidian uses). */
const CATALOG_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-css-themes.json";

interface CommunityCatalogEntry {
  name: string;
  author: string;
  repo: string;
  screenshot?: string;
  modes?: Array<"light" | "dark">;
}

export type MarketplaceFetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class ThemeMarketplace {
  private entries = new Map<string, ThemeMarketplaceEntry>();
  private catalogLoaded = false;

  constructor(private readonly fetcher: MarketplaceFetcher = (url) => fetch(url)) {}

  /** Fetches the community catalog once; re-fetch with force. */
  async loadCatalog(force = false): Promise<number> {
    if (this.catalogLoaded && !force) return this.entries.size;
    const response = await this.fetcher(CATALOG_URL);
    if (!response.ok) throw new Error(`Theme catalog request failed: ${response.status}`);
    const catalog = JSON.parse(await response.text()) as CommunityCatalogEntry[];
    for (const item of catalog) {
      if (!item?.name || !item.repo) continue;
      this.registerEntry({
        manifest: { id: item.name, name: item.name, author: item.author, version: "", modes: item.modes ?? ["light", "dark"] },
        repository: item.repo,
        screenshot: item.screenshot,
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
    return [...this.entries.values()]
      .filter((entry) => !q
        || entry.manifest.name.toLowerCase().includes(q)
        || entry.manifest.author?.toLowerCase().includes(q)
        || entry.manifest.description?.toLowerCase().includes(q)
        || entry.manifest.id.toLowerCase().includes(q))
      .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
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
        manifest = { ...manifest, version: remote.version ?? manifest.version, author: remote.author ?? manifest.author };
      } catch {
        // Malformed remote manifest: the catalog entry is enough.
      }
    }
    return { manifest, cssText };
  }
}
