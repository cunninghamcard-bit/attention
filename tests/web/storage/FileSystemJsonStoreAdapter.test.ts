import { describe, expect, it } from "vitest";
import { FileSystemAdapter } from "@web/vault/FileSystemAdapter";
import { FileSystemJsonStoreAdapter } from "@web/storage/FileSystemJsonStoreAdapter";
import { JsonStore } from "@web/storage/JsonStore";

type TestFsModule = {
  mkdtemp(prefix: string): Promise<string>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  rm(path: string, options: { force: boolean; recursive: boolean }): Promise<void>;
};

type TestOsModule = {
  tmpdir(): string;
};

type TestPathModule = {
  join(...paths: string[]): string;
};

const fsPromisesSpecifier = "node:fs/promises";
const osSpecifier = "node:os";
const pathSpecifier = "node:path";

describe("FileSystemJsonStoreAdapter", () => {
  it("persists config JSON under the hidden config directory and emits JsonStore raw paths", async () => {
    const { fs, os, path, basePath } = await createTempVault();
    const adapter = new FileSystemAdapter(basePath);
    const store = new JsonStore(new FileSystemJsonStoreAdapter(adapter), ".obsidian");
    const rawPaths: string[] = [];
    store.on("raw", (rawPath) => rawPaths.push(String(rawPath)));

    await store.write("app.json", { theme: "moonstone" });

    expect(await store.read<{ theme: string }>("app.json")).toEqual({ theme: "moonstone" });
    expect(await fs.readFile(path.join(basePath, ".obsidian", "app.json"), "utf8")).toBe(
      '{\n  "theme": "moonstone"\n}',
    );
    expect(rawPaths).toEqual([".obsidian/app.json"]);
    await fs.rm(basePath, { force: true, recursive: true });
    void os;
  });

  it("preserves plugin data mtime options for external-settings change detection", async () => {
    const { fs, basePath } = await createTempVault();
    const adapter = new FileSystemAdapter(basePath);
    const store = new JsonStore(new FileSystemJsonStoreAdapter(adapter), ".obsidian");
    const mtime = Date.now() - 10_000;

    await store.write("plugins/sample/data.json", { enabled: true }, { mtime });

    const stat = await store.stat("plugins/sample/data.json");
    expect(stat).not.toBeNull();
    expect(Math.abs((stat?.mtime ?? 0) - mtime)).toBeLessThan(2_000);
    await fs.rm(basePath, { force: true, recursive: true });
  });

  it("distinguishes a corrupt json file from a missing one", async () => {
    const { fs, basePath } = await createTempVault();
    const adapter = new FileSystemAdapter(basePath);
    const store = new JsonStore(new FileSystemJsonStoreAdapter(adapter), ".obsidian");
    await store.writeText("style-settings.json", '{"theme": ');

    // A whole-document writer replaces its file from memory. If a file that exists
    // but will not parse were indistinguishable from one that is absent, that write
    // would silently destroy a hand-repairable file.
    expect(await store.read("style-settings.json")).toBeUndefined();
    expect(await store.read("never-written.json")).toBeNull();
    await fs.rm(basePath, { force: true, recursive: true });
  });

  it("lists, deletes files, and removes plugin data folders through the filesystem adapter", async () => {
    const { fs, basePath } = await createTempVault();
    const adapter = new FileSystemAdapter(basePath);
    const store = new JsonStore(new FileSystemJsonStoreAdapter(adapter), ".obsidian");
    await store.write("plugins/alpha/data.json", { alpha: true });
    await store.write("plugins/beta/data.json", { beta: true });
    await store.writeText("snippets/theme.css", "body{}");

    expect(await store.list("plugins")).toEqual({ folders: ["alpha", "beta"], files: [] });

    await store.delete("plugins/alpha/data.json");
    expect(await store.read("plugins/alpha/data.json")).toBeNull();
    await store.deleteFolder("plugins/beta");
    expect(await store.read("plugins/beta/data.json")).toBeNull();
    expect(await store.readText("snippets/theme.css")).toBe("body{}");
    await fs.rm(basePath, { force: true, recursive: true });
  });
});

async function createTempVault(): Promise<{
  fs: TestFsModule;
  os: TestOsModule;
  path: TestPathModule;
  basePath: string;
}> {
  const fs = await importRuntimeModule<TestFsModule>(fsPromisesSpecifier);
  const os = await importRuntimeModule<TestOsModule>(osSpecifier);
  const path = await importRuntimeModule<TestPathModule>(pathSpecifier);
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "obsidian-reconstructed-json-"));
  return { fs, os, path, basePath };
}

async function importRuntimeModule<T>(specifier: string): Promise<T> {
  return import(/* @vite-ignore */ specifier) as Promise<T>;
}
