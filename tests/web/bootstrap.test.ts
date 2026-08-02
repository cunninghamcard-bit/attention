import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrap } from "@web/bootstrap";

// The renderer tsconfig is DOM-only (no node types), so load Node builtins via
// a non-literal specifier: TS types `import(<string>)` as `any` and skips
// module/global resolution, keeping node's globals out of the renderer program.
type NodeFs = any;
async function nodeModule(id: string): Promise<NodeFs> {
  return import(/* @vite-ignore */ id as string);
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
    // The workspace is multi-root: demo content seeds into Home, the one
    // root this app writes to, so every path carries that mount.
    expect(app.vault.getFileByPath("Home/Welcome.md")).not.toBeNull();
    expect(app.vault.getFileByPath("Home/Plugin Architecture.md")).not.toBeNull();
    expect(app.workspace.activeLeaf?.view?.getViewType()).toBe("markdown");
    expect(
      (app.workspace.activeLeaf?.view as { file?: { path: string } | null } | null)?.file?.path,
    ).toBe("Home/Welcome.md");
    expect(app.workspace.activeLeaf?.view?.getState()).toMatchObject({ mode: "preview" });
    expect(document.body.textContent).toContain("Attention");
  });

  describe("under the Electron desktop shell", () => {
    let repoDir: string;
    let fs: NodeFs;
    let nodePath: NodeFs;

    beforeEach(async () => {
      fs = await nodeModule("node:fs");
      nodePath = await nodeModule("node:path");
      const os = await nodeModule("node:os");
      repoDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "repo-boot-"));
      // The workspace form's boot handshake: home only, plus the e2e mount
      // seed. Real's {id, path} vault-window identity is gone.
      Object.defineProperty(window, "electron", {
        configurable: true,
        value: {
          ipcRenderer: {
            sendSync: (channel: string) =>
              channel === "vault" ? { home: null, mounts: [repoDir] } : undefined,
            send: () => {},
            on: () => {},
          },
        },
      });
    });

    afterEach(() => {
      delete (window as { electron?: unknown }).electron;
      fs.rmSync(repoDir, { recursive: true, force: true });
    });

    it("mounts the seeded folder beside Home, backed by the real disk", async () => {
      fs.writeFileSync(nodePath.join(repoDir, "Notes.md"), "# My real note\n");
      const repoName = nodePath.basename(repoDir);

      const app = await bootstrap(document.body);

      // One namespace, two roots: the demo seeds into Home while the seeded
      // repository serves its own disk contents under its mount name.
      expect(app.vault.getFileByPath("Home/Welcome.md")).not.toBeNull();
      const note = app.vault.getFileByPath(`${repoName}/Notes.md`);
      expect(note).not.toBeNull();
      expect(await app.vault.read(note!)).toContain("My real note");

      // Writes through the mount land on disk, not in memory.
      await app.vault.create(`${repoName}/FromApp.md`, "# From the app\n");
      expect(fs.existsSync(nodePath.join(repoDir, "FromApp.md"))).toBe(true);
    });

    it("remembers the seeded mount in the registry (idempotent across boots)", async () => {
      await bootstrap(document.body);
      const repoName = nodePath.basename(repoDir);
      const stored = JSON.parse(window.localStorage.getItem("attention-mounts") ?? "[]") as Array<{
        name: string;
        path: string;
      }>;
      expect(stored).toEqual([{ name: repoName, path: repoDir }]);

      // A second boot in the same profile does not duplicate the record.
      document.body.replaceChildren();
      await bootstrap(document.body);
      const again = JSON.parse(window.localStorage.getItem("attention-mounts") ?? "[]");
      expect(again).toHaveLength(1);
    });
  });
});
