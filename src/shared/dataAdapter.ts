/**
 * Native-seam port: the vault filesystem (`DataAdapter`).
 *
 * ONE definition of the disk-access contract. Unlike git/terminal this port is
 * satisfied IN-PROCESS in the renderer (`FileSystemAdapter`, node `fs`) — the
 * perf red line, never routed over IPC or the kernel. The renderer's abstract
 * `DataAdapter` base implements this interface; its value types live here so
 * there is one definition of `Stat`, `ListedFiles` and `DataWriteOptions`.
 */

export interface ListedFiles {
  files: string[];
  folders: string[];
}

export interface Stat {
  type: "file" | "folder";
  ctime: number;
  mtime: number;
  size: number;
}

export interface DataWriteOptions {
  ctime?: number;
  immediate?: () => void;
  mtime?: number;
}

export type DataAdapterWatchHandler = (event: string, path: string, oldPath?: string) => void;

export interface DataAdapter {
  getName(): string;
  read(path: string): Promise<string>;
  write(path: string, data: string, options?: DataWriteOptions): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string, sensitive?: boolean): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<ListedFiles>;
  stat(path: string): Promise<Stat | null>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>;
  getResourcePath(path: string): string;
  getFullPath(path: string): string;
  rename(path: string, newPath: string): Promise<void>;
  remove(path: string): Promise<void>;
  trashSystem(path: string): Promise<boolean>;
  trashLocal(path: string): Promise<void>;
  watch(handler: DataAdapterWatchHandler): Promise<() => void>;
}
