import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { join } from "node:path";
import { createInterface } from "node:readline";

/**
 * Desktop sidecar for the loom kernel.
 *
 * Dev/preview flow runs the kernel manually on 8790 (`chat-bridge-url`
 * override in localStorage) — untouched by this module. The sidecar is
 * opt-in: it only spawns when `LOOM_SIDECAR_BIN` is set, so the manual flow
 * never breaks. `LOOM_EXTERNAL_URL` (if set) is used verbatim and skips
 * spawning too, for pointing the desktop app at a kernel someone else started.
 *
 * The child prints one JSON ready line to stdout:
 *   {"event":"ready","port":<n>,"url":"http://127.0.0.1:<n>"}
 * every other stdout/stderr line is passed through to the console.
 */

export interface LoomSidecarConfig {
  bin: string | null;
  externalUrl: string | null;
  dbPath: string;
}

export function resolveLoomSidecarConfig(
  userDataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): LoomSidecarConfig {
  return {
    bin: env.LOOM_SIDECAR_BIN || null,
    externalUrl: env.LOOM_EXTERNAL_URL || null,
    dbPath: join(userDataDir, "loom", "loom.db"),
  };
}

interface ReadyLine {
  event: "ready";
  port: number;
  url: string;
}

function parseReadyLine(line: string): ReadyLine | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as { event?: unknown }).event === "ready" &&
    typeof (parsed as { url?: unknown }).url === "string"
  ) {
    return parsed as ReadyLine;
  }
  return null;
}

const RESPAWN_BACKOFF_MS = 5_000;
const KILL_GRACE_MS = 5_000;

export class LoomSidecar {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private stopping = false;
  private respawned = false;

  constructor(
    private readonly config: LoomSidecarConfig,
    /** Called with the resolved kernel URL (or null once it stops being reachable). */
    private readonly onUrlChange: (url: string | null) => void,
  ) {}

  start(): void {
    if (this.config.externalUrl) {
      this.onUrlChange(this.config.externalUrl);
      return;
    }
    if (!this.config.bin) return; // not configured: skip spawning entirely
    this.spawn();
  }

  private spawn(): void {
    const child = spawn(
      this.config.bin as string,
      ["serve", "-port", "0", "-db", this.config.dbPath],
      {
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.child = child;

    createInterface({ input: child.stdout }).on("line", (line) => {
      const ready = parseReadyLine(line);
      if (ready) this.onUrlChange(ready.url);
      else console.log(`[loom] ${line}`);
    });
    createInterface({ input: child.stderr }).on("line", (line) => {
      console.error(`[loom] ${line}`);
    });

    child.on("exit", (code, signal) => {
      this.child = null;
      this.onUrlChange(null);
      if (this.stopping) return;
      console.error(`[loom] sidecar exited unexpectedly (code=${code}, signal=${signal})`);
      if (this.respawned) return; // already retried once; give up quietly
      this.respawned = true;
      setTimeout(() => {
        if (!this.stopping) this.spawn();
      }, RESPAWN_BACKOFF_MS);
    });
  }

  stop(): void {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, KILL_GRACE_MS);
    child.once("exit", () => clearTimeout(timer));
  }
}
