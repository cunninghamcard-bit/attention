import type { App } from "../../app/App";
import type { FileRevision } from "./RevisionHistory";

export interface RecoverySnapshot {
  path: string;
  revisionId: string;
  recoveredAt?: string;
}

export class FileRecoveryService {
  constructor(readonly app: App) {}

  async snapshot(path: string, content: string): Promise<FileRevision> {
    return this.app.revisions.addRevision(path, content, "manual");
  }

  async recover(path: string, revisionId: string): Promise<RecoverySnapshot | null> {
    const revision = this.app.revisions.getRevision(path, revisionId);
    if (!revision) return null;
    const file = this.app.vault.getFileByPath(path) ?? (await this.app.vault.create(path, ""));
    await this.app.vault.modify(file, revision.content);
    const snapshot = { path, revisionId, recoveredAt: new Date().toISOString() };
    this.app.workspace.trigger("file-recovered", snapshot);
    return snapshot;
  }
}
