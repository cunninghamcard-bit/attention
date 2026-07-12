import {
  normalizePluginManifest,
  type PluginManifest,
  type PluginManifestInput,
} from "./PluginManifest";

export interface CommunityPluginRecord {
  manifest: PluginManifest;
  installed: boolean;
  enabled: boolean;
  updateAvailable?: boolean;
  latestVersion?: string;
  checkedAt?: string;
  error?: string | null;
  installedAt?: string;
  enabledAt?: string;
}

export interface CommunityPluginRecordInput extends Omit<CommunityPluginRecord, "manifest"> {
  manifest: PluginManifestInput;
}

export class CommunityPluginRegistry {
  private records = new Map<string, CommunityPluginRecord>();

  add(record: CommunityPluginRecordInput): void {
    const manifest = normalizePluginManifest(record.manifest);
    this.records.set(manifest.id, { ...record, manifest });
  }

  remove(id: string): void {
    this.records.delete(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    const record = this.records.get(id);
    if (record) {
      record.enabled = enabled;
      record.error = null;
      if (enabled) record.enabledAt = new Date().toISOString();
    }
  }

  setError(id: string, error: string | null): void {
    const record = this.records.get(id);
    if (record) {
      record.error = error;
      if (error) record.enabled = false;
    }
  }

  setUpdateStatus(
    id: string,
    updateAvailable: boolean,
    latestVersion: string,
    checkedAt = new Date().toISOString(),
  ): void {
    const record = this.records.get(id);
    if (record) {
      record.updateAvailable = updateAvailable;
      record.latestVersion = latestVersion;
      record.checkedAt = checkedAt;
    }
  }

  get(id: string): CommunityPluginRecord | null {
    const record = this.records.get(id);
    return record ? { ...record, manifest: { ...record.manifest } } : null;
  }

  list(): readonly CommunityPluginRecord[] {
    return [...this.records.values()];
  }
}
