import { describe, expect, it } from "vitest";
import { App } from "../app/App";

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
    // info=<key> returns just that value, not the whole table.
    expect(await app.cli.handleCli(["vault", "info=files"])).toBe("2");
  });

  it("files lists paths, filters by folder/ext, and counts with total", async () => {
    const app = await seededApp();
    expect((await app.cli.handleCli(["files"])).split("\n").sort()).toEqual(["Folder/Sub.md", "Note.md"]);
    expect(await app.cli.handleCli(["files", "folder=Folder"])).toBe("Folder/Sub.md");
    expect(await app.cli.handleCli(["files", "total"])).toBe("2");
    expect(await app.cli.handleCli(["files", "ext=md", "total"])).toBe("2");
  });

  it("read resolves file= by name and path= exactly", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["read", "file=Note"])).toContain("# Note");
    expect(await app.cli.handleCli(["read", "path=Folder/Sub.md"])).toBe("sub");
    expect(await app.cli.handleCli(["read", "path=Nope.md"])).toBe("File not found.");
  });

  it("command requires an id and reports unknown ids", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["command"])).rejects.toMatch(/^Missing required parameter: id=<command-id>/);
    expect(await app.cli.handleCli(["command", "id=nope:missing"])).toBe('Command "nope:missing" not found.');
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
