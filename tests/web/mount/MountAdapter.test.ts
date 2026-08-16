/**
 * Input: None
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { describe, expect, it } from "vitest";
import { DataAdapter, InMemoryAdapter } from "@web/vault/DataAdapter";
import { MountAdapter } from "@web/mount/MountAdapter";

/**
 * The router carries the same DataAdapter contract the vault demands, so the
 * contract suite runs against it with everything living under one mount —
 * routing must be transparent. The rest tests what only mounting promises:
 * roots listing as folders, isolation between mounts, cross-mount moves, and
 * live add/remove announcing through the watch pipeline.
 */

const singleMount = async (): Promise<DataAdapter> =>
  new MountAdapter([{ name: "Home", adapter: new InMemoryAdapter() }]);

// Every contract assertion is written against a mounted namespace: the paths
// carry the mount prefix, and nothing else changes.
describe("DataAdapter contract through a mount", () => {
  it("round-trips text and answers exists with case rules", async () => {
    const adapter = await singleMount();
    await adapter.write("Home/notes/hello.md", "# Hi");
    expect(await adapter.read("Home/notes/hello.md")).toBe("# Hi");
    expect(await adapter.exists("Home/notes/hello.md")).toBe(true);
    expect(await adapter.exists("Home/Notes/Hello.MD")).toBe(true);
    expect(await adapter.exists("Home/Notes/Hello.MD", true)).toBe(false);
    expect(await adapter.exists("Home/absent.md")).toBe(false);
  });

  it("creates parent folders on write and lists direct children only", async () => {
    const adapter = await singleMount();
    await adapter.write("Home/a/b/c.md", "deep");
    await adapter.write("Home/a/top.md", "top");
    await adapter.mkdir("Home/a/empty");
    const a = await adapter.list("Home/a");
    expect(a.files.sort()).toEqual(["Home/a/top.md"]);
    expect(a.folders.sort()).toEqual(["Home/a/b", "Home/a/empty"]);
    expect((await adapter.list("Home/a/b")).files).toEqual(["Home/a/b/c.md"]);
  });

  it("renames files and folders within a mount", async () => {
    const adapter = await singleMount();
    await adapter.write("Home/dir/one.md", "1");
    await adapter.write("Home/dir/sub/two.md", "2");
    await adapter.rename("Home/dir/one.md", "Home/dir/first.md");
    expect(await adapter.read("Home/dir/first.md")).toBe("1");
    await adapter.rename("Home/dir", "Home/moved");
    expect(await adapter.read("Home/moved/sub/two.md")).toBe("2");
    expect(await adapter.exists("Home/dir")).toBe(false);
  });

  it("deletes folders recursively and round-trips binary", async () => {
    const adapter = await singleMount();
    await adapter.write("Home/gone/a.md", "a");
    await adapter.delete("Home/gone");
    expect(await adapter.exists("Home/gone/a.md")).toBe(false);

    await adapter.writeBinary("Home/img.png", new Uint8Array([0, 255, 7]).buffer.slice(0), {
      mtime: 1234,
    });
    expect([...new Uint8Array(await adapter.readBinary("Home/img.png"))]).toEqual([0, 255, 7]);
    expect((await adapter.stat("Home/img.png"))?.mtime).toBe(1234);
  });
});

describe("MountAdapter", () => {
  const makeThree = async () => {
    const home = new InMemoryAdapter();
    const repoA = new InMemoryAdapter();
    const repoB = new InMemoryAdapter();
    const adapter = new MountAdapter([
      { name: "Home", adapter: home },
      { name: "attention", adapter: repoA },
      { name: "Memoh", adapter: repoB },
    ]);
    return { adapter, home, repoA, repoB };
  };

  it("lists mounts as the top-level folders", async () => {
    const { adapter } = await makeThree();
    const root = await adapter.list("");
    expect(root.folders).toEqual(["Home", "attention", "Memoh"]);
    expect(root.files).toEqual([]);
    // A mount root exists and stats as a folder even while empty.
    expect(await adapter.exists("Home")).toBe(true);
    expect((await adapter.stat("attention"))?.type).toBe("folder");
    expect(await adapter.exists("nope")).toBe(false);
  });

  it("routes each mount to its own adapter, with no leakage between them", async () => {
    const { adapter, home, repoA, repoB } = await makeThree();
    await adapter.write("Home/note.md", "home content");
    await adapter.write("attention/src/main.ts", "repo A");
    await adapter.write("Memoh/go.mod", "repo B");

    // Each write landed in its own child, at the INNER path.
    expect(await home.read("note.md")).toBe("home content");
    expect(await repoA.read("src/main.ts")).toBe("repo A");
    expect(await repoB.read("go.mod")).toBe("repo B");

    // Same-named files in different mounts do not collide.
    await adapter.write("attention/README.md", "A");
    await adapter.write("Memoh/README.md", "B");
    expect(await adapter.read("attention/README.md")).toBe("A");
    expect(await adapter.read("Memoh/README.md")).toBe("B");
    expect(await adapter.exists("Home/README.md")).toBe(false);
  });

  it("moves bytes across mounts and rejects unknown ones", async () => {
    const { adapter } = await makeThree();
    await adapter.write("attention/report.md", "findings");
    await adapter.rename("attention/report.md", "Home/report.md");
    expect(await adapter.read("Home/report.md")).toBe("findings");
    expect(await adapter.exists("attention/report.md")).toBe(false);

    await adapter.copy("Home/report.md", "Memoh/copy.md");
    expect(await adapter.read("Memoh/copy.md")).toBe("findings");

    await expect(adapter.read("ghost/file.md")).rejects.toThrow("No such mount");
    await expect(adapter.rename("Home/report.md", "ghost/x.md")).rejects.toThrow("No such mount");
  });

  it("re-emits child events under the mount prefix", async () => {
    const { adapter, repoA } = await makeThree();
    const events: Array<[string, string, unknown]> = [];
    await adapter.watch((event, path, oldPath, stat) =>
      events.push([event, path, oldPath ?? stat]),
    );

    // A child adapter's own event surfaces prefixed.
    repoA.trigger("modified", "src/main.ts", { type: "file", ctime: 1, mtime: 2, size: 3 });
    repoA.trigger("renamed", "src/new.ts", "src/old.ts");
    expect(events).toContainEqual([
      "modified",
      "attention/src/main.ts",
      { type: "file", ctime: 1, mtime: 2, size: 3 },
    ]);
    expect(events).toContainEqual(["renamed", "attention/src/new.ts", "attention/src/old.ts"]);
  });

  it("adds and removes mounts live, announcing their contents", async () => {
    const { adapter } = await makeThree();
    const events: Array<[string, string]> = [];
    await adapter.watch((event, path) => events.push([event, path]));

    const late = new InMemoryAdapter();
    await late.write("docs/guide.md", "later");
    await adapter.addMount({ name: "later-repo", adapter: late });

    expect((await adapter.list("")).folders).toContain("later-repo");
    expect(await adapter.read("later-repo/docs/guide.md")).toBe("later");
    expect(events).toContainEqual(["folder-created", "later-repo"]);
    expect(events).toContainEqual(["folder-created", "later-repo/docs"]);
    expect(events).toContainEqual(["file-created", "later-repo/docs/guide.md"]);

    // A duplicate name is refused; removal detaches without touching bytes.
    await expect(
      adapter.addMount({ name: "later-repo", adapter: new InMemoryAdapter() }),
    ).rejects.toThrow("already exists");
    await adapter.removeMount("later-repo");
    expect((await adapter.list("")).folders).not.toContain("later-repo");
    expect(events).toContainEqual(["folder-removed", "later-repo"]);
    expect(await late.read("docs/guide.md")).toBe("later");
  });
});

describe("MountAdapter announces its own writes", () => {
  it("emits create/modify/remove events for local operations", async () => {
    // supportsEvents means the Vault indexes FROM these events, and children
    // that keep state in memory have no watcher to notice their own writes.
    const adapter = new MountAdapter([{ name: "Home", adapter: new InMemoryAdapter() }]);
    const events: Array<[string, string]> = [];
    await adapter.watch((event, path) => events.push([event, path]));

    await adapter.write("Home/notes/new.md", "first");
    expect(events).toContainEqual(["folder-created", "Home/notes"]);
    expect(events).toContainEqual(["file-created", "Home/notes/new.md"]);

    events.length = 0;
    await adapter.write("Home/notes/new.md", "second");
    expect(events.map(([event]) => event)).toEqual(["modified"]);

    events.length = 0;
    await adapter.delete("Home/notes/new.md");
    expect(events).toContainEqual(["file-removed", "Home/notes/new.md"]);
  });
});

describe("MountAdapter and the config home", () => {
  it("answers config probes itself instead of routing them at a mount", async () => {
    const adapter = new MountAdapter([{ name: "Home", adapter: new InMemoryAdapter() }]);
    // The Vault probes its config dir against the content adapter; config
    // belongs to no mount, and a rejection here would take boot down.
    expect(await adapter.exists(".obsidian")).toBe(true);
    await expect(adapter.mkdir(".obsidian")).resolves.toBeUndefined();
    // Nothing was written into any mount.
    expect((await adapter.list("")).folders).toEqual(["Home"]);
  });
});
