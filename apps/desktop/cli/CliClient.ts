import { createConnection } from "node:net";

/**
 * The CLI client — real Obsidian's `!requestSingleInstanceLock()` branch.
 *
 * The same binary, relaunched, fails the single-instance lock; that failure IS
 * the "become a client" signal. It connects to the running instance's socket,
 * sends `{argv, tty, cwd}\n`, pipes stdin↔socket (reserved for the future tty
 * REPL) and socket→stdout, then exits 0 when the socket ends (even for an error
 * response) and 1 on a socket error. Replaces `app.quit()` in main's no-lock
 * branch.
 */

export interface CliClientIo {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  exit(code: number): void;
}

export function runCliClient(
  socketPath: string,
  argv: string[],
  cwd: string,
  io: CliClientIo = process,
): void {
  const tty = Boolean(io.stdin.isTTY);
  const socket = createConnection(socketPath);
  socket.setNoDelay(true);
  socket.once("connect", () => {
    socket.write(JSON.stringify({ argv, tty, cwd }) + "\n");
    if (tty && io.stdin.setRawMode) io.stdin.setRawMode(true);
    io.stdin.pipe(socket);
    socket.pipe(io.stdout);
  });
  socket.once("end", () => io.exit(0));
  socket.once("error", () => io.exit(1));
}
