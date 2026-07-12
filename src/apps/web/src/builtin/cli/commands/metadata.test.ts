import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../../app/App";
import type { TFile } from "../../../vault/TAbstractFile";

// The metadata commands are registered per-lane (wiring happens after all
// lanes land), so each test registers them onto a fresh real App and drives
// them through the faithful `app.cli.handleCli` entry.

const ALPHA = `---
tags: [foo, bar]
aliases: [A1, Shared]
status: draft
count: 2
empty:
---
# Alpha
#foo #baz
`;

const BETA = `---
tags:
  - foo
aliases: Shared
done: false
---
body #qux #Baz
`;

async function seededApp(): Promise<{ app: App; alpha: TFile; beta: TFile; gamma: TFile }> {
  const app = new App(document.createElement("div"));
  const seed = async (path: string, content: string): Promise<TFile> => {
    const file = await app.vault.create(path, content);
    await app.metadataCache.computeFileMetadata(file);
    return file;
  };
  const alpha = await seed("Alpha.md", ALPHA);
  const beta = await seed("Beta.md", BETA);
  const gamma = await seed("Folder/Gamma.md", "plain body");
  return { app, alpha, beta, gamma };
}

// Vault-mode `properties` reads the metadataTypeManager cache; make it
// deterministic (reserved types + a fresh scan) instead of racing app startup.
async function refreshProperties(app: App): Promise<void> {
  await app.metadataTypeManager.load();
  app.metadataTypeManager.updatePropertyInfoCache();
}

beforeEach(() => {
  Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
});

describe("tags", () => {
  it("lists vault tags sorted by name, one per line", async () => {
    const { app } = await seededApp();
    // '#baz' (Alpha) and '#Baz' (Beta) merge case-insensitively into one entry.
    expect(await app.cli.handleCli(["tags"])).toBe("#bar\n#baz\n#foo\n#qux");
  });

  it("counts occurrences (frontmatter + inline, casings merged)", async () => {
    const { app } = await seededApp();
    expect(await app.cli.handleCli(["tags", "counts"])).toBe("#bar\t1\n#baz\t2\n#foo\t3\n#qux\t1");
  });

  it("rolls nested tag occurrences up into their parents", async () => {
    const { app } = await seededApp();
    const file = await app.vault.create("Nested.md", "#foo/bar #foo/bar/deep");
    await app.metadataCache.computeFileMetadata(file);
    const counts = (await app.cli.handleCli(["tags", "counts"])).split("\n");
    expect(counts).toContain("#foo\t5");
    expect(counts).toContain("#foo/bar\t2");
    expect(counts).toContain("#foo/bar/deep\t1");
  });

  it("skips files matched by userIgnoreFilters", async () => {
    const { app } = await seededApp();
    app.vault.setConfig("userIgnoreFilters", ["Beta.md"]);
    expect(await app.cli.handleCli(["tags", "counts"])).toBe("#bar\t1\n#baz\t1\n#foo\t2");
  });

  it("sort=count orders descending by count", async () => {
    const { app } = await seededApp();
    const out = await app.cli.handleCli(["tags", "counts", "sort=count"]);
    expect(out.split("\n")[0]).toBe("#foo\t3");
  });

  it("total returns the distinct tag count", async () => {
    const { app } = await seededApp();
    expect(await app.cli.handleCli(["tags", "total"])).toBe("4");
  });

  it("format=json emits objects with STRING counts; csv is comma-separated", async () => {
    const { app } = await seededApp();
    const json = JSON.parse(await app.cli.handleCli(["tags", "counts", "format=json"]));
    expect(json).toContainEqual({ tag: "#foo", count: "3" });
    expect(JSON.parse(await app.cli.handleCli(["tags", "format=json"]))).toContainEqual({ tag: "#foo" });
    const csv = await app.cli.handleCli(["tags", "counts", "format=csv"]);
    expect(csv.split("\n")).toContain("#foo,3");
  });

  it("per-file mode scopes tags to the resolved file", async () => {
    const { app } = await seededApp();
    expect(await app.cli.handleCli(["tags", "path=Alpha.md"])).toBe("#bar\n#baz\n#foo");
    expect(await app.cli.handleCli(["tags", "file=Alpha", "counts"])).toBe("#bar\t1\n#baz\t1\n#foo\t2");
    expect(await app.cli.handleCli(["tags", "path=Folder/Gamma.md"])).toBe("No tags found.");
  });

  it("throws the tryResolveFile error strings", async () => {
    const { app } = await seededApp();
    await expect(app.cli.handleCli(["tags", "path=Nope.md"])).rejects.toBe('File "Nope.md" not found.');
    await expect(app.cli.handleCli(["tags", "path=Folder"])).rejects.toBe('"Folder" is a folder, not a file.');
    await expect(app.cli.handleCli(["tags", "file=Zed"])).rejects.toBe('File "Zed" not found.');
    await expect(app.cli.handleCli(["tags", "active"])).rejects.toBe(
      "No active file. Use file=<name> or path=<path> to specify a file.",
    );
  });

  it("active flag uses the active file", async () => {
    const { app, alpha } = await seededApp();
    await app.workspace.openFile(alpha, { active: true });
    expect(await app.cli.handleCli(["tags", "active"])).toBe("#bar\n#baz\n#foo");
  });
});

describe("tag", () => {
  it("lists files containing the tag, sorted", async () => {
    const { app } = await seededApp();
    expect(await app.cli.handleCli(["tag", "name=foo"])).toBe("Alpha.md\nBeta.md");
    expect(await app.cli.handleCli(["tag", "name=#bar"])).toBe("Alpha.md");
  });

  it("total returns the occurrence count; verbose prepends tag and count", async () => {
    const { app } = await seededApp();
    expect(await app.cli.handleCli(["tag", "name=foo", "total"])).toBe("3");
    expect(await app.cli.handleCli(["tag", "name=foo", "verbose"])).toBe("#foo\t3\nAlpha.md\nBeta.md");
  });

  it("looks up the count case-sensitively but matches files case-insensitively", async () => {
    const { app } = await seededApp();
    await expect(app.cli.handleCli(["tag", "name=FOO"])).rejects.toBe('Tag "#FOO" not found.');
    // '#baz' (Alpha inline) and '#Baz' (Beta inline) merge under the canonical
    // casing '#baz' with the counts summed; the file scan matches both.
    expect(await app.cli.handleCli(["tag", "name=baz", "total"])).toBe("2");
    expect(await app.cli.handleCli(["tag", "name=baz"])).toBe("Alpha.md\nBeta.md");
  });

  it("throws for unknown tags and missing name", async () => {
    const { app } = await seededApp();
    await expect(app.cli.handleCli(["tag", "name=nope"])).rejects.toBe('Tag "#nope" not found.');
    await expect(app.cli.handleCli(["tag"])).rejects.toMatch(/^Missing required parameter: name=<tag>/);
  });
});

describe("properties", () => {
  it("per-file default renders trimmed YAML with empty nulls", async () => {
    const { app } = await seededApp();
    const out = await app.cli.handleCli(["properties", "path=Alpha.md"]);
    expect(out).toContain("status: draft");
    expect(out).toContain("count: 2");
    expect(out).toContain("tags:\n  - foo\n  - bar");
    expect(out).toMatch(/empty: ?($|\n)/);
    expect(out).not.toContain("null");
    expect(out).toBe(out.trim());
  });

  it("per-file json is the raw frontmatter object", async () => {
    const { app } = await seededApp();
    const out = JSON.parse(await app.cli.handleCli(["properties", "path=Alpha.md", "format=json"]));
    expect(out).toEqual({
      tags: ["foo", "bar"],
      aliases: ["A1", "Shared"],
      status: "draft",
      count: 2,
      empty: null,
    });
  });

  it("per-file tsv joins arrays with ', ' and drops null values", async () => {
    const { app } = await seededApp();
    expect(await app.cli.handleCli(["properties", "path=Alpha.md", "format=tsv"])).toBe(
      "tags\tfoo, bar\naliases\tA1, Shared\nstatus\tdraft\ncount\t2",
    );
  });

  it("per-file without frontmatter returns the literal text", async () => {
    const { app } = await seededApp();
    expect(await app.cli.handleCli(["properties", "path=Folder/Gamma.md"])).toBe("No frontmatter found.");
  });

  it("vault mode lists property names sorted by name", async () => {
    const { app } = await seededApp();
    await refreshProperties(app);
    const out = await app.cli.handleCli(["properties"]);
    expect(out.split("\n")).toEqual(["aliases", "count", "cssclasses", "done", "empty", "status", "tags"]);
  });

  it("vault counts, total, sort=count, and json shapes", async () => {
    const { app } = await seededApp();
    await refreshProperties(app);
    const counts = await app.cli.handleCli(["properties", "counts"]);
    expect(counts.split("\n")).toContain("status\t1");
    expect(counts.split("\n")).toContain("aliases\t2");
    expect(await app.cli.handleCli(["properties", "total"])).toBe("7");
    const byCount = await app.cli.handleCli(["properties", "sort=count", "counts"]);
    expect(byCount.split("\n")[0]).toMatch(/\t2$/);
    const json = JSON.parse(await app.cli.handleCli(["properties", "format=json"]));
    expect(json).toContainEqual({ name: "status", type: "text", count: 1 });
  });

  it("name mode returns the occurrence count via lowercased lookup", async () => {
    const { app } = await seededApp();
    await refreshProperties(app);
    expect(await app.cli.handleCli(["properties", "name=Status"])).toBe("1");
    await expect(app.cli.handleCli(["properties", "name=zzz"])).rejects.toBe('Property "zzz" not found.');
  });
});

describe("property:read", () => {
  it("renders scalars, booleans, arrays, and empties", async () => {
    const { app } = await seededApp();
    expect(await app.cli.handleCli(["property:read", "name=status", "path=Alpha.md"])).toBe("draft");
    expect(await app.cli.handleCli(["property:read", "name=count", "path=Alpha.md"])).toBe("2");
    expect(await app.cli.handleCli(["property:read", "name=done", "path=Beta.md"])).toBe("false");
    expect(await app.cli.handleCli(["property:read", "name=aliases", "path=Alpha.md"])).toBe("A1\nShared");
    expect(await app.cli.handleCli(["property:read", "name=empty", "path=Alpha.md"])).toBe("(empty)");
  });

  it("throws for absent keys, missing frontmatter, and missing name", async () => {
    const { app } = await seededApp();
    await expect(app.cli.handleCli(["property:read", "name=nope", "path=Alpha.md"])).rejects.toBe(
      'Property "nope" not found.',
    );
    await expect(app.cli.handleCli(["property:read", "name=status", "path=Folder/Gamma.md"])).rejects.toBe(
      'Property "status" not found.',
    );
    await expect(app.cli.handleCli(["property:read", "name=x", "path=Nope.md"])).rejects.toBe('File "Nope.md" not found.');
    await expect(app.cli.handleCli(["property:read"])).rejects.toMatch(/^Missing required parameter: name=<name>/);
  });
});

describe("property:set", () => {
  async function readBack(app: App, file: TFile, name: string): Promise<string> {
    await app.metadataCache.computeFileMetadata(file);
    return app.cli.handleCli(["property:read", `name=${name}`, `path=${file.path}`]);
  }

  it("sets a text value and echoes the raw input", async () => {
    const { app, alpha } = await seededApp();
    expect(await app.cli.handleCli(["property:set", "name=status", "value=final", "path=Alpha.md"])).toBe(
      "Set status: final",
    );
    expect(await readBack(app, alpha, "status")).toBe("final");
  });

  it("parses a JSON array regardless of type and infers list", async () => {
    const { app, beta } = await seededApp();
    expect(await app.cli.handleCli(["property:set", "name=mylist", 'value=["a", "b"]', "path=Beta.md"])).toBe(
      'Set mylist: ["a", "b"]',
    );
    expect(await readBack(app, beta, "mylist")).toBe("a\nb");
    expect(app.metadataTypeManager.getAssignedWidget("mylist")).toBe("multitext");
  });

  it("parses number, checkbox, list, and date types", async () => {
    const { app, beta } = await seededApp();
    await app.cli.handleCli(["property:set", "name=num", "value=42", "type=number", "path=Beta.md"]);
    expect(await readBack(app, beta, "num")).toBe("42");
    await app.cli.handleCli(["property:set", "name=flag", "value=1", "type=checkbox", "path=Beta.md"]);
    expect(await readBack(app, beta, "flag")).toBe("true");
    await app.cli.handleCli(["property:set", "name=items", "value=a, b", "type=list", "path=Beta.md"]);
    expect(await readBack(app, beta, "items")).toBe("a\nb");
    await app.cli.handleCli(["property:set", "name=day", "value=2026-07-11", "type=date", "path=Beta.md"]);
    expect(await readBack(app, beta, "day")).toBe("2026-07-11");
  });

  it("throws the validation error strings", async () => {
    const { app } = await seededApp();
    await expect(app.cli.handleCli(["property:set", "name=n", "value=abc", "type=number", "path=Alpha.md"])).rejects.toBe(
      "Invalid number: abc",
    );
    await expect(app.cli.handleCli(["property:set", "name=d", "value=nope", "type=date", "path=Alpha.md"])).rejects.toBe(
      "Invalid date format. Use YYYY-MM-DD",
    );
    await expect(
      app.cli.handleCli(["property:set", "name=d", "value=nope", "type=datetime", "path=Alpha.md"]),
    ).rejects.toBe("Invalid datetime format. Use YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss");
    await expect(app.cli.handleCli(["property:set", "name=x"])).rejects.toMatch(
      /^Missing required parameter: value=<value>/,
    );
  });
});

describe("property:remove", () => {
  it("removes a property and reports success even for absent keys", async () => {
    const { app, alpha } = await seededApp();
    expect(await app.cli.handleCli(["property:remove", "name=status", "path=Alpha.md"])).toBe("Removed: status");
    expect(await app.vault.read(alpha)).not.toContain("status");
    expect(await app.cli.handleCli(["property:remove", "name=ghost", "path=Alpha.md"])).toBe("Removed: ghost");
    await expect(app.cli.handleCli(["property:remove", "path=Alpha.md"])).rejects.toMatch(
      /^Missing required parameter: name=<name>/,
    );
  });
});

describe("aliases", () => {
  it("vault mode lists distinct aliases sorted; verbose appends paths", async () => {
    const { app } = await seededApp();
    expect(await app.cli.handleCli(["aliases"])).toBe("A1\nShared");
    // Paths ride in encounter order (vault traversal), NOT sorted — faithful.
    expect(await app.cli.handleCli(["aliases", "verbose"])).toBe("A1\tAlpha.md\nShared\tBeta.md, Alpha.md");
    expect(await app.cli.handleCli(["aliases", "total"])).toBe("2");
  });

  it("per-file mode scopes to the resolved file", async () => {
    const { app } = await seededApp();
    expect(await app.cli.handleCli(["aliases", "path=Alpha.md"])).toBe("A1\nShared");
    expect(await app.cli.handleCli(["aliases", "path=Beta.md", "total"])).toBe("1");
    expect(await app.cli.handleCli(["aliases", "path=Folder/Gamma.md"])).toBe("No aliases found.");
  });

  it("throws the tryResolveFile error strings", async () => {
    const { app } = await seededApp();
    await expect(app.cli.handleCli(["aliases", "path=Nope.md"])).rejects.toBe('File "Nope.md" not found.');
    await expect(app.cli.handleCli(["aliases", "active"])).rejects.toBe(
      "No active file. Use file=<name> or path=<path> to specify a file.",
    );
  });
});
