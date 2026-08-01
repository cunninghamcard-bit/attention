/**
 * Input: None
 * Output: SyncStore, DocRecord, MemorySyncStore, createSyncStore
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * Local persistence for a synced vault: per-doc snapshot + WAL of loro
 * update bytes, content-addressed blobs, and a small meta shelf — the same
 * snapshot+log shape the server keeps in Postgres, so the whole system has
 * one storage mental model. Payloads are opaque here exactly as they are
 * there; only VaultDocs (holding loro) understands them.
 *
 * Two implementations, following the MetadataCacheStore precedent: the
 * Memory store carries vitest (the repo adds no fake-indexeddb), IndexedDB
 * carries the app and is exercised by e2e.
 *
 * Writes are fire-and-forget: appendUpdate returns a synchronous ticket so
 * saveSnapshot(upTo) can never race away updates appended after the export
 * it persists.
 */

export interface DocRecord {
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
}

export interface SyncStore {
  loadDoc(docId: string): Promise<DocRecord>;
  listDocIds(): Promise<string[]>;
  /** Append one update to the doc's WAL; returns the doc's ticket for it. */
  appendUpdate(docId: string, bytes: Uint8Array): number;
  /** Persist a consolidated snapshot and drop WAL entries through `upTo`. */
  saveSnapshot(docId: string, snapshot: Uint8Array, upTo: number): void;
  putBlob(hash: string, bytes: Uint8Array): void;
  getBlob(hash: string): Promise<Uint8Array | null>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string | null): void;
}

/** Tickets are per-doc and monotonically increasing within a session. */
class TicketCounter {
  private counters = new Map<string, number>();

  next(docId: string): number {
    const value = (this.counters.get(docId) ?? 0) + 1;
    this.counters.set(docId, value);
    return value;
  }

  advanceTo(docId: string, floor: number): void {
    if ((this.counters.get(docId) ?? 0) < floor) this.counters.set(docId, floor);
  }
}

export class MemorySyncStore implements SyncStore {
  private docs = new Map<string, { snapshot: Uint8Array | null; wal: Map<number, Uint8Array> }>();
  private blobs = new Map<string, Uint8Array>();
  private meta = new Map<string, string>();
  private tickets = new TicketCounter();

  private doc(docId: string) {
    let record = this.docs.get(docId);
    if (!record) {
      record = { snapshot: null, wal: new Map() };
      this.docs.set(docId, record);
    }
    return record;
  }

  async loadDoc(docId: string): Promise<DocRecord> {
    const record = this.docs.get(docId);
    if (!record) return { snapshot: null, updates: [] };
    const updates = [...record.wal.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, bytes]) => bytes.slice());
    return { snapshot: record.snapshot ? record.snapshot.slice() : null, updates };
  }

  async listDocIds(): Promise<string[]> {
    return [...this.docs.keys()];
  }

  appendUpdate(docId: string, bytes: Uint8Array): number {
    const ticket = this.tickets.next(docId);
    this.doc(docId).wal.set(ticket, bytes.slice());
    return ticket;
  }

  saveSnapshot(docId: string, snapshot: Uint8Array, upTo: number): void {
    const record = this.doc(docId);
    record.snapshot = snapshot.slice();
    for (const ticket of record.wal.keys()) {
      if (ticket <= upTo) record.wal.delete(ticket);
    }
  }

  putBlob(hash: string, bytes: Uint8Array): void {
    if (!this.blobs.has(hash)) this.blobs.set(hash, bytes.slice());
  }

  async getBlob(hash: string): Promise<Uint8Array | null> {
    return this.blobs.get(hash)?.slice() ?? null;
  }

  async getMeta(key: string): Promise<string | null> {
    return this.meta.get(key) ?? null;
  }

  setMeta(key: string, value: string | null): void {
    if (value === null) this.meta.delete(key);
    else this.meta.set(key, value);
  }
}

/** IndexedDB-backed store, one database per vault: `{vaultId}-sync`. */
export function createSyncStore(vaultId: string): SyncStore {
  if (!globalThis.indexedDB) return new MemorySyncStore();
  return new IndexedDbSyncStore(`${vaultId}-sync`);
}

const DB_VERSION = 1;

class IndexedDbSyncStore implements SyncStore {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private tickets = new TicketCounter();

  constructor(private readonly dbName: string) {}

  private open(): Promise<IDBDatabase | null> {
    this.dbPromise ??= new Promise((resolve) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("docs");
        db.createObjectStore("updates");
        db.createObjectStore("blobs");
        db.createObjectStore("meta");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return this.dbPromise;
  }

  private async withStore<T>(
    name: "docs" | "updates" | "blobs" | "meta",
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T> | void,
  ): Promise<T | null> {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(name, mode);
      const request = run(tx.objectStore(name)) ?? null;
      tx.oncomplete = () => resolve(request ? (request.result as T) : null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  }

  /** WAL keys are `[docId, ticket]`, ordered by IndexedDB's array compare. */
  async loadDoc(docId: string): Promise<DocRecord> {
    const snapshot = await this.withStore<Uint8Array>("docs", "readonly", (s) => s.get(docId));
    const range = IDBKeyRange.bound([docId, 0], [docId, Number.MAX_SAFE_INTEGER]);
    const updates =
      (await this.withStore<Uint8Array[]>("updates", "readonly", (s) => s.getAll(range))) ?? [];
    // Boot must resume tickets past what is already on disk, or a rebooted
    // session's first append could collide with a stored key.
    const keys =
      (await this.withStore<IDBValidKey[]>("updates", "readonly", (s) => s.getAllKeys(range))) ??
      [];
    for (const key of keys) {
      if (Array.isArray(key)) this.tickets.advanceTo(docId, Number(key[1]));
    }
    return { snapshot: snapshot ?? null, updates };
  }

  async listDocIds(): Promise<string[]> {
    const keys =
      (await this.withStore<IDBValidKey[]>("docs", "readonly", (s) => s.getAllKeys())) ?? [];
    const fromUpdates =
      (await this.withStore<IDBValidKey[]>("updates", "readonly", (s) => s.getAllKeys())) ?? [];
    const ids = new Set<string>();
    for (const key of keys) ids.add(String(key));
    for (const key of fromUpdates) if (Array.isArray(key)) ids.add(String(key[0]));
    return [...ids];
  }

  appendUpdate(docId: string, bytes: Uint8Array): number {
    const ticket = this.tickets.next(docId);
    void this.withStore("updates", "readwrite", (s) => s.put(bytes.slice(), [docId, ticket]));
    return ticket;
  }

  saveSnapshot(docId: string, snapshot: Uint8Array, upTo: number): void {
    void this.withStore("docs", "readwrite", (s) => s.put(snapshot.slice(), docId));
    void this.withStore("updates", "readwrite", (s) =>
      s.delete(IDBKeyRange.bound([docId, 0], [docId, upTo])),
    );
  }

  putBlob(hash: string, bytes: Uint8Array): void {
    void this.withStore("blobs", "readwrite", (s) => s.put(bytes.slice(), hash));
  }

  async getBlob(hash: string): Promise<Uint8Array | null> {
    return this.withStore<Uint8Array>("blobs", "readonly", (s) => s.get(hash));
  }

  async getMeta(key: string): Promise<string | null> {
    return this.withStore<string>("meta", "readonly", (s) => s.get(key));
  }

  setMeta(key: string, value: string | null): void {
    void this.withStore("meta", "readwrite", (s) =>
      value === null ? s.delete(key) : s.put(value, key),
    );
  }
}
