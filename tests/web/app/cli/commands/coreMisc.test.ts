import { afterEach, describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import { Platform } from "@web/platform/Platform";

// Not yet wired into the App constructor (glue lands after all lanes), so each
// test registers the batch itself and drives it through the faithful
// `app.cli.handleCli` entry against a real in-memory vault.
async function seededApp(): Promise<App> {
  const app = new App(document.createElement("div"));
  await app.vault.create("Note.md", "# Note\nbody");
  await app.vault.create("Folder/Sub.md", "sub");
  await app.vault.create("Folder/Nested/Deep.md", "deep!");
  return app;
}

function installVaultRegistry(vaults: Record<string, { path: string; ts: number }>): void {
  (globalThis as { electron?: unknown }).electron = {
    ipcRenderer: {
      sendSync: (channel: string) => {
        if (channel !== "vault-list") throw new Error(`unexpected channel: ${channel}`);
        return vaults;
      },
    },
  };
}

const originalVersion = Platform.version;
const originalBuild = Platform.build;
const originalIsMobile = Platform.isMobile;

afterEach(() => {
  Platform.version = originalVersion;
  Platform.build = originalBuild;
  Platform.isMobile = originalIsMobile;
  delete (globalThis as { electron?: unknown }).electron;
});

describe("version", () => {
  it("returns <version> (installer <build>) from the platform global", async () => {
    const app = await seededApp();
    Platform.version = "1.12.7";
    Platform.build = "1.11.5";
    expect(await app.cli.handleCli(["version"])).toBe("1.12.7 (installer 1.11.5)");
  });
});

describe("vaults", () => {
  it("lists basenames sorted by descending last-opened timestamp", async () => {
    const app = await seededApp();
    installVaultRegistry({
      a: { path: "/Users/u/Beta", ts: 100 },
      b: { path: "/Users/u/Alpha", ts: 300 },
      c: { path: "/Users/u/Zed", ts: 200 },
    });
    expect(await app.cli.handleCli(["vaults"])).toBe("Alpha\nZed\nBeta");
  });

  it("verbose appends the full path after a tab", async () => {
    const app = await seededApp();
    installVaultRegistry({
      a: { path: "/Users/u/Beta", ts: 100 },
      b: { path: "/Users/u/Alpha", ts: 300 },
    });
    expect(await app.cli.handleCli(["vaults", "verbose"])).toBe(
      "Alpha\t/Users/u/Alpha\nBeta\t/Users/u/Beta",
    );
  });

  it("total returns the bare count", async () => {
    const app = await seededApp();
    installVaultRegistry({
      a: { path: "/Users/u/Beta", ts: 100 },
      b: { path: "/Users/u/Alpha", ts: 300 },
    });
    expect(await app.cli.handleCli(["vaults", "total"])).toBe("2");
  });

  it("an empty registry yields an empty string", async () => {
    const app = await seededApp();
    installVaultRegistry({});
    expect(await app.cli.handleCli(["vaults"])).toBe("");
  });

  it("throws the desktop-only string on mobile", async () => {
    const app = await seededApp();
    installVaultRegistry({});
    Platform.isMobile = true;
    await expect(app.cli.handleCli(["vaults"])).rejects.toBe(
      "This command is only available on desktop.",
    );
  });
});

describe("folder", () => {
  it("returns the four-line tabbed report", async () => {
    const app = await seededApp();
    // Folder holds Sub.md (3 bytes) and Nested/Deep.md (5 bytes).
    expect(await app.cli.handleCli(["folder", "path=Folder"])).toBe(
      "path\tFolder\nfiles\t2\nfolders\t1\nsize\t8",
    );
  });

  it("info=files|folders|size return bare counts", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["folder", "path=Folder", "info=files"])).toBe("2");
    expect(await app.cli.handleCli(["folder", "path=Folder", "info=folders"])).toBe("1");
    expect(await app.cli.handleCli(["folder", "path=Folder", "info=size"])).toBe("8");
  });

  it("an unknown info value falls through to the full report", async () => {
    const app = await seededApp();
    expect(await app.cli.handleCli(["folder", "path=Folder", "info=bogus"])).toBe(
      "path\tFolder\nfiles\t2\nfolders\t1\nsize\t8",
    );
  });

  it("throws not-found and file-not-folder strings", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["folder", "path=Nope"])).rejects.toBe(
      'Folder "Nope" not found.',
    );
    await expect(app.cli.handleCli(["folder", "path=Folder/Sub.md"])).rejects.toBe(
      '"Folder/Sub.md" is a file, not a folder.',
    );
  });

  it("missing path fails dispatcher validation, and the handler keeps the reference's own runtime check", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["folder"])).rejects.toMatch(
      /^Missing required parameter: path/,
    );
    // The reference duplicates the check inside the handler with its own
    // Usage string — invoke the handler directly to reach it.
    const handler = app.cli.handlers.get("folder")?.handler;
    let thrown: unknown;
    try {
      handler?.({});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(
      "Missing required parameter: path\nUsage: folder path=<folder-path> [info=files|folders|size]",
    );
  });
});

describe("file", () => {
  it("returns the six-line tabbed report with raw epoch-ms times", async () => {
    const app = await seededApp();
    const file = app.vault.getFileByPath("Folder/Sub.md");
    const out = await app.cli.handleCli(["file", "path=Folder/Sub.md"]);
    expect(out).toBe(
      `path\tFolder/Sub.md\nname\tSub\nextension\tmd\nsize\t3\ncreated\t${file?.stat.ctime}\nmodified\t${file?.stat.mtime}`,
    );
  });

  it("file= resolves like a wikilink by name", async () => {
    const app = await seededApp();
    const out = await app.cli.handleCli(["file", "file=Note"]);
    expect(out).toContain("path\tNote.md");
    expect(out).toContain("name\tNote");
  });

  it("path= throws and never falls through to file=", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["file", "path=Nope.md", "file=Note"])).rejects.toBe(
      'File "Nope.md" not found.',
    );
  });

  it("throws folder-not-file, unresolved-name and no-active-file strings", async () => {
    const app = await seededApp();
    await expect(app.cli.handleCli(["file", "path=Folder"])).rejects.toBe(
      '"Folder" is a folder, not a file.',
    );
    await expect(app.cli.handleCli(["file", "file=Nope"])).rejects.toBe('File "Nope" not found.');
    await expect(app.cli.handleCli(["file"])).rejects.toBe(
      "No active file. Use file=<name> or path=<path> to specify a file.",
    );
  });
});
