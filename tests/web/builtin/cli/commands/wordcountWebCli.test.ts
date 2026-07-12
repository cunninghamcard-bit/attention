import { describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import type { InternalPluginWrapper } from "@web/plugin/InternalPluginWrapper";
import { countWords } from "@web/builtin/WordCount";

function pluginOrThrow(app: App, id: string): InternalPluginWrapper {
  const plugin = app.internalPlugins.getPluginById(id);
  if (!plugin) throw new Error(`Expected core plugin ${id}`);
  return plugin;
}

// word-count is defaultOn, so awaiting corePluginsReady flips the buffered
// CLI handler live — the same path the real wiring takes.
async function wordcountApp(): Promise<App> {
  const app = new App(document.createElement("div"));
  await app.corePluginsReady;
  await app.vault.create("Note.md", "hello world");
  await app.vault.create("Frontmatter.md", "---\ntitle: x\n---\nhello world");
  await app.vault.create("data.txt", "plain text");
  await app.vault.create("Folder/Sub.md", "sub");
  return app;
}

// webviewer is defaultOn:false — enable it explicitly after corePluginsReady.
async function webApp(): Promise<App> {
  const app = new App(document.body.appendChild(document.createElement("div")));
  await app.corePluginsReady;
  await app.internalPlugins.enable("webviewer");
  return app;
}

describe("wordcount CLI command", () => {
  it("returns the exact two-line shape by default", async () => {
    const app = await wordcountApp();
    expect(await app.cli.handleCli(["wordcount", "path=Note.md"])).toBe("words: 2\ncharacters: 11");
  });

  it("returns just the number for words= or characters=", async () => {
    const app = await wordcountApp();
    expect(await app.cli.handleCli(["wordcount", "path=Note.md", "words"])).toBe("2");
    expect(await app.cli.handleCli(["wordcount", "path=Note.md", "characters"])).toBe("11");
  });

  it("falls through to the two-line shape when BOTH flags are set", async () => {
    const app = await wordcountApp();
    expect(await app.cli.handleCli(["wordcount", "path=Note.md", "words", "characters"])).toBe("words: 2\ncharacters: 11");
  });

  it("excludes frontmatter from both counts", async () => {
    const app = await wordcountApp();
    expect(await app.cli.handleCli(["wordcount", "path=Frontmatter.md"])).toBe("words: 2\ncharacters: 11");
  });

  it("resolves file= as a linkpath", async () => {
    const app = await wordcountApp();
    expect(await app.cli.handleCli(["wordcount", "file=Note"])).toBe("words: 2\ncharacters: 11");
  });

  it("counts the active file when neither file= nor path= is given", async () => {
    const app = await wordcountApp();
    const file = app.metadataCache.getFirstLinkpathDest("Note", "");
    if (!file) throw new Error("Expected Note.md");
    await app.workspace.openFile(file, { active: true });
    expect(await app.cli.handleCli(["wordcount"])).toBe("words: 2\ncharacters: 11");
  });

  it("rejects non-markdown files before reading", async () => {
    const app = await wordcountApp();
    await expect(app.cli.handleCli(["wordcount", "path=data.txt"])).rejects.toBe(
      "Word count is only available for markdown files.",
    );
  });

  it("throws the resolver error strings verbatim", async () => {
    const app = await wordcountApp();
    await expect(app.cli.handleCli(["wordcount", "path=Nope.md"])).rejects.toBe('File "Nope.md" not found.');
    await expect(app.cli.handleCli(["wordcount", "path=Folder"])).rejects.toBe('"Folder" is a folder, not a file.');
    await expect(app.cli.handleCli(["wordcount", "file=Ghost"])).rejects.toBe('File "Ghost" not found.');
    await expect(app.cli.handleCli(["wordcount"])).rejects.toBe(
      "No active file. Use file=<name> or path=<path> to specify a file.",
    );
  });
});

// The CLI reuses countWords directly, so pin the real word-count regex (Aee)
// semantics here: WordCount has no test file of its own.
describe("countWords (real Aee regex semantics)", () => {
  it("counts digit runs with , or . group separators as one word", () => {
    expect(countWords("1,000").words).toBe(1);
    expect(countWords("3.14").words).toBe(1);
    expect(countWords("1,000,000.50").words).toBe(1);
  });

  it("counts a run of hyphens as one word", () => {
    expect(countWords("--").words).toBe(1);
  });

  it("counts CJK one word per character, Hangul one word per run", () => {
    expect(countWords("你好世界").words).toBe(4);
    expect(countWords("ひらがな").words).toBe(4);
    expect(countWords("안녕하세요").words).toBe(1);
  });

  it("keeps apostrophe and hyphen joins inside one word", () => {
    expect(countWords("don't stop").words).toBe(2);
    expect(countWords("well-known").words).toBe(1);
  });

  it("counts zero words and whitespace-free characters for empty-ish text", () => {
    expect(countWords("")).toEqual({ words: 0, characters: 0 });
    expect(countWords(" \n\t")).toEqual({ words: 0, characters: 0 });
  });
});

describe("web CLI command", () => {
  it("prefixes https:// when the url has no scheme and opens a webviewer leaf", async () => {
    const app = await webApp();
    expect(await app.cli.handleCli(["web", "url=example.com"])).toBe("Opened: https://example.com");
    await vi.waitFor(() => expect(app.workspace.getLeavesOfType("webviewer")).toHaveLength(1));
  });

  it("leaves urls that already contain :// untouched", async () => {
    const app = await webApp();
    expect(await app.cli.handleCli(["web", "url=ftp://files.example"])).toBe("Opened: ftp://files.example");
  });

  it("reuses the active leaf without newtab and opens a new tab with it", async () => {
    const app = await webApp();
    const file = await app.vault.create("Note.md", "hello");
    await app.workspace.openFile(file, { active: true });
    const activeLeaf = app.workspace.activeLeaf;
    // No newtab: the active leaf's view is replaced with a webviewer view.
    await app.cli.handleCli(["web", "url=one.example"]);
    await vi.waitFor(() => expect(activeLeaf?.view?.getViewType()).toBe("webviewer"));
    expect(app.workspace.getLeavesOfType("webviewer")).toHaveLength(1);
    await app.cli.handleCli(["web", "url=two.example", "newtab"]);
    await vi.waitFor(() => expect(app.workspace.getLeavesOfType("webviewer")).toHaveLength(2));
  });

  it("requires url (framework validation plus the handler's own guard)", async () => {
    const app = await webApp();
    // The dispatcher's required-flag check fires first...
    await expect(app.cli.handleCli(["web"])).rejects.toMatch(/^Missing required parameter: url=<url>/);
    // ...so exercise the real handler's verbatim manual guard directly.
    const cmd = app.cli.handlers.get("web");
    if (!cmd) throw new Error("Expected web handler");
    let caught: unknown;
    try {
      cmd.handler({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe("Missing required parameter: url\nUsage: web url=<url>");
  });
});
