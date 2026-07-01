import { describe, expect, it, vi } from "vitest";
import { iterateCacheRefs, iterateRefs, MetadataCache } from "./MetadataCache";
import { MemoryMetadataCacheStore } from "./MetadataCacheStore";
import { Vault, type VaultAdapter } from "../vault/Vault";
import { ViewRegistry } from "../workspace/ViewRegistry";
import type { App } from "../app/App";

describe("MetadataCache", () => {
  it("keeps ignored files cached but filters aggregate metadata queries", async () => {
    const vault = new Vault();
    const metadataCache = new MetadataCache(vault);
    const kept = await vault.create("Notes/Kept.md", "---\nstatus: kept\n---\n# Kept\n[[Archive/Hidden]]");
    const folderIgnored = await vault.create("Archive/Hidden.md", "---\nstatus: hidden\n---\n# Hidden");
    const regexIgnored = await vault.create("Secret.md", "---\nstatus: secret\n---\n# Secret");

    vault.setConfig("userIgnoreFilters", ["Archive/", "/^Secret\\.md$/"]);
    await metadataCache.clear();

    expect(metadataCache.isUserIgnored("Archive/Hidden.md")).toBe(true);
    expect(metadataCache.isUserIgnored("Secret.md")).toBe(true);
    expect(metadataCache.isUserIgnored("Notes/Kept.md")).toBe(false);
    expect(metadataCache.getFileCache(kept)?.headings?.[0]?.heading).toBe("Kept");
    expect(metadataCache.getFileCache(folderIgnored)?.headings?.[0]?.heading).toBe("Hidden");
    expect(metadataCache.getFileCache(regexIgnored)?.headings?.[0]?.heading).toBe("Secret");
    expect(metadataCache.getAllPropertyInfos().status).toMatchObject({ name: "status", widget: "text", occurrences: 1 });
    expect(metadataCache.getFrontmatterPropertyValuesForKey("status")).toEqual(["kept"]);

    vault.setConfig("userIgnoreFilters", null);
    await metadataCache.computeFileMetadata(folderIgnored);

    expect(metadataCache.getFileCache(folderIgnored)?.headings?.[0]?.heading).toBe("Hidden");
  });

  it("emits changed with source text and debounces finished after vault modifications", async () => {
    vi.useFakeTimers();
    try {
      const vault = new Vault();
      const metadataCache = new MetadataCache(vault);
      const file = await vault.create("Note.md", "# One");
      const changed: unknown[][] = [];
      const finished: string[] = [];
      metadataCache.on("changed", (...args: unknown[]) => changed.push(args));
      metadataCache.on("finished", () => finished.push("finished"));

      await metadataCache.computeFileMetadataAsync(file);
      const initialized = metadataCache.initialize();
      await vi.advanceTimersByTimeAsync(0);
      await initialized;
      await vi.advanceTimersByTimeAsync(10);
      changed.length = 0;
      finished.length = 0;

      const nextChanged = new Promise<void>((resolve) => {
        metadataCache.on("changed", () => resolve());
      });
      await vault.modify(file, "# Two");
      await nextChanged;

      expect(changed[0]?.[0]).toBe(file);
      expect(changed[0]?.[1]).toBe("# Two");
      expect((changed[0]?.[2] as { headings?: Array<{ heading: string }> }).headings?.[0]?.heading).toBe("Two");
      expect(finished).toEqual([]);

      await vi.advanceTimersByTimeAsync(9);
      expect(finished).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      expect(finished).toEqual(["finished"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists file and metadata cache entries and preloads them into a new cache", async () => {
    const store = new MemoryMetadataCacheStore();
    const vault = new Vault();
    const metadataCache = new MetadataCache(vault, undefined, store);
    const file = await vault.create("Note.md", "---\nstatus: cached\n---\n# Cached");

    await metadataCache.computeFileMetadata(file);
    const info = metadataCache.getFileInfo("Note.md");

    expect(info?.size).toBeGreaterThan(0);
    expect(store.getFile("Note.md")).toEqual(info);
    expect(store.getMetadata(info?.hash ?? "")).not.toBeNull();

    const preloaded = new MetadataCache(new Vault(), undefined, store);
    await preloaded.preload();

    expect(preloaded.getFileInfo("Note.md")).toEqual(info);
    expect(preloaded.getCache("Note.md")?.frontmatter).toEqual({ status: "cached" });
  });

  it("indexes frontmatter position and root markdown sections", async () => {
    const vault = new Vault();
    const metadataCache = new MetadataCache(vault);
    const source = [
      "---",
      "title: Test",
      "---",
      "# Heading",
      "",
      "> [!note]",
      "> Callout",
      "",
      "- item ^abc",
      "",
      "paragraph",
      "",
      "---",
      "",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");
    const file = await vault.create("Sections.md", source);

    await metadataCache.computeFileMetadata(file);

    const cache = metadataCache.getFileCache(file);
    expect(cache?.frontmatterPosition).toEqual({
      start: { line: 0, col: 0, offset: 0 },
      end: { line: 3, col: 0, offset: "---\ntitle: Test\n---\n".length },
    });
    expect(cache?.sections?.map((section) => section.type)).toEqual([
      "yaml",
      "heading",
      "callout",
      "list",
      "paragraph",
      "thematicBreak",
      "code",
    ]);
    expect(cache?.sections?.[0]?.position).toEqual(cache?.frontmatterPosition);
    expect(cache?.sections?.[3]).toMatchObject({ type: "list", id: "abc" });
    expect(cache?.listItems).toEqual([
      {
        id: "abc",
        parent: -8,
        position: {
          start: { line: 8, col: 0, offset: source.indexOf("- item ^abc") },
          end: { line: 8, col: "- item ^abc".length, offset: source.indexOf("- item ^abc") + "- item ^abc".length },
        },
      },
    ]);
  });

  it("keeps frontmatter positions for invalid YAML and respects CRLF offsets", async () => {
    const vault = new Vault();
    const metadataCache = new MetadataCache(vault);
    const source = "---\r\n  invalid\r\n---\r\nBody";
    const file = await vault.create("Invalid.md", source);

    await metadataCache.computeFileMetadata(file);

    const cache = metadataCache.getFileCache(file);
    expect(cache?.frontmatter).toBeUndefined();
    expect(cache?.frontmatterPosition).toEqual({
      start: { line: 0, col: 0, offset: 0 },
      end: { line: 3, col: 0, offset: "---\r\n  invalid\r\n---\r\n".length },
    });
    expect(cache?.sections?.[0]?.type).toBe("yaml");
    expect(cache?.sections?.[1]).toMatchObject({ type: "paragraph" });
  });

  it("uses official cache item positions for links, embeds, tags, and frontmatter links", async () => {
    const vault = new Vault();
    const metadataCache = new MetadataCache(vault);
    const body = "See [[Target#Heading|Shown]] and ![[Image.png]] plus [Docs](Docs/File.md) and ![Alt](Pic.png) #tag/sub";
    const source = [
      "---",
      "related: \"[[Front#A|Front shown]]\"",
      "aliases:",
      "  - \"[[AliasTarget]]\"",
      "---",
      body,
      "[docs]: https://example.com",
    ].join("\n");
    const file = await vault.create("Refs.md", source);

    await metadataCache.computeFileMetadata(file);

    const cache = metadataCache.getFileCache(file);
    const targetStart = body.indexOf("[[Target");
    const tagStart = body.indexOf("#tag/sub");
    expect(cache?.frontmatterLinks).toEqual([
      { key: "related", link: "Front#A", original: "[[Front#A|Front shown]]", displayText: "Front shown" },
      { key: "aliases", link: "AliasTarget", original: "[[AliasTarget]]" },
    ]);
    expect(cache?.links?.[0]).toMatchObject({
      link: "Target#Heading",
      original: "[[Target#Heading|Shown]]",
      displayText: "Shown",
      position: {
        start: { line: 5, col: targetStart, offset: source.indexOf("[[Target") },
        end: { line: 5, col: targetStart + "[[Target#Heading|Shown]]".length, offset: source.indexOf("[[Target") + "[[Target#Heading|Shown]]".length },
      },
      source: {
        line: 5,
        start: targetStart,
        end: targetStart + "[[Target#Heading|Shown]]".length,
        text: body,
      },
    });
    expect(cache?.links?.some((link) => link.link === "Docs/File.md" && link.displayText === "Docs")).toBe(true);
    expect(cache?.embeds?.map((embed) => embed.link)).toEqual(["Image.png", "Pic.png"]);
    expect(cache?.tags?.[0]).toMatchObject({
      tag: "#tag/sub",
      position: {
        start: { line: 5, col: tagStart, offset: source.indexOf("#tag/sub") },
        end: { line: 5, col: tagStart + "#tag/sub".length, offset: source.indexOf("#tag/sub") + "#tag/sub".length },
      },
    });
  });

  it("exposes official reference iteration helpers for links and embeds", async () => {
    const vault = new Vault();
    const metadataCache = new MetadataCache(vault);
    const file = await vault.create("Refs.md", "---\nrelated: \"[[Front]]\"\n---\n[[Target]] ![[Image.png]] [Docs](Docs.md)");

    await metadataCache.computeFileMetadata(file);

    const cache = metadataCache.getFileCache(file);
    if (!cache) throw new Error("Expected metadata cache");
    expect(iterateCacheRefs(null, () => true)).toBe(false);
    expect(iterateRefs(null, () => true)).toBe(false);
    const cacheRefs: string[] = [];
    const stopped = iterateCacheRefs(cache, (ref) => {
      cacheRefs.push(ref.link);
      return ref.link === "Image.png";
    });
    const allRefs: string[] = [];
    const allStopped = iterateRefs([...(cache.frontmatterLinks ?? []), ...(cache.links ?? []), ...(cache.embeds ?? [])], (ref) => {
      allRefs.push(ref.link);
      return false;
    });

    expect(stopped).toBe(true);
    expect(cacheRefs).toEqual(["Target", "Docs.md", "Image.png"]);
    expect(allStopped).toBe(false);
    expect(allRefs).toEqual(["Front", "Target", "Docs.md", "Image.png"]);
  });

  it("indexes reference links and footnote definition positions", async () => {
    const vault = new Vault();
    const metadataCache = new MetadataCache(vault);
    const file = await vault.create("Note.md", "Read [Docs][docs] and note [^one]\n\n[docs]: https://example.com\n[^one]: Footnote\n  continuation");

    await metadataCache.computeFileMetadata(file);

    const cache = metadataCache.getFileCache(file);
    expect(cache?.referenceLinks).toEqual([
      expect.objectContaining({
        id: "docs",
        link: "https://example.com",
        position: {
          start: { line: 2, col: 0, offset: "Read [Docs][docs] and note [^one]\n\n".length },
          end: { line: 2, col: "[docs]: https://example.com".length, offset: "Read [Docs][docs] and note [^one]\n\n[docs]: https://example.com".length },
        },
      }),
    ]);
    expect(cache?.footnotes).toEqual([
      {
        id: "one",
        position: {
          start: { line: 3, col: 0, offset: "Read [Docs][docs] and note [^one]\n\n[docs]: https://example.com\n".length },
          end: { line: 4, col: "  continuation".length, offset: "Read [Docs][docs] and note [^one]\n\n[docs]: https://example.com\n[^one]: Footnote\n  continuation".length },
        },
      },
    ]);
    expect(cache?.footnoteRefs).toEqual([
      {
        id: "one",
        position: {
          start: { line: 0, col: "Read [Docs][docs] and note ".length, offset: "Read [Docs][docs] and note ".length },
          end: { line: 0, col: "Read [Docs][docs] and note [^one]".length, offset: "Read [Docs][docs] and note [^one]".length },
        },
      },
    ]);
  });

  it("removes file cache entries immediately and cleans unreferenced metadata later", async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryMetadataCacheStore();
      const vault = new Vault();
      const metadataCache = new MetadataCache(vault, undefined, store);
      const file = await vault.create("Gone.md", "# Gone");

      await metadataCache.computeFileMetadataAsync(file);
      await metadataCache.initialize();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10);
      const hash = metadataCache.getFileInfo("Gone.md")?.hash ?? "";

      expect(store.getFile("Gone.md")).not.toBeNull();
      expect(store.getMetadata(hash)).not.toBeNull();

      await vault.delete(file, true);
      expect(store.getFile("Gone.md")).toBeNull();
      expect(store.getMetadata(hash)).not.toBeNull();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(store.getMetadata(hash)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves links through an async queue and normalizes unresolved markdown linkpaths", async () => {
    vi.useFakeTimers();
    try {
      const vault = new Vault();
      const metadataCache = new MetadataCache(vault);
      const source = await vault.create("Source.md", "[[Missing.md#Heading]]");
      const resolved: string[] = [];
      const fileResolved: string[] = [];
      metadataCache.on("resolve", (file) => fileResolved.push((file as { path: string }).path));
      metadataCache.on("resolved", () => resolved.push("resolved"));

      const initialized = metadataCache.initialize();
      await vi.advanceTimersByTimeAsync(0);
      await initialized;
      await vi.advanceTimersByTimeAsync(0);

      expect(fileResolved).toContain(source.path);
      expect(metadataCache.unresolvedLinks[source.path]).toEqual({ Missing: 1 });
      expect(resolved.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("requeues related unresolved links when a matching file is created", async () => {
    vi.useFakeTimers();
    try {
      const vault = new Vault();
      const metadataCache = new MetadataCache(vault);
      const source = await vault.create("Source.md", "[[Target]]");

      const initialized = metadataCache.initialize();
      await vi.advanceTimersByTimeAsync(0);
      await initialized;
      await vi.advanceTimersByTimeAsync(0);
      expect(metadataCache.unresolvedLinks[source.path]).toEqual({ Target: 1 });

      await vault.create("Target.md", "");
      await vi.advanceTimersByTimeAsync(0);

      expect(metadataCache.resolvedLinks[source.path]).toEqual({ "Target.md": 1 });
      expect(metadataCache.unresolvedLinks[source.path]).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves ambiguous same-name links through unique lookup with source proximity", async () => {
    const vault = new Vault();
    const metadataCache = new MetadataCache(vault);
    await vault.create("B/Target.md", "# Distant");
    await vault.create("A/Target.md", "# Nearby");
    const source = await vault.create("A/Source.md", "[[target]]");

    await metadataCache.clear();
    await waitForClean(metadataCache);

    expect(metadataCache.resolvedLinks[source.path]).toEqual({ "A/Target.md": 1 });
  });

  it("honors relative and absolute linkpath exact matches before suffix fallback", async () => {
    const vault = new Vault();
    const metadataCache = new MetadataCache(vault);
    await vault.create("A/Target.md", "# A");
    await vault.create("B/Target.md", "# B");
    const source = await vault.create("A/Sub/Source.md", "[[../Target]] [[/B/Target]] [[/Missing/Target]]");

    await metadataCache.clear();
    await waitForClean(metadataCache);

    expect(metadataCache.resolvedLinks[source.path]).toEqual({
      "A/Target.md": 1,
      "B/Target.md": 1,
    });
    expect(metadataCache.unresolvedLinks[source.path]).toEqual({ "/Missing/Target": 1 });
  });

  it("prefers source-folder linkpath matches only on directory boundaries", async () => {
    const vault = new Vault();
    const metadataCache = new MetadataCache(vault);
    await vault.create("AA/Target.md", "# AA");
    const expected = await vault.create("A/Target.md", "# A");
    const source = await vault.create("A/Source.md", "[[Target]]");

    await metadataCache.clear();
    await waitForClean(metadataCache);

    expect(metadataCache.getFirstLinkpathDest("Target", source.path)).toBe(expected);
    expect(metadataCache.resolvedLinks[source.path]).toEqual({ "A/Target.md": 1 });
  });

  it("builds link suggestions from supported files, aliases, and unresolved links", async () => {
    const vault = new Vault();
    const viewRegistry = new ViewRegistry();
    const app = { appId: "test", vault, viewRegistry } as unknown as App;
    const metadataCache = new MetadataCache(vault, app);
    const note = await vault.create("Folder/Note.md", "---\nAliases:\n  - Nick\n  - '  Trimmed  '\n  - 7\n  - ''\n---\n[[Missing.md]]");
    await vault.createBinary("Folder/Attachment.pdf", new Uint8Array([1, 2, 3]).buffer);
    await vault.createBinary("Folder/Archive.bin", new Uint8Array([4, 5, 6]).buffer);

    await metadataCache.computeFileMetadataAsync(note);
    await vi.waitFor(() => expect(metadataCache.unresolvedLinks[note.path]).toEqual({ Missing: 1 }));

    const suggestions = metadataCache.getLinkSuggestions();

    expect(suggestions).toContainEqual({ file: note, path: "Folder/Note" });
    expect(suggestions).toContainEqual({ file: note, path: "Folder/Note", alias: "Nick" });
    expect(suggestions).toContainEqual({ file: note, path: "Folder/Note", alias: "Trimmed" });
    expect(suggestions).toContainEqual({ file: null, path: "Missing" });
    expect(suggestions.some((suggestion) => suggestion.path === "Folder/Attachment.pdf")).toBe(true);
    expect(suggestions.some((suggestion) => suggestion.path === "Folder/Archive.bin")).toBe(false);

    vault.setConfig("showUnsupportedFiles", true);
    expect(metadataCache.getLinkSuggestions().some((suggestion) => suggestion.path === "Folder/Archive.bin")).toBe(true);
  });

  it("exposes Obsidian fileToLinktext link format semantics", async () => {
    const vault = new Vault();
    const metadataCache = new MetadataCache(vault);
    const note = await vault.create("Notes/Target.md", "");
    const image = await vault.createBinary("Assets/image.png", new ArrayBuffer(1));

    expect(metadataCache.fileToLinktext(note, "Daily/Today.md", true)).toBe("Target");
    expect(metadataCache.fileToLinktext(note, "Daily/Today.md", false)).toBe("Target.md");
    expect(metadataCache.fileToLinktext(image, "Daily/Today.md", true)).toBe("image.png");

    await vault.create("Archive/Target.md", "");

    expect(metadataCache.fileToLinktext(note, "Daily/Today.md", true)).toBe("Notes/Target");

    vault.setConfig("newLinkFormat", "relative");
    expect(metadataCache.fileToLinktext(note, "Daily/Today.md", true)).toBe("../Notes/Target");
    expect(metadataCache.fileToLinktext(image, "Daily/Today.md", true)).toBe("../Assets/image.png");

    vault.setConfig("newLinkFormat", "absolute");
    expect(metadataCache.fileToLinktext(note, "Daily/Today.md", true)).toBe("Notes/Target");
    expect(metadataCache.fileToLinktext(image, "Daily/Today.md", true)).toBe("Assets/image.png");
  });

  it("keeps aliases out of link resolution while using them as suggestions", async () => {
    const vault = new Vault();
    const viewRegistry = new ViewRegistry();
    const app = { appId: "test", vault, viewRegistry } as unknown as App;
    const metadataCache = new MetadataCache(vault, app);
    const note = await vault.create("Real.md", "---\naliases: Alias Name\n---\n# Real");

    await metadataCache.computeFileMetadataAsync(note);

    expect(metadataCache.getLinkSuggestions()).toContainEqual({ file: note, path: "Real", alias: "Alias Name" });
    expect(metadataCache.getFirstLinkpathDest("Alias Name", "")).toBeNull();
  });

  it("runs clean-cache callbacks immediately when clean and after resolver queues drain", async () => {
    vi.useFakeTimers();
    try {
      const adapter = new GatedReadAdapter();
      const vault = new Vault(adapter);
      const metadataCache = new MetadataCache(vault);
      const file = await vault.create("Source.md", "[[Target]]");
      const calls: string[] = [];

      metadataCache.onCleanCache(() => calls.push("immediate"));
      expect(calls).toEqual(["immediate"]);

      const compute = metadataCache.computeFileMetadataAsync(file);
      await adapter.waitForReadCount(1);
      metadataCache.onCleanCache(() => calls.push("after-clean"));
      expect(calls).toEqual(["immediate"]);

      adapter.releaseNext();
      await compute;
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual(["immediate", "after-clean"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues draining clean-cache callbacks after callback errors", async () => {
    vi.useFakeTimers();
    const error = new Error("boom");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const adapter = new GatedReadAdapter();
      const vault = new Vault(adapter);
      const metadataCache = new MetadataCache(vault);
      const calls: string[] = [];
      const file = await vault.create("Source.md", "[[Target]]");
      const compute = metadataCache.computeFileMetadataAsync(file);
      await adapter.waitForReadCount(1);
      metadataCache.onCleanCache(() => {
        throw error;
      });
      metadataCache.onCleanCache(() => calls.push("second"));

      adapter.releaseNext();
      await compute;
      await vi.advanceTimersByTimeAsync(0);

      expect(spy).toHaveBeenCalledWith(error);
      expect(calls).toEqual(["second"]);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("reuses clean file cache without reading or emitting changed and finished", async () => {
    vi.useFakeTimers();
    try {
      const adapter = new TestAdapter();
      const vault = new Vault(adapter);
      const metadataCache = new MetadataCache(vault);
      const file = await vault.create("Note.md", "# One");
      const changed: unknown[] = [];
      const finished: unknown[] = [];
      metadataCache.on("changed", (...args: unknown[]) => changed.push(args));
      metadataCache.on("finished", () => finished.push("finished"));

      await metadataCache.computeFileMetadataAsync(file);
      await vi.advanceTimersByTimeAsync(10);
      changed.length = 0;
      finished.length = 0;
      adapter.readCount = 0;

      await metadataCache.computeFileMetadataAsync(file);
      await vi.advanceTimersByTimeAsync(0);

      expect(adapter.readCount).toBe(0);
      expect(changed).toEqual([]);
      expect(finished).toEqual([]);
      expect(metadataCache.resolvedLinks[file.path]).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs metadata compute work in strict queue order", async () => {
    const adapter = new GatedReadAdapter();
    const vault = new Vault(adapter);
    const metadataCache = new MetadataCache(vault);
    const first = await vault.create("First.md", "# First");
    const second = await vault.create("Second.md", "# Second");

    const firstCompute = metadataCache.computeFileMetadataAsync(first);
    const secondCompute = metadataCache.computeFileMetadataAsync(second);
    await adapter.waitForReadCount(1);

    expect(adapter.started).toEqual(["First.md"]);

    adapter.releaseNext();
    await adapter.waitForReadCount(2);

    expect(adapter.started).toEqual(["First.md", "Second.md"]);

    adapter.releaseNext();
    await Promise.all([firstCompute, secondCompute]);
  });

  it("runs direct metadata worker requests through the same strict queue", async () => {
    const vault = new Vault();
    const metadataCache = new MetadataCache(vault);
    const originalWork = (metadataCache as unknown as { work(buffer: ArrayBuffer): Promise<unknown> }).work.bind(metadataCache);
    const started: string[] = [];
    let releaseFirst: (() => void) | null = null;
    (metadataCache as unknown as { work(buffer: ArrayBuffer): Promise<unknown> }).work = async (buffer) => {
      const source = new TextDecoder().decode(buffer);
      started.push(source);
      if (source === "# First") await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return originalWork(buffer);
    };

    const first = metadataCache.computeMetadataAsync(toBuffer("# First"));
    const second = metadataCache.computeMetadataAsync(toBuffer("# Second"));
    await Promise.resolve();

    expect(started).toEqual(["# First"]);

    releaseFirst?.();
    await Promise.all([first, second]);

    expect(started).toEqual(["# First", "# Second"]);
  });

  it("shows the single-file slow indexing notice only after ten seconds", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    try {
      const vault = new Vault();
      const metadataCache = new MetadataCache(vault);
      const file = await vault.create("Slow.md", "# Slow");
      let workStarted: (() => void) | null = null;
      const started = new Promise<void>((resolve) => {
        workStarted = resolve;
      });
      (metadataCache as unknown as { work(buffer: ArrayBuffer): Promise<unknown> }).work = async () => {
        workStarted?.();
        await new Promise<void>((resolve) => setTimeout(resolve, 10_001));
        return { headings: [{ heading: "Slow", level: 1, position: { line: 0 } }] };
      };

      const compute = metadataCache.computeFileMetadataAsync(file);
      await started;
      await vi.advanceTimersByTimeAsync(9_999);

      expect([...document.querySelectorAll(".notice")].some((el) => el.textContent?.includes("Slow.md"))).toBe(false);

      await vi.advanceTimersByTimeAsync(1);

      expect([...document.querySelectorAll(".notice")].some((el) => el.textContent?.includes("Slow.md"))).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      await compute;
    } finally {
      document.body.innerHTML = "";
      vi.useRealTimers();
    }
  });
});

class TestAdapter implements VaultAdapter {
  private files = new Map<string, { data: string; mtime: number; size: number }>();
  readCount = 0;

  async read(path: string): Promise<string> {
    this.readCount += 1;
    return this.files.get(path)?.data ?? "";
  }

  async write(path: string, data: string): Promise<void> {
    const previous = this.files.get(path)?.mtime ?? 0;
    this.files.set(path, { data, mtime: previous + 1, size: data.length });
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()];
  }

  async stat(path: string): Promise<{ mtime: number; size: number } | null> {
    const file = this.files.get(path);
    return file ? { mtime: file.mtime, size: file.size } : null;
  }
}

class GatedReadAdapter extends TestAdapter {
  readonly started: string[] = [];
  private releases: Array<() => void> = [];
  private waiters: Array<() => void> = [];

  override async read(path: string): Promise<string> {
    this.started.push(path);
    this.waiters.splice(0).forEach((resolve) => resolve());
    await new Promise<void>((resolve) => this.releases.push(resolve));
    return super.read(path);
  }

  releaseNext(): void {
    this.releases.shift()?.();
  }

  async waitForReadCount(count: number): Promise<void> {
    while (this.started.length < count) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}

function toBuffer(source: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(source);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function waitForClean(metadataCache: MetadataCache): Promise<void> {
  return new Promise((resolve) => metadataCache.onCleanCache(resolve));
}
