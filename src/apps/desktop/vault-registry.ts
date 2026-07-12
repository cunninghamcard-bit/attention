import * as fs from "node:fs";
import { basename, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import type { JsonStore } from "./json-store";
import type { ObsidianSettings } from "./settings";

/**
 * The vault registry — real symbol `P` (`C.vaults`), persisted inside
 * `obsidian.json`: `{ [vaultId]: { path, ts, open? } }`.
 *
 * Semantics reproduced from the reverse note:
 * - startup prune: resolve every path; drop entries whose folder is missing
 *   (also deleting the per-vault window-state json).
 * - `Re(name)`: id match, or case-insensitive basename match.
 * - `Ge(path)`: the vault whose root contains the given absolute path.
 * - `d(path)`: register-or-touch by resolved path; new ids are random hex.
 * - `Ke(id, open)`: `open: true` while a window is showing the vault, deleted
 *   on close, so relaunch restores the same set of windows (`ke()`).
 */
export interface VaultEntry {
  path: string;
  ts: number;
  open?: boolean;
}

export type VaultRegistryData = Record<string, VaultEntry>;

/** Real `ct(16)` — random hex id for a new vault. */
export function generateVaultId(): string {
  return randomBytes(8).toString("hex");
}

export class VaultRegistry {
  readonly vaults: VaultRegistryData;

  constructor(
    settings: ObsidianSettings,
    private readonly store: JsonStore,
    private readonly save: () => void,
  ) {
    this.vaults = settings.vaults && typeof settings.vaults === "object" ? settings.vaults : {};
    settings.vaults = this.vaults;
  }

  /**
   * Startup prune (reverse note: the loop right after `P` is loaded): resolve
   * paths, drop vaults whose folder no longer exists, delete their state file.
   */
  pruneMissing(): void {
    for (const id of Object.keys(this.vaults)) {
      const entry = this.vaults[id];
      entry.path = resolve(entry.path);
      if (!entry.path || !fs.existsSync(entry.path)) {
        delete this.vaults[id];
        this.store.remove(id);
      }
    }
  }

  /** Real `Re(name)`: vault id by exact id or case-insensitive folder basename. */
  getIdByName(name: string): string | null {
    for (const id of Object.keys(this.vaults)) {
      const path = this.vaults[id].path;
      if (id === name || basename(path).toUpperCase() === name.toUpperCase()) return id;
    }
    return null;
  }

  /** Real `xt(id)`: display name (folder basename) for a vault id. */
  getNameById(id: string): string | null {
    return this.vaults[id] ? basename(this.vaults[id].path) : null;
  }

  /** Real `Ge(path)`: the vault whose root contains `path`. */
  getIdByContainedPath(path: string): string | null {
    const resolved = resolve(path);
    for (const id of Object.keys(this.vaults)) {
      const root = resolve(this.vaults[id].path);
      if (resolved === root || resolved.startsWith(root + sep)) return id;
    }
    return null;
  }

  /**
   * Real `d(path)` (registration half — window opening is the caller's job):
   * validates the folder, reuses an existing entry (touching `ts`) or creates
   * a new id. Returns the vault id, or an error string exactly like the real
   * handler ("folder not found" / "no permission to access folder").
   */
  registerPath(path: string): { id: string } | { error: string } {
    if (!path || typeof path !== "string") return { error: "folder not found" };
    const resolved = resolve(path);
    if (!fs.existsSync(resolved)) return { error: "folder not found" };
    if (!isReadWritable(resolved)) return { error: "no permission to access folder" };
    for (const id of Object.keys(this.vaults)) {
      if (this.vaults[id].path === resolved) {
        this.vaults[id].ts = Date.now();
        this.save();
        return { id };
      }
    }
    const id = generateVaultId();
    this.vaults[id] = { path: resolved, ts: Date.now() };
    this.save();
    return { id };
  }

  /** Real `Ke(id, open)`: persist whether a window currently shows this vault. */
  setOpen(id: string, open: boolean): void {
    const entry = this.vaults[id];
    if (!entry) return;
    if (open) entry.open = true;
    else delete entry.open;
    this.save();
  }

  /**
   * Real `vault-remove` semantics: remove by path unless open; deletes the
   * per-vault state json. Returns whether the vault was removed.
   */
  removeByPath(path: string, isOpen: (id: string) => boolean): boolean {
    for (const id of Object.keys(this.vaults)) {
      if (this.vaults[id].path === path) {
        if (isOpen(id)) return false;
        delete this.vaults[id];
        this.save();
        this.store.remove(id);
        return true;
      }
    }
    return false;
  }

  /**
   * Real `vault-move` semantics: rename the folder on disk unless open.
   * Returns "" on success, "EVAULTOPEN" if a window has it open, an error
   * string if the rename failed, or `false` when the path is unknown.
   */
  moveByPath(from: string, to: string, isOpen: (id: string) => boolean): string | false {
    for (const id of Object.keys(this.vaults)) {
      const entry = this.vaults[id];
      if (entry.path === from) {
        if (isOpen(id)) return "EVAULTOPEN";
        try {
          fs.renameSync(from, to);
        } catch (error) {
          return String(error);
        }
        entry.path = to;
        this.save();
        return "";
      }
    }
    return false;
  }
}

/** Real `j(path)`: R_OK | W_OK access check. */
function isReadWritable(path: string): boolean {
  try {
    fs.accessSync(path, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
