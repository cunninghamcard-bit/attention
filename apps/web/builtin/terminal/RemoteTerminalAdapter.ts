/**
 * Input: ./TerminalAdapter
 * Output: RemoteTerminalAdapter
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import {
  TerminalSpawnError,
  type TerminalAdapter,
  type TerminalProcessHandle,
  type TerminalSpawnRequest,
} from "./TerminalAdapter";

/**
 * The PTY over a WebSocket — the third seat at the adapter seam, beside the
 * preload bridge and the unsupported stub.
 *
 * The socket enters HERE and not at restty's transport. restty ships
 * `createWebSocketPtyTransport` meant to be handed to the surface, which would
 * make restty own the connection and route shell bytes around TerminalService
 * entirely: two data paths depending on transport, and the buffer/replay,
 * exit, notification and copy wiring forking with them. At this layer the
 * pipeline above stays exactly one shape — the adapter answers with a
 * PtyHandle and nothing upstream can tell where the shell lives.
 *
 * The protocol is still restty's, and deliberately not reimplemented: its
 * transport carries the connectId guard that discards a stale socket's
 * callbacks, the streaming TextDecoder with the tail flush on close, and the
 * three framings a server may use (ArrayBuffer, Blob, string — where a string
 * is output only after failing to parse as a status/error/exit control
 * message). Hand-rolling those sixty lines would fork a protocol we do not own.
 *
 * restty is a 4.2 MB bundle the renderer already loads on demand, so the
 * import stays dynamic: `spawn()` answers with a live handle immediately and
 * the queue drains once the module and the socket are both up.
 *
 * ponytail: client only, on purpose — this dials a PTY server somebody else
 * runs. Hosting one is deferred, and the Go kernel is where it goes when it
 * lands, not the Electron main process: a "connect and get a shell" endpoint
 * is a real local attack surface (any process on the box, and depending on
 * origin checks any page in a browser), so it needs a bind address and an auth
 * story designed rather than inherited, and the kernel is the component that
 * already owns headless lifetime.
 */

/** The slice of restty's transport this drives — declared locally so the type
 * import does not pull the bundle into the entry chunk. */
interface PtyTransportLike {
  connect(options: {
    url: string;
    cols?: number;
    rows?: number;
    callbacks: {
      onConnect?: () => void;
      onDisconnect?: () => void;
      onData?: (data: string) => void;
      onExit?: (code: number) => void;
      onError?: (message: string, errors?: string[]) => void;
    };
  }): void | Promise<void>;
  disconnect(): void;
  sendInput(data: string): boolean;
  resize(cols: number, rows: number): boolean;
  destroy?(): void | Promise<void>;
}

export type PtyTransportLoader = () => Promise<PtyTransportLike>;

/** restty is a 4.2 MB bundle; keeping the import dynamic keeps it out of the
 * entry chunk. Injectable the way `terminal-bridge.ts` injects `loadNodePty` —
 * the tests lane does not depend on restty, so it cannot resolve the module a
 * `vi.mock` would have to key on. */
const loadResttyTransport: PtyTransportLoader = async () => {
  const { createWebSocketPtyTransport } = (await import("restty")) as unknown as {
    createWebSocketPtyTransport(): PtyTransportLike;
  };
  return createWebSocketPtyTransport();
};

class RemotePtyHandle implements TerminalProcessHandle {
  /** No local process to number. Nothing in the terminal slice reads it. */
  readonly pid = 0;
  private transport: PtyTransportLike | null = null;
  private dataCallback: ((data: string) => void) | null = null;
  private exitCallback: ((code: number) => void) | null = null;
  private pendingInput: string[] = [];
  private pendingSize: { cols: number; rows: number } | null = null;
  private connected = false;
  private exited = false;
  private killed = false;

  constructor(url: string, request: TerminalSpawnRequest, load: PtyTransportLoader) {
    void this.start(url, request, load);
  }

  private async start(
    url: string,
    request: TerminalSpawnRequest,
    load: PtyTransportLoader,
  ): Promise<void> {
    let transport: PtyTransportLike;
    try {
      transport = await load();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      return;
    }
    // kill() can land while the import is in flight; do not open a socket
    // nobody is listening to.
    if (this.killed) return;
    this.transport = transport;
    try {
      await transport.connect({
        url,
        cols: request.cols,
        rows: request.rows,
        callbacks: {
          onConnect: () => this.flush(),
          onData: (data) => this.dataCallback?.(data),
          // Whichever arrives first wins: a server that reports the exit code
          // and then drops the socket must not fire the callback twice.
          onExit: (code) => this.finish(code),
          onDisconnect: () => this.finish(0),
          onError: (message) => this.fail(message),
        },
      });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private flush(): void {
    this.connected = true;
    if (this.pendingSize) {
      this.transport?.resize(this.pendingSize.cols, this.pendingSize.rows);
      this.pendingSize = null;
    }
    for (const data of this.pendingInput) this.transport?.sendInput(data);
    this.pendingInput = [];
  }

  /** A failure the shell never saw: surface it as output, then exit non-zero,
   * so the pane says what happened instead of going quiet. */
  private fail(message: string): void {
    if (this.exited) return;
    this.dataCallback?.(`\r\n\x1b[31mTerminal connection failed: ${message}\x1b[0m\r\n`);
    this.finish(1);
  }

  private finish(code: number): void {
    if (this.exited) return;
    this.exited = true;
    this.exitCallback?.(code);
  }

  write(data: string): void {
    if (this.exited) return;
    if (this.connected) this.transport?.sendInput(data);
    else this.pendingInput.push(data);
  }

  resize(cols: number, rows: number): void {
    if (this.exited) return;
    if (this.connected) this.transport?.resize(cols, rows);
    else this.pendingSize = { cols, rows };
  }

  kill(): void {
    this.killed = true;
    this.pendingInput = [];
    this.pendingSize = null;
    this.transport?.disconnect();
    void this.transport?.destroy?.();
    this.finish(0);
  }

  onData(callback: (data: string) => void): void {
    this.dataCallback = callback;
  }

  onExit(callback: (exitCode: number) => void): void {
    this.exitCallback = callback;
    if (this.exited) callback(0);
  }
}

export class RemoteTerminalAdapter implements TerminalAdapter {
  readonly available = true;

  constructor(
    private readonly url: string,
    private readonly load: PtyTransportLoader = loadResttyTransport,
  ) {}

  /** The server picks the shell — the protocol's only word on it is the
   * `status` message's advisory name, which arrives after the spawn. */
  defaultShell(): string {
    return "";
  }

  defaultCwd(): string {
    return "";
  }

  spawn(request: TerminalSpawnRequest): TerminalProcessHandle {
    const url = this.url.trim();
    if (!url) throw new TerminalSpawnError("spawn-failed", "No terminal server URL is configured.");
    return new RemotePtyHandle(url, request, this.load);
  }
}
