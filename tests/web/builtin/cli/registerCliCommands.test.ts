import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";

// The core commands are registered by the App constructor; drive them through
// the faithful `app.cli.handleCli` entry against a real (in-memory) vault.
async function seededApp(): Promise<App> {
  const app = new App(document.createElement("div"));
  await app.vault.create("Note.md", "# Note\nbody");
  await app.vault.create("Folder/Sub.md", "sub");
  return app;
}

describe("core CLI commands", () => {
  it("vault returns tab-separated info and respects info=", async () => {
    const app = await seededApp();
    const out = await app.cli.handleCli(["vault"]);
    expect(out).toContain("name\t");
    expect(out).toContain("files\t2");
    // The path row only exists for a FileSystemAdapter (in-memory here);
    // info=path then reports the real "(not available)".
    expect(out).not.toContain("path\t");
    expect(await app.cli.handleCli(["vault", "info=path"])).toBe("(not available)");
    // info=<key> returns just that value, not the whole table.
    expect(await app.cli.handleCli(["vault", "info=files"])).toBe("2");
    // An unknown info value (and a bare `info` flag = "true") falls through
    // to the full report — never an empty string.
    expect(await app.cli.handleCli(["vault", "info=bogus"])).toContain("files\t2");
    expect(await app.cli.handleCli(["vault", "info"])).toContain("files\t2");
  });

  it("files lists ub-sorted paths, filters by folder/ext, and counts with total", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["files"])).toBe("Folder/Sub.md\nNote.md");
    // folder= accepts an explicit trailing slash too.
    expect(await app.cli.handleCli(["files", "folder=Folder"])).toBe("Folder/Sub.md");
    expect(await app.cli.handleCli(["files", "folder=Folder/"])).toBe("Folder/Sub.md");
    expect(await app.cli.handleCli(["files", "total"])).toBe("2");
    // ext= strips a leading dot before matching.
    expect(await app.cli.handleCli(["files", "ext=md", "total"])).toBe("2");
    expect(await app.cli.handleCli(["files", "ext=.md", "total"])).toBe("2");
  });

  it("folders traverses from folder= (throwing when missing) and includes the root", async () => {
    const app = await seededApp();
    // recurseChildren visits the start folder itself, so "/" is listed.
    expect(await app.cli.handleCli(["folders"])).toBe("/\nFolder");
    expect(await app.cli.handleCli(["folders", "folder=Folder"])).toBe("Folder");
    expect(await app.cli.handleCli(["folders", "total"])).toBe("2");
    await expect(app.cli.handleCli(["folders", "folder=Nope"])).rejects.toBe(
      'Folder "Nope" not found.',
    );
  });

  it("read resolves file= by name and path= exactly", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["read", "file=Note"])).toContain("# Note");
    expect(await app.cli.handleCli(["read", "path=Folder/Sub.md"])).toBe("sub");
    // Real resolver errors are thrown plain strings, not returned text.
    await expect(app.cli.handleCli(["read", "path=Nope.md"])).rejects.toBe(
      'File "Nope.md" not found.',
    );
  });

  it("open has no active-file fallback and echoes the resolved path", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["open", "file=Note"])).toBe("Opened: Note.md");
    await expect(app.cli.handleCli(["open"])).rejects.toBe(
      "Missing required parameter: file or path",
    );
  });

  it("command requires an id and reports unknown ids", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["command"])).rejects.toMatch(
      /^Missing required parameter: id=<command-id>/,
    );
    expect(await app.cli.handleCli(["command", "id=nope:missing"])).toBe(
      'Command "nope:missing" not found.',
    );
  });

  it("commands lists ids and filters by prefix", async () => {
    const app = await seededApp();
    const all = await app.cli.handleCli(["commands"]);
    expect(all.length).toBeGreaterThan(0);
    const filtered = await app.cli.handleCli(["commands", "filter=app:"]);
    expect(filtered.split("\n").every((id) => id === "" || id.startsWith("app:"))).toBe(true);
  });

  it("appears in help, registered by the core app (no plugin prefix)", async () => {
    const app = await seededApp();
    const help = await app.cli.handleCli(["help"]);
    expect(help).toContain("vault");
    // Core commands carry no `[Plugin]: ` description prefix.
    expect(help).not.toContain("]: ");
  });
});
