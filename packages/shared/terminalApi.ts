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
  /** Extra environment merged over the defaults — already resolved by the
   * caller (TerminalService profile resolution); the bridge applies it verbatim. */
  env?: Record<string, string>;
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
  /** Provision the enhanced-zsh shim and return the ZDOTDIR to spawn with, or
   * null when it can't be provisioned. Pure capability — whether to use it is
   * the renderer's profile decision. Optional so test fakes keep working. */
  prepareShellIntegration?(): string | null;
}
