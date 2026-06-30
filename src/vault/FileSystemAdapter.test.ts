import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "./DataAdapter";
import { FileSystemAdapter } from "./FileSystemAdapter";
import { Platform } from "../platform/Platform";

type TestFsModule = {
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  rm(path: string, options: { force: boolean; recursive: boolean }): Promise<void>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
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

describe("FileSystemAdapter", () => {
  let basePath: string;
  let adapter: FileSystemAdapter;
  let fs: TestFsModule;
  let os: TestOsModule;
  let path: TestPathModule;

  beforeEach(async () => {
    fs ??= await importRuntimeModule<TestFsModule>(fsPromisesSpecifier);
    os ??= await importRuntimeModule<TestOsModule>(osSpecifier);
    path ??= await importRuntimeModule<TestPathModule>(pathSpecifier);
    basePath = await fs.mkdtemp(path.join(os.tmpdir(), "obsidian-reconstructed-"));
    adapter = new FileSystemAdapter(basePath);
  });

  afterEach(async () => {
    delete (globalThis as { electron?: unknown }).electron;
    await fs.rm(basePath, { force: true, recursive: true });
  });

  it("reads, writes, creates folders and lists vault paths non-recursively", async () => {
    await adapter.write("Folder/Note.md", "hello");
    await adapter.mkdir("Folder/Sub");
    await adapter.write("Folder/Sub/Leaf.md", "leaf");

    const rootListed = await adapter.list("");
    const folderListed = await adapter.list("Folder");

    expect(await adapter.read("Folder/Note.md")).toBe("hello");
    expect(rootListed.files).toEqual([]);
    expect(rootListed.folders.sort()).toEqual(["Folder"]);
    expect(folderListed.files.sort()).toEqual(["Folder/Note.md"]);
    expect(folderListed.folders.sort()).toEqual(["Folder/Sub"]);
  });

  it("keeps in-memory adapter list results non-recursive", async () => {
    const memory = new InMemoryAdapter();

    await memory.write("Folder/Note.md", "hello");
    await memory.mkdir("Folder/Sub");
    await memory.write("Folder/Sub/Leaf.md", "leaf");

    await expect(memory.list("")).resolves.toEqual({ files: [], folders: ["Folder"] });
    await expect(memory.list("Folder")).resolves.toEqual({ files: ["Folder/Note.md"], folders: ["Folder/Sub"] });
  });

  it("reads and writes binary files without UTF-8 conversion", async () => {
    const data = new Uint8Array([0, 255, 127, 64]).buffer;

    await adapter.writeBinary("Assets/image.bin", data);

    expect([...new Uint8Array(await adapter.readBinary("Assets/image.bin"))]).toEqual([0, 255, 127, 64]);
    expect([...await fs.readFile(path.join(basePath, "Assets/image.bin"))]).toEqual([0, 255, 127, 64]);
  });

  it("exposes Obsidian static desktop file helpers", async () => {
    const folderPath = path.join(basePath, "Static", "Nested");
    const filePath = path.join(folderPath, "binary.bin");

    await FileSystemAdapter.mkdir(folderPath);
    await fs.writeFile(filePath, new Uint8Array([5, 6, 7]));

    expect([...new Uint8Array(await FileSystemAdapter.readLocalFile(filePath))]).toEqual([5, 6, 7]);
  });

  it("resolves file URLs and native paths back to vault paths", async () => {
    await adapter.write("Folder/Image.png", "image");

    const resourcePath = adapter.getResourcePath("Folder/Image.png");

    expect(resourcePath.startsWith(Platform.resourcePathPrefix)).toBe(true);
    expect(resourcePath).toMatch(/\?\d+$/);
    expect(adapter.getFilePath("Folder/Image.png")).toMatch(/^file:\/\//);
    expect(adapter.resolvePath(resourcePath)).toBe("Folder/Image.png");
    expect(adapter.resolvePath(`${resourcePath}?123`)).toBe("Folder/Image.png");
    expect(adapter.resolvePath(path.join(basePath, "Folder/Image.png"))).toBe("Folder/Image.png");
    expect(adapter.resolvePath("/tmp/not-in-this-vault.png")).toBeNull();
  });

  it("normalizes filesystem adapter paths with Obsidian's space and NFC rules", async () => {
    await adapter.write("Folder/No\u202fBreak/e\u0301.md", "body");

    expect(adapter.getFullPath("")).toBe(basePath);
    expect(adapter.getFullPath("/")).toBe(basePath);
    expect(adapter.getFullPath("///")).toBe(basePath);
    expect(adapter.getFullPath("Folder/No Break/é.md")).toBe(path.join(basePath, "Folder", "No Break", "é.md"));
    expect(await adapter.exists("Folder/No Break/é.md", true)).toBe(true);
  });

  it("resolves descendant full paths through indexed real paths", async () => {
    const realFolder = path.join(basePath, "Actual Folder");
    await fs.mkdir(realFolder, { recursive: true });
    (adapter as unknown as { files: Map<string, { path: string; realpath: string; type: "folder" }> }).files.set("Linked", {
      path: "Linked",
      realpath: realFolder,
      type: "folder",
    });

    expect(adapter.getFullPath("Linked/Child.md")).toBe(path.join(realFolder, "Child.md"));
  });

  it("moves local trash into root .trash using basename and Obsidian duplicate numbering", async () => {
    await adapter.write(".trash/Name.md", "existing");
    await adapter.write("Folder/Name.md", "next");

    await adapter.trashLocal("Folder/Name.md");

    expect(await adapter.exists("Folder/Name.md")).toBe(false);
    expect(await adapter.read(".trash/Name 2.md")).toBe("next");
  });

  it("honors sensitive existence checks with exact basename matching", async () => {
    const memory = new InMemoryAdapter();
    await memory.write("Folder/Case.md", "case");
    await adapter.write("Folder/Case.md", "case");

    expect(await memory.exists("folder/case.md")).toBe(true);
    expect(await memory.exists("folder/case.md", true)).toBe(false);
    expect(await adapter.exists("Folder/Case.md", true)).toBe(true);
    expect(await adapter.exists("Folder/case.md", true)).toBe(false);
  });

  it("uses Electron ipcRenderer trash channel for system trash when available", async () => {
    const sendSync = vi.fn().mockReturnValue(true);
    (globalThis as { electron?: unknown }).electron = { ipcRenderer: { sendSync } };

    await expect(adapter.trashSystem("System.md")).resolves.toBe(true);

    expect(sendSync).toHaveBeenCalledWith("trash", adapter.getFullPath("System.md"));
  });

  it("returns false from system trash when the desktop ipc channel is unavailable or returns false", async () => {
    await expect(adapter.trashSystem("Missing.md")).resolves.toBe(false);

    (globalThis as { electron?: unknown }).electron = { ipcRenderer: { sendSync: vi.fn().mockReturnValue(false) } };

    await expect(adapter.trashSystem("Denied.md")).resolves.toBe(false);
  });

  it("lets desktop system trash ipc errors propagate like the Electron adapter", async () => {
    (globalThis as { electron?: unknown }).electron = {
      ipcRenderer: {
        sendSync: vi.fn(() => {
          throw new Error("denied");
        }),
      },
    };

    await expect(adapter.trashSystem("Denied.md")).rejects.toThrow("denied");
  });

  it("renames and permanently removes filesystem entries", async () => {
    await adapter.write("Old.md", "old");
    await adapter.rename("Old.md", "Folder/New.md");

    expect(await adapter.exists("Old.md")).toBe(false);
    expect(await adapter.read("Folder/New.md")).toBe("old");

    await adapter.remove("Folder/New.md");
    expect(await adapter.exists("Folder/New.md")).toBe(false);
    await expect(fs.readFile(path.join(basePath, "Folder", "New.md"), "utf8")).rejects.toThrow();
  });

  it("copies folders recursively into existing destination folders", async () => {
    await adapter.write("Thread/a.md", "A");
    await adapter.write("Thread/Sub/b.md", "B");
    await adapter.mkdir("Archive/Thread");

    await adapter.copy("Thread", "Archive/Thread");

    expect(await adapter.read("Archive/Thread/a.md")).toBe("A");
    expect(await adapter.read("Archive/Thread/Sub/b.md")).toBe("B");
  });

  it("prevents rename destination collisions while allowing case-only renames", async () => {
    await adapter.write("Folder/Name.md", "one");
    await adapter.write("Folder/Other.md", "two");

    await expect(adapter.rename("Folder/Name.md", "Folder/Other.md")).rejects.toThrow("Destination file already exists!");

    await adapter.rename("Folder/Name.md", "Folder/name.md");

    expect(await adapter.exists("Folder/Name.md", true)).toBe(false);
    expect(await adapter.read("Folder/name.md")).toBe("one");
  });

  it("recursively reconciles newly discovered folders and their children", async () => {
    const created: string[] = [];
    adapter.on("folder-created", (filePath) => created.push(`folder:${String(filePath)}`));
    adapter.on("file-created", (filePath) => created.push(`file:${String(filePath)}`));
    await fs.mkdir(path.join(basePath, "External", "Nested"), { recursive: true });
    await fs.writeFile(path.join(basePath, "External", "Nested", "Note.md"), "external", "utf8");

    await adapter.reconcileInternalFile("External");

    expect(created).toEqual(["folder:External", "folder:External/Nested", "file:External/Nested/Note.md"]);
  });
});

async function importRuntimeModule<T>(specifier: string): Promise<T> {
  return import(/* @vite-ignore */ specifier) as Promise<T>;
}
