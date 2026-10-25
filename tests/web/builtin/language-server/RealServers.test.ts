/**
 * Input: node:fs, node:os, node:path, @preload/lsp-bridge, @web/builtin/language-server/LanguageUri, @web/builtin/language-server/ReferencesView, tests/web/TestApp
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LSPPlugin } from "@codemirror/lsp-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElectronLspApi } from "@preload/lsp-bridge";
import { pathToUri } from "@web/builtin/language-server/LanguageUri";
import { REFERENCES_VIEW_TYPE, ReferencesView } from "@web/builtin/language-server/ReferencesView";
import type { App } from "@web/app/App";
import { TFile } from "@web/vault/TAbstractFile";
import { CodeFileView } from "@web/views/CodeFileView";
import { createTestApp } from "../../TestApp";

// End to end against REAL language servers: the preload bridge spawns the
// process, the service talks to it through the client package. Each suite
// skips itself when its server is not installed, so the gate stays green on a
// machine without them — and proves the whole path on one that has them.

const bridge = createElectronLspApi();

const PY_FILES: Record<string, string> = {
  "pkg/shapes.py": [
    "class Shape:",
    '    """A thing with an area."""',
    "",
    "    def area(self) -> float:",
    "        raise NotImplementedError",
    "",
    "",
    "class Square(Shape):",
    "    def __init__(self, side: float) -> None:",
    "        self.side = side",
    "",
    "    def area(self) -> float:",
    "        return self.side * self.side",
    "",
  ].join("\n"),
  "main.py": [
    "from pkg.shapes import Square",
    "",
    "",
    "def total(squares: list[Square]) -> float:",
    "    return sum(square.area() for square in squares)",
    "",
    "",
    "print(total([Square(2.0)]))",
    "",
  ].join("\n"),
  "pkg/__init__.py": "",
};

const TS_FILES: Record<string, string> = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, module: "esnext" },
    include: ["src"],
  }),
  "src/shapes.ts": [
    "export interface Shape {",
    "  area(): number;",
    "}",
    "",
    "/** A square with equal sides. */",
    "export class Square implements Shape {",
    "  constructor(readonly side: number) {}",
    "  area(): number {",
    "    return this.side * this.side;",
    "  }",
    "}",
    "",
  ].join("\n"),
  "src/main.ts": [
    'import { Square } from "./shapes";',
    "",
    "export function total(squares: Square[]): number {",
    "  return squares.reduce((sum, square) => sum + square.area(), 0);",
    "}",
    "",
  ].join("\n"),
};

interface Project {
  app: App;
  dir: string;
  file(path: string): TFile;
}

async function project(files: Record<string, string>): Promise<Project> {
  // realpath: macOS tmpdir is a symlink, and servers answer with the real path.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lsp-real-")));
  const app = createTestApp();
  await app.ready;
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
    const folder = dirname(path);
    if (folder !== "." && !app.vault.getAbstractFileByPath(folder))
      await app.vault.createFolder(folder);
    await app.vault.create(path, content);
  }
  // The test vault is in memory; point the service at the copy on disk.
  app.languageServers.roots = () => [{ name: "", path: dir, uri: pathToUri(dir) }];
  return {
    app,
    dir,
    file(path) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error(`missing ${path}`);
      return file;
    },
  };
}

async function openCode(app: App, target: TFile): Promise<CodeFileView> {
  const leaf = await app.workspace.openFile(target, { active: true });
  const view = leaf.view as CodeFileView;
  for (let attempt = 0; attempt < 400 && !LSPPlugin.get(view.editorView!); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return view;
}

const dirs: string[] = [];
beforeAll(() => {
  (globalThis as { electronLsp?: unknown }).electronLsp = bridge;
});
afterAll(() => {
  delete (globalThis as { electronLsp?: unknown }).electronLsp;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function suite(
  serverId: string,
  command: string,
  files: Record<string, string>,
  main: string,
  lib: string,
) {
  describe.skipIf(!bridge.resolve(command))(`${serverId} (real server)`, () => {
    let current: Project | null = null;
    const open = async (): Promise<Project> => {
      current = await project(files);
      dirs.push(current.dir);
      const group = serverId === "typescript" ? "typescript" : "python";
      current.app.languageServers.saveSettings({ servers: { [group]: serverId } });
      return current;
    };
    afterEach(() => {
      current?.app.languageServers.shutdown();
      current = null;
    });

    it("jumps from the editor to the definition in another file", async () => {
      const { app, file } = await open();
      const view = await openCode(app, file(main));
      const offset = files[main]!.indexOf("square.area()") + "square.".length + 1;

      expect(await app.languageServers.goToDefinition(view.editorView!, view.file!, offset)).toBe(
        true,
      );

      const active = app.workspace.getActiveViewOfType(CodeFileView)!;
      expect(active.file?.path).toBe(lib);
      const selection = active.editorView!.state.selection.main;
      expect(active.editorView!.state.sliceDoc(selection.from, selection.to)).toBe("area");
    }, 60_000);

    it("lists references across files in the References pane", async () => {
      const { app, file } = await open();
      const view = await openCode(app, file(lib));
      const editor = view.editorView!;
      editor.dispatch({
        selection: { anchor: files[lib]!.indexOf("class Square") + "class ".length + 1 },
      });
      // Some servers (Pyrefly, basedpyright) index the project in the
      // background and answer from what they have so far: asked the instant
      // they start, they know only the open file. Ask until the project is in.
      let titles: string[] = [];
      for (let attempt = 0; attempt < 40 && !titles.includes(main); attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 250));
        expect(await app.languageServers.showReferences(editor, view.file!)).toBe(true);
        const pane = app.workspace.getLeavesOfType(REFERENCES_VIEW_TYPE)[0]!.view as ReferencesView;
        titles = [...pane.contentEl.querySelectorAll(".search-result-file-title")].map(
          (el) => el.textContent ?? "",
        );
      }
      expect(titles).toContain(main);
      expect(titles).toContain(lib);
    }, 60_000);

    it("answers hover in the editor", async () => {
      const { app, file } = await open();
      const view = await openCode(app, file(lib));
      const plugin = LSPPlugin.get(view.editorView!)!;
      const hover = await plugin.client.request<unknown, { contents: unknown } | null>(
        "textDocument/hover",
        {
          textDocument: { uri: plugin.uri },
          position: plugin.toPosition(files[lib]!.indexOf("class Square") + "class ".length + 1),
        },
      );
      expect(JSON.stringify(hover?.contents)).toContain("Square");
      expect(app.languageServers.status()).toHaveLength(1);
    }, 60_000);
  });
}

suite("ty", "ty", PY_FILES, "main.py", "pkg/shapes.py");
suite("pyrefly", "pyrefly", PY_FILES, "main.py", "pkg/shapes.py");
suite("basedpyright", "basedpyright-langserver", PY_FILES, "main.py", "pkg/shapes.py");
suite("typescript", "tsc", TS_FILES, "src/main.ts", "src/shapes.ts");
