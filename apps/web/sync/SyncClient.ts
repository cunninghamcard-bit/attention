/**
 * Input: loro-websocket (dynamic), loro-adaptors (dynamic), ./VaultDocs
 * Output: SyncClient, SyncClientOptions
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { LoroDoc } from "loro-crdt";
import { TREE_DOC_ID, type VaultDocs } from "./VaultDocs";

/**
 * Room orchestration over the OFFICIAL loro-websocket client — this module
 * writes no protocol code at all. One room per doc, `<vaultId>/<docId>` on
 * the wire; the JWT rides the join payload (browsers cannot put headers on
 * a WebSocket). The official LoroAdaptor wraps each of our live docs, so
 * versions, backfill and update push are all upstream behavior.
 *
 * ponytail: v0 instantiates and joins EVERY file doc, so connected sessions
 * pay memory for the whole vault; the cold-doc thrift only holds offline.
 * A WAL-only room adaptor (no live doc) lifts that when large vaults land.
 *
 * ponytail: remote updates imported by the adaptor reach IndexedDB only at
 * the next compaction; between crash and rejoin the server's copy is the
 * durable one. WAL-append-on-import when local-first durability matters.
 */

export interface SyncClientOptions {
  /** ws(s)://host/sync */
  url: string;
  vaultId: string;
  /** Token bytes for the join payload; called per join and on rejoin. */
  auth: () => Uint8Array | Promise<Uint8Array>;
}

interface WsClient {
  waitConnected(): Promise<void>;
  join(options: { roomId: string; crdtAdaptor: unknown; auth?: unknown }): Promise<unknown>;
  close(): void;
}

export class SyncClient {
  private joined = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;
  private unsubscribe: (() => void) | null = null;

  private constructor(
    private readonly docs: VaultDocs,
    private readonly options: SyncClientOptions,
    private readonly client: WsClient,
    private readonly makeAdaptor: (doc: LoroDoc) => unknown,
  ) {}

  static async connect(docs: VaultDocs, options: SyncClientOptions): Promise<SyncClient> {
    const [ws, adaptors] = await Promise.all([
      import("loro-websocket"),
      import("loro-adaptors/loro"),
    ]);
    const client = new ws.LoroWebsocketClient({ url: options.url }) as unknown as WsClient;
    await client.waitConnected();
    const sync = new SyncClient(docs, options, client, (doc) => new adaptors.LoroAdaptor(doc));
    sync.unsubscribe = docs.onDocSetChanged(() => sync.scheduleReconcile());
    await sync.reconcile();
    return sync;
  }

  /** Serialized so overlapping doc-set changes cannot double-join. */
  private scheduleReconcile(): void {
    this.queue = this.queue.then(() => this.reconcile()).catch(() => undefined);
  }

  private async reconcile(): Promise<void> {
    if (this.stopped) return;
    await this.joinDoc(TREE_DOC_ID, this.docs.treeDocRef());
    for (const id of this.docs.docIds()) {
      if (this.stopped) return;
      if (id === TREE_DOC_ID || this.joined.has(id)) continue;
      await this.joinDoc(id, await this.docs.openTextDoc(id));
    }
  }

  private async joinDoc(docId: string, doc: LoroDoc): Promise<void> {
    if (this.joined.has(docId)) return;
    this.joined.add(docId);
    try {
      await this.client.join({
        roomId: `${this.options.vaultId}/${docId}`,
        crdtAdaptor: this.makeAdaptor(doc),
        auth: this.options.auth,
      });
    } catch (error) {
      // A failed join (auth, network) retries on the next doc-set change.
      this.joined.delete(docId);
      throw error;
    }
  }

  close(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.client.close();
  }
}
