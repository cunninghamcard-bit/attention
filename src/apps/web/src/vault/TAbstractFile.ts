import type { Vault } from "./Vault";

export abstract class TAbstractFile {
  vault: Vault;
  deleted = false;
  private _path = "";
  name = "";
  parent: TFolder | null;

  constructor(vault: Vault, path: string, parent: TFolder | null = null) {
    this.vault = vault;
    this.parent = parent;
    this.path = path;
  }

  get path(): string {
    return this._path;
  }

  set path(path: string) {
    this._path = path;
    this.name = path.split("/").pop() ?? path;
  }

  setPath(path: string): void {
    this.path = path;
  }

  get parentPath(): string {
    const index = this.path.lastIndexOf("/");
    return index === -1 ? "" : this.path.slice(0, index);
  }

  getNewPathAfterRename(name: string): string {
    name = name.replace(/[\x00-\x1F]/g, " ").trim();
    const parentPrefix = this.parentPath ? `${this.parentPath}/` : "";
    return `${parentPrefix}${name}`;
  }
}

export interface FileStats {
  ctime: number;
  mtime: number;
  size: number;
}

export class TFile extends TAbstractFile {
  saving = false;
  stat: FileStats;

  constructor(vault: Vault, path: string, stat?: FileStats, parent: TFolder | null = null) {
    super(vault, path, parent);
    this.stat = stat ?? createFileStats(0);
  }

  get extension(): string {
    const index = this.name.lastIndexOf(".");
    return index <= 0 || index === this.name.length - 1 ? "" : this.name.slice(index + 1).toLowerCase();
  }

  get basename(): string {
    const index = this.name.lastIndexOf(".");
    return index <= 0 || index === this.name.length - 1 ? this.name : this.name.slice(0, index);
  }

  getShortName(): string {
    return this.extension === "md" ? this.basename : this.name;
  }

  override getNewPathAfterRename(name: string): string {
    name = name.replace(/[\x00-\x1F]/g, " ").trim();
    return super.getNewPathAfterRename(this.extension ? `${name}.${this.extension}` : name);
  }

  cache(data: string | null | undefined): void {
    if (data == null) {
      fileCache.delete(this);
      return;
    }
    if (data.length <= this.vault.cacheLimit) fileCache.set(this, data);
    else fileCache.delete(this);
  }

  hasCachedData(): boolean {
    return fileCache.has(this);
  }

  getCachedData(): string | undefined {
    return fileCache.get(this);
  }

  updateCacheLimit(): void {
    const cached = fileCache.get(this);
    if (cached !== undefined && cached.length > this.vault.cacheLimit) fileCache.delete(this);
  }

  toString(): string {
    return this.path;
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];

  constructor(vault: Vault, path: string, parent: TFolder | null = null) {
    super(vault, path, parent);
  }

  isRoot(): boolean {
    return this.parent === null && this.path === "/";
  }

  getParentPrefix(): string {
    return this.isRoot() ? "" : `${this.path}/`;
  }

  getFileCount(): number {
    return this.children.reduce((count, child) => count + (child instanceof TFolder ? child.getFileCount() : 1), 0);
  }

  getFolderCount(): number {
    return this.children.reduce((count, child) => count + (child instanceof TFolder ? 1 + child.getFolderCount() : 0), 0);
  }
}

const fileCache = new WeakMap<TFile, string>();

function createFileStats(size: number): FileStats {
  const now = Date.now();
  return { ctime: now, mtime: now, size };
}
