/**
 * Input: None
 * Output: LspSpawnOptions, LspProcessHandle, ElectronLspApi
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * Native-seam port: the language-server bridge.
 *
 * ONE definition of the contract. The shell fills it in the preload
 * (`lsp-bridge.ts` → the injected `electronLsp` global, backed by
 * `child_process`); the renderer's `LanguageServerService` consumes it. Both
 * sides import from here.
 *
 * The bridge owns the process and the wire framing (`Content-Length`
 * headers); what crosses the seam is one JSON-RPC message per string, which is
 * exactly the transport shape `@codemirror/lsp-client` asks for.
 */

export interface LspSpawnOptions {
  /** Absolute path of the server executable (see `ElectronLspApi.resolve`). */
  command: string;
  args: string[];
  /** The project root the server runs in. */
  cwd: string;
  env?: Record<string, string>;
}

export interface LspProcessHandle {
  pid: number;
  /** Send one JSON-RPC message, no headers. Throws once the process is gone. */
  send(message: string): void;
  /** One JSON-RPC message per call, headers already stripped. */
  onMessage(callback: (message: string) => void): void;
  onStderr(callback: (text: string) => void): void;
  /** `null` when the process could not be started or died from a signal. */
  onExit(callback: (exitCode: number | null) => void): void;
  kill(): void;
}

export interface ElectronLspApi {
  available: boolean;
  /**
   * Resolve a server command to an executable path, searching `PATH` plus the
   * usual install locations (a GUI app inherits a bare `PATH`). `extraDirs`
   * are searched first. `null` when the command is not installed.
   */
  resolve(command: string, extraDirs?: string[]): string | null;
  spawn(options: LspSpawnOptions): LspProcessHandle;
}
