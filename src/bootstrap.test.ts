import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrap } from "./bootstrap";
import { FileSystemAdapter } from "./vault/FileSystemAdapter";

// The renderer tsconfig is DOM-only (no node types), so load Node builtins via
// a non-literal specifier: TS types `import(<string>)` as `any` and skips
// module/global resolution, keeping node's globals out of the renderer program.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NodeFs = any;
async function nodeModule(id: string): Promise<NodeFs> {
  return import(/* @vite-ignore */ (id as string));
}

describe("application bootstrap", () => {
  beforeEach(() => {
    document.body.className = "";
    document.body.replaceChildren();
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  it("starts the runnable shell with one AppDom and opens the Welcome markdown view", async () => {
    const app = await bootstrap(document.body);

    expect(window.app).toBe(app);
    expect(document.body.querySelectorAll(":scope > .app-container")).toHaveLength(1);
    expect(app.vault.getFileByPath("Welcome.md")).not.toBeNull();
    expect(app.vault.getFileByPath("Plugin Architecture.md")).not.toBeNull();
    expect(app.workspace.activeLeaf?.view?.getViewType()).toBe("markdown");
    expect((app.workspace.activeLeaf?.view as { file?: { path: string } | null } | null)?.file?.path).toBe("Welcome.md");
    expect(app.workspace.activeLeaf?.view?.getState()).toMatchObject({ mode: "preview" });
    expect(document.body.textContent).toContain("Obsidian Reconstructed");
  });

  describe("under the Electron desktop shell", () => {
    let vaultDir: string;
    let fs: NodeFs;
    let nodePath: NodeFs;

    beforeEach(async () => {
      fs = await nodeModule("node:fs");
      nodePath = await nodeModule("node:path");
      const os = await nodeModule("node:os");
      vaultDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "vault-boot-"));
      Object.defineProperty(window, "electron", {
        configurable: true,
        value: {
          ipcRenderer: {
            sendSync: (channel: string) => (channel === "vault" ? { id: "v1", path: vaultDir } : undefined),
            send: () => {},
            on: () => {},
          },
        },
      });
    });

    afterEach(() => {
      delete (window as { electron?: unknown }).electron;
      fs.rmSync(vaultDir, { recursive: true, force: true });
    });

    it("backs the vault with a FileSystemAdapter and seeds files to disk", async () => {
      const app = await bootstrap(document.body);

      expect(app.vault.adapter).toBeInstanceOf(FileSystemAdapter);
      expect((app.vault.adapter as FileSystemAdapter).getBasePath()).toBe(vaultDir);

      // The Welcome docs are real files on disk, not just in-memory entries.
      const welcomePath = nodePath.join(vaultDir, "Welcome.md");
      expect(fs.existsSync(welcomePath)).toBe(true);
      expect(fs.readFileSync(welcomePath, "utf8")).toContain("Obsidian Reconstructed");
      expect(fs.existsSync(nodePath.join(vaultDir, "Plugin Architecture.md"))).toBe(true);
    });

    it("loads existing markdown from the vault folder on next launch", async () => {
      fs.writeFileSync(nodePath.join(vaultDir, "Welcome.md"), "# Existing\n");
      fs.writeFileSync(nodePath.join(vaultDir, "Plugin Architecture.md"), "# Existing\n");
      fs.writeFileSync(nodePath.join(vaultDir, "Notes.md"), "# My real note\n");

      const app = await bootstrap(document.body);

      expect(app.vault.getFileByPath("Notes.md")).not.toBeNull();
      expect(await app.vault.read(app.vault.getFileByPath("Notes.md")!)).toContain("My real note");
    });
  });
});
