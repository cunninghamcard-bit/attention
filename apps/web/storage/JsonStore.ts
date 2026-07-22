import { Events } from "../core/Events";

export interface JsonStoreWriteOptions {
  mtime?: number;
}

export interface JsonStoreStat {
  mtime: number;
}

export interface JsonStoreAdapter {
  /** `null` when the file is missing, `undefined` when it exists but will not parse. */
  readJson<T>(path: string): Promise<T | null | undefined>;
  writeJson<T>(path: string, value: T, options?: JsonStoreWriteOptions): Promise<void>;
  readText?(path: string): Promise<string | null>;
  writeText?(path: string, value: string, options?: JsonStoreWriteOptions): Promise<void>;
  list?(path: string): Promise<{ folders: string[]; files: string[] }>;
  stat?(path: string): Promise<JsonStoreStat | null>;
  delete(path: string): Promise<void>;
  deleteFolder?(path: string): Promise<void>;
}

export class MemoryJsonStoreAdapter implements JsonStoreAdapter {
  private jsonValues = new Map<string, unknown>();
  private textValues = new Map<string, string>();
  private mtimes = new Map<string, number>();

  async readJson<T>(path: string): Promise<T | null> {
    return this.jsonValues.has(path) ? (structuredClone(this.jsonValues.get(path)) as T) : null;
  }

  async writeJson<T>(path: string, value: T, options?: JsonStoreWriteOptions): Promise<void> {
    this.jsonValues.set(path, structuredClone(value));
    this.touch(path, options?.mtime);
  }

  async readText(path: string): Promise<string | null> {
    return this.textValues.get(path) ?? null;
  }

  async writeText(path: string, value: string, options?: JsonStoreWriteOptions): Promise<void> {
    this.textValues.set(path, value);
    this.touch(path, options?.mtime);
  }

  async list(path: string): Promise<{ folders: string[]; files: string[] }> {
    const folders = new Set<string>();
    const files = new Set<string>();
    const prefix = path.endsWith("/") ? path : `${path}/`;
    for (const file of [...this.jsonValues.keys(), ...this.textValues.keys()]) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) files.add(rest);
      else folders.add(rest.slice(0, slash));
    }
    return { folders: [...folders], files: [...files] };
  }

  async stat(path: string): Promise<JsonStoreStat | null> {
    return this.jsonValues.has(path) || this.textValues.has(path)
      ? { mtime: this.mtimes.get(path) ?? 0 }
      : null;
  }

  async delete(path: string): Promise<void> {
    this.jsonValues.delete(path);
    this.textValues.delete(path);
    this.mtimes.delete(path);
  }

  async deleteFolder(path: string): Promise<void> {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    // oxlint-disable-next-line unicorn/no-useless-spread -- Prefix cleanup deletes entries during iteration, so use a stable key snapshot.
    for (const file of [...this.jsonValues.keys()]) {
      if (file === path || file.startsWith(prefix)) this.jsonValues.delete(file);
      if (file === path || file.startsWith(prefix)) this.mtimes.delete(file);
    }
    // oxlint-disable-next-line unicorn/no-useless-spread -- Prefix cleanup deletes entries during iteration, so use a stable key snapshot.
    for (const file of [...this.textValues.keys()]) {
      if (file === path || file.startsWith(prefix)) this.textValues.delete(file);
      if (file === path || file.startsWith(prefix)) this.mtimes.delete(file);
    }
  }

  private touch(path: string, mtime?: number): void {
    if (mtime !== undefined) {
      this.mtimes.set(path, mtime);
      return;
    }
    this.mtimes.set(path, Math.max(Date.now(), (this.mtimes.get(path) ?? 0) + 1));
  }
}

export class JsonStore extends Events {
  constructor(
    readonly adapter: JsonStoreAdapter = new MemoryJsonStoreAdapter(),
    public root = ".obsidian",
  ) {
    super();
  }

  setRoot(root: string): void {
    this.root = root || ".obsidian";
  }

  path(name: string): string {
    const normalized = name.replace(/\\/g, "/").replace(/^\/+/, "");
    return normalized === this.root || normalized.startsWith(`${this.root}/`)
      ? normalized
      : `${this.root}/${normalized}`;
  }

  read<T>(name: string): Promise<T | null | undefined> {
    return this.adapter.readJson<T>(this.path(name));
  }

  async write<T>(name: string, value: T, options?: JsonStoreWriteOptions): Promise<void> {
    const path = this.path(name);
    await this.adapter.writeJson(path, value, options);
    this.trigger("raw", path);
  }

  async readText(name: string): Promise<string | null> {
    return this.adapter.readText?.(this.path(name)) ?? null;
  }

  async writeText(name: string, value: string, options?: JsonStoreWriteOptions): Promise<void> {
    if (!this.adapter.writeText) throw new Error("JsonStore adapter does not support text files");
    const path = this.path(name);
    await this.adapter.writeText(path, value, options);
    this.trigger("raw", path);
  }

  async list(name: string): Promise<{ folders: string[]; files: string[] }> {
    return this.adapter.list?.(this.path(name)) ?? { folders: [], files: [] };
  }

  async stat(name: string): Promise<JsonStoreStat | null> {
    return this.adapter.stat?.(this.path(name)) ?? null;
  }

  delete(name: string): Promise<void> {
    const path = this.path(name);
    return this.adapter.delete(path).then(() => this.trigger("raw", path));
  }

  async deleteFolder(name: string): Promise<void> {
    const path = this.path(name);
    if (this.adapter.deleteFolder) {
      await this.adapter.deleteFolder(path);
      this.trigger("raw", path);
      return;
    }
    await this.delete(name);
  }
}
