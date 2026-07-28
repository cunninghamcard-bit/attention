/**
 * Input: node:os, @app/shared/terminalApi, node-pty
 * Output: createElectronTerminalApi, installTerminalBridge
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { homedir, userInfo } from "node:os";
import type { ElectronTerminalApi, PtyHandle, PtySpawnOptions } from "@app/shared/terminalApi";

/**
 * Preload-side PTY bridge (`window.electronTerminal`).
 *
 * The renderer runs with nodeIntegration, so PTY ownership lives here in the
 * preload module: `node-pty` is required lazily on first spawn and never
 * leaves this file. The renderer's DesktopTerminalAdapter only sees the
 * function-based handle. The port contract (`ElectronTerminalApi`) is declared
 * once in `@app/shared` and consumed by both this bridge and the renderer.
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

/**
 * The LANG a real terminal emulator would hand the shell. An app launched
 * from Finder inherits no locale at all, which drops zsh into the C locale:
 * zle then books the prompt's UTF-8 glyphs by BYTE, its wrap model diverges
 * from the rendered grid, and every redisplay that navigates (kill-line,
 * wrapped-line repaints) paints over the prompt. Terminal.app and iTerm set
 * LANG from the system locale for exactly this reason. An invalid computed
 * locale just falls back to C — no worse than the unset status quo.
 */
export function defaultLang(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.LANG || env.LC_ALL || env.LC_CTYPE) return env.LANG;
  const tag = Intl.DateTimeFormat().resolvedOptions().locale;
  const match = /^([a-z]{2,3})(?:-.+)?-([A-Z]{2})$/.exec(tag);
  return match ? `${match[1]}_${match[2]}.UTF-8` : "en_US.UTF-8";
}

export function createElectronTerminalApi(
  loadNodePty: () => NodePtyModule = () => require("node-pty") as NodePtyModule,
  platform: NodeJS.Platform = process.platform,
): ElectronTerminalApi {
  // The LOGIN shell from passwd, the way Terminal.app and iTerm resolve it —
  // not `$SHELL`, which is inherited from whatever launched the app. Started
  // from a fish terminal, `$SHELL` is fish; started from Finder it is the
  // login shell, and the same app opened two different shells.
  const defaultShell =
    userInfo().shell || process.env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  return {
    available: platform === "darwin" || platform === "linux",
    platform,
    defaultShell,
    homeDir: homedir(),
    spawn(options: PtySpawnOptions): PtyHandle {
      if (platform === "win32") {
        throw new Error("Terminal is not supported on Windows yet.");
      }
      const pty = loadNodePty();
      const shell = options.shell || defaultShell;
      const cols = options.cols ?? 80;
      const rows = options.rows ?? 24;
      const lang = defaultLang();
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
          ...(lang ? { LANG: lang } : {}),
          // No COLUMNS/LINES: real terminals never export them. An exported
          // COLUMNS pins anything that reads it (starship in a capture pipe)
          // to the SPAWN-time width while zle tracks the live winsize; the
          // winsize ioctl is the single source of truth.
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
