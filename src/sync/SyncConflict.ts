export interface SyncConflict<T = string> {
  path: string;
  local: T;
  remote: T;
  base?: T;
  reason: "both-modified" | "deleted-remotely" | "deleted-locally" | "version-skew";
}

export type ConflictResolution<T = string> =
  | { strategy: "use-local"; value: T }
  | { strategy: "use-remote"; value: T }
  | { strategy: "keep-both"; localPath: string; remotePath: string }
  | { strategy: "manual" };

export class SyncConflictResolver {
  resolve<T>(conflict: SyncConflict<T>, strategy: ConflictResolution<T>["strategy"]): ConflictResolution<T> {
    if (strategy === "use-local") return { strategy, value: conflict.local };
    if (strategy === "use-remote") return { strategy, value: conflict.remote };
    if (strategy === "keep-both") return { strategy, localPath: conflict.path, remotePath: `${conflict.path}.remote` };
    return { strategy: "manual" };
  }
}
