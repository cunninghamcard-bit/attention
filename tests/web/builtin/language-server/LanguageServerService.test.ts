/**
 * Input: @codemirror/lsp-client, @web/builtin/language-server/LanguageUri, @web/builtin/language-server/ReferencesView, @web/views/CodeFileView, tests/web/TestApp, ./fakes
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { LSPPlugin } from "@codemirror/lsp-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "@web/app/App";
import { pathToUri } from "@web/builtin/language-server/LanguageUri";
import { REFERENCES_VIEW_TYPE, ReferencesView } from "@web/builtin/language-server/ReferencesView";
import { CodeFileView } from "@web/views/CodeFileView";
import { createTestApp } from "../../TestApp";
import {
  FakeBridge,
  type FakeProcess,
  addFile,
  installFakeBridge,
  location,
  mountOnDisk,
  tick,
  until,
} from "./fakes";

let bridge: FakeBridge;
let restore: () => void;

beforeEach(() => {
  ({ bridge, restore } = installFakeBridge());
  bridge.installed = { ty: "/bin/ty" };
});
afterEach(() => {
  document.querySelectorAll(".notice").forEach((el) => el.remove());
  restore();
});

async function setup(mounts: Record<string, string> = { repo: "/disk/repo" }): Promise<App> {
  const app = createTestApp();
  await app.ready;
  // Settings live in local storage, which outlives a test's app.
  app.saveLocalStorage("language-server-settings", null);
  mountOnDisk(app, mounts);
  return app;
}

async function openCode(app: App, path: string): Promise<CodeFileView> {
  const file = app.vault.getAbstractFileByPath(path);
  const leaf = await app.workspace.openFile(file as never, { active: true });
  const view = leaf.view as CodeFileView;
  // The server is attached after the file is shown, not before.
  for (let attempt = 0; attempt < 20 && !LSPPlugin.get(view.editorView!); attempt += 1)
    await tick(1);
  return view;
}

const notices = (): string[] =>
  [...document.querySelectorAll(".notice-message")].map((el) => el.textContent ?? "");

describe("LanguageServerService — starting servers", () => {
  it("starts nothing until a file of that language is opened", async () => {
    const app = await setup();
    await addFile(app, "repo/readme.md", "# hi\n");
    await addFile(app, "repo/data.json", "{}\n");
    await app.workspace.openFile(app.vault.getAbstractFileByPath("repo/data.json") as never, {});
    await tick();
    expect(bridge.processes).toHaveLength(0);
  });

  it("starts the server in the project root and opens the document once", async () => {
    const app = await setup();
    await addFile(app, "repo/pkg/a.py", "x = 1\n");
    const view = await openCode(app, "repo/pkg/a.py");

    expect(bridge.processes).toHaveLength(1);
    const server = bridge.processes[0]!;
    expect(server.options).toEqual({ command: "/bin/ty", args: ["server"], cwd: "/disk/repo" });

    const init = server.sent("initialize")[0]!.params;
    expect(init.rootUri).toBe("file:///disk/repo");
    // The client package sends rootUri alone; newer servers discover the
    // project from workspaceFolders.
    expect(init.workspaceFolders).toEqual([{ uri: "file:///disk/repo", name: "repo" }]);

    const opened = server.sent("textDocument/didOpen");
    expect(opened).toHaveLength(1);
    expect(opened[0]!.params.textDocument).toMatchObject({
      uri: "file:///disk/repo/pkg/a.py",
      languageId: "python",
      text: "x = 1\n",
    });
    expect(LSPPlugin.get(view.editorView!)?.uri).toBe("file:///disk/repo/pkg/a.py");
  });

  it("shares one server per root and language, and separates roots", async () => {
    const app = await setup({ repo: "/disk/repo", other: "/disk/other" });
    await addFile(app, "repo/a.py", "a = 1\n");
    await addFile(app, "repo/b.py", "b = 1\n");
    await addFile(app, "other/c.py", "c = 1\n");

    await openCode(app, "repo/a.py");
    await app.workspace
      .getLeaf("tab")
      .openFile(app.vault.getAbstractFileByPath("repo/b.py") as never);
    await tick(5);
    expect(bridge.processes).toHaveLength(1);

    await app.workspace
      .getLeaf("tab")
      .openFile(app.vault.getAbstractFileByPath("other/c.py") as never);
    await tick(5);
    expect(bridge.processes.map((process) => process.options.cwd)).toEqual([
      "/disk/repo",
      "/disk/other",
    ]);
    expect(
      app.languageServers
        .status()
        .map((status) => status.root)
        .sort(),
    ).toEqual(["other", "repo"]);
  });

  it("falls back to the next server when the first cannot start, and remembers it", async () => {
    bridge.installed = { ty: "/bin/ty", pyrefly: "/bin/pyrefly" };
    bridge.onSpawn = (process) => {
      process.dieOnStart = process.options.command === "/bin/ty";
    };
    const app = await setup();
    await addFile(app, "repo/a.py", "a = 1\n");
    await openCode(app, "repo/a.py");

    expect(bridge.processes.map((process) => process.options.command)).toEqual([
      "/bin/ty",
      "/bin/pyrefly",
    ]);
    expect(app.languageServers.status()).toMatchObject([{ server: "pyrefly", state: "ready" }]);

    // A second file does not retry the server that already failed here.
    await addFile(app, "repo/b.py", "b = 1\n");
    await app.workspace
      .getLeaf("tab")
      .openFile(app.vault.getAbstractFileByPath("repo/b.py") as never);
    await tick(5);
    expect(bridge.processes).toHaveLength(2);
  });

  it("honors the chosen server and 'off'", async () => {
    bridge.installed = { ty: "/bin/ty", pyrefly: "/bin/pyrefly" };
    const app = await setup();
    await addFile(app, "repo/a.py", "a = 1\n");
    app.languageServers.saveSettings({ servers: { python: "pyrefly" } });
    await openCode(app, "repo/a.py");
    expect(bridge.processes.map((process) => process.options.command)).toEqual(["/bin/pyrefly"]);

    app.languageServers.saveSettings({ servers: { python: "off" } });
    await tick(5);
    expect(bridge.running).toHaveLength(0);
    expect(
      app.languageServers.availability(app.vault.getAbstractFileByPath("repo/a.py") as never),
    ).toEqual({
      kind: "disabled",
    });
  });

  it("looks inside the project only when the setting allows it", async () => {
    const calls: string[][] = [];
    bridge.resolve = (command: string, extraDirs: string[] = []) => {
      calls.push(extraDirs);
      return command === "ty" ? "/bin/ty" : null;
    };
    const app = await setup();
    await addFile(app, "repo/a.py", "a = 1\n");
    await app.languageServers.sessionFor(app.vault.getAbstractFileByPath("repo/a.py") as never);
    expect(calls.every((dirs) => dirs.length === 0)).toBe(true);

    calls.length = 0;
    app.languageServers.saveSettings({ useProjectBinaries: true });
    await app.languageServers.sessionFor(app.vault.getAbstractFileByPath("repo/a.py") as never);
    expect(calls).toContainEqual(["/disk/repo/node_modules/.bin", "/disk/repo/.venv/bin"]);
  });

  it("does nothing without the desktop bridge", async () => {
    restore();
    const app = await setup();
    const file = await addFile(app, "repo/a.py", "a = 1\n");
    expect(await app.languageServers.extensionFor(file)).toBeNull();
    expect(app.languageServers.availability(file)).toEqual({ kind: "no-bridge" });
  });
});

describe("LanguageServerService — the editor", () => {
  it("jumps to a definition in another file and selects the name", async () => {
    const app = await setup();
    await addFile(app, "repo/lib.py", "import os\n\ndef helper():\n    return 1\n");
    await addFile(app, "repo/main.py", "from lib import helper\nhelper()\n");
    bridge.onSpawn = (process) => {
      process.responders["textDocument/definition"] = () => [
        location("/disk/repo/lib.py", 2, 4, 10),
      ];
    };
    const view = await openCode(app, "repo/main.py");
    const pos = view.editorView!.state.doc.line(2).from + 2;

    const jumped = await app.languageServers.goToDefinition(view.editorView!, view.file!, pos);

    expect(jumped).toBe(true);
    const request = bridge.processes[0]!.sent("textDocument/definition")[0]!;
    expect(request.params).toEqual({
      textDocument: { uri: "file:///disk/repo/main.py" },
      position: { line: 1, character: 2 },
    });
    const active = app.workspace.getActiveViewOfType(CodeFileView)!;
    expect(active.file?.path).toBe("repo/lib.py");
    const selection = active.editorView!.state.selection.main;
    expect(active.editorView!.state.sliceDoc(selection.from, selection.to)).toBe("helper");
  });

  it("follows a definition given as a link, to the name rather than the whole body", async () => {
    const app = await setup();
    await addFile(app, "repo/lib.py", "def helper():\n    return 1\n");
    await addFile(app, "repo/main.py", "from lib import helper\n");
    bridge.onSpawn = (process) => {
      process.responders["textDocument/definition"] = () => [
        {
          targetUri: "file:///disk/repo/lib.py",
          targetRange: { start: { line: 0, character: 0 }, end: { line: 1, character: 12 } },
          targetSelectionRange: location("/x", 0, 4, 10).range,
        },
      ];
    };
    const view = await openCode(app, "repo/main.py");

    expect(await app.languageServers.goToDefinition(view.editorView!, view.file!, 18)).toBe(true);
    const active = app.workspace.getActiveViewOfType(CodeFileView)!;
    expect(active.file?.path).toBe("repo/lib.py");
    const selection = active.editorView!.state.selection.main;
    expect(active.editorView!.state.sliceDoc(selection.from, selection.to)).toBe("helper");
  });

  it("says so when the definition is outside the workspace", async () => {
    const app = await setup();
    await addFile(app, "repo/main.py", "import os\n");
    bridge.onSpawn = (process) => {
      process.responders["textDocument/definition"] = () =>
        location("/usr/lib/python3/os.py", 0, 0, 2);
    };
    const view = await openCode(app, "repo/main.py");

    expect(await app.languageServers.goToDefinition(view.editorView!, view.file!, 7)).toBe(false);
    expect(notices().join("\n")).toContain("/usr/lib/python3/os.py");
    expect(app.workspace.getActiveViewOfType(CodeFileView)?.file?.path).toBe("repo/main.py");
  });

  it("lists references from every file in the References pane, and opens them", async () => {
    const app = await setup();
    await addFile(app, "repo/lib.py", "import os\n\ndef helper():\n    return 1\n");
    await addFile(app, "repo/use.py", "from lib import helper\n\n\nprint(  helper())\n");
    await addFile(app, "repo/main.py", "from lib import helper\nhelper()\n");
    bridge.onSpawn = (process) => {
      process.responders["textDocument/references"] = () => [
        location("/disk/repo/lib.py", 2, 4, 10),
        // Never opened in a tab: the list must not depend on that.
        location("/disk/repo/use.py", 3, 8, 14),
        location("/disk/repo/use.py", 0, 16, 22),
        location("/usr/lib/python3/other.py", 6, 0, 6),
      ];
    };
    const view = await openCode(app, "repo/main.py");
    const editor = view.editorView!;
    editor.dispatch({ selection: { anchor: editor.state.doc.line(2).from + 2 } });

    expect(await app.languageServers.showReferences(editor, view.file!)).toBe(true);

    const request = bridge.processes[0]!.sent("textDocument/references")[0]!;
    expect(request.params).toEqual({
      textDocument: { uri: "file:///disk/repo/main.py" },
      position: { line: 1, character: 2 },
      context: { includeDeclaration: true },
    });
    const pane = app.workspace.getLeavesOfType(REFERENCES_VIEW_TYPE)[0]!.view as ReferencesView;
    expect(pane.contentEl.querySelector(".tree-item-inner")?.textContent).toBe("helper 4");
    const files = [...pane.contentEl.querySelectorAll(".search-result-file")];
    expect(files.map((el) => el.querySelector(".search-result-file-title")?.textContent)).toEqual([
      "repo/lib.py",
      "repo/use.py",
      "/usr/lib/python3/other.py",
    ]);
    // Within a file: by line, with the line number, the indent dropped and the name marked.
    const rows = [...files[1]!.querySelectorAll(".search-result-file-match")];
    expect(rows.map((row) => row.textContent)).toEqual([
      "1from lib import helper",
      "4print(  helper())",
    ]);
    expect(rows[1]!.querySelector(".search-result-file-matched-text")?.textContent).toBe("helper");
    // A file outside the workspace has no text to show — only where it is.
    expect(files[2]!.querySelector(".search-result-file-match-text")?.textContent).toBe("7:1");

    (rows[1] as HTMLElement).click();
    await until(
      () => app.workspace.getActiveViewOfType(CodeFileView)?.file?.path === "repo/use.py",
      "the reference to open",
    );
    const active = app.workspace.getActiveViewOfType(CodeFileView)!;
    await until(() => !active.editorView!.state.selection.main.empty, "the name to be selected");
    const selection = active.editorView!.state.selection.main;
    expect(active.editorView!.state.sliceDoc(selection.from, selection.to)).toBe("helper");
    expect(active.editorView!.state.doc.lineAt(selection.from).number).toBe(4);

    // Asking again reuses the pane rather than stacking another.
    bridge.processes[0]!.responders["textDocument/references"] = () => null;
    expect(await app.languageServers.showReferences(editor, view.file!)).toBe(true);
    expect(app.workspace.getLeavesOfType(REFERENCES_VIEW_TYPE)).toHaveLength(1);
    expect(pane.contentEl.querySelector(".search-empty-state")?.textContent).toBe(
      "No references found.",
    );
  });

  it("explains a missing server once, with how to install it", async () => {
    bridge.installed = {};
    const app = await setup();
    await addFile(app, "repo/main.py", "x = 1\n");
    const leaf = await app.workspace.openFile(
      app.vault.getAbstractFileByPath("repo/main.py") as never,
      {
        active: true,
      },
    );
    const view = leaf.view as CodeFileView;
    await tick(5);

    // No server, but the keys are still bound so they can explain themselves.
    expect(LSPPlugin.get(view.editorView!)).toBeNull();
    expect(await app.languageServers.goToDefinition(view.editorView!, view.file!)).toBe(false);
    await app.languageServers.goToDefinition(view.editorView!, view.file!);
    const shown = notices().filter((text) => text.includes("No Python language server"));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain("uv tool install ty");
  });

  it("closes the document when its last tab closes, not before", async () => {
    const app = await setup();
    await addFile(app, "repo/a.py", "a = 1\n");
    const first = await openCode(app, "repo/a.py");
    const secondLeaf = app.workspace.getLeaf("tab");
    await secondLeaf.openFile(app.vault.getAbstractFileByPath("repo/a.py") as never);
    for (let i = 0; i < 20 && !LSPPlugin.get((secondLeaf.view as CodeFileView).editorView!); i += 1)
      await tick(1);
    const server = bridge.processes[0]!;
    expect(server.sent("textDocument/didOpen")).toHaveLength(1);

    first.leaf.detach();
    await tick(5);
    expect(server.sent("textDocument/didClose")).toHaveLength(0);

    secondLeaf.detach();
    await tick(5);
    expect(server.sent("textDocument/didClose")).toHaveLength(1);
  });

  it("detaches from the old file before the tab shows another", async () => {
    const app = await setup();
    await addFile(app, "repo/a.py", "a = 1\n");
    await addFile(app, "repo/b.py", "b = 2\n");
    const view = await openCode(app, "repo/a.py");
    const server = bridge.processes[0]!;

    await view.leaf.openFile(app.vault.getAbstractFileByPath("repo/b.py") as never);
    for (
      let i = 0;
      i < 20 && LSPPlugin.get(view.editorView!)?.uri !== "file:///disk/repo/b.py";
      i += 1
    )
      await tick(1);

    // a.py was closed untouched: swapping the tab's content must not reach the
    // server as an edit to a.py.
    expect(server.sent("textDocument/didChange")).toHaveLength(0);
    expect(server.sent("textDocument/didClose").map((m) => m.params.textDocument.uri)).toEqual([
      "file:///disk/repo/a.py",
    ]);
    expect(server.sent("textDocument/didOpen").map((m) => m.params.textDocument.uri)).toEqual([
      "file:///disk/repo/a.py",
      "file:///disk/repo/b.py",
    ]);
  });
});

describe("LanguageServerService — lifecycle", () => {
  it("restarts after a crash and reconnects open editors", async () => {
    const app = await setup();
    await addFile(app, "repo/a.py", "a = 1\n");
    const view = await openCode(app, "repo/a.py");
    const first = bridge.processes[0]!;

    const deadClient = LSPPlugin.get(view.editorView!)!.client;
    first.exit(1);
    await until(
      () => (bridge.processes[1]?.sent("textDocument/didOpen").length ?? 0) > 0,
      "reopen",
    );

    expect(bridge.processes).toHaveLength(2);
    // The editor is on the new server's client, not the dead one.
    expect(LSPPlugin.get(view.editorView!)!.client).not.toBe(deadClient);
    expect(app.languageServers.status()).toMatchObject([{ state: "ready", documents: 1 }]);
  });

  it("refuses to navigate on a server that has died", async () => {
    // Out of crash budget: the editor stays attached to a dead client. The
    // client itself still reports "connected", so the service must know better.
    const app = await setup();
    await addFile(app, "repo/a.py", "a = 1\n");
    const view = await openCode(app, "repo/a.py");
    for (let round = 0; round < 3; round += 1) {
      const current = bridge.processes.at(-1) as FakeProcess;
      await until(() => current.sent("initialized").length > 0, "initialized");
      current.exit(1);
      await tick(8);
    }
    expect(await app.languageServers.goToDefinition(view.editorView!, view.file!)).toBe(false);
    expect(bridge.processes.at(-1)!.sent("textDocument/definition")).toHaveLength(0);
  });

  it("gives up on a server that keeps crashing", async () => {
    const app = await setup();
    await addFile(app, "repo/a.py", "a = 1\n");
    await openCode(app, "repo/a.py");

    for (let round = 0; round < 3; round += 1) {
      const current = bridge.processes.at(-1) as FakeProcess;
      for (let i = 0; i < 30 && current.sent("initialized").length === 0; i += 1) await tick(1);
      current.exit(1);
      await tick(8);
    }

    expect(bridge.processes).toHaveLength(3);
    expect(bridge.running).toHaveLength(0);
    expect(notices().join("\n")).toContain("keeps stopping");
  });

  it("answers the requests servers wait on", async () => {
    const app = await setup();
    await addFile(app, "repo/a.py", "a = 1\n");
    await openCode(app, "repo/a.py");
    const server = bridge.processes[0]!;

    server.emit({ id: "cfg", method: "workspace/configuration", params: { items: [{}, {}] } });
    server.emit({ id: "reg", method: "client/registerCapability", params: {} });
    server.emit({ id: "edit", method: "workspace/applyEdit", params: {} });
    await tick();

    const reply = (id: string) => server.received.find((message) => message.id === id);
    expect(reply("cfg")?.result).toEqual([null, null]);
    expect(reply("reg")?.result).toBeNull();
    // A reading client never lets the server write.
    expect(reply("edit")?.result).toEqual({ applied: false });
  });

  it("stops every server on restart and starts again on demand", async () => {
    const app = await setup();
    await addFile(app, "repo/a.py", "a = 1\n");
    const view = await openCode(app, "repo/a.py");

    const oldClient = LSPPlugin.get(view.editorView!)!.client;
    app.languageServers.restart();
    await until(
      () => (bridge.processes[1]?.sent("textDocument/didOpen").length ?? 0) > 0,
      "reopen",
    );
    await until(() => bridge.processes[0]!.exited, "old server exit");

    // The polite sequence, not a kill.
    expect(bridge.processes[0]!.sent("shutdown")).toHaveLength(1);
    expect(bridge.processes[0]!.sent("exit")).toHaveLength(1);
    expect(bridge.processes[0]!.killed).toBe(false);
    expect(bridge.processes).toHaveLength(2);
    expect(LSPPlugin.get(view.editorView!)!.client).not.toBe(oldClient);
  });
});

describe("LanguageServerService — paths", () => {
  it("maps vault paths to disk and back, per mount", async () => {
    const app = await setup({ repo: "/disk/my repo", other: "/disk/other" });
    expect(app.languageServers.locate("repo/src/a.py")).toMatchObject({
      fullPath: "/disk/my repo/src/a.py",
      uri: "file:///disk/my%20repo/src/a.py",
    });
    expect(app.languageServers.locate("Home/note.md")).toBeNull();
    // Servers do not agree on escaping; both spellings name the same file.
    expect(app.languageServers.pathForUri("file:///disk/my%20repo/src/a.py")).toBe("repo/src/a.py");
    expect(app.languageServers.pathForUri(pathToUri("/disk/other/x.ts"))).toBe("other/x.ts");
    expect(app.languageServers.pathForUri("file:///disk/elsewhere/x.ts")).toBeNull();
    expect(app.languageServers.pathForUri("file:///disk/other-sibling/x.ts")).toBeNull();
  });
});
