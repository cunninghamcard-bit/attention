import type { App } from "../../app/App";

export interface FileRevision {
  id: string;
  path: string;
  content: string;
  createdAt: string;
  source: "local" | "sync" | "manual";
}

export class RevisionHistoryService {
  private revisions = new Map<string, FileRevision[]>();

  constructor(readonly app: App) {}

  addRevision(
    path: string,
    content: string,
    source: FileRevision["source"] = "local",
  ): FileRevision {
    const revision: FileRevision = {
      id: crypto.randomUUID?.() ?? `${Date.now()}`,
      path,
      content,
      createdAt: new Date().toISOString(),
      source,
    };
    const list = this.revisions.get(path) ?? [];
    list.unshift(revision);
    this.revisions.set(path, list.slice(0, 100));
    this.app.workspace.trigger("revision-add", revision);
    return revision;
  }

  listRevisions(path: string): readonly FileRevision[] {
    return [...(this.revisions.get(path) ?? [])];
  }

  listPaths(): string[] {
    return [...this.revisions.keys()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
    );
  }

  getRevision(path: string, id: string): FileRevision | null {
    return this.revisions.get(path)?.find((revision) => revision.id === id) ?? null;
  }

  pruneOlderThan(cutoff: Date): void {
    const cutoffTime = cutoff.getTime();
    for (const [path, revisions] of this.revisions) {
      const next = revisions.filter(
        (revision) => new Date(revision.createdAt).getTime() >= cutoffTime,
      );
      if (next.length === 0) this.revisions.delete(path);
      else this.revisions.set(path, next);
    }
  }
}
