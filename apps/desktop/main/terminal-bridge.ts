import { homedir } from "node:os";
import { ensureZshShim } from "./zsh-shim";
import type { ElectronTerminalApi, PtyHandle, PtySpawnOptions } from "@app/shared/terminalApi";

/**
 * Preload-side PTY bridge (`window.electronTerminal`).
 *
 * The renderer runs with nodeIntegration, so PTY ownership lives here in the
 * preload module: `node-pty` is required lazily on first spawn and never
 * leaves this file. The renderer's DesktopTerminalAdapter only sees the
 * function-based handle. The port contract (`ElectronTerminalApi`) is declared
 * once in `src/shared` and consumed by both this bridge and the renderer.
 */

interface NodePtyProcess {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): void;
}

interface NodePtyModule {
  spawn(
    shell: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string | undefined>;
    },
  ): NodePtyProcess;
}

export function createElectronTerminalApi(
  loadNodePty: () => NodePtyModule = () => require("node-pty") as NodePtyModule,
  platform: NodeJS.Platform = process.platform,
): ElectronTerminalApi {
  const defaultShell = process.env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  return {
    available: platform === "darwin" || platform === "linux",
    platform,
    defaultShell,
    homeDir: homedir(),
    prepareShellIntegration(): string | null {
      // Respect a user who already runs their own ZDOTDIR arrangement.
      if (process.env.ZDOTDIR) return null;
      return ensureZshShim({ homeDir: homedir() });
    },
    spawn(options: PtySpawnOptions): PtyHandle {
      if (platform === "win32") {
        throw new Error("Terminal is not supported on Windows yet.");
      }
      const pty = loadNodePty();
      const shell = options.shell || defaultShell;
      const cols = options.cols ?? 80;
      const rows = options.rows ?? 24;
      const child = pty.spawn(shell, options.args ?? [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: options.cwd || homedir(),
        env: {
          ...process.env,
          TERM: "xterm-256color",
          TERM_PROGRAM: "obsidian-agent-workspace",
          COLORTERM: "truecolor",
          COLUMNS: String(cols),
          LINES: String(rows),
          ...options.env,
        },
      });
      let killed = false;
      return {
        pid: child.pid,
        write: (data) => child.write(data),
        resize: (nextCols, nextRows) => {
          if (nextCols > 0 && nextRows > 0) child.resize(nextCols, nextRows);
        },
        kill: () => {
          if (killed) return;
          killed = true;
          try {
            child.kill();
          } catch {
            // ponytail: graceful kill failed; SIGKILL is the hard fallback.
            try {
              child.kill("SIGKILL");
            } catch {
              /* process already gone */
            }
          }
        },
        onData: (callback) => child.onData(callback),
        onExit: (callback) =>
          child.onExit(({ exitCode }) => {
            killed = true;
            callback(exitCode);
          }),
      };
    },
  };
}

export function installTerminalBridge(target: typeof globalThis): void {
  Object.defineProperty(target, "electronTerminal", {
    value: createElectronTerminalApi(),
    configurable: true,
    enumerable: true,
    writable: false,
  });
}
