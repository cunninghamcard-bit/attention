import type { App } from "../app/App";

export interface VaultRecord {
  id: string;
  name: string;
  path: string;
  openedAt?: string;
  favorite?: boolean;
}

export class VaultManager {
  private vaults = new Map<string, VaultRecord>();
  private activeVaultId: string | null = null;

  constructor(readonly app: App) {}

  addVault(record: VaultRecord): void {
    this.vaults.set(record.id, record);
    this.app.workspace.trigger("vault-add", record);
  }

  removeVault(id: string): void {
    const record = this.vaults.get(id);
    if (!record) return;
    this.vaults.delete(id);
    if (this.activeVaultId === id) this.activeVaultId = null;
    this.app.workspace.trigger("vault-remove", record);
  }

  openVault(id: string): VaultRecord | null {
    const record = this.vaults.get(id);
    if (!record) return null;
    record.openedAt = new Date().toISOString();
    this.activeVaultId = id;
    this.app.workspace.trigger("vault-open", record);
    return { ...record };
  }

  getActiveVault(): VaultRecord | null {
    const record = this.activeVaultId ? this.vaults.get(this.activeVaultId) : null;
    return record ? { ...record } : null;
  }

  listVaults(): readonly VaultRecord[] {
    return [...this.vaults.values()].map((record) => ({ ...record }));
  }
}
