import { describe, expect, it } from "vitest";
import { LinkSuggestionManager } from "./LinkSuggestionManager";
import { MetadataCache } from "./MetadataCache";
import { Vault, type VaultAdapter } from "../vault/Vault";
import { ViewRegistry } from "../views/workspace/ViewRegistry";
import type { App } from "../app/App";

describe("LinkSuggestionManager", () => {
  it("sorts empty-query file and alias suggestions by mtime while skipping ignored files", async () => {
    const { app, metadataCache, vault } = createHarness();
    const older = await vault.create("Older.md", "---\naliases: Old Nick\n---\n# Older");
    const hidden = await vault.create("Hidden.md", "---\naliases: Secret\n---\n# Hidden");
    const newer = await vault.create("Newer.md", "# Newer\n[[Missing]]");
    vault.setConfig("userIgnoreFilters", ["Hidden.md"]);
    await metadataCache.computeFileMetadataAsync(older);
    await metadataCache.computeFileMetadataAsync(hidden);
    await metadataCache.computeFileMetadataAsync(newer);
    await waitForClean(metadataCache);

    const manager = new LinkSuggestionManager(app);
    const suggestions = manager.getFileSuggestions(null, "");

    expect(suggestions.map((suggestion) => suggestion.path)).toEqual(["Newer", "Older", "Older", "Missing"]);
    expect(suggestions.some((suggestion) => suggestion.path === "Hidden")).toBe(false);
    expect(suggestions.find((suggestion) => suggestion.type === "alias")).toMatchObject({ type: "alias", alias: "Old Nick", path: "Older" });
  });

  it("matches aliases only by alias text and downranks ignored non-empty matches", async () => {
    const { app, metadataCache, vault } = createHarness();
    const real = await vault.create("Real.md", "---\naliases: Nickname\n---\n# Real");
    const hidden = await vault.create("Hidden.md", "# Hidden");
    vault.setConfig("userIgnoreFilters", ["Hidden.md"]);
    await metadataCache.computeFileMetadataAsync(real);
    await metadataCache.computeFileMetadataAsync(hidden);
    await waitForClean(metadataCache);

    const manager = new LinkSuggestionManager(app);

    await expect(manager.getSuggestionsAsync(null, "Nick")).resolves.toContainEqual(expect.objectContaining({
      type: "alias",
      alias: "Nickname",
      path: "Real",
    }));
    expect((await manager.getSuggestionsAsync(null, "Real")).some((suggestion) => suggestion.type === "alias" && suggestion.path === "Real")).toBe(false);
    await expect(manager.getSuggestionsAsync(null, "Hidden")).resolves.toContainEqual(expect.objectContaining({
      type: "file",
      path: "Hidden",
      downranked: true,
    }));
  });

  it("uses basename-first file matching before full path matching", async () => {
    const { app, metadataCache, vault } = createHarness();
    const basenameHit = await vault.create("Folder/Needle.md", "# Needle");
    const pathHit = await vault.create("NeedleFolder/Other.md", "# Other");
    await metadataCache.computeFileMetadataAsync(pathHit);
    await metadataCache.computeFileMetadataAsync(basenameHit);

    const manager = new LinkSuggestionManager(app);
    const suggestions = await manager.getSuggestionsAsync(null, "Needle");

    expect(suggestions[0]).toMatchObject({ type: "file", path: "Folder/Needle" });
  });

  it("suggests display aliases for resolved link targets and falls back to typed display text", async () => {
    const { app, metadataCache, vault } = createHarness();
    const target = await vault.create("Target.md", "---\naliases:\n  - Display Name\n  - Other\n---\n# Heading");
    await metadataCache.computeFileMetadataAsync(target);

    const manager = new LinkSuggestionManager(app);

    await expect(manager.getSuggestionsAsync(null, "Target#Heading|Display", "")).resolves.toContainEqual(expect.objectContaining({
      type: "alias",
      alias: "Display Name",
      file: target,
      path: "Target#Heading",
    }));
    await expect(manager.getSuggestionsAsync(null, "Missing|Typed", "")).resolves.toEqual([{
      type: "alias",
      alias: "Typed",
      file: null,
      path: "Missing",
      score: 0,
      matches: [[0, 5]],
    }]);
  });

  it("suggests local headings and sanitizes heading subpaths", async () => {
    const { app, metadataCache, vault } = createHarness();
    const target = await vault.create("Target.md", "# Alpha: One\n## Child [[Two]]\n# Beta");
    await metadataCache.computeFileMetadataAsync(target);

    const manager = new LinkSuggestionManager(app);

    await expect(manager.getSuggestionsAsync(null, "Target#Alpha", "")).resolves.toContainEqual(expect.objectContaining({
      type: "heading",
      file: target,
      path: "Target",
      subpath: "#Alpha One",
      heading: "Alpha: One",
    }));
    await expect(manager.getSuggestionsAsync(null, "Target#Alpha: One#", "")).resolves.toContainEqual(expect.objectContaining({
      type: "heading",
      file: target,
      path: "Target",
      subpath: "#Alpha One#Child Two",
      heading: "Child [[Two]]",
    }));
    expect(manager.suggestionToLinkpath({
      type: "heading",
      file: target,
      path: "Target",
      subpath: "#ignored",
      level: 1,
      heading: "Alpha: One",
      score: 0,
      matches: null,
    })).toEqual({ path: "Target.md", subpath: "#Alpha One" });
  });

  it("suggests global headings while skipping ignored files", async () => {
    const { app, metadataCache, vault } = createHarness();
    const visible = await vault.create("Visible.md", "# Shared Heading");
    const hidden = await vault.create("Hidden.md", "# Shared Hidden");
    vault.setConfig("userIgnoreFilters", ["Hidden.md"]);
    await metadataCache.computeFileMetadataAsync(visible);
    await metadataCache.computeFileMetadataAsync(hidden);

    const manager = new LinkSuggestionManager(app);
    const suggestions = await manager.getSuggestionsAsync(null, "##Shared", "");

    expect(suggestions).toContainEqual(expect.objectContaining({
      type: "heading",
      file: visible,
      path: null,
      subpath: "#Shared Heading",
      heading: "Shared Heading",
    }));
    expect(suggestions.some((suggestion) => suggestion.type === "heading" && suggestion.file === hidden)).toBe(false);
  });

  it("falls back to typed local heading and converts linktext suggestions with subpaths", async () => {
    const { app, metadataCache, vault } = createHarness();
    await metadataCache.computeFileMetadataAsync(await vault.create("Target.md", "# Existing"));
    const manager = new LinkSuggestionManager(app);

    await expect(manager.getSuggestionsAsync(null, "Target#Missing", "")).resolves.toEqual([{
      type: "heading",
      file: null,
      path: "Target",
      subpath: "#Missing",
      heading: "Missing",
      level: 0,
      score: 0,
      matches: [[0, 8]],
    }]);
    expect(manager.suggestionToLinkpath({ type: "linktext", path: "Missing#Heading", score: 0, matches: null })).toEqual({
      path: "Missing",
      subpath: "#Heading",
    });
  });

  it("suggests local and global blocks from block cache with id matches ranked first", async () => {
    const { app, metadataCache, vault } = createHarness();
    const target = await vault.create("Target.md", "# Heading\n\nParagraph block ^para-id\n\n- List block");
    await metadataCache.computeFileMetadataAsync(target);
    const manager = new LinkSuggestionManager(app);

    await expect(manager.getSuggestionsAsync(null, "Target#^para", "")).resolves.toContainEqual(expect.objectContaining({
      type: "block",
      file: target,
      path: "Target",
      display: "Paragraph block",
      score: 0,
      idMatch: [[0, 4]],
    }));

    const global = await manager.getSuggestionsAsync(null, "^^List", "");
    expect(global).toContainEqual(expect.objectContaining({
      type: "block",
      file: target,
      path: null,
      display: "List block",
    }));
    const block = global.find((suggestion) => suggestion.type === "block" && suggestion.display === "List block");
    expect(block && manager.suggestionToLinkpath(block)).toEqual({ path: "Target.md", subpath: "#^" });
  });

  it("ensures missing block ids by writing a KA-style insertion through the vault", async () => {
    const { app, metadataCache, vault } = createHarness();
    const target = await vault.create("Target.md", "Paragraph block");
    await metadataCache.computeFileMetadataAsync(target);
    const manager = new LinkSuggestionManager(app);
    const suggestion = (await manager.getSuggestionsAsync(null, "Target#^Paragraph", "")).find((item) => item.type === "block");
    if (!suggestion || suggestion.type !== "block") throw new Error("missing block suggestion");

    const result = await manager.ensureBlockSuggestionId(suggestion, "abc123");

    expect(result.blockId).toBe("abc123");
    expect(result.insertion).toMatchObject({ addition: " ^abc123", newlines: 0 });
    expect(await vault.read(target)).toBe("Paragraph block ^abc123");
    expect(manager.suggestionToLinkpath(suggestion)).toEqual({ path: "Target.md", subpath: "#^abc123" });
  });

  it("creates wiki replacements for file, alias, heading, linktext, and block suggestions without writing ids", async () => {
    const { app, metadataCache, vault } = createHarness();
    app.vault.setConfig("newLinkFormat", "relative");
    const file = await vault.create("Folder/Target.md", "# Heading\n\nParagraph block");
    await metadataCache.computeFileMetadataAsync(file);
    const manager = new LinkSuggestionManager(app);
    const block = (await manager.getSuggestionsAsync(null, "Target#^Paragraph", "")).find((item) => item.type === "block");
    if (!block || block.type !== "block") throw new Error("missing block suggestion");

    expect(manager.createLinkSuggestionReplacement({ type: "file", file, path: "Folder/Target", score: 0, matches: null }, {
      query: "Target",
      start: 2,
      end: 8,
      sourcePath: "Source.md",
      mode: "markdown",
    })).toMatchObject({ replacement: "[[Folder/Target|Target]]", blockId: null });

    expect(manager.createLinkSuggestionReplacement({ type: "alias", file, path: "Folder/Target", alias: "Alias", score: 0, matches: null }, {
      query: "Alias",
      start: 0,
      end: 5,
      sourcePath: "Source.md",
      tailText: "|Kept display]]",
      mode: "markdown",
    })).toMatchObject({ replacement: "[[Folder/Target|Kept display]]", end: 20 });

    expect(manager.createLinkSuggestionReplacement({
      type: "heading",
      file,
      path: "Folder/Target",
      subpath: "#Heading",
      level: 1,
      heading: "Heading",
      score: 0,
      matches: null,
    }, {
      query: "Target#Heading",
      start: 0,
      end: 14,
      sourcePath: "Source.md",
      key: "#",
      mode: "markdown",
    })).toMatchObject({ replacement: "[[Folder/Target#Heading#|Heading]]" });

    expect(manager.createLinkSuggestionReplacement({ type: "linktext", path: "Missing", score: 0, matches: null }, {
      query: "Missing",
      start: 0,
      end: 7,
      mode: "markdown",
    })).toMatchObject({ replacement: "[[Missing|Missing]]" });

    const blockReplacement = manager.createLinkSuggestionReplacement(block, {
      query: "Target#^Paragraph",
      start: 0,
      end: 17,
      sourcePath: "Source.md",
      mode: "markdown",
      blockId: "abc123",
    });
    expect(blockReplacement).toMatchObject({ replacement: "[[Folder/Target#^abc123]]", blockId: "abc123" });
    expect(await vault.read(file)).toBe("# Heading\n\nParagraph block");
  });

  it("creates markdown-link replacements only in markdown context", async () => {
    const { app, metadataCache, vault } = createHarness();
    const file = await vault.create("Notes/Target.md", "# Heading");
    await metadataCache.computeFileMetadataAsync(file);
    app.vault.setConfig("useMarkdownLinks", true);
    app.vault.setConfig("newLinkFormat", "relative");
    const manager = new LinkSuggestionManager(app);

    expect(manager.createLinkSuggestionReplacement({ type: "alias", file, path: "Notes/Target", alias: "Alias", score: 0, matches: null }, {
      query: "Alias",
      start: 0,
      end: 5,
      sourcePath: "Daily/Today.md",
      mode: "markdown",
    })).toMatchObject({ replacement: "[Alias](../Notes/Target.md)" });

    expect(manager.createLinkSuggestionReplacement({ type: "alias", file, path: "Notes/Target", alias: "Alias", score: 0, matches: null }, {
      query: "Alias",
      start: 0,
      end: 5,
      sourcePath: "Daily/Today.md",
      mode: "frontmatter",
    })).toMatchObject({ replacement: "[[../Notes/Target|Alias]]" });
  });
});

function createHarness(): { app: App; metadataCache: MetadataCache; vault: Vault } {
  const vault = new Vault(new TimestampedAdapter());
  const viewRegistry = new ViewRegistry();
  const app = {
    appId: "test",
    vault,
    viewRegistry,
  } as unknown as App;
  const metadataCache = new MetadataCache(vault, app);
  (app as { metadataCache: MetadataCache }).metadataCache = metadataCache;
  return { app, metadataCache, vault };
}

function waitForClean(metadataCache: MetadataCache): Promise<void> {
  return new Promise((resolve) => metadataCache.onCleanCache(resolve));
}

class TimestampedAdapter implements VaultAdapter {
  private files = new Map<string, { data: string; mtime: number; size: number }>();
  private clock = 0;

  async read(path: string): Promise<string> {
    return this.files.get(path)?.data ?? "";
  }

  async write(path: string, data: string): Promise<void> {
    this.clock += 1;
    this.files.set(path, { data, mtime: this.clock, size: data.length });
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
