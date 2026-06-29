import type { ThemeManifest, ThemePackage } from "./ThemeManifest";

export interface ThemeMarketplaceEntry {
  manifest: ThemeManifest;
  downloads?: number;
  updatedAt?: string;
  repository?: string;
}

export class ThemeMarketplace {
  private entries = new Map<string, ThemeMarketplaceEntry>();

  registerEntry(entry: ThemeMarketplaceEntry): void {
    this.entries.set(entry.manifest.id, entry);
  }

  search(query = ""): ThemeMarketplaceEntry[] {
    const q = query.toLowerCase();
    return [...this.entries.values()].filter((entry) => !q
      || entry.manifest.name.toLowerCase().includes(q)
      || entry.manifest.description?.toLowerCase().includes(q)
      || entry.manifest.id.toLowerCase().includes(q));
  }

  createPackage(id: string): ThemePackage | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    return {
      manifest: entry.manifest,
      cssText: `body.theme-${entry.manifest.id} { ${Object.entries(entry.manifest.variables ?? {}).map(([k, v]) => `${k}: ${v};`).join(" ")} }`,
    };
  }
}
