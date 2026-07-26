/**
 * Input: None
 * Output: PtySpawnOptions, PtyHandle, ElectronTerminalApi
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * Native-seam port: the PTY (terminal) bridge.
 *
 * ONE definition of the contract. The shell fills it in the preload
 * (`terminal-bridge.ts` → the injected `electronTerminal` global, backed by
 * `node-pty`); the renderer's `DesktopTerminalAdapter` consumes it. Both sides
 * import from here.
 */

export interface PtySpawnOptions {
  shell?: string;
  args?: string[];
  cwd?: string;
  cols?: number;
  rows?: number;
}

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
  platform: NodeJS.Platform;
  defaultShell: string;
  homeDir: string;
  spawn(options: PtySpawnOptions): PtyHandle;
}
