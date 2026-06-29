export interface AppUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseNotes?: string;
  available: boolean;
}

export class AutoUpdateService {
  private latestVersion = "";

  setLatestVersion(version: string): void {
    this.latestVersion = version;
  }

  check(currentVersion: string): AppUpdateInfo {
    const latestVersion = this.latestVersion || currentVersion;
    return {
      currentVersion,
      latestVersion,
      available: latestVersion !== currentVersion,
    };
  }
}
