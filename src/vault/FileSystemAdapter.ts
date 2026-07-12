import { DataAdapter, type DataAdapterWatchHandler, type DataWriteOptions, type ListedFiles, type Stat } from "./DataAdapter";
import { Platform } from "../platform/Platform";

type FileSystemModule = {
  access(path: string): Promise<void>;
  copyFile(path: string, newPath: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  readdir(path: string, options: { withFileTypes: true }): Promise<DirEntry[]>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options?: { force?: boolean; maxRetries?: number; recursive?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  stat(path: string): Promise<FileSystemStat>;
  unlink(path: string): Promise<void>;
  utimes(path: string, atime: Date, mtime: Date): Promise<void>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
};

type WatchModule = {
  watch(path: string, options: { recursive?: boolean }, listener: (eventType: string, filename: unknown) => void): FileSystemWatcher;
};

type PathModule = {
  basename(path: string, suffix?: string): string;
  dirname(path: string): string;
  extname(path: string): string;
  join(...paths: string[]): string;
  relative(from: string, to: string): string;
};

type DirEntry = {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
};

type FileSystemStat = {
  birthtimeMs: number;
  mtimeMs: number;
  size: number;
  isDirectory(): boolean;
  isFile(): boolean;
};

type FileSystemEntry = {
  path: string;
  realpath: string;
  type: "file" | "folder";
  ctime?: number;
  mtime?: number;
  size?: number;
};

type FileSystemWatcher = {
  close(): void;
};

type DesktopModules = {
  fs: FileSystemModule;
  path: PathModule;
};

type ElectronIpcRenderer = {
  sendSync(channel: "trash", path: string): unknown;
};

type ElectronHost = typeof globalThis & {
  electron?: {
    ipcRenderer?: ElectronIpcRenderer;
  };
};

const fsPromisesSpecifier = "node:fs/promises";
const fsSpecifier = "node:fs";
const pathSpecifier = "node:path";

export class FileSystemAdapter extends DataAdapter {
  readonly supportsEvents = true;
  private desktopModules?: Promise<DesktopModules>;
  private watchModule?: Promise<WatchModule>;
  private files = new Map<string, FileSystemEntry>();
  private watchers: FileSystemWatcher[] = [];
  private hiddenWatchers: FileSystemWatcher[] = [];
  private externalReconcileTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private hiddenRawTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(readonly basePath: string) {
    super();
  }

  static async readLocalFile(path: string): Promise<ArrayBuffer> {
    const fs = await loadFileSystemModule();
    const data = await fs.readFile(path);
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
  }

  static async mkdir(path: string): Promise<void> {
    const fs = await loadFileSystemModule();
    await fs.mkdir(path, { recursive: true });
  }

  getFullPath(path: string): string {
    const realPath = this.getRealPath(path);
    return realPath !== "/" && isFullFilesystemPath(realPath) ? realPath : this.getFullRealPath(realPath);
  }

  private getFullRealPath(path: string): string {
    const base = this.basePath.replace(/[\\/]+$/, "");
    const vaultPath = normalizeVaultPath(path);
    return vaultPath === "/" ? base : `${base}/${vaultPath}`;
  }

  private getRealPath(path: string): string {
    const normalized = normalizeVaultPath(path);
    for (let parentPath: string | null = normalized; parentPath; parentPath = getParentVaultPath(parentPath)) {
      const entry = this.files.get(parentPath);
      if (!entry) continue;
      return `${entry.realpath}${normalized.slice(parentPath.length)}`;
    }
    return normalized;
  }

  override getName(): string {
    return this.basePath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || this.basePath;
  }

  getBasePath(): string {
    return this.basePath;
  }

  getFilePath(path: string): string {
    return pathToFileUrl(this.getFullPath(path));
  }

  getResourcePath(path: string): string {
    const normalized = normalizeVaultPath(path);
    const entry = this.files.get(normalized);
    const version = entry?.type === "file" && entry.mtime ? entry.mtime : Date.now();
    let resourcePath = this.getFilePath(normalized);
    if (resourcePath.startsWith("file:///")) resourcePath = resourcePath.substring(8);
    else if (resourcePath.startsWith("file://")) resourcePath = `%5C%5C${resourcePath.substring(7)}`;
    return `${Platform.resourcePathPrefix}${resourcePath}?${version}`;
  }

  resolvePath(urlOrPath: string): string | null {
    const fullPath = decodeFileUrlOrPath(urlOrPath);
    if (!fullPath) return null;
    const base = normalizeFilesystemPath(this.basePath);
    const candidate = normalizeFilesystemPath(fullPath);
    const relative = candidate === base ? "" : candidate.startsWith(`${base}/`) ? candidate.slice(base.length + 1) : null;
    return relative === null ? null : normalizeVaultPath(relative);
  }

  async read(path: string): Promise<string> {
    const { fs } = await this.loadDesktopModules();
    return fs.readFile(this.getFullPath(path), "utf8");
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const { fs } = await this.loadDesktopModules();
    const data = await fs.readFile(this.getFullPath(path));
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
  }

  async write(path: string, data: string, options?: DataWriteOptions): Promise<void> {
    const { fs, path: pathModule } = await this.loadDesktopModules();
    const fullPath = this.getFullPath(path);
    try {
      await fs.mkdir(pathModule.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, data, "utf8");
      if (options?.mtime !== undefined) {
        const mtime = new Date(options.mtime);
        await fs.utimes(fullPath, mtime, mtime);
      }
      options?.immediate?.();
    } finally {
      await this.reconcileInternalFile(path);
    }
  }

  async writeBinary(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    const { fs, path: pathModule } = await this.loadDesktopModules();
    const fullPath = this.getFullPath(path);
    try {
      await fs.mkdir(pathModule.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, new Uint8Array(data));
      if (options?.mtime !== undefined) {
        const mtime = new Date(options.mtime);
        await fs.utimes(fullPath, mtime, mtime);
      }
      options?.immediate?.();
    } finally {
      await this.reconcileInternalFile(path);
    }
  }

  async delete(path: string): Promise<void> {
    const { fs } = await this.loadDesktopModules();
    await fs.rm(this.getFullPath(path), { force: true, maxRetries: 5, recursive: true });
    await this.reconcileInternalFile(path);
  }

  async exists(path: string, sensitive = false): Promise<boolean> {
    const { fs, path: pathModule } = await this.loadDesktopModules();
    const fullPath = this.getFullPath(path);
    if (!await this.existsFullPath(fullPath, fs)) return false;
    if (!sensitive) return true;
    try {
      const entries = await fs.readdir(pathModule.dirname(fullPath), { withFileTypes: true });
      return entries.some((entry) => entry.name === pathModule.basename(fullPath));
    } catch {
      return false;
    }
  }

  override async stat(path: string): Promise<Stat | null> {
    const entry = await this.readEntry(path);
    if (!entry) return null;
    return {
      type: entry.type,
      ctime: entry.ctime ?? Date.now(),
      mtime: entry.mtime ?? Date.now(),
      size: entry.size ?? 0,
    };
  }

  override async append(path: string, data: string, options?: DataWriteOptions): Promise<void> {
    await this.write(path, `${await this.read(path)}${data}`, options);
  }

  override async appendBinary(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void> {
    const current = await this.readBinary(path);
    const merged = new Uint8Array(current.byteLength + data.byteLength);
    merged.set(new Uint8Array(current), 0);
    merged.set(new Uint8Array(data), current.byteLength);
    await this.writeBinary(path, merged.buffer, options);
  }

  override async process(path: string, fn: (data: string) => string, options?: DataWriteOptions): Promise<string> {
    return super.process(path, fn, options);
  }

  async mkdir(path: string): Promise<void> {
    const { fs } = await this.loadDesktopModules();
    await fs.mkdir(this.getFullPath(path), { recursive: true });
    await this.reconcileInternalFile(path);
  }

  async list(path: string): Promise<ListedFiles> {
    const modules = await this.loadDesktopModules();
    const root = this.getFullPath(path);

    const result: ListedFiles = { files: [], folders: [] };
    const entries = await modules.fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = modules.path.join(root, entry.name);
      const vaultPath = this.toVaultPath(fullPath, modules.path);
      if (!path.startsWith(".") && this.isHiddenPath(vaultPath)) continue;
      if (entry.isDirectory()) result.folders.push(vaultPath);
      else if (entry.isFile()) result.files.push(vaultPath);
    }
    return result;
  }

  async rename(path: string, newPath: string): Promise<void> {
    if (path === newPath) return;
    if (await this.renameDestinationExists(path, newPath)) throw new Error("Destination file already exists!");
    const { fs } = await this.loadDesktopModules();
    await this.primePath(path);
    await fs.rename(this.getFullPath(path), this.getFullPath(newPath));
    this.renameIndexedEntries(path, newPath);
  }

  override async copy(path: string, newPath: string): Promise<void> {
    const { fs, path: pathModule } = await this.loadDesktopModules();
    await this.copyRecursive(this.getFullPath(path), this.getFullPath(newPath), fs, pathModule);
    await this.reconcileInternalFile(newPath);
  }

  async remove(path: string): Promise<void> {
    const { fs } = await this.loadDesktopModules();
    await fs.unlink(this.getFullPath(path));
    await this.reconcileInternalFile(path);
  }

  async rmdir(path: string, recursive = false): Promise<void> {
    const { fs } = await this.loadDesktopModules();
    if (recursive) await fs.rm(this.getFullPath(path), { maxRetries: 5, recursive: true });
    else await fs.rmdir(this.getFullPath(path));
    await this.reconcileInternalFile(path);
  }

  async trashSystem(path: string): Promise<boolean> {
    const ipcRenderer = this.getElectronIpcRenderer();
    if (!ipcRenderer) return false;
    if (!ipcRenderer.sendSync("trash", this.getFullPath(path))) return false;
    await this.reconcileInternalFile(path);
    return true;
  }

  async trashLocal(path: string): Promise<void> {
    const { fs, path: pathModule } = await this.loadDesktopModules();
    const sourcePath = this.getFullPath(path);
    const trashPath = this.getFullPath(".trash");
    await fs.mkdir(trashPath, { recursive: true });

    const extension = pathModule.extname(sourcePath);
    const basename = pathModule.basename(sourcePath, extension);
    let candidatePath = pathModule.join(trashPath, `${basename}${extension}`);
    let index = 1;
    while (await this.existsFullPath(candidatePath, fs)) {
      index += 1;
      candidatePath = pathModule.join(trashPath, `${basename} ${index}${extension}`);
    }
    await fs.rename(sourcePath, candidatePath);
    await this.reconcileInternalFile(path);
  }

  override async load(): Promise<void> {
    await this.reconcileInternalFile("");
  }

  override async watch(handler: DataAdapterWatchHandler): Promise<() => void> {
    const unwatchEvents = await super.watch(handler);
    await this.startWatchPath("");
    await this.load();
    return () => {
      unwatchEvents();
      for (const timer of this.externalReconcileTimers.values()) clearTimeout(timer);
      this.externalReconcileTimers.clear();
      for (const watcher of this.watchers.splice(0)) watcher.close();
    };
  }

  async watchHiddenRecursive(path: string): Promise<() => void> {
    if (this.usesRecursiveWatcher()) return () => {};
    const normalized = normalizeVaultPath(path);
    await this.startHiddenWatchPath(normalized);
    await this.watchHiddenChildFolders(normalized);
    return () => {
      for (const timer of this.hiddenRawTimers.values()) clearTimeout(timer);
      this.hiddenRawTimers.clear();
      for (const watcher of this.hiddenWatchers.splice(0)) watcher.close();
    };
  }

  async reconcileInternalFile(path: string): Promise<void> {
    const normalized = normalizeVaultPath(path);
    this.trigger("raw", normalized);
    if (this.isHiddenPath(normalized)) return;
    const entry = await this.readEntry(normalized);
    await this.reconcileFile(normalized, entry);
  }

  private async loadDesktopModules(): Promise<DesktopModules> {
    this.desktopModules ??= Promise.all([
      loadNodeModule<FileSystemModule>(fsPromisesSpecifier),
      loadNodeModule<PathModule>(pathSpecifier),
    ]).then(([fs, path]) => ({ fs, path }));
    return this.desktopModules;
  }

  private async loadWatchModule(): Promise<WatchModule> {
    this.watchModule ??= loadNodeModule<WatchModule>(fsSpecifier);
    return this.watchModule;
  }

  private async existsFullPath(path: string, fs: FileSystemModule): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async copyRecursive(sourcePath: string, destinationPath: string, fs: FileSystemModule, pathModule: PathModule): Promise<void> {
    const stat = await fs.stat(sourcePath);
    if (stat.isFile()) {
      if (await this.existsFullPath(destinationPath, fs)) throw new Error(`File already exists: ${destinationPath}`);
      await fs.copyFile(sourcePath, destinationPath);
      return;
    }
    if (!stat.isDirectory()) return;
    await fs.mkdir(destinationPath, { recursive: true });
    for (const entry of await fs.readdir(sourcePath, { withFileTypes: true })) {
      await this.copyRecursive(pathModule.join(sourcePath, entry.name), pathModule.join(destinationPath, entry.name), fs, pathModule);
    }
  }

  private getElectronIpcRenderer(): ElectronIpcRenderer | null {
    const host = globalThis as ElectronHost;
    return host.electron?.ipcRenderer ?? null;
  }

  private toVaultPath(fullPath: string, pathModule: PathModule): string {
    return pathModule.relative(this.getFullPath(""), fullPath).replace(/\\/g, "/");
  }

  private async readEntry(path: string): Promise<FileSystemEntry | null> {
    const { fs } = await this.loadDesktopModules();
    const normalized = normalizeVaultPath(path);
    const fullPath = this.getFullPath(normalized);
    let stat: FileSystemStat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      return null;
    }
    const type = stat.isDirectory() ? "folder" : stat.isFile() ? "file" : null;
    if (!type) return null;
    if (type === "folder") return { path: normalized, realpath: fullPath, type };
    return {
      path: normalized,
      realpath: fullPath,
      type,
      ctime: Math.round(stat.birthtimeMs),
      mtime: Math.round(stat.mtimeMs),
      size: stat.size,
    };
  }

  private async reconcileFile(path: string, entry: FileSystemEntry | null): Promise<void> {
    const previous = this.files.get(path);
    if (!entry) {
      if (!previous) return;
      this.removeIndexedEntry(path, previous.type);
      return;
    }

    if (!previous) {
      this.files.set(path, entry);
      this.trigger(entry.type === "folder" ? "folder-created" : "file-created", path, entry.type === "file" ? entry : undefined);
      if (entry.type === "folder") {
        if (!this.usesRecursiveWatcher()) await this.startWatchPath(path);
        await this.reconcileFolderChildren(path);
      }
      return;
    }

    if (previous.type !== entry.type) {
      this.removeIndexedEntry(path, previous.type);
      this.files.set(path, entry);
      this.trigger(entry.type === "folder" ? "folder-created" : "file-created", path, entry.type === "file" ? entry : undefined);
      if (entry.type === "folder") {
        if (!this.usesRecursiveWatcher()) await this.startWatchPath(path);
        await this.reconcileFolderChildren(path);
      }
      return;
    }

    this.files.set(path, entry);
    if (entry.type === "file" && (previous.mtime !== entry.mtime || previous.size !== entry.size)) this.trigger("modified", path, entry);
  }

  private removeIndexedEntry(path: string, type: "file" | "folder"): void {
    const descendants = type === "folder"
      ? [...this.files.entries()].filter(([item]) => item === path || item.startsWith(`${path}/`))
      : [[path, this.files.get(path)] as [string, FileSystemEntry | undefined]];
    for (const [descendant, entry] of descendants.sort(([a], [b]) => b.length - a.length)) {
      this.files.delete(descendant);
      if (entry) this.trigger(entry.type === "folder" ? "folder-removed" : "file-removed", descendant);
    }
  }

  private async reconcileFolderChildren(path: string): Promise<void> {
    const listed = await this.list(path);
    const folders = [...listed.folders].sort((a, b) => a.length - b.length);
    const files = [...listed.files].sort((a, b) => a.length - b.length);
    for (const folder of folders) await this.reconcileInternalFile(folder);
    for (const file of files) await this.reconcileInternalFile(file);
  }

  private async startWatchPath(path: string): Promise<void> {
    const modules = await this.loadDesktopModules();
    const fs = await this.loadWatchModule();
    try {
      const watcher = fs.watch(this.getFullPath(path), { recursive: this.usesRecursiveWatcher() }, (_eventType, filename) => {
        if (filename == null) return;
        const changedPath = normalizeVaultPath(modules.path.join(path, String(filename)));
        this.onExternalFileChange(changedPath);
      });
      this.watchers.push(watcher);
    } catch {
      // Some runtimes do not support recursive fs.watch. Obsidian falls back per platform;
      // this reconstruction keeps explicit reconcileInternalFile as the reliable path.
    }
  }

  private onExternalFileChange(path: string): void {
    const normalized = normalizeVaultPath(path);
    clearTimeout(this.externalReconcileTimers.get(normalized));
    this.externalReconcileTimers.set(normalized, setTimeout(() => {
      this.externalReconcileTimers.delete(normalized);
      void this.reconcileInternalFile(normalized);
    }, 100));
  }

  private async startHiddenWatchPath(path: string): Promise<void> {
    const modules = await this.loadDesktopModules();
    const fs = await this.loadWatchModule();
    const fullPath = this.getFullPath(path);
    if (!await this.existsFullPath(fullPath, modules.fs)) return;
    try {
      const watcher = fs.watch(fullPath, { recursive: false }, (_eventType, filename) => {
        if (filename == null) return;
        const changedPath = normalizeVaultPath(modules.path.join(path, String(filename)));
        this.onHiddenFileChange(changedPath);
      });
      this.hiddenWatchers.push(watcher);
    } catch {
      // Hidden config watching is best-effort in this reconstruction; explicit JsonStore writes still emit raw.
    }
  }

  private async watchHiddenChildFolders(path: string): Promise<void> {
    const modules = await this.loadDesktopModules();
    const fullPath = this.getFullPath(path);
    if (!await this.existsFullPath(fullPath, modules.fs)) return;
    const listed = await this.list(path);
    for (const folder of listed.folders) await this.startHiddenWatchPath(folder);
  }

  private onHiddenFileChange(path: string): void {
    const normalized = normalizeVaultPath(path);
    clearTimeout(this.hiddenRawTimers.get(normalized));
    this.hiddenRawTimers.set(normalized, setTimeout(() => {
      this.hiddenRawTimers.delete(normalized);
      this.trigger("raw", normalized);
    }, 100));
  }

  private isHiddenPath(path: string): boolean {
    return path.split("/").some((segment) => segment.startsWith("."));
  }

  private usesRecursiveWatcher(): boolean {
    const platform = (globalThis as { process?: { platform?: string } }).process?.platform;
    return platform === "darwin" || platform === "win32";
  }

  private async primePath(path: string): Promise<void> {
    const normalized = normalizeVaultPath(path);
    const entry = await this.readEntry(normalized);
    if (!entry) return;
    this.files.set(normalized, entry);
    if (entry.type !== "folder") return;
    const listed = await this.list(normalized);
    for (const folder of listed.folders) {
      const folderEntry = await this.readEntry(folder);
      if (folderEntry) this.files.set(folder, folderEntry);
    }
    for (const file of listed.files) {
      const fileEntry = await this.readEntry(file);
      if (fileEntry) this.files.set(file, fileEntry);
    }
  }

  private renameIndexedEntries(path: string, newPath: string): void {
    const oldRoot = normalizeVaultPath(path);
    const newRoot = normalizeVaultPath(newPath);
    const entries = [...this.files.values()]
      .filter((entry) => entry.path === oldRoot || entry.path.startsWith(`${oldRoot}/`))
      .sort((a, b) => a.path.length - b.path.length);
    for (const entry of entries) this.files.delete(entry.path);
    for (const entry of entries) {
      const oldPath = entry.path;
      const suffix = oldPath === oldRoot ? "" : oldPath.slice(oldRoot.length + 1);
      entry.path = suffix ? `${newRoot}/${suffix}` : newRoot;
      entry.realpath = this.getFullPath(entry.path);
      this.files.set(entry.path, entry);
      this.trigger("renamed", entry.path, oldPath);
    }
  }
}

/**
 * Load a Node builtin. Under Electron's renderer, ESM `import()` cannot resolve
 * `node:` specifiers, but a CommonJS `require` is injected when the window runs
 * with nodeIntegration (as real Obsidian's renderer does), so prefer it. Fall
 * back to dynamic `import()` for other Node ESM hosts (e.g. tests).
 */
function loadNodeModule<T>(specifier: string): Promise<T> {
  const nodeRequire = (globalThis as { require?: (id: string) => unknown }).require;
  if (typeof nodeRequire === "function") {
    return Promise.resolve(nodeRequire(specifier) as T);
  }
  return import(/* @vite-ignore */ specifier) as Promise<T>;
}

async function loadFileSystemModule(): Promise<FileSystemModule> {
  return loadNodeModule<FileSystemModule>(fsPromisesSpecifier);
}

function normalizeVaultPath(path: string): string {
  const normalized = path.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
  return (normalized === "" ? "/" : normalized).replace(/[\u00a0\u202f]/g, " ").normalize("NFC");
}

function getParentVaultPath(path: string): string | null {
  const index = path.lastIndexOf("/");
  return index === -1 ? null : path.slice(0, index);
}

function decodeFileUrlOrPath(urlOrPath: string): string | null {
  if (urlOrPath.startsWith("file://") || urlOrPath.startsWith(Platform.resourcePathPrefix)) {
    try {
      return decodeURIComponent(new URL(urlOrPath).pathname);
    } catch {
      return null;
    }
  }
  return urlOrPath.startsWith("/") ? urlOrPath : null;
}

function normalizeFilesystemPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isFullFilesystemPath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("//") || /^[A-Za-z]:\//.test(path);
}

function pathToFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("//")) return `file://${encodeFileUrlPath(normalized.slice(2))}`;
  return `file://${encodeFileUrlPath(normalized.startsWith("/") ? normalized : `/${normalized}`)}`;
}

function encodeFileUrlPath(path: string): string {
  return path.split("/").map((segment) => /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)).join("/");
}
