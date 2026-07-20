import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { ElectronGitApi, GitExecResult } from "@app/shared/gitApi";

/**
 * Preload-side git bridge (`window.electronGit`). Runs the real git binary
 * against the vault working tree; the renderer's GitClient only sees this
 * function surface. Same pattern as the terminal bridge: capability lives in
 * the preload, browser mode gets a clean unavailable. The port contract
 * (`ElectronGitApi`) is declared once in `src/shared` and consumed by both
 * this bridge and the renderer's `GitService`.
 */

type ExecFileFn = typeof execFile;

/** GUI apps on macOS get a bare PATH; probe the usual install spots for gh. */
export function resolveGhBinary(exists: (path: string) => boolean = existsSync): string | null {
  for (const candidate of ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"]) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function gravatarUrl(email: string): string {
  const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?s=80&d=identicon`;
}

export function createElectronGitApi(execFileImpl: ExecFileFn = execFile): ElectronGitApi {
  const run = (
    binary: string,
    args: string[],
    cwd: string,
    input?: string,
  ): Promise<GitExecResult> =>
    new Promise((resolve) => {
      const child = execFileImpl(
        binary,
        args,
        { cwd, maxBuffer: 32 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const code =
            error && typeof (error as { code?: unknown }).code === "number"
              ? (error as { code: number }).code
              : error
                ? 1
                : 0;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        },
      );
      if (input !== undefined && child.stdin) {
        child.stdin.write(input);
        child.stdin.end();
      }
    });
  return {
    available: true,
    exec: (args, cwd) => run("git", args, cwd),
    gravatarUrl,
    execGh(args, cwd, input) {
      const gh = resolveGhBinary();
      if (!gh) return Promise.resolve({ code: 127, stdout: "", stderr: "gh: command not found" });
      return run(gh, args, cwd, input);
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
