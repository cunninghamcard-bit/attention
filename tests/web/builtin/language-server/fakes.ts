/**
 * Input: @app/shared/lspApi, @web/app/App, @web/builtin/language-server/LanguageUri, @web/vault/TAbstractFile
 * Output: FakeMessage, FakeProcess, FakeBridge, installFakeBridge, mountOnDisk, addFile, tick, until, location
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { ElectronLspApi, LspProcessHandle, LspSpawnOptions } from "@app/shared/lspApi";
import type { App } from "@web/app/App";
import { pathToUri } from "@web/builtin/language-server/LanguageUri";
import { TFile } from "@web/vault/TAbstractFile";

export interface FakeMessage {
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
}

type Responder = (params: any, process: FakeProcess) => unknown;

/**
 * An in-process language server: it sees exactly the JSON-RPC messages the
 * real bridge would deliver, and answers like a server would — asynchronously,
 * a tick after the request, never inside `send`.
 */
export class FakeProcess implements LspProcessHandle {
  static nextPid = 100;
  readonly pid = FakeProcess.nextPid++;
  readonly received: FakeMessage[] = [];
  killed = false;
  exited = false;
  /** Method → result. Unlisted methods answer null. */
  responders: Record<string, Responder> = {};
  /** Exit instead of answering `initialize` — a server that cannot start. */
  dieOnStart = false;

  private readonly messageCallbacks: Array<(message: string) => void> = [];
  private readonly stderrCallbacks: Array<(text: string) => void> = [];
  private readonly exitCallbacks: Array<(code: number | null) => void> = [];

  constructor(readonly options: LspSpawnOptions) {}

  send(message: string): void {
    if (this.exited) throw new Error("Language server is not running.");
    const parsed = JSON.parse(message) as FakeMessage;
    this.received.push(parsed);
    queueMicrotask(() => this.handle(parsed));
  }
  onMessage(callback: (message: string) => void): void {
    this.messageCallbacks.push(callback);
  }
  onStderr(callback: (text: string) => void): void {
    this.stderrCallbacks.push(callback);
  }
  onExit(callback: (code: number | null) => void): void {
    this.exitCallbacks.push(callback);
  }
  kill(): void {
    this.killed = true;
    queueMicrotask(() => this.exit(null));
  }

  /** Deliver a message from the server to the client. */
  emit(message: FakeMessage): void {
    if (this.exited) return;
    const text = JSON.stringify({ jsonrpc: "2.0", ...message });
    for (const callback of this.messageCallbacks) callback(text);
  }
  stderr(text: string): void {
    for (const callback of this.stderrCallbacks) callback(text);
  }
  exit(code: number | null): void {
    if (this.exited) return;
    this.exited = true;
    for (const callback of this.exitCallbacks) callback(code);
  }

  /** Requests and notifications the client sent for one method. */
  sent(method: string): FakeMessage[] {
    return this.received.filter((message) => message.method === method);
  }

  private handle(message: FakeMessage): void {
    if (this.exited || !message.method) return;
    if (message.method === "initialize" && this.dieOnStart) {
      this.stderr("error: unknown option '--lsp'\n");
      this.exit(1);
      return;
    }
    if (message.method === "exit") {
      this.exit(0);
      return;
    }
    if (message.id === undefined) return; // a notification
    const responder = this.responders[message.method];
    const result =
      message.method === "initialize"
        ? {
            capabilities: {
              textDocumentSync: 2,
              definitionProvider: true,
              referencesProvider: true,
              hoverProvider: true,
              documentSymbolProvider: true,
              workspaceSymbolProvider: true,
            },
          }
        : responder
          ? responder(message.params, this)
          : null;
    this.emit({ id: message.id, result });
  }
}

export class FakeBridge implements ElectronLspApi {
  available = true;
  /** Command name → the path it "resolves" to. Anything else is not installed. */
  installed: Record<string, string> = {};
  readonly processes: FakeProcess[] = [];
  /** Runs on every spawn, before the client connects — configure the server here. */
  onSpawn: (process: FakeProcess) => void = () => {};

  resolve(command: string): string | null {
    if (command.startsWith("/"))
      return Object.values(this.installed).includes(command) ? command : null;
    return this.installed[command] ?? null;
  }
  spawn(options: LspSpawnOptions): LspProcessHandle {
    const process = new FakeProcess(options);
    this.processes.push(process);
    this.onSpawn(process);
    return process;
  }
  /** Processes that have not exited. */
  get running(): FakeProcess[] {
    return this.processes.filter((process) => !process.exited);
  }
}

/** Put a fake bridge on `globalThis.electronLsp`; returns it and the undo. */
export function installFakeBridge(): { bridge: FakeBridge; restore: () => void } {
  const host = globalThis as { electronLsp?: ElectronLspApi };
  const previous = host.electronLsp;
  const bridge = new FakeBridge();
  host.electronLsp = bridge;
  return {
    bridge,
    restore: () => {
      if (previous) host.electronLsp = previous;
      else delete host.electronLsp;
    },
  };
}

/**
 * Give the in-memory test vault disk identities: `mounts` maps a top-level
 * folder name to the disk path it stands for ("" = the vault root itself).
 */
export function mountOnDisk(app: App, mounts: Record<string, string>): void {
  app.languageServers.roots = () =>
    Object.entries(mounts).map(([name, path]) => ({ name, path, uri: pathToUri(path) }));
}

export async function addFile(app: App, path: string, content: string): Promise<TFile> {
  const parts = path.split("/");
  for (let depth = 1; depth < parts.length; depth += 1) {
    const folder = parts.slice(0, depth).join("/");
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
  }
  const file = await app.vault.create(path, content);
  if (!(file instanceof TFile)) throw new Error(`could not create ${path}`);
  return file;
}

/** Let queued microtasks and zero-delay timers (server replies, view loads) run. */
export async function tick(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/** Wait for a condition that depends on asynchronous server traffic. */
export async function until(condition: () => boolean, label = "condition"): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

export function location(path: string, line: number, start: number, end: number) {
  return {
    uri: pathToUri(path),
    range: { start: { line, character: start }, end: { line, character: end } },
  };
}
