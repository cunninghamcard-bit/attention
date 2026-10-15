/**
 * Input: node:child_process, node:fs, node:os, node:path, @app/shared/lspApi
 * Output: encodeLspFrame, LspFrameDecoder, lspSearchDirs, resolveLspBinary, createElectronLspApi, installLspBridge
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, resolve as resolvePath } from "node:path";
import type { ElectronLspApi, LspProcessHandle, LspSpawnOptions } from "@app/shared/lspApi";

/**
 * Preload-side language-server bridge (`window.electronLsp`).
 *
 * Same pattern as the terminal and git bridges: the capability (a child
 * process speaking LSP over stdio) lives in the preload and never leaves this
 * file; the renderer's `LanguageServerService` only sees the function-based
 * handle. The wire framing is done here so one string across the seam is
 * always one complete JSON-RPC message.
 */

type SpawnFn = typeof spawn;

/** Wrap one JSON-RPC message in the LSP base-protocol header. */
export function encodeLspFrame(message: string): Buffer {
  const body = Buffer.from(message, "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/**
 * Incremental decoder for the LSP base protocol. stdout arrives in arbitrary
 * chunks — a message split across chunks, or several messages in one — so the
 * decoder buffers until a whole `Content-Length` body is in.
 */
export class LspFrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): string[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const messages: string[] = [];
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Not a frame we understand (a server printing to stdout before the
        // protocol starts). Drop the bogus header and keep scanning.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) break;
      messages.push(this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8"));
      this.buffer = this.buffer.subarray(bodyStart + length);
    }
    return messages;
  }
}

/**
 * Where to look for a server binary. An app launched from Finder inherits a
 * bare `PATH` (the reason `resolveGhBinary` probes fixed spots too), so the
 * common per-user and package-manager install directories are appended.
 */
export function lspSearchDirs(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  const fromPath = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const usual =
    platform === "win32"
      ? [
          resolvePath(home, ".cargo", "bin"),
          resolvePath(home, "go", "bin"),
          resolvePath(home, ".local", "bin"),
        ]
      : [
          resolvePath(home, ".local", "bin"),
          resolvePath(home, ".cargo", "bin"),
          resolvePath(home, "go", "bin"),
          resolvePath(home, ".bun", "bin"),
          resolvePath(home, ".local", "share", "mise", "shims"),
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
        ];
  return [...new Set([...fromPath, ...usual])];
}

function defaultIsExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** First directory holding an executable named `command`; `null` when none does. */
export function resolveLspBinary(
  command: string,
  dirs: string[],
  isExecutable: (path: string) => boolean = defaultIsExecutable,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (!command) return null;
  if (isAbsolute(command)) return isExecutable(command) ? command : null;
  const suffixes = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      // Absolute, always: a relative PATH entry (`node_modules/.bin`) would
      // otherwise resolve against the SERVER's cwd — the project root — at spawn.
      const candidate = resolvePath(dir, command + suffix);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

export function createElectronLspApi(
  spawnImpl: SpawnFn = spawn,
  env: NodeJS.ProcessEnv = process.env,
): ElectronLspApi {
  return {
    available: true,
    resolve: (command, extraDirs = []) =>
      resolveLspBinary(command, [...extraDirs, ...lspSearchDirs(env)]),
    spawn(options: LspSpawnOptions): LspProcessHandle {
      const child = spawnImpl(options.command, options.args, {
        cwd: options.cwd,
        // The widened PATH goes to the child too: a server that is a script
        // (`#!/usr/bin/env node`) must find its interpreter the same way we
        // found the server.
        env: { ...env, PATH: lspSearchDirs(env).join(delimiter), ...options.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const decoder = new LspFrameDecoder();
      const messageCallbacks: Array<(message: string) => void> = [];
      const stderrCallbacks: Array<(text: string) => void> = [];
      const exitCallbacks: Array<(exitCode: number | null) => void> = [];
      let exited = false;
      const finish = (code: number | null): void => {
        if (exited) return;
        exited = true;
        for (const callback of exitCallbacks) callback(code);
      };
      child.stdout?.on("data", (chunk: Buffer) => {
        for (const message of decoder.push(chunk)) {
          for (const callback of messageCallbacks) callback(message);
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        for (const callback of stderrCallbacks) callback(text);
      });
      // A write after the server died surfaces as an async EPIPE on stdin;
      // without a listener that is an uncaught exception in the preload.
      child.stdin?.on("error", () => {});
      child.on("error", (error) => {
        for (const callback of stderrCallbacks) callback(`${error.message}\n`);
        finish(null);
      });
      child.on("exit", (code) => finish(code));
      return {
        pid: child.pid ?? -1,
        send(message) {
          if (exited || !child.stdin || child.stdin.destroyed) {
            throw new Error("Language server is not running.");
          }
          child.stdin.write(encodeLspFrame(message));
        },
        onMessage: (callback) => void messageCallbacks.push(callback),
        onStderr: (callback) => void stderrCallbacks.push(callback),
        onExit: (callback) => void exitCallbacks.push(callback),
        kill() {
          if (exited) return;
          child.kill();
          // ponytail: a server that ignores SIGTERM gets the hard stop.
          const timer = setTimeout(() => {
            if (!exited) child.kill("SIGKILL");
          }, 2000);
          timer.unref?.();
        },
      };
    },
  };
}

export function installLspBridge(target: typeof globalThis): void {
  Object.defineProperty(target, "electronLsp", {
    value: createElectronLspApi(),
    configurable: true,
    enumerable: true,
    writable: false,
  });
}
