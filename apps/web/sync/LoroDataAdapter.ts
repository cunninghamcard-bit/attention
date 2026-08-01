/**
 * Input: ../vault/DataAdapter, ./VaultDocs, ./SyncStore
 * Output: LoroDataAdapter
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import {
  DataAdapter,
  type DataWriteOptions,
  type ListedFiles,
  type Stat,
} from "../vault/DataAdapter";
import type { SyncStore } from "./SyncStore";
import { VaultDocs, type RemoteEvent } from "./VaultDocs";

/**
 * The synced vault's DataAdapter — the third seat beside FileSystemAdapter
 * and InMemoryAdapter, semantics mirrored from InMemoryAdapter (the
 * contract's reference implementation; the shared contract test runs both).
 *
 * String content lives in per-file loro text docs; binary content is
 * content-addressed in the blob store with the hash on the tree node.
 * Local operations emit no events (the Vault handles its own actions,
 * exactly as with every adapter); REMOTE changes arrive through VaultDocs
 * and are emitted as the same watch events a disk change would produce —
 * which is the entire collaboration pipeline.
 */
export class LoroDataAdapter extends DataAdapter {
  private constructor(
    private readonly docs: VaultDocs,
    private readonly store: SyncStore,
    private readonly vaultId: string,
  ) {
    super();
    this.docs.onRemoteChange((events) => this.emitRemote(events));
  }

  static async load(store: SyncStore, vaultId: string): Promise<LoroDataAdapter> {
    return new LoroDataAdapter(await VaultDocs.load(store), store, vaultId);
  }

  /** The loro layer, exposed for the SyncClient to wire rooms onto. */
  vaultDocs(): VaultDocs {
    return this.docs;
  }

  override getName(): string {
    return "Synced";
  }

  async read(path: string): Promise<string> {
    const data = this.docs.nodeData(path);
    if (data?.blob) {
      const bytes = await this.store.getBlob(data.blob);
      return new TextDecoder().decode(bytes ?? new Uint8Array());
    }
    return this.docs.readText(path);
  }

  override async readBinary(path: string): Promise<ArrayBuffer> {
    const data = this.docs.nodeData(path);
    if (data?.blob) {
      const bytes = (await this.store.getBlob(data.blob)) ?? new Uint8Array();
      return toArrayBuffer(bytes);
    }
    return toArrayBuffer(new TextEncoder().encode(await this.docs.readText(path)));
  }

  async write(path: string, data: string, options?: DataWriteOptions): Promise<void> {
    await this.docs.writeText(path, data);
    this.docs.touch(path, {
      size: new TextEncoder().encode(data).byteLength,
      mtime: options?.mtime ?? Date.now(),
      ...(options?.ctime !== undefined ? { ctime: options.ctime } : {}),
      blob: null,
    });
    options?.immediate?.();
  }

  override async writeBinary(
    path: string,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<void> {
    const bytes = new Uint8Array(data.slice(0));
    const hash = await contentHash(bytes);
    this.store.putBlob(hash, bytes);
    this.docs.ensureFile(path);
    this.docs.touch(path, {
      blob: hash,
      size: bytes.byteLength,
      mtime: options?.mtime ?? Date.now(),
      ...(options?.ctime !== undefined ? { ctime: options.ctime } : {}),
    });
    options?.immediate?.();
  }

  async delete(path: string): Promise<void> {
    this.docs.deleteAt(path);
  }

  async exists(path: string, sensitive = false): Promise<boolean> {
    if (path === "" || this.docs.kindAt(path) !== undefined) return true;
    if (sensitive) return false;
    return this.docs.pathInsensitive(path) !== undefined;
  }

  override async stat(path: string): Promise<Stat | null> {
    const data = this.docs.nodeData(path);
    if (!data) return null;
    return { type: data.kind, ctime: data.ctime, mtime: data.mtime, size: data.size };
  }

  async mkdir(path: string): Promise<void> {
    this.docs.ensureFolder(path);
  }

  async list(path: string): Promise<ListedFiles> {
    return this.docs.list(path);
  }

  override getResourcePath(path: string): string {
    return `synced://${this.vaultId}/${encodeURIComponent(path)}`;
  }

  /** Identity-preserving: the tree node moves, its text room survives. */
  override async rename(path: string, newPath: string): Promise<void> {
    if (path === newPath) return;
    if (await this.renameDestinationExists(path, newPath))
      throw new Error("Destination file already exists!");
    if (this.docs.kindAt(path) === undefined) return;
    this.docs.renameTo(path, newPath);
  }

  override async copy(path: string, newPath: string): Promise<void> {
    if (await this.exists(newPath)) throw new Error(`File already exists: ${newPath}`);
    if (this.docs.kindAt(path) !== "file") throw new Error(`File not found: ${path}`);
    await this.writeBinary(newPath, await this.readBinary(path));
  }

  override async trashLocal(path: string): Promise<void> {
    const filename = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
    const dot = filename.lastIndexOf(".");
    const stem = dot === -1 ? filename : filename.slice(0, dot);
    const extension = dot === -1 ? "" : filename.slice(dot);
    let candidate = `.trash/${stem}${extension}`;
    let index = 1;
    while (this.docs.kindAt(candidate) !== undefined) {
      index += 1;
      candidate = `.trash/${stem} ${index}${extension}`;
    }
    await this.rename(path, candidate);
  }

  private emitRemote(events: RemoteEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case "renamed":
          this.trigger("renamed", event.path, event.oldPath);
          break;
        case "modified": {
          void this.stat(event.path).then((stat) => {
            this.trigger("modified", event.path, stat ?? undefined);
          });
          break;
        }
        default:
          this.trigger(event.type, event.path);
      }
    }
  }
}

async function contentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
