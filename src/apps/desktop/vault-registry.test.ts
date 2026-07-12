import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { JsonStore } from "./json-store";
import { loadSettings, saveSettings, type ObsidianSettings } from "./settings";
import { VaultRegistry, generateVaultId } from "./vault-registry";

let dir: string;
let userData: string;
let store: JsonStore;
let settings: ObsidianSettings;
let save: ReturnType<typeof vi.fn<() => void>>;

function makeRegistry(): VaultRegistry {
  return new VaultRegistry(settings, store, save);
}

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), "vaults-"));
  userData = join(dir, "userData");
  fs.mkdirSync(userData);
  store = new JsonStore(userData);
  settings = {};
  save = vi.fn(() => saveSettings(store, settings));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("VaultRegistry", () => {
  it("registers a folder and reuses the entry on re-register (real d)", () => {
    const vaultPath = join(dir, "My Vault");
    fs.mkdirSync(vaultPath);
    const registry = makeRegistry();

    const first = registry.registerPath(vaultPath);
    expect("id" in first && first.id).toBeTruthy();
    const id = (first as { id: string }).id;
    expect(registry.vaults[id].path).toBe(resolve(vaultPath));

    const again = registry.registerPath(vaultPath);
    expect((again as { id: string }).id).toBe(id);
    expect(Object.keys(registry.vaults)).toHaveLength(1);
    expect(save).toHaveBeenCalled();
  });

  it("rejects missing folders with the real error strings", () => {
    const registry = makeRegistry();
    expect(registry.registerPath(join(dir, "nope"))).toEqual({ error: "folder not found" });
    expect(registry.registerPath("")).toEqual({ error: "folder not found" });
  });

  it("prunes vaults whose folder disappeared, deleting their state json", () => {
    const vaultPath = join(dir, "Gone");
    fs.mkdirSync(vaultPath);
    settings.vaults = { deadbeef: { path: vaultPath, ts: 1 } };
    store.write("deadbeef", { x: 1 });
    fs.rmSync(vaultPath, { recursive: true });

    const registry = makeRegistry();
    registry.pruneMissing();

    expect(registry.vaults.deadbeef).toBeUndefined();
    expect(fs.existsSync(store.pathFor("deadbeef"))).toBe(false);
  });

  it("resolves ids by name (id or case-insensitive basename — real Re)", () => {
    const vaultPath = join(dir, "Notes");
    fs.mkdirSync(vaultPath);
    const registry = makeRegistry();
    const { id } = registry.registerPath(vaultPath) as { id: string };

    expect(registry.getIdByName(id)).toBe(id);
    expect(registry.getIdByName("notes")).toBe(id);
    expect(registry.getIdByName("NOTES")).toBe(id);
    expect(registry.getIdByName("other")).toBeNull();
    expect(registry.getNameById(id)).toBe("Notes");
  });

  it("resolves the vault containing a path (real Ge)", () => {
    const vaultPath = join(dir, "Container");
    fs.mkdirSync(vaultPath);
    const registry = makeRegistry();
    const { id } = registry.registerPath(vaultPath) as { id: string };

    expect(registry.getIdByContainedPath(join(vaultPath, "a/b.md"))).toBe(id);
    expect(registry.getIdByContainedPath(vaultPath)).toBe(id);
    expect(registry.getIdByContainedPath(dir)).toBeNull();
    // Sibling with a shared prefix must NOT match (the + sep guard).
    expect(registry.getIdByContainedPath(join(dir, "Container2"))).toBeNull();
  });

  it("tracks the open flag (real Ke) and persists via save", () => {
    const vaultPath = join(dir, "OpenMe");
    fs.mkdirSync(vaultPath);
    const registry = makeRegistry();
    const { id } = registry.registerPath(vaultPath) as { id: string };

    registry.setOpen(id, true);
    expect(registry.vaults[id].open).toBe(true);
    registry.setOpen(id, false);
    expect("open" in registry.vaults[id]).toBe(false);
  });

  it("refuses to remove or move an open vault (real vault-remove/vault-move)", () => {
    const vaultPath = join(dir, "Busy");
    fs.mkdirSync(vaultPath);
    const registry = makeRegistry();
    const { id } = registry.registerPath(vaultPath) as { id: string };
    const resolved = registry.vaults[id].path;

    expect(registry.removeByPath(resolved, () => true)).toBe(false);
    expect(registry.moveByPath(resolved, join(dir, "Moved"), () => true)).toBe("EVAULTOPEN");
    expect(registry.vaults[id]).toBeDefined();
  });

  it("moves a closed vault on disk and updates the entry", () => {
    const vaultPath = join(dir, "Old");
    const target = join(dir, "New");
    fs.mkdirSync(vaultPath);
    const registry = makeRegistry();
    const { id } = registry.registerPath(vaultPath) as { id: string };
    const resolved = registry.vaults[id].path;

    expect(registry.moveByPath(resolved, target, () => false)).toBe("");
    expect(registry.vaults[id].path).toBe(target);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(vaultPath)).toBe(false);
  });

  it("removes a closed vault and its state json", () => {
    const vaultPath = join(dir, "Removable");
    fs.mkdirSync(vaultPath);
    const registry = makeRegistry();
    const { id } = registry.registerPath(vaultPath) as { id: string };
    store.write(id, { x: 0 });

    expect(registry.removeByPath(registry.vaults[id].path, () => false)).toBe(true);
    expect(registry.vaults[id]).toBeUndefined();
    expect(fs.existsSync(store.pathFor(id))).toBe(false);
  });

  it("round-trips through obsidian.json (real C/q)", () => {
    const vaultPath = join(dir, "Persist");
    fs.mkdirSync(vaultPath);
    const registry = makeRegistry();
    const { id } = registry.registerPath(vaultPath) as { id: string };

    const reloaded = loadSettings(store);
    expect(reloaded.vaults?.[id]?.path).toBe(resolve(vaultPath));
  });

  it("generates 16-char hex ids (real ct(16))", () => {
    const id = generateVaultId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(generateVaultId()).not.toBe(id);
  });
});
