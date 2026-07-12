import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSystemAdapter } from "@web/vault/FileSystemAdapter";
import { TFile, TFolder } from "@web/vault/TAbstractFile";
import { Vault } from "@web/vault/Vault";

type TestFsModule = {
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  rm(path: string, options: { force: boolean; recursive: boolean }): Promise<void>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
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

describe("Vault with FileSystemAdapter events", () => {
  let basePath: string;
  let fs: TestFsModule;
  let os: TestOsModule;
  let path: TestPathModule;
  let adapter: FileSystemAdapter;
  let vault: Vault;

  beforeEach(async () => {
    fs ??= await importRuntimeModule<TestFsModule>(fsPromisesSpecifier);
    os ??= await importRuntimeModule<TestOsModule>(osSpecifier);
    path ??= await importRuntimeModule<TestPathModule>(pathSpecifier);
    basePath = await fs.mkdtemp(path.join(os.tmpdir(), "obsidian-reconstructed-vault-"));
    adapter = new FileSystemAdapter(basePath);
    vault = new Vault(adapter);
    await vault.load();
  });

  afterEach(async () => {
    vault.unload();
    await fs.rm(basePath, { force: true, recursive: true });
  });

  it("turns adapter create, modify, rename and delete events into Vault file objects", async () => {
    const seen: string[] = [];
    vault.on("create", (file) => seen.push(`create:${(file as TFile | TFolder).path}`));
    vault.on("modify", (file) => seen.push(`modify:${(file as TFile).path}`));
    vault.on("rename", (file, oldPath) =>
      seen.push(`rename:${String(oldPath)}->${(file as TFile).path}`),
    );
    vault.on("delete", (file) => seen.push(`delete:${(file as TFile).path}`));

    const file = await vault.create("Folder/Note.md", "hello");
    await vault.modify(file, "next");
    await vault.rename(file, "Folder/Renamed.md");
    await vault.delete(file, true);

    expect(vault.getFileByPath("Folder/Note.md")).toBeNull();
    expect(vault.getFileByPath("Folder/Renamed.md")).toBeNull();
    expect(seen).toEqual([
      "create:Folder",
      "create:Folder/Note.md",
      "modify:Folder/Note.md",
      "rename:Folder/Note.md->Folder/Renamed.md",
      "delete:Folder/Renamed.md",
    ]);
  });

  it("renames folder descendants through adapter renamed events", async () => {
    const folder = await vault.createFolder("Projects");
    const file = await vault.create("Projects/Plan.md", "plan");

    await vault.rename(folder, "Archive");

    expect(vault.getFolderByPath("Projects")).toBeNull();
    expect(vault.getFileByPath("Projects/Plan.md")).toBeNull();
    expect(vault.getFolderByPath("Archive")).toBe(folder);
    expect(vault.getFileByPath("Archive/Plan.md")).toBe(file);
    expect(await vault.read(file)).toBe("plan");
  });

  it("resolves adapter resource URLs back to vault files", async () => {
    const file = await vault.create("Assets/Image.png", "image");
    const resourcePath = vault.getResourcePath(file);

    expect(vault.resolveFileUrl(resourcePath)).toBe(file);
    expect(vault.resolveFilePath(resourcePath)).toBe("Assets/Image.png");
    expect(vault.resolveFileUrl(`${resourcePath}?123`)).toBe(file);
    expect(vault.resolveFilePath(`${resourcePath}?123`)).toBe("Assets/Image.png");
    expect(vault.resolveFileUrl("/tmp/outside.png")).toBeNull();
    expect(vault.resolveFilePath("/tmp/outside.png")).toBeNull();
  });

  it("treats local trash as a delete from the original Vault path", async () => {
    const deleted: string[] = [];
    vault.on("delete", (file) => deleted.push((file as TFile).path));
    const file = await vault.create("Folder/Trash.md", "trash");

    await vault.trash(file, false);

    expect(vault.getFileByPath("Folder/Trash.md")).toBeNull();
    expect(deleted).toEqual(["Folder/Trash.md"]);
    expect(await fs.readFile(path.join(basePath, ".trash", "Trash.md"), "utf8")).toBe("trash");
  });

  it("loads existing filesystem entries into the Vault object map", async () => {
    const nextBasePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "obsidian-reconstructed-existing-"),
    );
    const nextAdapter = new FileSystemAdapter(nextBasePath);
    await fs.mkdir(path.join(nextBasePath, "Existing"), { recursive: true });
    await fs.writeFile(path.join(nextBasePath, "Existing", "Nested.md"), "nested", "utf8");
    const nextVault = new Vault(nextAdapter);

    await nextVault.load();

    const folder = nextVault.getFolderByPath("Existing");
    const file = nextVault.getFileByPath("Existing/Nested.md");
    expect(folder).toBeInstanceOf(TFolder);
    expect(file).toBeInstanceOf(TFile);
    expect(await nextVault.read(file as TFile)).toBe("nested");
    nextVault.unload();
    await fs.rm(nextBasePath, { force: true, recursive: true });
  });

  it("keeps top-level files attached to the Vault root folder", async () => {
    const file = await vault.create("Root.md", "root");

    expect(vault.root.children).toContain(file);
  });

  it("keeps hidden config files out of the Vault file tree while still forwarding raw changes", async () => {
    const nextBasePath = await fs.mkdtemp(path.join(os.tmpdir(), "obsidian-reconstructed-config-"));
    await fs.mkdir(path.join(nextBasePath, ".obsidian", "plugins", "sample"), { recursive: true });
    await fs.writeFile(path.join(nextBasePath, ".obsidian", "app.json"), "{}", "utf8");
    await fs.writeFile(
      path.join(nextBasePath, ".obsidian", "plugins", "sample", "data.json"),
      "{}",
      "utf8",
    );
    const nextAdapter = new FileSystemAdapter(nextBasePath);
    const nextVault = new Vault(nextAdapter);
    const rawPaths: string[] = [];
    nextVault.on("raw", (rawPath) => rawPaths.push(String(rawPath)));

    await nextVault.load();
    await nextAdapter.reconcileInternalFile(".obsidian/app.json");

    expect(rawPaths).toContain(".obsidian/app.json");
    expect(nextVault.getAbstractFileByPath(".obsidian/app.json")).toBeNull();
    nextVault.unload();
    await fs.rm(nextBasePath, { force: true, recursive: true });
  });
});

async function importRuntimeModule<T>(specifier: string): Promise<T> {
  return import(/* @vite-ignore */ specifier) as Promise<T>;
}
