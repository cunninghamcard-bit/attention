import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

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
  /** GitHub CLI; rejects into a code-127 result when gh is not installed. */
  execGh(args: string[], cwd: string): Promise<GitExecResult>;
}

type ExecFileFn = typeof execFile;

/** GUI apps on macOS get a bare PATH; probe the usual install spots for gh. */
export function resolveGhBinary(exists: (path: string) => boolean = existsSync): string | null {
  for (const candidate of ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"]) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function createElectronGitApi(execFileImpl: ExecFileFn = execFile): ElectronGitApi {
  const run = (binary: string, args: string[], cwd: string): Promise<GitExecResult> =>
    new Promise((resolve) => {
      execFileImpl(binary, args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: unknown }).code === "number"
          ? (error as { code: number }).code
          : error ? 1 : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      });
    });
  return {
    available: true,
    exec: (args, cwd) => run("git", args, cwd),
    execGh(args, cwd) {
      const gh = resolveGhBinary();
      if (!gh) return Promise.resolve({ code: 127, stdout: "", stderr: "gh: command not found" });
      return run(gh, args, cwd);
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
