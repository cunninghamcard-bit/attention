export class PluginSecurityManager {
  communityPluginsStorageKey: string;
  private restrictedMode = true;

  constructor(readonly appId = "obsidian-reconstructed") {
    this.communityPluginsStorageKey = `enable-plugin-${appId}`;
    this.restrictedMode = !this.readCommunityPluginsEnabled();
  }

  setAppId(appId: string): void {
    this.communityPluginsStorageKey = `enable-plugin-${appId}`;
    this.restrictedMode = !this.readCommunityPluginsEnabled();
  }

  isRestrictedMode(): boolean {
    return this.restrictedMode;
  }

  setRestrictedMode(enabled: boolean): void {
    this.restrictedMode = enabled;
    this.writeCommunityPluginsEnabled(!enabled);
  }

  isCommunityPluginsEnabled(): boolean {
    return !this.restrictedMode;
  }

  hasCommunityPluginsDecision(): boolean {
    try {
      return window.localStorage?.getItem(this.communityPluginsStorageKey) !== null;
    } catch {
      return false;
    }
  }

  setCommunityPluginsEnabled(enabled: boolean): void {
    this.restrictedMode = !enabled;
    this.writeCommunityPluginsEnabled(enabled);
  }

  private readCommunityPluginsEnabled(): boolean {
    try {
      return window.localStorage?.getItem(this.communityPluginsStorageKey) === "true";
    } catch {
      return false;
    }
  }

  private writeCommunityPluginsEnabled(enabled: boolean): void {
    try {
      window.localStorage?.setItem(this.communityPluginsStorageKey, String(enabled));
    } catch {
      // localStorage can be unavailable in tests or restricted browser contexts.
    }
  }
}
