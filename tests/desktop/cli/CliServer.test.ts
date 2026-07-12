import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createConnection } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliServer, type CliExec } from "@desktop/cli/CliServer";
import type { CliRequest } from "@desktop/cli/CliDispatch";

const dir = mkdtempSync(join(tmpdir(), "cli-server-"));
let server: CliServer | null = null;
afterEach(() => {
  server?.stop();
  server = null;
});

// Drive one request over a real unix socket and collect the text response.
function call(socketPath: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let out = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(line));
    socket.on("data", (chunk: string) => (out += chunk));
    socket.on("end", () => resolve(out));
    socket.on("error", reject);
  });
}

describe("CliServer", () => {
  it("parses the {argv,tty,cwd} header and writes the exec result with a trailing newline", async () => {
    const socketPath = join(dir, "a.sock");
    let seen: CliRequest | null = null;
    const exec: CliExec = async (request) => {
      seen = request;
      return "hello";
    };
    server = new CliServer(exec, socketPath);
    server.start();

    const out = await call(
      socketPath,
      JSON.stringify({ argv: ["vault", "files"], tty: false, cwd: "/x" }) + "\n",
    );
    expect(out).toBe("hello\n");
    expect(seen).toEqual({ argv: ["vault", "files"], tty: false, cwd: "/x" });
  });

  it("drops the connection on a rejected exec (no server-side Error: wrap)", async () => {
    const socketPath = join(dir, "b.sock");
    const exec: CliExec = async () => {
      throw new Error("boom");
    };
    const errors: unknown[] = [];
    server = new CliServer(exec, socketPath, false, (error) => errors.push(error));
    server.start();
    // The socket errors or ends empty; either way no `Error: ` text arrives —
    // the only faithful wrap lives in executeCliRequest (real Xe).
    const out = await call(
      socketPath,
      JSON.stringify({ argv: ["x"], tty: false, cwd: "/" }) + "\n",
    ).catch(() => "");
    expect(out).toBe("");
    expect(errors).toHaveLength(1);
  });

  it("clears a stale socket file so a restart can bind", () => {
    const socketPath = join(dir, "c.sock");
    server = new CliServer(async () => "", socketPath);
    server.start();
    server.stop();
    // A second server on the same path must bind without EADDRINUSE.
    const again = new CliServer(async () => "", socketPath);
    expect(() => again.start()).not.toThrow();
    again.stop();
  });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
