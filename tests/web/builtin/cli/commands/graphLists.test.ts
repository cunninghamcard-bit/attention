import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";

// Real App + in-memory vault. The graph commands read
// metadataCache.resolvedLinks/unresolvedLinks, so seeding waits for the
// metadata cache to finish indexing and resolving links.
async function seededApp(files: Record<string, string> = {}): Promise<App> {
  const app = new App(document.createElement("div"));
  for (const [path, content] of Object.entries(files)) await app.vault.create(path, content);
  await app.ready;
  await new Promise<void>((resolve) => app.metadataCache.onCleanCache(resolve));
  return app;
}

// A.md links Note twice, B.md once; Missing is unresolved from both files,
// Ghost only from B.md; Pic.png is a non-markdown file.
function linkedVault(): Record<string, string> {
  return {
    "A.md": "[[Note]] [[Note]] [[Missing]]",
    "B.md": "[[Note]] [[Missing]] [[Ghost]]",
    "Note.md": "no links here",
    "Pic.png": "binary-ish",
  };
}

describe("backlinks", () => {
  it("lists linking files sorted, one per line, no header", async () => {
    const app = await seededApp(linkedVault());
    expect(await app.cli.handleCli(["backlinks", "path=Note.md"])).toBe("A.md\nB.md");
  });

  it("counts adds a tab-separated count column", async () => {
    const app = await seededApp(linkedVault());
    expect(await app.cli.handleCli(["backlinks", "path=Note.md", "counts"])).toBe("A.md\t2\nB.md\t1");
  });

  it("total sums link occurrences, not linking files, and runs before the empty message", async () => {
    const app = await seededApp(linkedVault());
    expect(await app.cli.handleCli(["backlinks", "path=Note.md", "total"])).toBe("3");
    expect(await app.cli.handleCli(["backlinks", "path=A.md", "total"])).toBe("0");
  });

  it("returns the exact empty message when there are no backlinks", async () => {
    const app = await seededApp(linkedVault());
    expect(await app.cli.handleCli(["backlinks", "path=A.md"])).toBe("No backlinks found.");
  });

  it("format=json emits 2-space-indented objects with string counts", async () => {
    const app = await seededApp(linkedVault());
    expect(await app.cli.handleCli(["backlinks", "path=Note.md", "counts", "format=json"])).toBe(
      JSON.stringify([{ file: "A.md", count: "2" }, { file: "B.md", count: "1" }], null, 2),
    );
    // Bare `json` is the dispatch format shorthand.
    expect(await app.cli.handleCli(["backlinks", "path=Note.md", "json"])).toBe(
      JSON.stringify([{ file: "A.md" }, { file: "B.md" }], null, 2),
    );
  });

  it("format=csv separates with commas and an unrecognized format falls through to tsv", async () => {
    const app = await seededApp(linkedVault());
    expect(await app.cli.handleCli(["backlinks", "path=Note.md", "counts", "format=csv"])).toBe("A.md,2\nB.md,1");
    expect(await app.cli.handleCli(["backlinks", "path=Note.md", "counts", "format=xml"])).toBe("A.md\t2\nB.md\t1");
  });

  it("resolves file= like a wikilink and falls back to the active file", async () => {
    const app = await seededApp(linkedVault());
    expect(await app.cli.handleCli(["backlinks", "file=Note", "total"])).toBe("3");
    const note = app.vault.getFileByPath("Note.md");
    await app.workspace.openFile(note, { active: true });
    expect(await app.cli.handleCli(["backlinks", "total"])).toBe("3");
  });

  it("throws the exact resolution error strings", async () => {
    const app = await seededApp({ ...linkedVault(), "Folder/Sub.md": "sub" });
    await expect(app.cli.handleCli(["backlinks", "path=Nope.md"])).rejects.toBe('File "Nope.md" not found.');
    await expect(app.cli.handleCli(["backlinks", "path=Folder"])).rejects.toBe('"Folder" is a folder, not a file.');
    await expect(app.cli.handleCli(["backlinks", "file=Nope"])).rejects.toBe('File "Nope" not found.');
    await expect(app.cli.handleCli(["backlinks"])).rejects.toBe(
      "No active file. Use file=<name> or path=<path> to specify a file.",
    );
  });
});

describe("unresolved", () => {
  it("lists distinct link texts sorted, no header", async () => {
    const app = await seededApp(linkedVault());
    expect(await app.cli.handleCli(["unresolved"])).toBe("Ghost\nMissing");
  });

  it("counts adds summed occurrence counts", async () => {
    const app = await seededApp(linkedVault());
    expect(await app.cli.handleCli(["unresolved", "counts"])).toBe("Ghost\t1\nMissing\t2");
  });

  it("verbose joins sources in encounter order and wins over counts", async () => {
    const app = await seededApp(linkedVault());
    const expected = "Ghost\t1\tB.md\nMissing\t2\tA.md, B.md";
    expect(await app.cli.handleCli(["unresolved", "verbose"])).toBe(expected);
    expect(await app.cli.handleCli(["unresolved", "verbose", "counts"])).toBe(expected);
  });

  it("total counts distinct link texts, not occurrences", async () => {
    const app = await seededApp(linkedVault());
    expect(await app.cli.handleCli(["unresolved", "total"])).toBe("2");
  });

  it("csv double-quotes the joined sources cell; json keeps sources a joined string", async () => {
    const app = await seededApp(linkedVault());
    expect(await app.cli.handleCli(["unresolved", "verbose", "format=csv"])).toBe(
      'Ghost,1,B.md\nMissing,2,"A.md, B.md"',
    );
    expect(await app.cli.handleCli(["unresolved", "verbose", "format=json"])).toBe(
      JSON.stringify([
        { link: "Ghost", count: "1", sources: "B.md" },
        { link: "Missing", count: "2", sources: "A.md, B.md" },
      ], null, 2),
    );
  });

  it("returns the exact empty message, and total 0 before it", async () => {
    const app = await seededApp({ "Note.md": "no links" });
    expect(await app.cli.handleCli(["unresolved"])).toBe("No unresolved links found.");
    expect(await app.cli.handleCli(["unresolved", "total"])).toBe("0");
  });
});

describe("orphans", () => {
  it("lists files (all extensions) never appearing as a link target, sorted", async () => {
    const app = await seededApp(linkedVault());
    expect(await app.cli.handleCli(["orphans"])).toBe("A.md\nB.md\nPic.png");
    // `all` is declared but dead in real Obsidian — output is identical.
    expect(await app.cli.handleCli(["orphans", "all"])).toBe("A.md\nB.md\nPic.png");
  });

  it("total counts orphan files and 0 wins over the empty message", async () => {
    const app = await seededApp(linkedVault());
    expect(await app.cli.handleCli(["orphans", "total"])).toBe("3");
    const linked = await seededApp({ "X.md": "[[Y]]", "Y.md": "[[X]]" });
    expect(await linked.cli.handleCli(["orphans", "total"])).toBe("0");
  });

  it("returns the exact empty message when every file is linked", async () => {
    const app = await seededApp({ "X.md": "[[Y]]", "Y.md": "[[X]]" });
    expect(await app.cli.handleCli(["orphans"])).toBe("No orphan files found.");
  });
});

describe("deadends", () => {
  it("lists files with no resolved outgoing links; unresolved-only files still qualify", async () => {
    const app = await seededApp({ ...linkedVault(), "C.md": "[[Missing]]" });
    expect(await app.cli.handleCli(["deadends"])).toBe("C.md\nNote.md\nPic.png");
    expect(await app.cli.handleCli(["deadends", "all"])).toBe("C.md\nNote.md\nPic.png");
  });

  it("total counts dead ends and 0 wins over the empty message", async () => {
    const app = await seededApp(linkedVault());
    expect(await app.cli.handleCli(["deadends", "total"])).toBe("2");
    const linked = await seededApp({ "X.md": "[[Y]]", "Y.md": "[[X]]" });
    expect(await linked.cli.handleCli(["deadends", "total"])).toBe("0");
  });

  it("returns the exact empty message when every file links out", async () => {
    const app = await seededApp({ "X.md": "[[Y]]", "Y.md": "[[X]]" });
    expect(await app.cli.handleCli(["deadends"])).toBe("No dead-end files found.");
  });
});

describe("registration", () => {
  it("all four commands appear in help with their flags", async () => {
    const app = await seededApp();
    const help = await app.cli.handleCli(["help"]);
    for (const id of ["backlinks", "unresolved", "orphans", "deadends"]) expect(help).toContain(id);
    expect(await app.cli.handleCli(["help", "orphans"])).toContain("Include non-markdown files");
  });
});
