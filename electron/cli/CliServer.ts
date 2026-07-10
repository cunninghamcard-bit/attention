import { createServer, type Server, type Socket } from "node:net";
import { unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CliRequest } from "./CliDispatch";

// Real Obsidian: `~/.obsidian-cli.sock` on posix, a `\\.\pipe\…` named pipe on
// Windows. Ours is `arkloop`.
export function defaultCliSocketPath(): string {
  if (process.platform === "win32") return "\\\\.\\pipe\\arkloop-cli";
  return join(homedir(), ".arkloop-cli.sock");
}

/**
 * The `arkloop` CLI's app-side server — real Obsidian's `Ve = createServer(…)`.
 *
 * The `arkloop` binary is the client: it connects to the socket, writes ONE
 * line `{"argv":[…],"tty":bool,"cwd":"…"}\n`, then reads the response as plain
 * text until the socket closes (verified live against obsidian 1.12.7 — no
 * handshake, no auth, no framing). Owning the socket path is the whole
 * integration.
 *
 * This owns transport only; each request goes to `exec` (see dispatchCli).
 * Faithful details: `setNoDelay(true)`, read to the first `\n`, parse the
 * header, `unshift` the remaining bytes (reserved for tty stdin), and — unless
 * on Windows named pipes — `unlink` a stale socket before listen.
 */

export type CliExec = (request: CliRequest) => Promise<string>;

export class CliServer {
  private server: Server | null = null;

  constructor(
    private readonly exec: CliExec,
    private readonly socketPath: string,
    private readonly isWindows: boolean = process.platform === "win32",
    private readonly onError: (error: unknown) => void = (error) => console.error("CLI server error:", error),
  ) {}

  start(): void {
    if (this.server) return;
    // The single-instance lock guarantees no live peer owns the socket, so a
    // leftover file from a crashed run is safe to clear (named pipes need no
    // unlink).
    if (!this.isWindows) this.clearStaleSocket();
    const server = createServer((socket) => this.handle(socket));
    server.on("error", (error) => this.onError(error));
    server.listen(this.socketPath);
    this.server = server;
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (!this.isWindows) this.clearStaleSocket();
  }

  private clearStaleSocket(): void {
    try {
      unlinkSync(this.socketPath);
    } catch {
      // Absent is normal; any real error surfaces at listen().
    }
  }

  private handle(socket: Socket): void {
    socket.setNoDelay(true);
    let buffer = "";
    let dispatched = false;
    const timeout = setTimeout(() => {
      if (!dispatched) socket.destroy();
    }, 5000);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      if (dispatched) return;
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      dispatched = true;
      clearTimeout(timeout);
      const header = buffer.slice(0, newline);
      const rest = buffer.slice(newline + 1);
      // Reserved for tty stdin: put back whatever followed the header line.
      if (rest.length > 0) socket.unshift(Buffer.from(rest));
      this.dispatch(socket, header);
    });
    socket.on("error", () => socket.destroy());
  }

  private dispatch(socket: Socket, header: string): void {
    let request: CliRequest;
    try {
      const parsed = JSON.parse(header) as Partial<CliRequest>;
      request = {
        argv: Array.isArray(parsed.argv) ? parsed.argv.map(String) : [],
        tty: Boolean(parsed.tty),
        cwd: typeof parsed.cwd === "string" ? parsed.cwd : process.cwd(),
      };
    } catch (error) {
      this.onError(error);
      socket.destroy();
      return;
    }
    this.exec(request)
      .then((output) => this.write(socket, output))
      .catch((error: unknown) => {
        this.onError(error);
        this.write(socket, `Error: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  // Real `p(u)`: write the result, ensuring a trailing newline, then close.
  private write(socket: Socket, output: string): void {
    socket.end(output.endsWith("\n") ? output : `${output}\n`);
  }
}
