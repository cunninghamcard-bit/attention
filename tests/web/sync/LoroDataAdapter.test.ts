/**
 * Input: None
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { describe, expect, it } from "vitest";
import { DataAdapter, InMemoryAdapter } from "@web/vault/DataAdapter";
import { LoroDataAdapter } from "@web/sync/LoroDataAdapter";
import { MemorySyncStore } from "@web/sync/SyncStore";
import { TREE_DOC_ID } from "@web/sync/VaultDocs";

/**
 * One contract, two implementations: every behavioral assertion here runs
 * against InMemoryAdapter (the reference) AND LoroDataAdapter (the synced
 * vault). Divergence in either direction is a bug. The second half tests
 * what only the synced adapter promises: persistence through the store,
 * identity across rename, and remote bytes surfacing as watch events.
 */

const makeLoro = async () => LoroDataAdapter.load(new MemorySyncStore(), "vault-test");

describe.each([
  ["InMemoryAdapter", async (): Promise<DataAdapter> => new InMemoryAdapter()],
  ["LoroDataAdapter", async (): Promise<DataAdapter> => makeLoro()],
])("DataAdapter contract: %s", (_name, make) => {
  it("round-trips text and answers exists with case rules", async () => {
    const adapter = await make();
    await adapter.write("notes/hello.md", "# Hi");
    expect(await adapter.read("notes/hello.md")).toBe("# Hi");
    expect(await adapter.exists("notes/hello.md")).toBe(true);
    expect(await adapter.exists("Notes/Hello.MD")).toBe(true);
    expect(await adapter.exists("Notes/Hello.MD", true)).toBe(false);
    expect(await adapter.exists("absent.md")).toBe(false);
  });

  it("creates parent folders on write and lists direct children only", async () => {
    const adapter = await make();
    await adapter.write("a/b/c.md", "deep");
    await adapter.write("a/top.md", "top");
    await adapter.mkdir("a/empty");
    const root = await adapter.list("");
    expect(root.folders).toContain("a");
    const a = await adapter.list("a");
    expect(a.files.sort()).toEqual(["a/top.md"]);
    expect(a.folders.sort()).toEqual(["a/b", "a/empty"]);
    const b = await adapter.list("a/b");
    expect(b.files).toEqual(["a/b/c.md"]);
  });

  it("renames files, and folders carry their descendants", async () => {
    const adapter = await make();
    await adapter.write("dir/one.md", "1");
    await adapter.write("dir/sub/two.md", "2");
    await adapter.rename("dir/one.md", "dir/first.md");
    expect(await adapter.read("dir/first.md")).toBe("1");
    expect(await adapter.exists("dir/one.md")).toBe(false);

    await adapter.rename("dir", "moved");
    expect(await adapter.read("moved/first.md")).toBe("1");
    expect(await adapter.read("moved/sub/two.md")).toBe("2");
    expect(await adapter.exists("dir")).toBe(false);

    await adapter.write("clash.md", "x");
    await expect(adapter.rename("moved/first.md", "clash.md")).rejects.toThrow(
      "Destination file already exists!",
    );
  });

  it("deletes folders recursively", async () => {
    const adapter = await make();
    await adapter.write("gone/a.md", "a");
    await adapter.write("gone/deep/b.md", "b");
    await adapter.delete("gone");
    expect(await adapter.exists("gone")).toBe(false);
    expect(await adapter.exists("gone/a.md")).toBe(false);
    expect(await adapter.exists("gone/deep/b.md")).toBe(false);
  });

  it("round-trips binary content and stats it", async () => {
    const adapter = await make();
    const bytes = new Uint8Array([0, 255, 128, 7]);
    await adapter.writeBinary("img.png", bytes.buffer.slice(0), { mtime: 1234 });
    const back = new Uint8Array(await adapter.readBinary("img.png"));
    expect([...back]).toEqual([0, 255, 128, 7]);
    const stat = await adapter.stat("img.png");
    expect(stat?.type).toBe("file");
    expect(stat?.size).toBe(4);
    expect(stat?.mtime).toBe(1234);
  });

  it("copies and trashes into .trash", async () => {
    const adapter = await make();
    await adapter.write("keep.md", "content");
    await adapter.copy("keep.md", "copy.md");
    expect(await adapter.read("copy.md")).toBe("content");
    await expect(adapter.copy("keep.md", "copy.md")).rejects.toThrow();

    await adapter.trashLocal("keep.md");
    expect(await adapter.exists("keep.md")).toBe(false);
    expect(await adapter.read(".trash/keep.md")).toBe("content");
  });
});

describe("LoroDataAdapter beyond the contract", () => {
  it("survives a reload from the same store", async () => {
    const store = new MemorySyncStore();
    const first = await LoroDataAdapter.load(store, "v");
    await first.write("persist/note.md", "still here");
    await first.writeBinary("persist/pic.bin", new Uint8Array([9, 9]).buffer.slice(0));
    await first.rename("persist/note.md", "persist/renamed.md");

    const second = await LoroDataAdapter.load(store, "v");
    expect(await second.read("persist/renamed.md")).toBe("still here");
    expect(await second.exists("persist/note.md")).toBe(false);
    expect([...new Uint8Array(await second.readBinary("persist/pic.bin"))]).toEqual([9, 9]);
  });

  it("keeps file identity stable across rename — the sync room survives", async () => {
    const adapter = await makeLoro();
    await adapter.write("id.md", "x");
    const before = adapter.vaultDocs().idAtPath("id.md");
    await adapter.rename("id.md", "folder/renamed.md");
    expect(adapter.vaultDocs().idAtPath("folder/renamed.md")).toBe(before);
  });

  it("surfaces remote tree bytes as the same events a disk change would", async () => {
    const storeA = new MemorySyncStore();
    const a = await LoroDataAdapter.load(storeA, "v");

    // Capture A's tree updates as a peer would receive them.
    const wire: Uint8Array[] = [];
    const record = await storeA.loadDoc(TREE_DOC_ID);
    void record;
    const b = await LoroDataAdapter.load(new MemorySyncStore(), "v");
    const events: Array<{ event: string; path: string; extra?: unknown }> = [];
    await b.watch(
      (event, path, oldPath, stat) => void events.push({ event, path, extra: oldPath ?? stat }),
    );

    await a.write("shared/doc.md", "hello");
    const treeBytes = (await storeA.loadDoc(TREE_DOC_ID)).updates;
    for (const bytes of treeBytes) await b.vaultDocs().applyRemote(TREE_DOC_ID, bytes);
    expect(wire.length).toBe(0);

    const created = events.filter((e) => e.event === "file-created").map((e) => e.path);
    expect(created).toContain("shared/doc.md");
    const folders = events.filter((e) => e.event === "folder-created").map((e) => e.path);
    expect(folders).toContain("shared");
    expect(await b.exists("shared/doc.md")).toBe(true);

    // Text bytes for the file's own doc: replay through the same seam.
    const fileId = a.vaultDocs().idAtPath("shared/doc.md");
    const textBytes = (await storeA.loadDoc(fileId ?? "")).updates;
    await b.read("shared/doc.md"); // instantiate the live doc
    for (const bytes of textBytes) await b.vaultDocs().applyRemote(fileId ?? "", bytes);
    expect(await b.read("shared/doc.md")).toBe("hello");
    expect(events.some((e) => e.event === "modified" && e.path === "shared/doc.md")).toBe(true);
  });
});

describe("FolderImport", () => {
  it("ingests an existing vault: text as docs, binary as blobs", async () => {
    const { importFolder } = await import("@web/sync/FolderImport");
    const { InMemoryAdapter } = await import("@web/vault/DataAdapter");
    const source = new InMemoryAdapter();
    await source.write("note.md", "# imported");
    await source.write("deep/config.json", "{}");
    await source.writeBinary("deep/pic.png", new Uint8Array([1, 2, 3]).buffer.slice(0));

    const target = await makeLoro();
    const count = await importFolder(source, target);
    expect(count).toBe(3);
    expect(await target.read("note.md")).toBe("# imported");
    expect(await target.read("deep/config.json")).toBe("{}");
    expect([...new Uint8Array(await target.readBinary("deep/pic.png"))]).toEqual([1, 2, 3]);
    // Text became a collaborative doc (a room), binary a blob reference.
    expect(target.vaultDocs().idAtPath("note.md")).toBeDefined();
    expect((await target.stat("deep/pic.png"))?.size).toBe(3);
  });
});
