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

  async install(pkg: ThemePackage): Promise<InstalledThemeRecord> {
    const record: InstalledThemeRecord = {
      id: pkg.manifest.id,
      version: pkg.manifest.version,
      installedAt: new Date().toISOString(),
      enabled: false,
    };
    this.installed.set(record.id, record);
    this.app.customCss.registerCss(`theme:${record.id}`, pkg.cssText);
    if (pkg.manifest.variables) {
      this.app.themes.registerTheme({ id: pkg.manifest.id, name: pkg.manifest.name, variables: pkg.manifest.variables, author: pkg.manifest.author });
    }
    this.app.workspace.trigger("theme-installed", record);
    return record;
  }

  enable(id: string): void {
    const record = this.installed.get(id);
    if (!record) return;
    record.enabled = true;
    this.app.themes.setTheme(id);
    document.body.classList.add(`theme-${id}`);
    this.app.workspace.trigger("theme-enabled", record);
  }

  disable(id: string): void {
    const record = this.installed.get(id);
    if (!record) return;
    record.enabled = false;
    document.body.classList.remove(`theme-${id}`);
    this.app.workspace.trigger("theme-disabled", record);
  }

  listInstalled(): readonly InstalledThemeRecord[] {
    return [...this.installed.values()];
  }
}
