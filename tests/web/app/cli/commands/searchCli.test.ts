import { describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";

// The global-search plugin owns these handlers; register them on its real
// wrapper (enabled by defaults) and drive them through `app.cli.handleCli`
// against a real in-memory vault.
async function seededApp(): Promise<App> {
  const app = new App(document.createElement("div"));
  await app.corePluginsReady;
  const plugin = app.internalPlugins.getPluginById("global-search");
  if (!plugin) throw new Error("global-search plugin missing");
  await app.vault.create("Alpha.md", "hello world hello\n  indented hello");
  await app.vault.create("Folder/Beta.md", "hello there");
  await app.vault.create("Folder2/Trick.md", "hello trick");
  await app.vault.create("Gamma.md", "goodbye");
  await app.vault.create("script.js", "hello from code");
  return app;
}

describe("search", () => {
  it("lists matched markdown file paths, one per line (never non-md files)", async () => {
    const app = await seededApp();
    const out = await app.cli.handleCli(["search", "query=hello"]);
    // script.js matches the engine but only markdown files are searched; order
    // is vault tree traversal (as real getMarkdownFiles), not the engine's path sort.
    expect(out.split("\n")).toEqual(["Alpha.md", "Folder2/Trick.md", "Folder/Beta.md"]);
  });

  it("path= is a folder prefix: Folder does not match Folder2", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["search", "query=hello", "path=Folder"])).toBe(
      "Folder/Beta.md",
    );
    expect(await app.cli.handleCli(["search", "query=hello", "path=Folder/"])).toBe(
      "Folder/Beta.md",
    );
  });

  it("limit caps files in vault order; limit=0 means unlimited", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["search", "query=hello", "limit=1"])).toBe("Alpha.md");
    // Vault order, not engine path order (which would put Folder/Beta.md second).
    expect(await app.cli.handleCli(["search", "query=hello", "limit=2"])).toBe(
      "Alpha.md\nFolder2/Trick.md",
    );
    expect(
      (await app.cli.handleCli(["search", "query=hello", "limit=0"])).split("\n"),
    ).toHaveLength(3);
  });

  it("a filename-only hit (word in name, not body) is a bare path line and counts in total", async () => {
    const app = await seededApp();
    await app.vault.create("Hello.md", "no greeting in the body");
    expect(await app.cli.handleCli(["search", "query=hello"])).toBe(
      "Hello.md\nAlpha.md\nFolder2/Trick.md\nFolder/Beta.md",
    );
    expect(await app.cli.handleCli(["search", "query=hello", "total"])).toBe("4");
  });

  it("total returns the file count, ignores limit, and wins over the empty check", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["search", "query=hello", "total"])).toBe("3");
    expect(await app.cli.handleCli(["search", "query=hello", "total", "limit=1"])).toBe("3");
    expect(await app.cli.handleCli(["search", "query=hello", "total", "format=json"])).toBe(
      '{"total":3}',
    );
    expect(await app.cli.handleCli(["search", "query=zzzz", "total"])).toBe("0");
    expect(await app.cli.handleCli(["search", "query=zzzz", "total", "format=json"])).toBe(
      '{"total":0}',
    );
  });

  it("format=json returns a bare JSON array of paths", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["search", "query=world", "format=json"])).toBe('["Alpha.md"]');
  });

  it("zero matches returns 'No matches found.' even with format=json", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["search", "query=zzzz"])).toBe("No matches found.");
    expect(await app.cli.handleCli(["search", "query=zzzz", "format=json"])).toBe(
      "No matches found.",
    );
  });

  it("case makes the search case sensitive", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["search", "query=HELLO", "case"])).toBe("No matches found.");
    expect((await app.cli.handleCli(["search", "query=HELLO"])).split("\n")).toHaveLength(3);
  });

  it("throws the raw missing-query string", async () => {
    const app = await seededApp();
    // Absent flag is caught by the registry's required validation...
    await expect(app.cli.handleCli(["search"])).rejects.toMatch(
      /^Missing required parameter: query/,
    );
    // ...an empty value reaches the handler's own check (raw string, not Error).
    await expect(app.cli.handleCli(["search", "query="])).rejects.toBe(
      "Missing required parameter: query",
    );
  });
});

describe("search:context", () => {
  it("formats matches as 'file:LINE: text' with 1-based lines and trimmed text", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["search:context", "query=indented"])).toBe(
      "Alpha.md:2: indented hello",
    );
    expect(await app.cli.handleCli(["search:context", "query=hello", "path=Folder"])).toBe(
      "Folder/Beta.md:1: hello there",
    );
  });

  it("repeats duplicate lines for multiple matches on one line; limit caps files not lines", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["search:context", "query=hello", "limit=1"])).toBe(
      "Alpha.md:1: hello world hello\nAlpha.md:1: hello world hello\nAlpha.md:2: indented hello",
    );
  });

  it("a match without content offsets contributes a bare path line", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["search:context", "query=file:trick"])).toBe(
      "Folder2/Trick.md",
    );
  });

  it("a filename-only hit contributes a bare path line", async () => {
    const app = await seededApp();
    await app.vault.create("Hello.md", "no greeting in the body");
    const lines = (await app.cli.handleCli(["search:context", "query=hello"])).split("\n");
    expect(lines[0]).toBe("Hello.md");
  });

  it("format=json returns the raw result array", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["search:context", "query=indented", "format=json"])).toBe(
      '[{"file":"Alpha.md","matches":[{"line":2,"text":"indented hello"}]}]',
    );
  });

  it("zero matches returns 'No matches found.' even with format=json", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["search:context", "query=zzzz"])).toBe("No matches found.");
    expect(await app.cli.handleCli(["search:context", "query=zzzz", "format=json"])).toBe(
      "No matches found.",
    );
  });

  it("throws the raw missing-query string", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["search:context"])).rejects.toMatch(
      /^Missing required parameter: query/,
    );
    await expect(app.cli.handleCli(["search:context", "query="])).rejects.toBe(
      "Missing required parameter: query",
    );
  });
});

describe("search:open", () => {
  it("opens the search side leaf with the query and echoes it", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["search:open", "query=foo bar"])).toBe(
      "Opened search: foo bar",
    );
    // The handler is fire-and-forget; wait until the leaf state lands.
    await vi.waitFor(() => {
      const leaf = app.workspace.getLeavesOfType("search")[0];
      expect((leaf?.view as unknown as { getQuery(): string } | undefined)?.getQuery()).toBe(
        "foo bar",
      );
    });
  });

  it("returns 'Opened search' without a query", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["search:open"])).toBe("Opened search");
    await vi.waitFor(() => expect(app.workspace.getLeavesOfType("search")).toHaveLength(1));
  });
});
