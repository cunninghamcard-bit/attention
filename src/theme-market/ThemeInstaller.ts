import type { App } from "../app/App";
import type { ThemePackage } from "./ThemeManifest";

export interface InstalledThemeRecord {
  id: string;
  version: string;
  installedAt: string;
  enabled: boolean;
}

export class ThemeInstaller {
  private installed = new Map<string, InstalledThemeRecord>();

  constructor(readonly app: App) {}

  /**
   * Persists the theme into the vault (`.obsidian/themes/<name>/`) — the same
   * layout real Obsidian writes, so themes are shared with it — then registers
   * it for immediate selection.
   */
  async install(pkg: ThemePackage): Promise<InstalledThemeRecord> {
    const record: InstalledThemeRecord = {
      id: pkg.manifest.id,
      version: pkg.manifest.version,
      installedAt: new Date().toISOString(),
      enabled: false,
    };
    const folder = `${this.app.customCss.getThemeFolder()}/${pkg.manifest.name}`;
    await this.app.vault.writeText(`${folder}/theme.css`, pkg.cssText);
    await this.app.vault.writeJson(`${folder}/manifest.json`, {
      name: pkg.manifest.name,
      version: pkg.manifest.version,
      author: pkg.manifest.author,
    });
    await this.app.customCss.readThemes();
    this.installed.set(record.id, record);
    if (pkg.manifest.variables) {
      this.app.themes.registerTheme({ id: pkg.manifest.id, name: pkg.manifest.name, variables: pkg.manifest.variables, author: pkg.manifest.author, cssText: pkg.cssText });
    }
    this.app.workspace.trigger("theme-installed", record);
    return record;
  }

  enable(id: string): void {
    const record = this.installed.get(id);
    if (!record) return;
    record.enabled = true;
    this.app.themes.setTheme(id);
    this.app.workspace.trigger("theme-enabled", record);
  }

  disable(id: string): void {
    const record = this.installed.get(id);
    if (!record) return;
    record.enabled = false;
    this.app.workspace.trigger("theme-disabled", record);
  }

  listInstalled(): readonly InstalledThemeRecord[] {
    return [...this.installed.values()];
  }
}
