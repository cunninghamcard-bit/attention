import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import type { TFile } from "@web/vault/TAbstractFile";

// Drive the commands through the faithful `app.cli.handleCli` against a real
// (in-memory) vault, with the handlers carried by the app's real plugins.
// outline is defaultOn; outgoing-link is a default-off seam here, so `links`
// only exists once that plugin is enabled (faithful to the carrier contract).
async function seededApp(): Promise<App> {
  const app = new App(document.createElement("div"));
  await app.corePluginsReady;
  await app.internalPlugins.enable("outgoing-link");

  await seed(app, "Folder/Sub.md", "sub");
  await seed(app, "Other.md", "other");
  await seed(app, "Image.png", "png");
  // Frontmatter link + duplicate inline links + subpath link + embed.
  await seed(app, "Note.md", '---\nrelated: "[[Other]]"\n---\n[[Sub]] then [[Sub]] again, [[Missing#Section]], ![[Image.png]]');
  await seed(app, "NoLinks.md", "plain text without links");
  await seed(app, "Doc.md", "# A\n## B\n### C\n## D\n# E");
  await seed(app, "data.txt", "not markdown");
  return app;
}

async function seed(app: App, path: string, content: string): Promise<TFile> {
  const file = await app.vault.create(path, content);
  await app.metadataCache.computeFileMetadata(file);
  return file;
}

describe("links CLI command", () => {
  it("lists deduplicated, sorted destinations across frontmatter links, links, and embeds", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["links", "path=Note.md"])).toBe(
      "Folder/Sub.md\nImage.png\nMissing (unresolved)\nOther.md",
    );
  });

  it("resolves file= like a wikilink", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["links", "file=Note"])).toBe(
      "Folder/Sub.md\nImage.png\nMissing (unresolved)\nOther.md",
    );
  });

  it("returns the count with total, including 0 for a link-less file", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["links", "path=Note.md", "total"])).toBe("4");
    // total is checked before the empty case: a file with no links counts "0".
    expect(await app.cli.handleCli(["links", "path=NoLinks.md", "total"])).toBe("0");
  });

  it('returns "No links found." for a file without links', async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["links", "path=NoLinks.md"])).toBe("No links found.");
  });

  it("throws the shared resolver errors as plain strings", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["links", "path=Nope.md"])).rejects.toBe('File "Nope.md" not found.');
    await expect(app.cli.handleCli(["links", "path=Folder"])).rejects.toBe('"Folder" is a folder, not a file.');
    await expect(app.cli.handleCli(["links", "file=Nope"])).rejects.toBe('File "Nope" not found.');
    await expect(app.cli.handleCli(["links"])).rejects.toBe(
      "No active file. Use file=<name> or path=<path> to specify a file.",
    );
  });

  it("falls back to the active file", async () => {
    const app = await seededApp();
    const note = app.vault.getFileByPath("Note.md")!;
    await app.workspace.openFile(note, { active: true });
    expect(await app.cli.handleCli(["links", "total"])).toBe("4");
  });
});

describe("outline CLI command", () => {
  it("renders the ASCII tree by default, with connectors on top-level headings", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["outline", "path=Doc.md"])).toBe(
      "├── A\n│   ├── B\n│   │   └── C\n│   └── D\n└── E",
    );
  });

  it("falls through to the tree for unknown format values", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["outline", "path=Doc.md", "format=garbage"])).toBe(
      "├── A\n│   ├── B\n│   │   └── C\n│   └── D\n└── E",
    );
  });

  it("renders markdown headings with format=md", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["outline", "path=Doc.md", "format=md"])).toBe("# A\n## B\n### C\n## D\n# E");
  });

  it("renders pretty-printed JSON with 1-based lines with format=json (and the json shorthand)", async () => {
    const app = await seededApp();
    const expected = JSON.stringify(
      [
        { level: 1, heading: "A", line: 1 },
        { level: 2, heading: "B", line: 2 },
        { level: 3, heading: "C", line: 3 },
        { level: 2, heading: "D", line: 4 },
        { level: 1, heading: "E", line: 5 },
      ],
      null,
      2,
    );
    expect(await app.cli.handleCli(["outline", "path=Doc.md", "format=json"])).toBe(expected);
    expect(await app.cli.handleCli(["outline", "path=Doc.md", "json"])).toBe(expected);
  });

  it("returns the heading count with total", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["outline", "path=Doc.md", "total"])).toBe("5");
  });

  it('returns "No headings found." for a heading-less file, even with total', async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["outline", "path=NoLinks.md"])).toBe("No headings found.");
    // The empty check runs before total (asymmetric with links, faithful).
    expect(await app.cli.handleCli(["outline", "path=NoLinks.md", "total"])).toBe("No headings found.");
  });

  it("rejects non-markdown files", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["outline", "path=data.txt"])).rejects.toBe("File is not a markdown file.");
  });

  it("throws the shared resolver errors as plain strings", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["outline", "path=Nope.md"])).rejects.toBe('File "Nope.md" not found.');
    await expect(app.cli.handleCli(["outline"])).rejects.toBe(
      "No active file. Use file=<name> or path=<path> to specify a file.",
    );
  });

  it("falls back to the active file", async () => {
    const app = await seededApp();
    const doc = app.vault.getFileByPath("Doc.md")!;
    await app.workspace.openFile(doc, { active: true });
    expect(await app.cli.handleCli(["outline", "total"])).toBe("5");
  });
});
