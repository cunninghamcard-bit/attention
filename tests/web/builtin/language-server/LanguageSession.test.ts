/**
 * Input: @codemirror/view, @web/builtin/language-server/LanguageServerRegistry, @web/builtin/language-server/LanguageSession, ./fakes
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  LANGUAGE_GROUPS,
  getLanguageServer,
} from "@web/builtin/language-server/LanguageServerRegistry";
import { LanguageSession } from "@web/builtin/language-server/LanguageSession";
import { FakeProcess, until } from "./fakes";

function start(idleMs: number, configure: (process: FakeProcess) => void = () => {}) {
  const process = new FakeProcess({ command: "/bin/ty", args: ["server"], cwd: "/disk/repo" });
  configure(process);
  const events: string[] = [];
  const session = new LanguageSession({
    spec: getLanguageServer("ty")!,
    group: LANGUAGE_GROUPS[0]!,
    root: { name: "repo", path: "/disk/repo", uri: "file:///disk/repo" },
    binary: "/bin/ty",
    handle: process,
    sanitizeHTML: (html) => html,
    idleMs,
    host: {
      loadDocument: async (uri) =>
        uri.endsWith("/a.py") ? { languageId: "python", text: "a = 1\n" } : null,
      displayDocument: async () => null,
    },
    onExit: () => events.push("exit"),
    onIdle: (idle) => {
      events.push("idle");
      idle.dispose();
    },
  });
  return { process, session, events };
}

describe("LanguageSession", () => {
  it("is ready once the server answers initialize", async () => {
    const { session, process } = start(0);
    expect(session.state).toBe("starting");
    expect(await session.ready).toBe(true);
    expect(session.state).toBe("ready");
    await until(() => process.sent("initialized").length === 1, "initialized");
  });

  it("reports a server that dies during startup as not ready, keeping its last words", async () => {
    const { session, events } = start(0, (process) => {
      process.dieOnStart = true;
    });
    expect(await session.ready).toBe(false);
    expect(session.state).toBe("exited");
    expect(session.exitCode).toBe(1);
    expect(session.stderrTail).toContain("unknown option");
    // The owner hears about it; it is the owner that knows this was startup.
    expect(events).toEqual(["exit"]);
    expect(session.everReady).toBe(false);
  });

  it("goes idle after its last editor closes, and not while one is open", async () => {
    const { session, process, events } = start(30);
    await session.ready;
    const first = new EditorView({ doc: "a = 1\n" });
    const second = new EditorView({ doc: "a = 1\n" });
    session.workspace.openFile("file:///disk/repo/a.py", "python", first);
    // The same file in a second tab, spelled with a different escape.
    session.workspace.openFile("file:///disk/repo/%61.py", "python", second);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(events).toEqual([]);
    expect(process.sent("textDocument/didOpen")).toHaveLength(1);

    session.workspace.closeFile("file:///disk/repo/a.py", first);
    expect(session.openCount).toBe(1);
    expect(process.sent("textDocument/didClose")).toHaveLength(0);
    session.workspace.closeFile("file:///disk/repo/a.py", second);
    await until(() => events.includes("idle"), "idle");
    await until(() => process.exited, "exit");
    expect(process.sent("textDocument/didClose")).toHaveLength(1);
    // Stopping on purpose is not an unexpected exit.
    expect(events).toEqual(["idle"]);
    first.destroy();
    second.destroy();
  });

  it("stops a server nobody ever opened a document in", async () => {
    const { session, events } = start(30);
    await session.ready;
    await until(() => events.includes("idle"), "idle");
  });

  it("kills a server that is disposed before it is ready", async () => {
    const { session, process } = start(0, (fake) => {
      fake.responders = {};
      // Never answer initialize.
      (fake as unknown as { handle: () => void }).handle = () => {};
    });
    session.dispose();
    await until(() => process.exited, "exit");
    expect(process.killed).toBe(true);
    expect(await session.ready).toBe(false);
  });
});
