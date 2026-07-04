import { describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { TerminalView } from "../builtin/TerminalView";
import { TerminalSpawnError, UnsupportedTerminalAdapter, type TerminalAdapter, type PtyHandle } from "./TerminalAdapter";
import type { TerminalRenderer } from "./GhosttyTerminalRenderer";
import { Menu, MenuItem } from "../ui/Menu";

class FakePty implements PtyHandle {
  pid = 4242;
  written: string[] = [];
  resizes: Array<[number, number]> = [];
  killed = false;
  private dataCallbacks: Array<(data: string) => void> = [];
  private exitCallbacks: Array<(code: number) => void> = [];

  write(data: string): void { this.written.push(data); }
  resize(cols: number, rows: number): void { this.resizes.push([cols, rows]); }
  kill(): void {
    this.killed = true;
    this.emitExit(0);
  }
  onData(callback: (data: string) => void): void { this.dataCallbacks.push(callback); }
  onExit(callback: (code: number) => void): void { this.exitCallbacks.push(callback); }
  emitData(data: string): void { for (const cb of this.dataCallbacks) cb(data); }
  emitExit(code: number): void {
    const callbacks = this.exitCallbacks;
    this.exitCallbacks = [];
    for (const cb of callbacks) cb(code);
  }
}

class FakeAdapter implements TerminalAdapter {
  readonly available = true;
  ptys: FakePty[] = [];
  spawnRequests: Array<{ shell?: string; cwd?: string }> = [];
  failNext: string | null = null;

  defaultShell(): string { return "/bin/fake-sh"; }
  defaultCwd(): string { return "/home/fake"; }
  spawn(request: { shell?: string; cwd?: string }): PtyHandle {
    if (this.failNext) {
      const message = this.failNext;
      this.failNext = null;
      throw new TerminalSpawnError("spawn-failed", message);
    }
    this.spawnRequests.push(request);
    const pty = new FakePty();
    this.ptys.push(pty);
    return pty;
  }
}

function fakeRenderer(): TerminalRenderer & { output: string[]; inputCallback: ((data: string) => void) | null } {
  const renderer = {
    output: [] as string[],
    inputCallback: null as ((data: string) => void) | null,
    mount: () => {},
    write: (data: Uint8Array | string) => { renderer.output.push(String(data)); },
    onInput: (callback: (data: string) => void) => { renderer.inputCallback = callback; },
    fit: () => ({ cols: 120, rows: 40 }),
    getSelection: () => "",
    focus: () => {},
    dispose: () => {},
  };
  return renderer;
}

async function createAppWithFakeTerminal() {
  const app = new App(document.createElement("div"));
  const adapter = new FakeAdapter();
  app.terminals.adapterFactory = () => adapter;
  const renderer = fakeRenderer();
  TerminalView.rendererFactory = async () => renderer;
  await app.ready;
  return { app, adapter, renderer };
}

describe("TerminalService", () => {
  it("TerminalView: open() creates a terminal leaf backed by a real process handle", async () => {
    const { app, adapter, renderer } = await createAppWithFakeTerminal();

    const terminal = await app.terminals.open();

    expect(terminal.status).toBe("running");
    expect(terminal.shell).toBe("/bin/fake-sh");
    const leaves = app.workspace.getLeavesOfType("terminal");
    expect(leaves).toHaveLength(1);
    expect(leaves[0].view).toBeInstanceOf(TerminalView);
    adapter.ptys[0].emitData("fake-prompt$ ");
    expect(renderer.output.join("")).toContain("fake-prompt$ ");
  });

  it("TerminalInput: renderer input reaches the PTY", async () => {
    const { app, adapter, renderer } = await createAppWithFakeTerminal();
    await app.terminals.open();

    renderer.inputCallback?.("printf terminal-ready\r");

    expect(adapter.ptys[0].written.join("")).toContain("printf terminal-ready");
  });

  it("TerminalResize: fit dimensions propagate to the PTY", async () => {
    const { app, adapter } = await createAppWithFakeTerminal();
    await app.terminals.open();

    expect(adapter.ptys[0].resizes).toContainEqual([120, 40]);
  });

  it("TerminalCwd: file menu context opens the terminal at the folder", async () => {
    const { app, adapter } = await createAppWithFakeTerminal();
    await app.vault.createFolder("projects");

    const terminal = await app.terminals.open({ cwd: "/home/fake/projects" });

    expect(terminal.cwd).toBe("/home/fake/projects");
    expect(adapter.spawnRequests[0].cwd).toBe("/home/fake/projects");
  });

  it("TerminalLifecycle: closing the leaf kills the PTY and drops the session", async () => {
    const { app, adapter } = await createAppWithFakeTerminal();
    const terminal = await app.terminals.open();
    const leaf = app.workspace.getLeavesOfType("terminal")[0];

    leaf.detach();
    await Promise.resolve();

    expect(adapter.ptys[0].killed).toBe(true);
    expect(app.terminals.getTerminal(terminal.id)).toBeNull();
  });

  it("TerminalRestart: restart spawns a new shell in the same cwd", async () => {
    const { app, adapter } = await createAppWithFakeTerminal();
    const terminal = await app.terminals.open({ cwd: "/home/fake/projects" });
    adapter.ptys[0].emitExit(1);
    expect(app.terminals.getTerminal(terminal.id)?.status).toBe("exited");

    await app.terminals.restart(terminal.id);

    expect(adapter.spawnRequests).toHaveLength(2);
    expect(adapter.spawnRequests[1].cwd).toBe("/home/fake/projects");
    expect(app.terminals.getTerminal(terminal.id)?.status).toBe("running");
  });

  it("TerminalMenu: plugins can extend the terminal context menu", async () => {
    const { app, renderer } = await createAppWithFakeTerminal();
    void renderer;
    await app.terminals.open();
    const view = app.workspace.getLeavesOfType("terminal")[0].view as TerminalView;
    const seen: Array<{ menu: Menu; context: Record<string, unknown> }> = [];
    app.workspace.on("terminal-menu", (menu: Menu, context: Record<string, unknown>) => {
      menu.addItem((item) => item.setTitle("Plugin action"));
      seen.push({ menu, context });
    });

    const surfaceEl = view.contentEl.querySelector(".terminal-view-surface") as HTMLElement;
    surfaceEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

    expect(seen).toHaveLength(1);
    expect(seen[0].context.cwd).toBeDefined();
    expect(seen[0].context.status).toBe("running");
    const titles = seen[0].menu.items.filter((item): item is MenuItem => item instanceof MenuItem).map((item) => item.titleEl.textContent);
    expect(titles).toContain("Plugin action");
  });

  it("TerminalPublicApi: handles and menu context expose no process internals", async () => {
    const { app } = await createAppWithFakeTerminal();
    const terminal = await app.terminals.open();

    for (const key of ["pty", "process", "stream", "renderer", "socket", "fd"]) {
      expect(terminal, `TTerminal must not expose ${key}`).not.toHaveProperty(key);
    }
    expect(Object.keys(terminal).sort()).toEqual(["cwd", "id", "shell", "status"]);
  });

  it("TerminalErrorPath: spawn failure surfaces an error and restart recovers", async () => {
    const { app, adapter } = await createAppWithFakeTerminal();
    adapter.failNext = "bad shell path";
    const errors: unknown[] = [];
    app.workspace.on("terminal-error", (_terminal: unknown, error: unknown) => errors.push(error));

    const terminal = await app.terminals.open();

    expect(terminal.status).toBe("error");
    expect(errors).toHaveLength(1);
    const view = app.workspace.getLeavesOfType("terminal")[0].view as TerminalView;
    expect(view.contentEl.querySelector(".terminal-view-overlay-message")?.textContent).toContain("bad shell path");

    await view.restart();
    expect(view.getTerminal()?.status).toBe("running");
  });

  it("TerminalUnsupportedRuntime: browser runtime reports unsupported instead of spawning", async () => {
    const app = new App(document.createElement("div"));
    app.terminals.adapterFactory = () => new UnsupportedTerminalAdapter();
    TerminalView.rendererFactory = async () => fakeRenderer();
    await app.ready;
    const errors: TerminalSpawnError[] = [];
    app.workspace.on("terminal-error", (_terminal: unknown, error: TerminalSpawnError) => errors.push(error));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const terminal = await app.terminals.open();

    expect(terminal.status).toBe("error");
    expect(errors[0]?.code).toBe("unsupported-runtime");
    const view = app.workspace.getLeavesOfType("terminal")[0].view as TerminalView;
    expect(view.contentEl.querySelector(".terminal-view-overlay")).not.toBeNull();
    warn.mockRestore();
  });
});
