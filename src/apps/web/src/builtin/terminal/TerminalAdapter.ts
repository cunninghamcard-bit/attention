/**
 * Renderer-side terminal capability boundary, analogous to FileSystemAdapter:
 * DesktopTerminalAdapter talks to the preload PTY bridge; the browser build
 * gets UnsupportedTerminalAdapter, which reports a clear unsupported-runtime
 * error instead of pretending it can spawn shells.
 *
 * The bridge shapes mirror electron/terminal-bridge.ts structurally — the
 * renderer tsconfig cannot import the electron project, so keep both in sync.
 */

export interface PtyHandle {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (exitCode: number) => void): void;
}

export interface ElectronTerminalApi {
  available: boolean;
  platform: string;
  defaultShell: string;
  homeDir: string;
  spawn(options: {
    shell?: string;
    args?: string[];
    cwd?: string;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
  }): PtyHandle;
  prepareShellIntegration?(): string | null;
}

export type TerminalErrorCode = "unsupported-runtime" | "spawn-failed";

export class TerminalSpawnError extends Error {
  constructor(
    readonly code: TerminalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TerminalSpawnError";
  }
}

export interface TerminalSpawnRequest {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  /** Extra environment resolved by the profile layer; passed through verbatim. */
  env?: Record<string, string>;
}

export type TerminalProcessHandle = PtyHandle;

export interface TerminalAdapter {
  readonly available: boolean;
  defaultShell(): string;
  defaultCwd(): string;
  spawn(request: TerminalSpawnRequest): TerminalProcessHandle;
  /** ZDOTDIR for the enhanced-zsh profile, or null when unavailable. */
  prepareShellIntegration(): string | null;
}

export class DesktopTerminalAdapter implements TerminalAdapter {
  constructor(private readonly bridge: ElectronTerminalApi) {}

  get available(): boolean {
    return this.bridge.available;
  }

  defaultShell(): string {
    return this.bridge.defaultShell;
  }

  defaultCwd(): string {
    return this.bridge.homeDir;
  }

  prepareShellIntegration(): string | null {
    return this.bridge.prepareShellIntegration?.() ?? null;
  }

  spawn(request: TerminalSpawnRequest): TerminalProcessHandle {
    try {
      return this.bridge.spawn(request);
    } catch (error) {
      throw new TerminalSpawnError(
        "spawn-failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

export class UnsupportedTerminalAdapter implements TerminalAdapter {
  readonly available = false;

  defaultShell(): string {
    return "";
  }

  defaultCwd(): string {
    return "";
  }

  prepareShellIntegration(): string | null {
    return null;
  }

  spawn(): TerminalProcessHandle {
    throw new TerminalSpawnError(
      "unsupported-runtime",
      "This runtime cannot spawn local shells. Open the desktop app to use the terminal.",
    );
  }
}

export function createTerminalAdapter(): TerminalAdapter {
  const bridge = (globalThis as { electronTerminal?: ElectronTerminalApi }).electronTerminal;
  if (bridge?.available) return new DesktopTerminalAdapter(bridge);
  return new UnsupportedTerminalAdapter();
}
