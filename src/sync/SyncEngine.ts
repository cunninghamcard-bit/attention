import type { App } from "../app/App";
import { SyncConflictResolver, type SyncConflict } from "./SyncConflict";

export interface SyncStatus {
  running: boolean;
  lastSyncAt: string | null;
  pendingUploads: number;
  pendingDownloads: number;
  conflicts: number;
}

export class SyncEngine {
  readonly conflicts: SyncConflict[] = [];
  readonly resolver = new SyncConflictResolver();
  private status: SyncStatus = {
    running: false,
    lastSyncAt: null,
    pendingUploads: 0,
    pendingDownloads: 0,
    conflicts: 0,
  };

  constructor(readonly app: App) {}

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  async start(): Promise<void> {
    this.status.running = true;
    this.app.workspace.trigger("sync-start", this.getStatus());
  }

  async stop(): Promise<void> {
    this.status.running = false;
    this.app.workspace.trigger("sync-stop", this.getStatus());
  }

  async runOnce(): Promise<SyncStatus> {
    this.status.running = true;
    this.app.workspace.trigger("sync-start", this.getStatus());
    this.status.lastSyncAt = new Date().toISOString();
    this.status.running = false;
    this.status.conflicts = this.conflicts.length;
    this.app.workspace.trigger("sync-complete", this.getStatus());
    return this.getStatus();
  }

  addConflict(conflict: SyncConflict): void {
    this.conflicts.push(conflict);
    this.status.conflicts = this.conflicts.length;
    this.app.workspace.trigger("sync-conflict", conflict);
  }
}
