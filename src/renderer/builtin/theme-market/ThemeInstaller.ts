import type { App } from "../../app/App";
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
      this.app.themes.registerTheme({
        id: pkg.manifest.id,
        name: pkg.manifest.name,
        variables: pkg.manifest.variables,
        author: pkg.manifest.author,
        version: pkg.manifest.version,
        cssText: pkg.cssText,
      });
    }
    this.app.workspace.trigger("theme-installed", record);
    return record;
  }

  async update(id: string): Promise<InstalledThemeRecord> {
    const active = (this.app.vault.getConfig<string>("cssTheme") ?? "") === id;
    const record = await this.install(await this.app.themeMarketplace.downloadPackage(id));
    if (active) await this.app.customCss.requestLoadTheme.run();
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

  async uninstall(id: string): Promise<void> {
    if (!id || id.startsWith("obsidian-default-")) return;
    if ((this.app.vault.getConfig<string>("cssTheme") ?? "") === id) this.app.themes.setTheme("");

    const folderPath = `${this.app.customCss.getThemeFolder()}/${id}`;
    if (this.app.vault.jsonStore) {
      await this.app.vault.jsonStore.deleteFolder(folderPath);
      await this.app.vault.jsonStore.delete(`${folderPath}/theme.css`);
      await this.app.vault.jsonStore.delete(`${folderPath}/manifest.json`);
      await this.app.vault.jsonStore.delete(this.app.customCss.getThemePath(id));
    } else {
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (folder) await this.app.vault.delete(folder, true);
      else {
        const file = this.app.vault.getAbstractFileByPath(this.app.customCss.getThemePath(id));
        if (file) await this.app.vault.delete(file, true);
      }
    }
    this.installed.delete(id);
    this.app.themes.unregisterTheme(id);
    await this.app.customCss.readThemes();
    this.app.workspace.trigger("theme-uninstalled", id);
  }

  listInstalled(): readonly InstalledThemeRecord[] {
    return [...this.installed.values()];
  }
}
