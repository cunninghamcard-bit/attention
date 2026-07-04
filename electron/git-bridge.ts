import { execFile } from "node:child_process";

/**
 * Preload-side git bridge (`window.electronGit`). Runs the real git binary
 * against the vault working tree; the renderer's GitClient only sees this
 * function surface. Same pattern as the terminal bridge: capability lives in
 * the preload, browser mode gets a clean unavailable.
 */

export interface GitExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ElectronGitApi {
  available: boolean;
  exec(args: string[], cwd: string): Promise<GitExecResult>;
}

type ExecFileFn = typeof execFile;

export function createElectronGitApi(execFileImpl: ExecFileFn = execFile): ElectronGitApi {
  return {
    available: true,
    exec(args: string[], cwd: string): Promise<GitExecResult> {
      return new Promise((resolve) => {
        execFileImpl("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
          const code = error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : error ? 1 : 0;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        });
      });
    },
  };
}

export function installGitBridge(target: typeof globalThis): void {
  Object.defineProperty(target, "electronGit", {
    value: createElectronGitApi(),
    configurable: true,
    enumerable: true,
    writable: false,
  });
}
