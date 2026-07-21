import { Events } from "../core/Events";
import { unregisterEventRef } from "../core/EventRefInternal";
import type {
  DataAdapter as DataAdapterPort,
  DataAdapterWatchHandler,
  DataWriteOptions,
  ListedFiles,
  Stat,
} from "@app/shared/dataAdapter";

// The value types and the port contract live once in @app/shared; re-export them
// so the renderer's many `./DataAdapter` importers keep resolving unchanged.
export type { DataAdapterWatchHandler, DataWriteOptions, ListedFiles, Stat };

const adapterWatchEvents = [
  "raw",
  "folder-created",
  "file-created",
  "modified",
  "folder-removed",
  "file-removed",
  "renamed",
  "closed",
];

export abstract class DataAdapter extends Events implements DataAdapterPort {
  private processQueues = new Map<string, Promise<unknown>>();

  getName(): string {
    return "DataAdapter";
  }

  abstract read(path: string): Promise<string>;
  abstract write(path: string, data: string, options?: DataWriteOptions): Promise<void>;
  abstract delete(path: string): Promise<void>;
  abstract exists(path: string, sensitive?: boolean): Promise<boolean>;
  abstract mkdir(path: string): Promise<void>;
  abstract list(path: string): Promise<ListedFiles>;

  async stat(path: string): Promise<Stat | null> {
    if (!(await this.exists(path))) return null;
    const data = await this.read(path);
    const now = Date.now();
    return { type: "file", ctime: now, mtime: now, size: byteLength(data) };
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    return new TextEncoder().encode(await this.read(path)).buffer;
  }

  async writeBinary(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    await this.write(path, new TextDecoder().decode(data), options);
  }

  async append(path: string, data: string, options?: DataWriteOptions): Promise<void> {
    await this.write(path, `${await this.read(path)}${data}`, options);
  }

  async appendBinary(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    await this.writeBinary(path, concatArrayBuffers(await this.readBinary(path), data), options);
  }

  async process(
    path: string,
    fn: (data: string) => string,
    options?: DataWriteOptions,
  ): Promise<string> {
    const previous = this.processQueues.get(path) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        const current = await this.read(path);
        const next = fn(current);
        if (next === current) return next;
        await this.write(path, next, options);
        return next;
      });
    this.processQueues.set(path, task);

    try {
      return await task;
    } finally {
      if (this.processQueues.get(path) === task) this.processQueues.delete(path);
    }
  }

  getResourcePath(path: string): string {
    return path;
  }

  getFullPath(path: string): string {
    return this.getResourcePath(path);
  }

  async trashSystem(_path: string): Promise<boolean> {
    return false;
  }

  async trashLocal(path: string): Promise<void> {
    await this.delete(path);
  }

  async rmdir(path: string, _recursive: boolean): Promise<void> {
    await this.delete(path);
  }

  async remove(path: string): Promise<void> {
    await this.delete(path);
  }

  async rename(path: string, newPath: string): Promise<void> {
    if (path === newPath) return;
    if (await this.renameDestinationExists(path, newPath))
      throw new Error("Destination file already exists!");
    const data = await this.readBinary(path);
    await this.writeBinary(newPath, data);
    await this.delete(path);
  }

  async copy(path: string, newPath: string): Promise<void> {
    if (await this.exists(newPath)) throw new Error(`File already exists: ${newPath}`);
    await this.writeBinary(newPath, await this.readBinary(path));
  }

  async load(): Promise<void> {}

  async watch(handler: DataAdapterWatchHandler): Promise<() => void> {
    const refs = adapterWatchEvents.map((event) =>
      this.on(event, (...args) =>
        handler(event, String(args[0] ?? ""), args[1] == null ? undefined : String(args[1])),
      ),
    );
    return () => refs.forEach((ref) => unregisterEventRef(ref));
  }

  protected async renameDestinationExists(path: string, newPath: string): Promise<boolean> {
    if (!(await this.exists(newPath))) return false;
    return !(path.toLowerCase() === newPath.toLowerCase() && !(await this.exists(newPath, true)));
  }
}

export class InMemoryAdapter extends DataAdapter {
  private files = new Map<string, Uint8Array>();
  private folders = new Set<string>([""]);
  private stats = new Map<string, Stat>([["", createStat("folder", 0)]]);

  override getName(): string {
    return "In-memory";
  }

  async read(path: string): Promise<string> {
    return new TextDecoder().decode(this.files.get(path) ?? new Uint8Array());
  }

  override async readBinary(path: string): Promise<ArrayBuffer> {
    return toArrayBuffer(this.files.get(path) ?? new Uint8Array());
  }

  async write(path: string, data: string, options?: DataWriteOptions): Promise<void> {
    const bytes = new TextEncoder().encode(data);
    this.files.set(path, bytes);
    this.ensureParentFolder(path);
    this.stats.set(path, createStat("file", bytes.byteLength, options, this.stats.get(path)));
    options?.immediate?.();
  }

  override async writeBinary(
    path: string,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<void> {
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(new Uint8Array(data));
    this.files.set(path, bytes);
    this.ensureParentFolder(path);
    this.stats.set(path, createStat("file", bytes.byteLength, options, this.stats.get(path)));
    options?.immediate?.();
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
    this.stats.delete(path);
    for (const file of [...this.files.keys()].filter((file) => file.startsWith(`${path}/`))) {
      this.files.delete(file);
      this.stats.delete(file);
    }
    for (const folder of [...this.folders].filter(
      (folder) => folder === path || folder.startsWith(`${path}/`),
    )) {
      this.folders.delete(folder);
      this.stats.delete(folder);
    }
  }

  async exists(path: string, sensitive = false): Promise<boolean> {
    if (this.files.has(path) || this.folders.has(path)) return true;
    if (sensitive) return false;
    const normalized = path.toLowerCase();
    return (
      [...this.files.keys()].some((file) => file.toLowerCase() === normalized) ||
      [...this.folders].some((folder) => folder.toLowerCase() === normalized)
    );
  }

  override async stat(path: string): Promise<Stat | null> {
    return this.stats.get(path) ?? null;
  }

  async mkdir(path: string): Promise<void> {
    this.ensureFolderPath(path);
  }

  async list(path: string): Promise<ListedFiles> {
    const prefix = path ? `${path}/` : "";
    const isDirectChild = (child: string) => {
      if (child === path || !child.startsWith(prefix)) return false;
      return !child.slice(prefix.length).includes("/");
    };
    return {
      files: [...this.files.keys()].filter(isDirectChild),
      folders: [...this.folders].filter(isDirectChild),
    };
  }

  override getResourcePath(path: string): string {
    return `memory://${encodeURIComponent(path)}`;
  }

  override async trashLocal(path: string): Promise<void> {
    await this.rename(path, this.getAvailableTrashPath(path));
  }

  override async rename(path: string, newPath: string): Promise<void> {
    if (path === newPath) return;
    if (await this.renameDestinationExists(path, newPath))
      throw new Error("Destination file already exists!");
    if (this.files.has(path)) {
      const data = this.files.get(path);
      if (data) this.files.set(newPath, data);
      this.files.delete(path);
      const stat = this.stats.get(path);
      if (stat) this.stats.set(newPath, { ...stat, mtime: Date.now() });
      this.stats.delete(path);
      this.ensureParentFolder(newPath);
      return;
    }
    if (!this.folders.has(path)) return;
    this.ensureFolderPath(newPath);
    for (const folder of [...this.folders].filter((folder) => folder.startsWith(`${path}/`))) {
      const destination = `${newPath}/${folder.slice(path.length + 1)}`;
      this.ensureFolderPath(destination);
    }
    for (const [file, data] of [...this.files.entries()].filter(([file]) =>
      file.startsWith(`${path}/`),
    )) {
      const destination = `${newPath}/${file.slice(path.length + 1)}`;
      this.files.set(destination, data);
      const stat = this.stats.get(file);
      if (stat) this.stats.set(destination, { ...stat });
    }
    await this.delete(path);
  }

  override async copy(path: string, newPath: string): Promise<void> {
    if (await this.exists(newPath)) throw new Error(`File already exists: ${newPath}`);
    const data = this.files.get(path);
    if (!data) throw new Error(`File not found: ${path}`);
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    this.files.set(newPath, copy);
    this.ensureParentFolder(newPath);
    this.stats.set(newPath, {
      ...(this.stats.get(path) ?? createStat("file", data.byteLength)),
      ctime: Date.now(),
    });
  }

  private getAvailableTrashPath(path: string): string {
    const filename = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
    const dotIndex = filename.lastIndexOf(".");
    const stem = dotIndex === -1 ? filename : filename.slice(0, dotIndex);
    const extension = dotIndex === -1 ? "" : filename.slice(dotIndex);
    let candidate = `.trash/${stem}${extension}`;
    let index = 1;
    while (this.files.has(candidate) || this.folders.has(candidate)) {
      index += 1;
      candidate = `.trash/${stem} ${index}${extension}`;
    }
    return candidate;
  }

  private ensureParentFolder(path: string): void {
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    this.ensureFolderPath(parent);
  }

  private ensureFolderPath(path: string): void {
    if (!path) {
      this.folders.add("");
      if (!this.stats.has("")) this.stats.set("", createStat("folder", 0));
      return;
    }
    const parts = path.split("/");
    for (let index = 0; index < parts.length; index += 1) {
      const folder = parts.slice(0, index + 1).join("/");
      this.folders.add(folder);
      if (!this.stats.has(folder)) this.stats.set(folder, createStat("folder", 0));
    }
  }
}

export class CapacitorAdapter extends InMemoryAdapter {
  override getName(): string {
    return "Capacitor";
  }

  override getResourcePath(path: string): string {
    return this.getFullPath(path);
  }

  override getFullPath(path: string): string {
    return `capacitor://${encodeURIComponent(path)}`;
  }
}

function createStat(
  type: "file" | "folder",
  size: number,
  options?: DataWriteOptions,
  previous?: Stat,
): Stat {
  const now = Date.now();
  return {
    type,
    ctime: options?.ctime ?? previous?.ctime ?? now,
    mtime: options?.mtime ?? now,
    size,
  };
}

function byteLength(data: string): number {
  return new TextEncoder().encode(data).byteLength;
}

function concatArrayBuffers(left: ArrayBuffer, right: ArrayBuffer): ArrayBuffer {
  const merged = new Uint8Array(left.byteLength + right.byteLength);
  merged.set(new Uint8Array(left), 0);
  merged.set(new Uint8Array(right), left.byteLength);
  return merged.buffer;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}
