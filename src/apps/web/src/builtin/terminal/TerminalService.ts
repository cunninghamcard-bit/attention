import type { App } from "../../app/App";
import {
  createTerminalAdapter,
  TerminalSpawnError,
  type TerminalAdapter,
  type TerminalProcessHandle,
} from "./TerminalAdapter";
import type { WorkspaceLeaf } from "../../views/workspace/WorkspaceLeaf";

/**
 * `app.terminals` — the app-level terminal service from the terminal-view
 * spec. Owns the PTY handles and per-terminal output buffers; everything a
 * plugin (or view) receives is a TTerminal handle plus service methods. The
 * raw process handle never leaves this module.
 */

export type TerminalStatus = "starting" | "running" | "exited" | "error";

export interface TTerminal {
  id: string;
  cwd: string;
  shell: string;
  status: TerminalStatus;
}

export interface TerminalOpenOptions {
  cwd?: string;
  shell?: string;
  location?: "left" | "right" | "tab" | "split" | "window";
  reveal?: boolean;
}

/**
 * The product-level terminal choice:
 * - "enhanced" (default): zsh with the batteries-included integration layer —
 *   prompt, autosuggestions, syntax highlighting — layered over the user's
 *   existing shell configuration like Kaku's setup flow.
 * - "system": the user's login shell and their own dotfiles, no injection.
 * - "custom": the shell/font detail fields below take effect.
 */
export type TerminalProfile = "enhanced" | "system" | "custom";

export interface TerminalSettings {
  profile: TerminalProfile;
  shell: string;
  location: "tab" | "split" | "right";
  fontFamily: string;
  fontSize: number;
  scrollback: number;
}

const SETTINGS_KEY = "agent-workspace-terminal-settings";

// ponytail: buffer caps replay memory per terminal; a ring buffer of chunks
// is enough until someone needs precise scrollback limits.
const MAX_BUFFER_CHUNKS = 4096;

interface TerminalSession {
  terminal: TTerminal;
  process: TerminalProcessHandle | null;
  buffer: string[];
  consumers: Set<(data: string) => void>;
  exitCallbacks: Set<(code: number) => void>;
  lastError: TerminalSpawnError | null;
}

export const TERMINAL_VIEW_TYPE = "terminal";

export class TerminalService {
  private sessions = new Map<string, TerminalSession>();
  private counter = 0;
  /** Swappable for tests; resolved lazily so the bridge can install first. */
  adapterFactory: () => TerminalAdapter = createTerminalAdapter;
  private adapterInstance: TerminalAdapter | null = null;

  constructor(readonly app: App) {}

  get adapter(): TerminalAdapter {
    this.adapterInstance ??= this.adapterFactory();
    return this.adapterInstance;
  }

  getSettings(): TerminalSettings {
    const stored = this.app.loadLocalStorage<Partial<TerminalSettings>>(SETTINGS_KEY) ?? {};
    return {
      profile: stored.profile ?? "enhanced",
      shell: stored.shell ?? "",
      location: stored.location ?? "tab",
      fontFamily: stored.fontFamily ?? "",
      fontSize: stored.fontSize ?? 15,
      scrollback: stored.scrollback ?? 10000,
    };
  }

  /**
   * Resolve the active profile into a concrete spawn config. This is the only
   * place profile semantics live — adapters and the bridge receive plain
   * `{ shell, env }` and execute it verbatim.
   */
  resolveSpawnConfig(requestedShell?: string): { shell: string; env?: Record<string, string> } {
    const settings = this.getSettings();
    if (settings.profile === "system") {
      return { shell: requestedShell || this.adapter.defaultShell() };
    }
    if (settings.profile === "custom") {
      return { shell: requestedShell || settings.shell || this.adapter.defaultShell() };
    }
    // enhanced: always zsh (matching the vendor terminal this profile mirrors),
    // with the integration shim's ZDOTDIR when it can be provisioned.
    const loginShell = this.adapter.defaultShell();
    const shell =
      requestedShell || (loginShell.split("/").pop() === "zsh" ? loginShell : "/bin/zsh");
    const zdotdir = this.adapter.prepareShellIntegration();
    return zdotdir ? { shell, env: { ZDOTDIR: zdotdir } } : { shell };
  }

  saveSettings(settings: Partial<TerminalSettings>): void {
    this.app.saveLocalStorage(SETTINGS_KEY, { ...this.getSettings(), ...settings });
  }

  async open(options: TerminalOpenOptions = {}): Promise<TTerminal> {
    const terminal = this.createSession(options);
    const leaf = this.resolveLeaf(options.location ?? this.getSettings().location);
    await leaf.setViewState({
      type: TERMINAL_VIEW_TYPE,
      active: true,
      state: { terminalId: terminal.id },
    });
    if (options.reveal !== false) this.app.workspace.revealLeaf(leaf);
    return terminal;
  }

  /** Start a PTY session without opening a leaf (the view calls this too). */
  createSession(options: Pick<TerminalOpenOptions, "cwd" | "shell"> = {}): TTerminal {
    const id = `terminal-${++this.counter}`;
    const { shell } = this.resolveSpawnConfig(options.shell);
    const cwd = options.cwd || this.defaultCwd();
    const terminal: TTerminal = { id, cwd, shell, status: "starting" };
    const session: TerminalSession = {
      terminal,
      process: null,
      buffer: [],
      consumers: new Set(),
      exitCallbacks: new Set(),
      lastError: null,
    };
    this.sessions.set(id, session);
    this.spawnInto(session);
    return terminal;
  }

  getTerminal(id: string): TTerminal | null {
    return this.sessions.get(id)?.terminal ?? null;
  }

  /** Why the terminal is in "error" status, if it is. */
  getError(id: string): TerminalSpawnError | null {
    return this.sessions.get(id)?.lastError ?? null;
  }

  write(terminalId: string, data: string): void {
    this.sessions.get(terminalId)?.process?.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.sessions.get(terminalId)?.process?.resize(cols, rows);
  }

  kill(terminalId: string): void {
    const session = this.sessions.get(terminalId);
    if (!session) return;
    session.process?.kill();
    session.process = null;
    if (session.terminal.status === "starting" || session.terminal.status === "running") {
      session.terminal.status = "exited";
    }
  }

  /** Kill and drop the session entirely (view closed for good). */
  dispose(terminalId: string): void {
    this.kill(terminalId);
    this.sessions.delete(terminalId);
  }

  async restart(terminalId: string): Promise<TTerminal> {
    const session = this.sessions.get(terminalId);
    if (!session) throw new Error(`Unknown terminal: ${terminalId}`);
    session.process?.kill();
    session.process = null;
    session.buffer = [];
    session.terminal.status = "starting";
    this.spawnInto(session);
    return session.terminal;
  }

  /** Internal: stream output to a consumer, replaying buffered chunks first. */
  onOutput(terminalId: string, callback: (data: string) => void): () => void {
    const session = this.sessions.get(terminalId);
    if (!session) return () => {};
    for (const chunk of session.buffer) callback(chunk);
    session.consumers.add(callback);
    return () => session.consumers.delete(callback);
  }

  /** Internal: notified when the shell process exits. */
  onExit(terminalId: string, callback: (code: number) => void): () => void {
    const session = this.sessions.get(terminalId);
    if (!session) return () => {};
    session.exitCallbacks.add(callback);
    return () => session.exitCallbacks.delete(callback);
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }

  defaultCwd(): string {
    const vaultAdapter = this.app.vault.adapter as { getBasePath?: () => string };
    const basePath = vaultAdapter.getBasePath?.();
    return basePath || this.adapter.defaultCwd();
  }

  private spawnInto(session: TerminalSession): void {
    const { terminal } = session;
    session.lastError = null;
    try {
      // Re-resolve on every (re)spawn so a profile change applies to restarts.
      const { env } = this.resolveSpawnConfig(terminal.shell);
      const handle = this.adapter.spawn({
        shell: terminal.shell,
        cwd: terminal.cwd,
        cols: 80,
        rows: 24,
        env,
      });
      session.process = handle;
      terminal.status = "running";
      handle.onData((data) => {
        session.buffer.push(data);
        if (session.buffer.length > MAX_BUFFER_CHUNKS)
          session.buffer.splice(0, session.buffer.length - MAX_BUFFER_CHUNKS);
        for (const consumer of session.consumers) consumer(data);
      });
      handle.onExit((code) => {
        terminal.status = "exited";
        session.process = null;
        for (const callback of session.exitCallbacks) callback(code);
        this.app.workspace.trigger("terminal-exit", { ...terminal }, code);
      });
      this.app.workspace.trigger("terminal-open", { ...terminal });
    } catch (error) {
      terminal.status = "error";
      const spawnError =
        error instanceof TerminalSpawnError
          ? error
          : new TerminalSpawnError(
              "spawn-failed",
              error instanceof Error ? error.message : String(error),
            );
      session.lastError = spawnError;
      this.app.workspace.trigger("terminal-error", { ...terminal }, spawnError);
    }
  }

  private resolveLeaf(location: TerminalOpenOptions["location"]): WorkspaceLeaf {
    if (location === "left" || location === "right") {
      const existing = this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);
      if (existing.length > 0) return existing[0];
    }
    if (location === "split") return this.app.workspace.getLeaf("split");
    if (location === "window") return this.app.workspace.getLeaf("window");
    return this.app.workspace.getLeaf("tab");
  }
}
