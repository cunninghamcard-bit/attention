import { FileSystemAdapter } from "../vault/FileSystemAdapter";
import type { JsonStoreAdapter, JsonStoreStat, JsonStoreWriteOptions } from "./JsonStore";

export class FileSystemJsonStoreAdapter implements JsonStoreAdapter {
  constructor(readonly adapter: FileSystemAdapter) {}

  async readJson<T>(path: string): Promise<T | null | undefined> {
    const text = await this.readText(path);
    if (text == null) return null;
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      // `undefined` is a file that exists but could not be parsed; `null` is one
      // that is not there. Callers that write the whole document back rely on the
      // difference to avoid replacing a recoverable file with defaults.
      console.error("failed to read JSON", path, error);
      return undefined;
    }
  }

  async writeJson<T>(path: string, value: T, options?: JsonStoreWriteOptions): Promise<void> {
    await this.adapter.write(path, JSON.stringify(value, undefined, 2), options);
  }

  async readText(path: string): Promise<string | null> {
    try {
      return await this.adapter.read(path);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async writeText(path: string, value: string, options?: JsonStoreWriteOptions): Promise<void> {
    await this.adapter.write(path, value, options);
  }

  async list(path: string): Promise<{ folders: string[]; files: string[] }> {
    // A config subfolder that was never created (e.g. `.obsidian/themes` on a
    // fresh vault) lists as empty, like real Obsidian.
    let listed: { folders: string[]; files: string[] };
    try {
      listed = await this.adapter.list(path);
    } catch (error) {
      if (isNotFoundError(error)) return { folders: [], files: [] };
      throw error;
    }
    const prefix = normalizeStorePath(path);
    const folders = new Set<string>();
    const files = new Set<string>();
    for (const folder of listed.folders) {
      const child = directChildName(prefix, folder);
      if (child) folders.add(child);
    }
    for (const file of listed.files) {
      const child = directFileName(prefix, file);
      if (child) files.add(child);
    }
    return { folders: [...folders], files: [...files] };
  }

  async stat(path: string): Promise<JsonStoreStat | null> {
    const stat = await this.adapter.stat(path);
    return stat?.mtime == null ? null : { mtime: stat.mtime };
  }

  async delete(path: string): Promise<void> {
    if (!(await this.adapter.exists(path))) return;
    await this.adapter.remove(path);
  }

  async deleteFolder(path: string): Promise<void> {
    if (!(await this.adapter.exists(path))) return;
    await this.adapter.rmdir(path, true);
  }
}

function normalizeStorePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function directChildName(parent: string, path: string): string | null {
  const normalized = normalizeStorePath(path);
  const rest = parent
    ? normalized.startsWith(`${parent}/`)
      ? normalized.slice(parent.length + 1)
      : ""
    : normalized;
  if (!rest) return null;
  const slash = rest.indexOf("/");
  return slash === -1 ? rest : rest.slice(0, slash);
}

function directFileName(parent: string, path: string): string | null {
  const normalized = normalizeStorePath(path);
  const rest = parent
    ? normalized.startsWith(`${parent}/`)
      ? normalized.slice(parent.length + 1)
      : ""
    : normalized;
  return rest && !rest.includes("/") ? rest : null;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
