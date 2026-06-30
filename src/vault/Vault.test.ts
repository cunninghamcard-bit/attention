import { describe, expect, it, vi } from "vitest";
import { JsonStore } from "../storage/JsonStore";
import { InMemoryAdapter, type DataWriteOptions } from "./DataAdapter";
import { Vault } from "./Vault";

describe("Vault attachment paths", () => {
  it("uses the vault root by default and sanitizes attachment names", async () => {
    const vault = new Vault();

    const path = await vault.getAvailablePathForAttachments("Pasted:image", "png");

    expect(path).toBe("Pasted image.png");
  });

  it("sanitizes attachment names like Obsidian link subpaths", async () => {
    const vault = new Vault();

    const path = await vault.getAvailablePathForAttachments("[[Daily]]%%:#|^\n", "png");

    expect(path).toBe("Daily.png");
  });

  it("creates configured attachment folders and picks an available path", async () => {
    const vault = new Vault();
    vault.setConfig("attachmentFolderPath", "Attachments");
    await vault.create("Attachments/image.png", "");

    const path = await vault.getAvailablePathForAttachments("image.png", "png");

    expect(path).toBe("Attachments/image 1.png");
    expect(vault.getFolderByPath("Attachments")).not.toBeNull();
  });

  it("picks available attachment paths with case-insensitive collisions", async () => {
    const vault = new Vault();
    await vault.create("Image.png", "");

    const path = await vault.getAvailablePathForAttachments("image", "png");

    expect(path).toBe("image 1.png");
  });

  it("resolves current-folder attachment paths from the source file", async () => {
    const vault = new Vault();
    const source = await vault.create("Notes/Source.md", "");
    vault.setConfig("attachmentFolderPath", "./");

    const path = await vault.getAvailablePathForAttachments("Recording", "webm", source);

    expect(path).toBe("Notes/Recording.webm");
  });

  it("resolves attachment subfolders under the source file folder", async () => {
    const vault = new Vault();
    const source = await vault.create("Notes/Source.md", "");
    vault.setConfig("attachmentFolderPath", "./assets");

    const path = await vault.getAvailablePathForAttachments("clip", ".m4a", source);

    expect(path).toBe("Notes/assets/clip.m4a");
    expect(vault.getFolderByPath("Notes/assets")).not.toBeNull();
  });

  it("falls back to the vault root when the configured folder path points at a file", async () => {
    const vault = new Vault();
    await vault.create("Attachments.md", "");
    vault.setConfig("attachmentFolderPath", "Attachments.md");

    const path = await vault.getAvailablePathForAttachments("image", "png");

    expect(path).toBe("image.png");
  });
});

describe("Vault config JSON helpers", () => {
  it("reads, writes, and deletes config JSON under the current config directory", async () => {
    const store = new JsonStore();
    const vault = new Vault(undefined, undefined, store);

    vault.setConfigDir(".config");
    await vault.writeConfigJson("daily-notes", { folder: "Daily" }, { mtime: 100 });

    expect(store.root).toBe(".config");
    await expect(vault.readConfigJson("daily-notes")).resolves.toEqual({ folder: "Daily" });
    await expect(store.read("daily-notes.json")).resolves.toEqual({ folder: "Daily" });
    await expect(store.read(vault.getConfigFile("daily-notes"))).resolves.toEqual({ folder: "Daily" });

    await vault.deleteConfigJson("daily-notes");

    await expect(vault.readConfigJson("daily-notes")).resolves.toBeNull();
  });

  it("routes plugin data through the same config JSON root", async () => {
    const store = new JsonStore();
    const vault = new Vault(undefined, undefined, store);
    vault.setConfigDir(".config");

    await vault.writePluginData("plugins/sample", { value: 1 });

    await expect(vault.readPluginData("plugins/sample")).resolves.toEqual({ value: 1 });
    await expect(store.read("plugins/sample/data.json")).resolves.toEqual({ value: 1 });
  });
});

describe("Vault public file API", () => {
  it("uses the adapter name as the vault name", () => {
    expect(new Vault(new InMemoryAdapter()).getName()).toBe("In-memory");
    expect(new Vault().getName()).toBe("Vault");
  });

  it("exposes Obsidian-style path existence and validation helpers", async () => {
    const vault = new Vault();

    expect(vault.isEmpty()).toBe(true);
    vault.checkPath("Notes/Today.md");
    vault.checkPath("Notes/Hash#Caret^Brackets[].md");
    expect(() => vault.checkPath("Bad:Name.md")).toThrow("File name cannot contain");
    const restorePlatform = mockNavigatorPlatform("Win32");
    try {
      expect(() => vault.checkPath("Notes/Trailing dot.")).toThrow("File names cannot end with a dot or a space.");
      expect(() => vault.checkPath("Notes/Trailing space ")).toThrow("File names cannot end with a dot or a space.");
      expect(() => vault.checkPath("Notes/CON.md")).toThrow("File name is forbidden: CON");
      expect(() => vault.checkPath("Notes/Bad|Name.md")).toThrow("File name cannot contain");
    } finally {
      restorePlatform();
    }
    const restoreAndroid = mockNavigatorRuntime({ platform: "Linux armv8l", userAgent: "Mozilla/5.0 (Linux; Android 14)" });
    try {
      expect(() => vault.checkPath("Notes/Bad?Name.md")).toThrow("File name cannot contain");
    } finally {
      restoreAndroid();
    }
    vault.checkPath("Notes/Question?Star*Angle<Quote\".md");

    const file = await vault.create("Notes/Today.md", "body");
    const other = await vault.create("Notes/Other.md", "body");

    expect(vault.isEmpty()).toBe(false);
    await expect(vault.exists("Notes/Today.md")).resolves.toBe(true);
    await expect(vault.exists("notes/today.md")).resolves.toBe(true);
    await expect(vault.exists("notes/today.md", true)).resolves.toBe(false);
    expect(vault.checkForDuplicate(file, "Today")).toBe(false);
    expect(vault.checkForDuplicate(other, "Today")).toBe(true);
    await expect(vault.create("notes/today.md", "duplicate")).rejects.toThrow("File already exists.");
    await expect(vault.create("Bad:Name.md", "bad")).rejects.toThrow("File name cannot contain");
  });

  it("normalizes vault paths with Obsidian's space and NFC rules", async () => {
    const vault = new Vault();
    const file = await vault.create("Notes/No\u00a0Break/e\u0301.md", "body");

    await expect(vault.exists("")).resolves.toBe(true);
    await expect(vault.exists("///")).resolves.toBe(true);
    expect(file.path).toBe("Notes/No Break/é.md");
    expect(vault.getFileByPath("Notes/No Break/é.md")).toBe(file);
  });

  it("throws when creating an existing folder but still ensures file parents", async () => {
    const vault = new Vault();
    const folder = await vault.createFolder("Notes");

    await expect(vault.createFolder("Notes")).rejects.toThrow("Folder already exists.");
    const nested = await vault.create("Notes/Sub/Today.md", "body");

    expect(vault.getFolderByPath("Notes")).toBe(folder);
    expect(vault.getFolderByPath("Notes/Sub")).not.toBeNull();
    expect(nested.path).toBe("Notes/Sub/Today.md");
  });

  it("exposes Obsidian-style vault, parent, root, and folder tree metadata", async () => {
    const vault = new Vault();

    expect(vault.getRoot()).toBe(vault.root);
    expect(vault.root.vault).toBe(vault);
    expect(vault.root.parent).toBeNull();
    expect(vault.root.isRoot()).toBe(true);
    expect(vault.getFolderByPath("/")).toBe(vault.root);
    expect(vault.getFolderByPath("")).toBeNull();

    const folder = await vault.createFolder("Notes");
    const file = await vault.create("Notes/Today.md", "body");

    expect(folder.vault).toBe(vault);
    expect(file.vault).toBe(vault);
    expect(folder.parent).toBe(vault.root);
    expect(file.parent).toBe(folder);
    expect(folder.isRoot()).toBe(false);
    expect(file.name).toBe("Today.md");
    expect(file.getShortName()).toBe("Today");
    expect(file.toString()).toBe("Notes/Today.md");
    expect(file.deleted).toBe(false);
    expect(file.saving).toBe(false);
    expect(folder.children).toContain(file);

    await vault.rename(folder, "Archive");

    expect(folder.parent).toBe(vault.root);
    expect(folder.name).toBe("Archive");
    expect(vault.root.getParentPrefix()).toBe("");
    expect(folder.getParentPrefix()).toBe("Archive/");
    expect(folder.getFileCount()).toBe(1);
    expect(folder.getFolderCount()).toBe(0);
    expect(file.parent).toBe(folder);
    expect(file.path).toBe("Archive/Today.md");
    expect(file.name).toBe("Today.md");
    expect(file.getNewPathAfterRename("Renamed\u0000 note ")).toBe("Archive/Renamed  note.md");

    await vault.delete(file, false);

    expect(file.parent).toBeNull();
    expect(file.deleted).toBe(true);
    expect(folder.children).not.toContain(file);
  });

  it("validates rename paths, prevents destination collisions, and allows case-only renames", async () => {
    const vault = new Vault();
    const file = await vault.create("Notes/Today.md", "body");
    await vault.create("Notes/Other.md", "other");

    await expect(vault.rename(file, "Notes/Bad:Name.md")).rejects.toThrow("File name cannot contain");
    await expect(vault.rename(file, "Notes/Other.md")).rejects.toThrow("File already exists");

    await vault.rename(file, "Notes/today.md");

    expect(file.path).toBe("Notes/today.md");
    expect(vault.getFileByPath("Notes/Today.md")).toBeNull();
    expect(vault.getFileByPath("Notes/today.md")).toBe(file);
  });

  it("tracks stat and supports cached, text, and binary modification helpers", async () => {
    const vault = new Vault();
    const file = await vault.create("Notes/Chat.md", "hello", { ctime: 10, mtime: 20 });

    expect(file.stat).toEqual({ ctime: 10, mtime: 20, size: 5 });
    await expect(vault.cachedRead(file)).resolves.toBe("hello");

    await vault.append(file, " world", { mtime: 30 });
    await expect(vault.read(file)).resolves.toBe("hello world");
    expect(file.stat).toEqual({ ctime: 10, mtime: 30, size: 11 });

    await vault.modifyBinary(file, new Uint8Array([1, 2]).buffer, { mtime: 40 });
    expect([...new Uint8Array(await vault.readBinary(file))]).toEqual([1, 2]);
    expect(file.stat).toEqual({ ctime: 10, mtime: 40, size: 2 });

    await vault.appendBinary(file, new Uint8Array([3]).buffer, { mtime: 50 });
    expect([...new Uint8Array(await vault.readBinary(file))]).toEqual([1, 2, 3]);
    expect(file.stat).toEqual({ ctime: 10, mtime: 50, size: 3 });
  });

  it("reads raw adapter text by normalized path without TFile caching or BOM stripping", async () => {
    const read = vi.fn(async () => "\ufeffraw");
    const vault = new Vault({
      read,
      write: async () => {},
      delete: async () => {},
      list: async () => [],
    });

    await expect(vault.readRaw("/Raw\\e\u0301.md/")).resolves.toBe("\ufeffraw");
    expect(read).toHaveBeenCalledWith("Raw/é.md");
  });

  it("caches cachedRead results until file content or path changes", async () => {
    const data = new Map<string, string>();
    const read = vi.fn(async (path: string) => data.get(path) ?? "");
    const adapter = {
      read,
      write: async (path: string, value: string) => { data.set(path, value); },
      delete: async (path: string) => { data.delete(path); },
      list: async () => [],
    };
    const vault = new Vault(adapter);
    const file = await vault.create("Cache.md", "one");

    await expect(vault.cachedRead(file)).resolves.toBe("one");
    await expect(vault.cachedRead(file)).resolves.toBe("one");
    expect(read).toHaveBeenCalledTimes(1);

    await vault.modify(file, "two");
    await expect(vault.cachedRead(file)).resolves.toBe("two");
    expect(read).toHaveBeenCalledTimes(1);

    await vault.rename(file, "Moved.md");
    await expect(vault.cachedRead(file)).resolves.toBe("two");
    expect(read).toHaveBeenCalledTimes(2);

    await vault.delete(file, true);
    const recreated = await vault.create("Moved.md", "three");
    await expect(vault.cachedRead(recreated)).resolves.toBe("three");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("updates TFile cache during writes while preserving the saving flag contract", async () => {
    const data = new Map<string, string>();
    const read = vi.fn(async (path: string) => data.get(path) ?? "");
    let activeFile: { saving: boolean } | null = null;
    let savingDuringImmediate = false;
    const adapter = {
      read,
      write: async (path: string, value: string, options?: DataWriteOptions) => {
        data.set(path, value);
        if (options?.immediate) {
          options.immediate();
          savingDuringImmediate = activeFile?.saving ?? false;
        }
      },
      delete: async (path: string) => { data.delete(path); },
      list: async () => [],
    };
    const vault = new Vault(adapter);
    const file = await vault.create("Cache.md", "one");
    activeFile = file;

    await expect(vault.cachedRead(file)).resolves.toBe("one");
    expect(read).toHaveBeenCalledTimes(1);

    await vault.modify(file, "two");

    expect(savingDuringImmediate).toBe(true);
    expect(file.saving).toBe(false);
    await expect(vault.cachedRead(file)).resolves.toBe("two");
    expect(read).toHaveBeenCalledTimes(1);

    vault.setFileCacheLimit(1);

    await expect(vault.cachedRead(file)).resolves.toBe("two");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("copies files and folders recursively and exposes recurseChildren traversal", async () => {
    const vault = new Vault();
    const folder = await vault.createFolder("Thread");
    await vault.create("Thread/a.md", "A");
    await vault.create("Thread/Sub/b.md", "B");

    const seen: string[] = [];
    Vault.recurseChildren(folder, (file) => seen.push(file.path));
    const copied = await vault.copy(folder, "Archive/Thread");

    expect(seen).toEqual(["Thread", "Thread/a.md", "Thread/Sub", "Thread/Sub/b.md"]);
    expect(copied.path).toBe("Archive/Thread");
    await expect(vault.read(vault.getFileByPath("Archive/Thread/a.md")!)).resolves.toBe("A");
    await expect(vault.read(vault.getFileByPath("Archive/Thread/Sub/b.md")!)).resolves.toBe("B");
  });

  it("lists files through Obsidian's tree traversal order", async () => {
    const vault = new Vault();
    await vault.create("Root.md", "");
    await vault.create("Folder/a.md", "");
    await vault.create("Folder/Sub/b.txt", "");
    await vault.create("Folder/Sub/c.md", "");

    expect(vault.getFiles().map((file) => file.path)).toEqual(["Root.md", "Folder/a.md", "Folder/Sub/c.md", "Folder/Sub/b.txt"]);
    expect(vault.getMarkdownFiles().map((file) => file.path)).toEqual(["Root.md", "Folder/a.md", "Folder/Sub/c.md"]);
  });

  it("prevents copy destinations that only differ by case", async () => {
    const vault = new Vault();
    const file = await vault.create("Image.md", "image");

    await expect(vault.copy(file, "image.md")).rejects.toThrow("File already exists");
  });

  it("copies folder contents into an existing destination folder", async () => {
    const vault = new Vault();
    const folder = await vault.createFolder("Thread");
    await vault.create("Thread/a.md", "A");
    const target = await vault.createFolder("Archive/Thread");

    const copied = await vault.copy(folder, "Archive/Thread");

    expect(copied).toBe(target);
    await expect(vault.read(vault.getFileByPath("Archive/Thread/a.md")!)).resolves.toBe("A");
  });

  it("does not delete or trash the vault root", async () => {
    const adapter = {
      read: vi.fn(async () => ""),
      write: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => []),
      remove: vi.fn(async () => {}),
      rmdir: vi.fn(async () => {}),
      trashSystem: vi.fn(async () => true),
      trashLocal: vi.fn(async () => {}),
    };
    const vault = new Vault(adapter);

    await vault.delete(vault.getRoot(), true);
    await vault.trash(vault.getRoot(), true);
    await vault.trash(vault.getRoot(), false);

    expect(vault.getAbstractFileByPath("/")).toBe(vault.getRoot());
    expect(vault.getRoot().deleted).toBe(false);
    expect(adapter.delete).not.toHaveBeenCalled();
    expect(adapter.remove).not.toHaveBeenCalled();
    expect(adapter.rmdir).not.toHaveBeenCalled();
    expect(adapter.trashSystem).not.toHaveBeenCalled();
    expect(adapter.trashLocal).not.toHaveBeenCalled();
  });

  it("backs DataAdapter-style stat and append APIs through the in-memory adapter", async () => {
    const adapter = new InMemoryAdapter();
    const vault = new Vault(adapter);
    const file = await vault.create("Adapter.md", "A", { ctime: 1, mtime: 2 });

    await vault.append(file, "B", { mtime: 3 });

    await expect(vault.read(file)).resolves.toBe("AB");
    await expect(adapter.stat("Adapter.md")).resolves.toEqual({ type: "file", ctime: 1, mtime: 3, size: 2 });
    expect(file.stat).toEqual({ ctime: 1, mtime: 3, size: 2 });
  });

  it("serializes direct DataAdapter process calls for the same path", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.write("Counter.md", "0");

    const first = adapter.process("Counter.md", (data) => `${Number(data) + 1}`);
    const second = adapter.process("Counter.md", (data) => `${Number(data) + 1}`);

    await expect(Promise.all([first, second])).resolves.toEqual(["1", "2"]);
    await expect(adapter.read("Counter.md")).resolves.toBe("2");
  });

  it("serializes Vault process calls so concurrent updaters cannot overwrite each other", async () => {
    const vault = new Vault();
    const file = await vault.create("Counter.md", "0");
    const first = vault.process(file, (data) => `${Number(data) + 1}`);
    const second = vault.process(file, (data) => `${Number(data) + 1}`);

    await expect(Promise.all([first, second])).resolves.toEqual(["1", "2"]);
    await expect(vault.read(file)).resolves.toBe("2");
  });

  it("runs no-op Vault process updates through the write path", async () => {
    const vault = new Vault();
    const file = await vault.create("Noop.md", "same", { ctime: 1, mtime: 2 });
    const modified: string[] = [];
    vault.on("modify", (item) => modified.push(item.path));

    await expect(vault.process(file, (data) => data, { mtime: 3 })).resolves.toBe("same");

    expect(modified).toEqual(["Noop.md"]);
    expect(file.stat).toEqual({ ctime: 1, mtime: 3, size: 4 });
  });

  it("uses adapter process with Obsidian's saving and immediate cache contract", async () => {
    const data = new Map<string, string>();
    const read = vi.fn(async (path: string) => data.get(path) ?? "");
    const callerImmediate = vi.fn();
    let activeFile: { saving: boolean } | null = null;
    let savingDuringImmediate = false;
    const process = vi.fn(async (path: string, updater: (text: string) => string, options?: DataWriteOptions) => {
      options?.immediate?.();
      savingDuringImmediate = activeFile?.saving ?? false;
      const next = updater(data.get(path) ?? "");
      data.set(path, next);
      return next;
    });
    const adapter = {
      read,
      write: async (path: string, value: string) => { data.set(path, value); },
      delete: async (path: string) => { data.delete(path); },
      list: async () => [],
      process,
    };
    const vault = new Vault(adapter);
    const file = await vault.create("Counter.md", "one");
    activeFile = file;

    await expect(vault.process(file, (text) => `${text}!`, { immediate: callerImmediate, mtime: 25 })).resolves.toBe("one!");

    expect(process).toHaveBeenCalledTimes(1);
    expect(savingDuringImmediate).toBe(true);
    expect(file.saving).toBe(false);
    expect(callerImmediate).not.toHaveBeenCalled();
    await expect(vault.cachedRead(file)).resolves.toBe("one!");
    expect(read).not.toHaveBeenCalled();
    expect(file.stat).toEqual({ ctime: file.stat.ctime, mtime: 25, size: 4 });
  });
});

describe("Vault setup and save config", () => {
  it("uses defaults as read-time fallbacks without persisting them", async () => {
    const store = new JsonStore();
    const vault = new Vault(undefined, undefined, store);

    expect(vault.getConfig("trashOption")).toBe("system");
    expect(vault.getConfig("enabledCssSnippets")).toEqual([]);

    await vault.saveConfig();

    await expect(store.read("app.json")).resolves.toEqual({});
    await expect(store.read("appearance.json")).resolves.toEqual({});
  });

  it("loads app and appearance config with app taking precedence and migrates legacy font config", async () => {
    const store = new JsonStore();
    const vault = new Vault(undefined, undefined, store);
    await store.write("app.json", { theme: "app-theme", attachmentFolderPath: "Files" });
    await store.write("appearance.json", { theme: "appearance-theme", editorFontFamily: "Legacy Serif" });

    await vault.setupConfig();

    expect(vault.getConfig("theme")).toBe("app-theme");
    expect(vault.getConfig("attachmentFolderPath")).toBe("Files");
    expect(vault.getConfig("textFontFamily")).toBe("Legacy Serif");
    expect(vault.getConfig("editorFontFamily")).toBeUndefined();

    await vault.requestSaveConfig.run();

    await expect(store.read("app.json")).resolves.toEqual({ attachmentFolderPath: "Files" });
    await expect(store.read("appearance.json")).resolves.toEqual({ theme: "app-theme", textFontFamily: "Legacy Serif" });
  });

  it("reloads app config when the adapter reports a raw config file change", async () => {
    const adapter = new RawWatchAdapter();
    const vault = new Vault(adapter);
    await adapter.write(".obsidian/app.json", JSON.stringify({ attachmentFolderPath: "Files" }));
    await adapter.write(".obsidian/appearance.json", JSON.stringify({ theme: "moonstone" }));
    await vault.setupConfig();
    await vault.load();

    const changed: string[] = [];
    vault.on("config-changed", (key) => changed.push(String(key)));
    const nextTime = Date.now() + 1000;
    vi.useFakeTimers();
    vi.setSystemTime(nextTime);
    try {
      await adapter.write(".obsidian/app.json", JSON.stringify({ attachmentFolderPath: "Assets" }));
      adapter.emitRaw(vault.getConfigFile("app"));
      await vi.advanceTimersByTimeAsync(500);

      expect(vault.getConfig("attachmentFolderPath")).toBe("Assets");
      expect(changed).toContain("attachmentFolderPath");
    } finally {
      vi.useRealTimers();
      vault.unload();
    }
  });

  it("splits configured keys on save and deletes keys set to undefined", async () => {
    const store = new JsonStore();
    const vault = new Vault(undefined, undefined, store);

    vault.setConfig("theme", "moonstone");
    vault.setConfig("attachmentFolderPath", "Assets");
    await vault.requestSaveConfig.run();

    await expect(store.read("app.json")).resolves.toEqual({ attachmentFolderPath: "Assets" });
    await expect(store.read("appearance.json")).resolves.toEqual({ theme: "moonstone" });

    vault.setConfig("attachmentFolderPath", undefined);
    await vault.requestSaveConfig.run();

    expect(vault.getConfig("attachmentFolderPath")).toBe("/");
    await expect(store.read("app.json")).resolves.toEqual({});
  });
});

describe("Vault trash", () => {
  it("uses adapter system trash when available and removes the file from the vault index", async () => {
    const trashSystem = vi.fn().mockResolvedValue(true);
    const adapter = createAdapter({ trashSystem });
    const vault = new Vault(adapter);
    const deleted: string[] = [];
    vault.on("delete", (file) => {
      const item = file as { path: string };
      deleted.push(item.path);
    });
    const file = await vault.create("System.md", "system");

    await vault.trash(file, true);

    expect(trashSystem).toHaveBeenCalledWith("System.md");
    expect(vault.getFileByPath("System.md")).toBeNull();
    expect(deleted).toEqual(["System.md"]);
  });

  it("falls back to local vault trash when system trash is unavailable", async () => {
    const trashSystem = vi.fn().mockResolvedValue(false);
    const vault = new Vault(createAdapter({ trashSystem }));
    const file = await vault.create("Fallback.md", "fallback");

    await vault.trash(file, true);

    const trashedFile = vault.getFileByPath(".trash/Fallback.md");
    expect(vault.getFileByPath("Fallback.md")).toBeNull();
    expect(trashedFile).not.toBeNull();
    expect(trashedFile).not.toBe(file);
  });

  it("moves local trash to .trash using basename and Obsidian duplicate numbering", async () => {
    const vault = new Vault();
    await vault.create(".trash/Name.md", "existing");
    const file = await vault.create("Folder/Name.md", "next");

    await vault.trash(file, false);

    const trashedFile = vault.getFileByPath(".trash/Name 2.md");
    expect(vault.getFileByPath("Folder/Name.md")).toBeNull();
    expect(trashedFile).not.toBeNull();
    expect(trashedFile).not.toBe(file);
    if (!trashedFile) throw new Error("expected duplicate local trash file");
    expect(await vault.read(trashedFile)).toBe("next");
  });
});

function createAdapter(overrides: Partial<{
  trashSystem: (path: string) => Promise<boolean>;
  trashLocal: (path: string) => Promise<void>;
}> = {}) {
  const data = new Map<string, string>();
  return {
    read: async (path: string) => data.get(path) ?? "",
    write: async (path: string, value: string) => { data.set(path, value); },
    delete: async (path: string) => { data.delete(path); },
    list: async () => [],
    ...overrides,
  };
}

class RawWatchAdapter extends InMemoryAdapter {
  supportsEvents = true;
  private handler: ((event: string, path: string, oldPath?: string) => void) | null = null;

  override async watch(handler: (event: string, path: string, oldPath?: string) => void): Promise<() => void> {
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }

  emitRaw(path: string): void {
    this.handler?.("raw", path);
  }
}

function mockNavigatorPlatform(platform: string): () => void {
  return mockNavigatorRuntime({ platform });
}

function mockNavigatorRuntime(values: Partial<Pick<Navigator, "appVersion" | "platform" | "userAgent">>): () => void {
  const original = {
    appVersion: window.navigator.appVersion,
    platform: window.navigator.platform,
    userAgent: window.navigator.userAgent,
  };
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(window.navigator, key, { configurable: true, value });
  }
  return () => {
    for (const [key, value] of Object.entries(original)) {
      Object.defineProperty(window.navigator, key, { configurable: true, value });
    }
  };
}
