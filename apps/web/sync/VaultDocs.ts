/**
 * Input: ./loro, ./SyncStore
 * Output: VaultDocs, RemoteEvent, TREE_DOC_ID
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { LoroDoc, LoroTree, LoroTreeNode } from "loro-crdt";
import { loadLoro } from "./loro";
import type { SyncStore } from "./SyncStore";

/**
 * The loro layer of a synced vault: one movable-tree doc for the hierarchy
 * (node id = file identity, stable across rename/move) plus one lazily
 * instantiated text doc per file, keyed by the node id. This is the ONLY
 * module that interprets loro bytes; SyncStore below and SyncClient beside
 * it move opaque payloads.
 *
 * Persistence: every live doc pipes subscribeLocalUpdates into the store's
 * WAL; past a threshold the doc is folded into a snapshot. Remote bytes
 * are WAL-appended first (durability), then imported if the doc is live —
 * a cold doc costs nothing until opened, when boot replay merges its WAL.
 * ponytail: remote edits to a COLD text doc don't refresh derived caches
 * until the file is next opened; revisit when metadata freshness matters.
 */

export const TREE_DOC_ID = "tree";

/** WAL entries per doc before folding into a snapshot. */
const COMPACT_THRESHOLD = 100;

export interface RemoteEvent {
  type:
    | "file-created"
    | "folder-created"
    | "modified"
    | "renamed"
    | "file-removed"
    | "folder-removed";
  path: string;
  oldPath?: string;
}

export interface NodeData {
  kind: "file" | "folder";
  ctime: number;
  mtime: number;
  size: number;
  /** Content-address of binary content; unset means text-doc content. */
  blob?: string;
}

export class VaultDocs {
  private textDocs = new Map<string, LoroDoc>();
  private lastTicket = new Map<string, number>();
  private walCounts = new Map<string, number>();
  /** path → node id, files and folders both; "" is the implicit root. */
  private index = new Map<string, string>();
  private kinds = new Map<string, "file" | "folder">();
  private remoteListeners = new Set<(events: RemoteEvent[]) => void>();
  private docSetListeners = new Set<() => void>();

  private constructor(
    private readonly module: Awaited<ReturnType<typeof loadLoro>>,
    private readonly store: SyncStore,
    private readonly treeDoc: LoroDoc,
  ) {}

  static async load(store: SyncStore): Promise<VaultDocs> {
    const module = await loadLoro();
    const treeDoc = new module.LoroDoc();
    const record = await store.loadDoc(TREE_DOC_ID);
    const batch = [...(record.snapshot ? [record.snapshot] : []), ...record.updates];
    if (batch.length > 0) treeDoc.importBatch(batch);
    const docs = new VaultDocs(module, store, treeDoc);
    docs.wirePersistence(TREE_DOC_ID, treeDoc);
    treeDoc.subscribe((event) => {
      if (event.by === "local") {
        docs.rebuildIndex();
        return;
      }
      docs.emitRemote(docs.diffAndRebuildIndex());
    });
    docs.rebuildIndex();
    return docs;
  }

  private tree(): LoroTree {
    return this.treeDoc.getTree("tree");
  }

  // ----- queries ---------------------------------------------------------

  idAtPath(path: string): string | undefined {
    return this.index.get(path);
  }

  kindAt(path: string): "file" | "folder" | undefined {
    if (path === "") return "folder";
    return this.kinds.get(path);
  }

  /** Case-insensitive lookup for the adapter's insensitive exists(). */
  pathInsensitive(path: string): string | undefined {
    const lowered = path.toLowerCase();
    for (const known of this.index.keys()) {
      if (known.toLowerCase() === lowered) return known;
    }
    return undefined;
  }

  list(path: string): { files: string[]; folders: string[] } {
    const prefix = path ? `${path}/` : "";
    const files: string[] = [];
    const folders: string[] = [];
    for (const [known, kind] of this.kinds) {
      if (known === path || !known.startsWith(prefix)) continue;
      if (known.slice(prefix.length).includes("/")) continue;
      (kind === "file" ? files : folders).push(known);
    }
    return { files, folders };
  }

  nodeData(path: string): NodeData | undefined {
    const node = this.nodeAt(path);
    if (!node) return path === "" ? { kind: "folder", ctime: 0, mtime: 0, size: 0 } : undefined;
    const data = node.data;
    return {
      kind: (data.get("kind") as "file" | "folder") ?? "file",
      ctime: Number(data.get("ctime") ?? 0),
      mtime: Number(data.get("mtime") ?? 0),
      size: Number(data.get("size") ?? 0),
      blob: (data.get("blob") as string | undefined) ?? undefined,
    };
  }

  // ----- mutations (each commits; persistence rides the subscription) ----

  ensureFolder(path: string): void {
    if (path === "" || this.index.has(path)) return;
    let parentId: string | undefined;
    let walked = "";
    for (const part of path.split("/")) {
      walked = walked ? `${walked}/${part}` : part;
      const existing = this.index.get(walked);
      if (existing) {
        parentId = existing;
        continue;
      }
      const node = this.createNode(parentId, part, "folder");
      parentId = node.id;
      this.index.set(walked, node.id);
      this.kinds.set(walked, "folder");
    }
    this.treeDoc.commit();
    this.rebuildIndex();
  }

  ensureFile(path: string): string {
    const existing = this.index.get(path);
    if (existing && this.kinds.get(path) === "file") return existing;
    const slash = path.lastIndexOf("/");
    const parent = slash === -1 ? "" : path.slice(0, slash);
    if (parent) this.ensureFolder(parent);
    const node = this.createNode(this.index.get(parent), path.slice(slash + 1), "file");
    this.treeDoc.commit();
    this.rebuildIndex();
    return node.id;
  }

  deleteAt(path: string): void {
    const id = this.index.get(path);
    if (id === undefined) return;
    this.tree().delete(id as never);
    this.treeDoc.commit();
    this.rebuildIndex();
  }

  /** Identity-preserving rename/move for files and folders alike. */
  renameTo(oldPath: string, newPath: string): void {
    const node = this.nodeAt(oldPath);
    if (!node) return;
    const slash = newPath.lastIndexOf("/");
    const parent = slash === -1 ? "" : newPath.slice(0, slash);
    if (parent) this.ensureFolder(parent);
    const parentId = this.index.get(parent);
    if (parent !== (oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : "")) {
      this.tree().move(node.id, parentId as never);
    }
    node.data.set("name", newPath.slice(slash + 1));
    node.data.set("mtime", Date.now());
    this.treeDoc.commit();
    this.rebuildIndex();
  }

  touch(path: string, fields: Partial<Omit<NodeData, "kind">> & { blob?: string | null }): void {
    const node = this.nodeAt(path);
    if (!node) return;
    if (fields.ctime !== undefined) node.data.set("ctime", fields.ctime);
    if (fields.mtime !== undefined) node.data.set("mtime", fields.mtime);
    if (fields.size !== undefined) node.data.set("size", fields.size);
    if (fields.blob !== undefined) {
      if (fields.blob === null) node.data.delete("blob");
      else node.data.set("blob", fields.blob);
    }
    this.treeDoc.commit();
  }

  // ----- text ------------------------------------------------------------

  async readText(path: string): Promise<string> {
    const id = this.index.get(path);
    if (id === undefined) return "";
    const doc = await this.liveTextDoc(id);
    return doc.getText("content").toString();
  }

  async writeText(path: string, text: string): Promise<void> {
    const id = this.ensureFile(path);
    const doc = await this.liveTextDoc(id);
    doc.getText("content").update(text);
    doc.commit();
  }

  // ----- remote ----------------------------------------------------------

  /** Bytes from the wire: durably WAL them, merge into the doc if live. */
  async applyRemote(docId: string, bytes: Uint8Array): Promise<void> {
    this.trackAppend(docId, this.store.appendUpdate(docId, bytes));
    if (docId === TREE_DOC_ID) {
      this.treeDoc.import(bytes);
      return;
    }
    const live = this.textDocs.get(docId);
    if (!live) return;
    live.import(bytes);
    const path = this.pathOfId(docId);
    if (path !== undefined) this.emitRemote([{ type: "modified", path }]);
  }

  onRemoteChange(listener: (events: RemoteEvent[]) => void): () => void {
    this.remoteListeners.add(listener);
    return () => this.remoteListeners.delete(listener);
  }

  /** Every doc id this vault owns — the SyncClient's room list. */
  docIds(): string[] {
    const ids = new Set<string>([TREE_DOC_ID]);
    for (const [path, id] of this.index) {
      if (this.kinds.get(path) === "file") ids.add(id);
    }
    return [...ids];
  }

  paths(): string[] {
    return [...this.index.keys()];
  }

  // ----- internals -------------------------------------------------------

  private createNode(
    parentId: string | undefined,
    name: string,
    kind: "file" | "folder",
  ): LoroTreeNode {
    const tree = this.tree();
    const node = parentId === undefined ? tree.createNode() : tree.createNode(parentId as never);
    const now = Date.now();
    node.data.set("name", name);
    node.data.set("kind", kind);
    node.data.set("ctime", now);
    node.data.set("mtime", now);
    node.data.set("size", 0);
    return node;
  }

  private nodeAt(path: string): LoroTreeNode | undefined {
    const id = this.index.get(path);
    if (id === undefined) return undefined;
    return this.tree().getNodeByID(id as never) ?? undefined;
  }

  private pathOfId(docId: string): string | undefined {
    for (const [path, id] of this.index) {
      if (id === docId) return path;
    }
    return undefined;
  }

  /** The tree doc itself — the SyncClient wraps it in a room adaptor. */
  treeDocRef(): LoroDoc {
    return this.treeDoc;
  }

  /** Instantiate (or fetch) a file's live text doc by node id. */
  openTextDoc(id: string): Promise<LoroDoc> {
    return this.liveTextDoc(id);
  }

  /** Fires after any tree change alters the doc set; reconcile idempotently. */
  onDocSetChanged(listener: () => void): () => void {
    this.docSetListeners.add(listener);
    return () => this.docSetListeners.delete(listener);
  }

  private async liveTextDoc(id: string): Promise<LoroDoc> {
    const existing = this.textDocs.get(id);
    if (existing) return existing;
    const doc = new this.module.LoroDoc();
    const record = await this.store.loadDoc(id);
    const batch = [...(record.snapshot ? [record.snapshot] : []), ...record.updates];
    if (batch.length > 0) doc.importBatch(batch);
    this.textDocs.set(id, doc);
    this.wirePersistence(id, doc);
    return doc;
  }

  private wirePersistence(docId: string, doc: LoroDoc): void {
    doc.subscribeLocalUpdates((bytes) => {
      this.trackAppend(docId, this.store.appendUpdate(docId, bytes));
      this.maybeCompact(docId, doc);
    });
  }

  private trackAppend(docId: string, ticket: number): void {
    this.lastTicket.set(docId, ticket);
    this.walCounts.set(docId, (this.walCounts.get(docId) ?? 0) + 1);
  }

  private maybeCompact(docId: string, doc: LoroDoc): void {
    if ((this.walCounts.get(docId) ?? 0) < COMPACT_THRESHOLD) return;
    const upTo = this.lastTicket.get(docId) ?? 0;
    // Full snapshot, history included — local persistence keeps time travel
    // possible. ponytail: shallow-snapshot when history size ever matters.
    this.store.saveSnapshot(docId, doc.export({ mode: "snapshot" }), upTo);
    this.walCounts.set(docId, 0);
  }

  private emitRemote(events: RemoteEvent[]): void {
    if (events.length === 0) return;
    for (const listener of this.remoteListeners) listener(events);
  }

  /** Recompute path→id from the tree; roots sorted for determinism. */
  private rebuildIndex(): void {
    this.rebuildIndexCore();
    for (const listener of this.docSetListeners) listener();
  }

  private rebuildIndexCore(): void {
    this.index = new Map();
    this.kinds = new Map();
    const walk = (node: LoroTreeNode, prefix: string) => {
      const name = String(node.data.get("name") ?? "");
      const kind = (node.data.get("kind") as "file" | "folder") ?? "file";
      const path = prefix ? `${prefix}/${name}` : name;
      this.index.set(path, node.id);
      this.kinds.set(path, kind);
      for (const child of node.children() ?? []) walk(child, path);
    };
    for (const root of this.tree().roots()) walk(root, "");
  }

  /** Rebuild and translate the delta into adapter-shaped remote events. */
  private diffAndRebuildIndex(): RemoteEvent[] {
    const oldIndex = this.index;
    const oldKinds = this.kinds;
    this.rebuildIndex();
    const events: RemoteEvent[] = [];
    const oldById = new Map<string, string>();
    for (const [path, id] of oldIndex) oldById.set(id, path);
    for (const [path, id] of this.index) {
      const before = oldById.get(id);
      if (before === undefined) {
        events.push({
          type: this.kinds.get(path) === "folder" ? "folder-created" : "file-created",
          path,
        });
      } else if (before !== path) {
        events.push({ type: "renamed", path, oldPath: before });
      }
      oldById.delete(id);
    }
    for (const [, before] of oldById) {
      events.push({
        type: oldKinds.get(before) === "folder" ? "folder-removed" : "file-removed",
        path: before,
      });
    }
    return events;
  }
}
