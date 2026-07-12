import { describe, expect, it } from "vitest";
import { App } from "../../../app/App";
import { formatDate } from "../../DailyNotes";
import type { TemplatesController } from "../../Templates";
import { TFile } from "../../../vault/TAbstractFile";

// This lane's wiring into App happens after all lanes land; register the
// batch directly and drive it through the faithful `app.cli.handleCli` entry
// against a real (in-memory) vault.
async function seededApp(): Promise<App> {
  const app = new App(document.createElement("div"));
  await app.vault.create("Note.md", "# Note\nbody");
  await app.vault.create("Folder/Sub.md", "sub");
  return app;
}

async function readPath(app: App, path: string): Promise<string> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error(`not a file: ${path}`);
  return app.vault.read(file);
}

// The templates core plugin is registered locked-off (non-parity scope), but
// its controller is real; enable it directly to exercise create's template
// branch.
async function enableTemplates(app: App): Promise<TemplatesController> {
  await app.corePluginsReady;
  await app.internalPlugins.enable("templates");
  const templates = app.internalPlugins.getEnabledPluginById<TemplatesController>("templates");
  if (!templates) throw new Error("templates plugin missing");
  return templates;
}

describe("create", () => {
  it("creates an empty markdown file, defaulting to Untitled", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["create"])).toBe("Created: Untitled.md");
    expect(await app.cli.handleCli(["create", "name=Fresh"])).toBe("Created: Fresh.md");
    expect(await readPath(app, "Fresh.md")).toBe("");
  });

  it("unescapes literal \\n and \\t in content=", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["create", "name=C", "content=a\\nb\\tc"]);
    expect(await readPath(app, "C.md")).toBe("a\nb\tc");
  });

  it("joins path= and name=, stripping trailing slashes from path", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["create", "path=Folder/", "name=Deep"])).toBe("Created: Folder/Deep.md");
  });

  it("rejects a name containing a slash", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["create", "name=a/b"])).rejects.toBe('name cannot contain "/". Use path for a full file path.');
  });

  it("splits the extension off the base path (strict lastIndexOf > 0)", async () => {
    const app = await seededApp();
    // txt has no registered file creator, so real createNewFile coerces the
    // extension to md — the dot-split still ran (basePath "data", ext "txt").
    expect(await app.cli.handleCli(["create", "name=data.txt"])).toBe("Created: data.md");
  });

  it("never overwrites without the flag: uniquifies instead", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["create", "name=Note"])).toBe("Created: Note 1.md");
    expect(await readPath(app, "Note.md")).toBe("# Note\nbody");
  });

  it("creates missing intermediate folders", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["create", "path=New/Sub/Leaf"])).toBe("Created: New/Sub/Leaf.md");
  });

  it("overwrite modifies an existing file in place", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["create", "name=Note", "overwrite", "content=new"])).toBe("Overwrote: Note.md");
    expect(await readPath(app, "Note.md")).toBe("new");
  });

  it("overwrite of a missing path reports Created", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["create", "name=Solo", "overwrite"])).toBe("Created: Solo.md");
  });

  it("quirk: overwrite over a folder creates a fresh file but says Overwrote", async () => {
    const app = await seededApp();
    await app.vault.createFolder("Weird.md");
    expect(await app.cli.handleCli(["create", "name=Weird", "overwrite"])).toBe("Overwrote: Weird 1.md");
  });

  it("open makes the created file active", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["create", "name=Opened", "open"]);
    expect(app.workspace.getActiveFile()?.path).toBe("Opened.md");
  });
});

describe("create with template", () => {
  it("throws when the templates plugin is not enabled", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["create", "name=T", "template=X"])).rejects.toBe("Templates plugin is not enabled.");
  });

  it("renders {{title}} and {{date}}/{{date:FMT}} from the template; content= is ignored", async () => {
    const app = await seededApp();
    await enableTemplates(app);
    await app.vault.create("Templates/Tpl.md", "# {{title}}\n{{DATE:YYYY}} {{date}}");
    expect(await app.cli.handleCli(["create", "name=T", "template=Tpl", "content=ignored"])).toBe("Created: T.md");
    const now = new Date();
    expect(await readPath(app, "T.md")).toBe(`# T\n${formatDate(now, "YYYY")} ${formatDate(now, "YYYY-MM-DD")}`);
  });

  it("matches templates case-insensitively by folder-relative path", async () => {
    const app = await seededApp();
    await enableTemplates(app);
    await app.vault.create("Templates/Sub/Deep.md", "x");
    expect(await app.cli.handleCli(["create", "name=D", "template=sub/deep"])).toBe("Created: D.md");
    expect(await readPath(app, "D.md")).toBe("x");
  });

  it("empty template= falls through to the content branch (plugin state irrelevant)", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["create", "name=T", "template="])).toBe("Created: T.md");
    expect(await readPath(app, "T.md")).toBe("");
  });

  it("does not double the .md suffix on an explicit .md template name", async () => {
    const app = await seededApp();
    await enableTemplates(app);
    await app.vault.create("Templates/Tpl.md", "x");
    expect(await app.cli.handleCli(["create", "name=M", "template=Tpl.md"])).toBe("Created: M.md");
    expect(await readPath(app, "M.md")).toBe("x");
  });

  it("reports an unknown template", async () => {
    const app = await seededApp();
    await enableTemplates(app);
    await app.vault.create("Templates/Tpl.md", "x");
    await expect(app.cli.handleCli(["create", "name=T", "template=Nope"])).rejects.toBe('Template "Nope" not found.');
  });

  it("reports a missing template folder", async () => {
    const app = await seededApp();
    await enableTemplates(app);
    await expect(app.cli.handleCli(["create", "name=T", "template=Tpl"])).rejects.toBe('Template folder "Templates" not found.');
  });

  it("reports an unconfigured template folder", async () => {
    const app = await seededApp();
    const templates = await enableTemplates(app);
    templates.options.folder = "";
    await expect(app.cli.handleCli(["create", "name=T", "template=Tpl"])).rejects.toBe("No template folder configured.");
  });
});

describe("append", () => {
  it("appends with a leading newline by default", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["append", "path=Note.md", "content=more"])).toBe("Appended to: Note.md");
    expect(await readPath(app, "Note.md")).toBe("# Note\nbody\nmore");
  });

  it("inline appends without the newline", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["append", "path=Note.md", "content=!", "inline"]);
    expect(await readPath(app, "Note.md")).toBe("# Note\nbody!");
  });

  it("unescapes literal \\n and \\t", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["append", "path=Note.md", "content=x\\ny"]);
    expect(await readPath(app, "Note.md")).toBe("# Note\nbody\nx\ny");
  });

  it("empty content= throws the handler usage error", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["append", "path=Note.md", "content="]))
      .rejects.toBe("Missing required parameter: content\nUsage: append [file=<name>] [path=<path>] content=<text> [inline]");
  });

  it("absent content is rejected by the dispatcher's generic required check", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["append", "path=Note.md"]))
      .rejects.toBe("Missing required parameter: content=<text>\nUsage: append [file=<name>] [path=<path>] content=<text> [inline]");
  });

  it("resolves file= like a wikilink", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["append", "file=Sub", "content=x"])).toBe("Appended to: Folder/Sub.md");
  });

  it("throws each tryResolveFile error string", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["append", "path=Nope.md", "content=x"])).rejects.toBe('File "Nope.md" not found.');
    await expect(app.cli.handleCli(["append", "path=Folder", "content=x"])).rejects.toBe('"Folder" is a folder, not a file.');
    await expect(app.cli.handleCli(["append", "file=Ghost", "content=x"])).rejects.toBe('File "Ghost" not found.');
    // Resolution runs before the empty-content check.
    await expect(app.cli.handleCli(["append", "content="]))
      .rejects.toBe("No active file. Use file=<name> or path=<path> to specify a file.");
  });

  it("falls back to the active file", async () => {
    const app = await seededApp();
    const note = app.vault.getFileByPath("Note.md");
    await app.workspace.openFile(note as TFile, { active: true });
    expect(await app.cli.handleCli(["append", "content=tail"])).toBe("Appended to: Note.md");
    expect(await readPath(app, "Note.md")).toBe("# Note\nbody\ntail");
  });
});

describe("prepend", () => {
  it("inserts at the very top when there is no frontmatter", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["prepend", "path=Note.md", "content=top"])).toBe("Prepended to: Note.md");
    expect(await readPath(app, "Note.md")).toBe("top\n# Note\nbody");
  });

  it("inserts after the closing frontmatter delimiter", async () => {
    const app = await seededApp();
    await app.vault.create("FM.md", "---\nkey: v\n---\nbody");
    await app.cli.handleCli(["prepend", "path=FM.md", "content=ins"]);
    expect(await readPath(app, "FM.md")).toBe("---\nkey: v\n---\nins\nbody");
  });

  it("treats unterminated frontmatter as no frontmatter", async () => {
    const app = await seededApp();
    await app.vault.create("Broken.md", "---\nkey: v\nbody");
    await app.cli.handleCli(["prepend", "path=Broken.md", "content=ins"]);
    expect(await readPath(app, "Broken.md")).toBe("ins\n---\nkey: v\nbody");
  });

  it("inline inserts without the newline", async () => {
    const app = await seededApp();
    await app.cli.handleCli(["prepend", "path=Note.md", "content=>", "inline"]);
    expect(await readPath(app, "Note.md")).toBe("># Note\nbody");
  });

  it("empty content= throws the handler usage error", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["prepend", "path=Note.md", "content="]))
      .rejects.toBe("Missing required parameter: content\nUsage: prepend [file=<name>] [path=<path>] content=<text> [inline]");
  });
});

describe("move", () => {
  it("moves into a folder keeping the full filename", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["move", "path=Note.md", "to=Folder"])).toBe("Moved: Note.md -> Folder/Note.md");
    expect(app.vault.getAbstractFileByPath("Folder/Note.md")).toBeInstanceOf(TFile);
    expect(app.vault.getAbstractFileByPath("Note.md")).toBeNull();
  });

  it("treats a destination containing a dot as a full file path", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["move", "path=Note.md", "to=Folder/New.md"])).toBe("Moved: Note.md -> Folder/New.md");
  });

  it("to=/ moves to the vault root", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["move", "path=Folder/Sub.md", "to=/"])).toBe("Moved: Folder/Sub.md -> Sub.md");
  });

  it("empty to= throws the handler usage error (distinct from the dispatcher's)", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["move", "path=Note.md", "to="]))
      .rejects.toBe("Missing required parameter: to\nUsage: move to=<folder> or to=<path>");
    await expect(app.cli.handleCli(["move", "path=Note.md"]))
      .rejects.toBe("Missing required parameter: to=<path>\nUsage: move [file=<name>] [path=<path>] to=<path>");
  });

  it("a taken destination rejects from the vault, not this handler", async () => {
    const app = await seededApp();
    await app.vault.create("Other.md", "x");
    await expect(app.cli.handleCli(["move", "path=Other.md", "to=Note.md"])).rejects.toThrow("File already exists");
  });

  it("throws the resolve error for a missing source", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["move", "path=Nope.md", "to=Folder"])).rejects.toBe('File "Nope.md" not found.');
  });
});

describe("rename", () => {
  it("preserves the extension for a bare name", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["rename", "path=Note.md", "name=Renamed"])).toBe("Renamed: Note.md -> Renamed.md");
    expect(app.vault.getAbstractFileByPath("Renamed.md")).toBeInstanceOf(TFile);
  });

  it("takes a dotted name literally", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["rename", "path=Note.md", "name=raw.txt"])).toBe("Renamed: Note.md -> raw.txt");
  });

  it("stays in the same folder", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["rename", "path=Folder/Sub.md", "name=New"])).toBe("Renamed: Folder/Sub.md -> Folder/New.md");
  });

  it("empty name= throws the handler usage error (distinct from the dispatcher's)", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["rename", "path=Note.md", "name="]))
      .rejects.toBe("Missing required parameter: name\nUsage: rename name=<new name>");
    await expect(app.cli.handleCli(["rename", "path=Note.md"]))
      .rejects.toBe("Missing required parameter: name=<name>\nUsage: rename [file=<name>] [path=<path>] name=<name>");
  });

  it("throws the resolve error for a missing source", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["rename", "path=Nope.md", "name=X"])).rejects.toBe('File "Nope.md" not found.');
  });
});

describe("delete", () => {
  it("permanent removes the file outright", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["delete", "path=Note.md", "permanent"])).toBe("Deleted permanently: Note.md");
    expect(app.vault.getAbstractFileByPath("Note.md")).toBeNull();
  });

  it("defaults to trash", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["delete", "path=Note.md"])).toBe("Moved to trash: Note.md");
    expect(app.vault.getAbstractFileByPath("Note.md")).toBeNull();
    expect(app.vault.getAbstractFileByPath(".trash/Note.md")).toBeInstanceOf(TFile);
  });

  it("bare delete targets the active file", async () => {
    const app = await seededApp();
    const note = app.vault.getFileByPath("Note.md");
    await app.workspace.openFile(note as TFile, { active: true });
    expect(await app.cli.handleCli(["delete"])).toBe("Moved to trash: Note.md");
  });

  it("throws without an active file or a resolvable target", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["delete"]))
      .rejects.toBe("No active file. Use file=<name> or path=<path> to specify a file.");
    await expect(app.cli.handleCli(["delete", "path=Nope.md"])).rejects.toBe('File "Nope.md" not found.');
  });
});

describe("move into a missing folder", () => {
  it("propagates the vault's ENOENT (adapter parity) instead of reparenting", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["move", "file=Note", "to=Nope"])).rejects.toThrow(/ENOENT: no such file or directory/);
    expect(app.vault.getFileByPath("Note.md")).not.toBeNull();
  });
});
