/**
 * Input: @codemirror/lsp-client, @app/shared/lspApi, ./LanguageServerRegistry, ./LanguageWorkspace
 * Output: LanguageRoot, LanguageTransport, LanguageSessionOptions, LanguageSession
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { LSPClient, hoverTooltips, type Transport } from "@codemirror/lsp-client";
import type { LspProcessHandle } from "@app/shared/lspApi";
import type { LanguageGroup, LanguageServerSpec } from "./LanguageServerRegistry";
import { LanguageWorkspace, type LanguageWorkspaceHost } from "./LanguageWorkspace";

/** A project root: one mounted repository. One server runs per root. */
export interface LanguageRoot {
  /** The mount's name — the first segment of every vault path under it. */
  name: string;
  /** Absolute path on disk. */
  path: string;
  uri: string;
}

const UNHANDLED = Symbol("unhandled");

/**
 * The seam between the process handle and the client.
 *
 * The client package answers every request a server sends with "method not
 * implemented". Most servers shrug that off, but some wait on
 * `workspace/configuration` or `client/registerCapability` before they answer
 * anything else. Those few are answered here, with the neutral reply a
 * read-only client would give. The `initialize` request is also completed on
 * the way out: the package sends `rootUri` only, and newer servers key their
 * project discovery off `workspaceFolders`.
 */
export class LanguageTransport implements Transport {
  private readonly handlers = new Set<(value: string) => void>();

  constructor(
    private readonly handle: LspProcessHandle,
    private readonly root: LanguageRoot,
  ) {
    handle.onMessage((message) => this.receive(message));
  }

  send(message: string): void {
    this.handle.send(this.completeInitialize(message));
  }

  subscribe(handler: (value: string) => void): void {
    this.handlers.add(handler);
  }

  unsubscribe(handler: (value: string) => void): void {
    this.handlers.delete(handler);
  }

  private completeInitialize(message: string): string {
    if (!message.includes('"method":"initialize"')) return message;
    const request = JSON.parse(message) as { method?: string; params?: Record<string, unknown> };
    if (request.method !== "initialize" || !request.params) return message;
    request.params.workspaceFolders = [{ uri: this.root.uri, name: this.root.name || "root" }];
    return JSON.stringify(request);
  }

  private receive(message: string): void {
    // Only a server→client REQUEST carries both an id and a method; the cheap
    // substring test keeps responses and notifications off the parse path.
    if (message.includes('"method"') && message.includes('"id"')) {
      let value: { id?: unknown; method?: unknown; params?: unknown } | null = null;
      try {
        value = JSON.parse(message) as typeof value;
      } catch {
        value = null;
      }
      if (value && value.id !== undefined && typeof value.method === "string") {
        const result = this.answer(value.method, value.params);
        if (result !== UNHANDLED) {
          try {
            this.handle.send(JSON.stringify({ jsonrpc: "2.0", id: value.id, result }));
          } catch {
            // The server exited between asking and being answered.
          }
          return;
        }
      }
    }
    for (const handler of this.handlers) handler(message);
  }

  private answer(method: string, params: unknown): unknown {
    switch (method) {
      case "workspace/configuration": {
        const items = (params as { items?: unknown[] } | null)?.items ?? [];
        return items.map(() => null);
      }
      case "workspace/workspaceFolders":
        return [{ uri: this.root.uri, name: this.root.name || "root" }];
      case "client/registerCapability":
      case "client/unregisterCapability":
      case "window/workDoneProgress/create":
      case "window/showMessageRequest":
        return null;
      case "workspace/applyEdit":
        // A reading client never lets the server write.
        return { applied: false };
      default:
        return UNHANDLED;
    }
  }
}

export interface LanguageSessionOptions {
  spec: LanguageServerSpec;
  group: LanguageGroup;
  root: LanguageRoot;
  /** The executable the server was started from. */
  binary: string;
  handle: LspProcessHandle;
  host: Omit<LanguageWorkspaceHost, "onOpenCountChange">;
  sanitizeHTML: (html: string) => string;
  /** Close the server this long after its last document closes. */
  idleMs: number;
  /** Called once, when the process ends for a reason other than `dispose`. */
  onExit: (session: LanguageSession) => void;
  /** Called when the idle timer fires; the owner disposes the session. */
  onIdle: (session: LanguageSession) => void;
}

/** How long a server may take to answer; project load makes the first slow. */
const REQUEST_TIMEOUT_MS = 20_000;
const STDERR_TAIL_CHARS = 4000;
const SHUTDOWN_GRACE_MS = 1500;

/** One running language server: the process, its client and its open documents. */
export class LanguageSession {
  readonly spec: LanguageServerSpec;
  readonly group: LanguageGroup;
  readonly root: LanguageRoot;
  readonly binary: string;
  readonly client: LSPClient;
  readonly workspace: LanguageWorkspace;
  /** Resolves true once the server is initialized, false when it never got there. */
  readonly ready: Promise<boolean>;
  readonly startedAt = Date.now();
  state: "starting" | "ready" | "exited" = "starting";
  /** Whether the server ever finished initializing — a startup failure never did. */
  everReady = false;
  exitCode: number | null = null;
  stderrTail = "";

  private readonly handle: LspProcessHandle;
  private disposed = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: LanguageSessionOptions) {
    this.spec = options.spec;
    this.group = options.group;
    this.root = options.root;
    this.binary = options.binary;
    this.handle = options.handle;

    let workspace!: LanguageWorkspace;
    this.client = new LSPClient({
      rootUri: options.root.uri,
      timeout: REQUEST_TIMEOUT_MS,
      sanitizeHTML: options.sanitizeHTML,
      workspace: (client) => {
        workspace = new LanguageWorkspace(client, {
          ...options.host,
          onOpenCountChange: (count) => this.onOpenCountChange(count),
        });
        return workspace;
      },
      // A reader's feature set: hover only. Navigation is driven by the
      // service (it decides which tab a jump lands in); completion,
      // diagnostics, rename and formatting are editing features and stay off.
      extensions: [
        hoverTooltips(),
        {
          // The package only declares what its own features use.
          clientCapabilities: { workspace: { workspaceFolders: true } },
        },
      ],
    });
    this.workspace = workspace;

    const exited = new Promise<false>((resolve) => {
      this.handle.onExit((code) => {
        this.exitCode = code;
        this.state = "exited";
        this.clearIdleTimer();
        this.client.disconnect();
        resolve(false);
        if (!this.disposed) options.onExit(this);
      });
    });
    this.handle.onStderr((text) => {
      this.stderrTail = (this.stderrTail + text).slice(-STDERR_TAIL_CHARS);
    });

    this.client.connect(new LanguageTransport(this.handle, options.root));
    const initialized = this.client.initializing.then(
      () => {
        if (this.state === "starting") {
          this.state = "ready";
          this.everReady = true;
        }
        return this.state === "ready";
      },
      () => false,
    );
    this.ready = Promise.race([initialized, exited]);
    // A server nobody opened a document in (a failed query) must not linger.
    this.onOpenCountChange(0);
  }

  get pid(): number {
    return this.handle.pid;
  }

  get openCount(): number {
    return this.workspace.files.length;
  }

  private onOpenCountChange(count: number): void {
    this.clearIdleTimer();
    if (count > 0 || this.state === "exited" || this.options.idleMs <= 0) return;
    this.idleTimer = setTimeout(() => this.options.onIdle(this), this.options.idleMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /** Stop the server. Silent: `onExit` is for exits nobody asked for. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearIdleTimer();
    if (this.state === "exited") return;
    if (this.state !== "ready") {
      this.handle.kill();
      return;
    }
    // The polite sequence first; the timer covers a server that ignores it
    // (`kill` is a no-op once the process is gone).
    const timer = setTimeout(() => this.handle.kill(), SHUTDOWN_GRACE_MS);
    (timer as { unref?: () => void }).unref?.();
    this.client.request("shutdown", null).then(
      () => this.client.notification("exit", null),
      () => this.handle.kill(),
    );
  }
}
