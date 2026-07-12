import type { App } from "../App";
import { compareVersions } from "../../core/Version";

export interface UpdateCheckResult {
  id: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

export class UpdateManager {
  private latestVersions = new Map<string, string>();

  constructor(readonly app: App) {}

  setLatestVersion(id: string, version: string): void {
    this.latestVersions.set(id, version);
  }

  checkPlugin(id: string, currentVersion: string): UpdateCheckResult {
    const latestVersion =
      this.latestVersions.get(id) ??
      this.app.pluginMarketplace.getEntry(id)?.manifest.version ??
      currentVersion;
    return {
      id,
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    };
  }

  checkInstalledPlugins(): UpdateCheckResult[] {
    return this.app.pluginInstaller
      .listInstalled()
      .map((record) => this.checkPlugin(record.id, record.version));
  }
}
