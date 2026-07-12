export type MetadataCacheStoreName = "file" | "metadata";

export interface MetadataCachePersistentStore {
  loadFileEntries(): Promise<Array<[string, unknown]>>;
  loadMetadataEntries(batchSize?: number): Promise<Array<[string, unknown]>>;
  save(store: MetadataCacheStoreName, key: string, value: unknown | null): void;
}

const STORE_NAMES: MetadataCacheStoreName[] = ["file", "metadata"];
const DB_VERSION = 19;

export function createMetadataCacheStore(appId: string): MetadataCachePersistentStore | null {
  if (!globalThis.indexedDB) return null;
  return new IndexedDbMetadataCacheStore(`${appId}-cache`);
}

export class MemoryMetadataCacheStore implements MetadataCachePersistentStore {
  private readonly files = new Map<string, unknown>();
  private readonly metadata = new Map<string, unknown>();

  async loadFileEntries(): Promise<Array<[string, unknown]>> {
    return cloneEntries(this.files);
  }

  async loadMetadataEntries(_batchSize = 300): Promise<Array<[string, unknown]>> {
    return cloneEntries(this.metadata);
  }

  save(store: MetadataCacheStoreName, key: string, value: unknown | null): void {
    const target = store === "file" ? this.files : this.metadata;
    if (value) target.set(key, structuredClone(value));
    else target.delete(key);
  }

  getFile(key: string): unknown | null {
    return this.files.has(key) ? structuredClone(this.files.get(key)) : null;
  }

  getMetadata(key: string): unknown | null {
    return this.metadata.has(key) ? structuredClone(this.metadata.get(key)) : null;
  }
}

class IndexedDbMetadataCacheStore implements MetadataCachePersistentStore {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private writeTransaction: IDBTransaction | null = null;

  constructor(private readonly dbName: string) {}

  async loadFileEntries(): Promise<Array<[string, unknown]>> {
    const db = await this.open();
    if (!db) return [];
    const transaction = db.transaction(STORE_NAMES, "readonly");
    const store = transaction.objectStore("file");
    const keys = await requestToPromise<IDBValidKey[]>(store.getAllKeys());
    const values = await requestToPromise<unknown[]>(store.getAll());
    return keys.map((key, index) => [String(key), values[index]]);
  }

  async loadMetadataEntries(batchSize = 300): Promise<Array<[string, unknown]>> {
    const db = await this.open();
    if (!db) return [];
    const transaction = db.transaction(STORE_NAMES, "readonly");
    const store = transaction.objectStore("metadata");
    const keys = await requestToPromise<IDBValidKey[]>(store.getAllKeys());
    const entries: Array<[string, unknown]> = [];
    let index = 0;
    while (index < keys.length) {
      const values = await requestToPromise<unknown[]>(
        store.getAll(IDBKeyRange.lowerBound(keys[index]), batchSize),
      );
      if (values.length === 0) break;
      for (let offset = 0; offset < values.length; offset += 1) {
        entries.push([String(keys[index + offset]), values[offset]]);
      }
      index += values.length;
    }
    return entries;
  }

  save(storeName: MetadataCacheStoreName, key: string, value: unknown | null): void {
    void this.saveAsync(storeName, key, value);
  }

  private async saveAsync(
    storeName: MetadataCacheStoreName,
    key: string,
    value: unknown | null,
  ): Promise<void> {
    const db = await this.open();
    if (!db) return;
    let transaction = this.writeTransaction;
    try {
      const store = transaction?.objectStore(storeName);
      if (store) {
        if (value) store.put(value, key);
        else store.delete(key);
        return;
      }
    } catch {
      transaction = null;
    }
    transaction = db.transaction(STORE_NAMES, "readwrite", { durability: "relaxed" });
    this.writeTransaction = transaction;
    queueMicrotask(() => {
      if (this.writeTransaction === transaction) this.writeTransaction = null;
    });
    const store = transaction.objectStore(storeName);
    if (value) store.put(value, key);
    else store.delete(key);
  }

  private async open(): Promise<IDBDatabase | null> {
    this.dbPromise ??= new Promise((resolve) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const storeName of STORE_NAMES) {
          if (db.objectStoreNames.contains(storeName)) db.deleteObjectStore(storeName);
          db.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.error("Failed to load cache, unable to open IndexedDB", request.error);
        resolve(null);
      };
      request.onblocked = () => {
        console.error("Failed to load cache, unable to open IndexedDB", request.error);
        resolve(null);
      };
    });
    return this.dbPromise;
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function cloneEntries(source: Map<string, unknown>): Array<[string, unknown]> {
  return [...source.entries()].map(([key, value]) => [key, structuredClone(value)]);
}
