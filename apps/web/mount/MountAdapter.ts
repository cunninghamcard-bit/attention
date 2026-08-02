/**
 * Input: ../vault/DataAdapter
 * Output: Mount, MountAdapter
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

/**
 * One vault, several roots — the VS Code multi-root shape. Each mount owns a
 * top-level name and routes to its own adapter: "Home" is the synced replica,
 * every repository is a FileSystemAdapter, and a remote workspace would slot
 * in the same way. Paths are `"<mount>/<inner>"`; this adapter strips the
 * prefix on the way down and re-adds it on events coming back up.
 *
 * The point is that everything ABOVE the adapter seam keeps assuming ONE
 * namespace: Vault, MetadataCache, search, links and the file tree work
 * across mounts without knowing mounts exist. That assumption is Obsidian's
 * and is faithful; multiple roots under it is our deviation, recorded in
 * docs/architecture.
 *
 * ponytail: mounts are flat and one segment deep — that is the whole product
 * model (a home vault plus repositories), not a limitation waiting to be
 * lifted.
 */

export interface Mount {
  /** Top-level name in the tree; unique, no slashes. */
  name: string;
  adapter: DataAdapter;
}

export class MountAdapter extends DataAdapter {
  /** The Vault only registers watch when this is true (usesAdapterEvents). */
  readonly supportsEvents = true;

  private mounts: Mount[] = [];
  private unwatchers = new Map<string, () => void>();

  constructor(mounts: Mount[] = []) {
    super();
    for (const mount of mounts) this.mounts.push(mount);
  }

  override getName(): string {
    return "Workspace";
  }

  list(path: string): Promise<ListedFiles> {
    // The root lists the mounts themselves — they ARE the top-level folders.
    if (path === "" || path === "/") {
      return Promise.resolve({ files: [], folders: this.mounts.map((mount) => mount.name) });
    }
    return this.route(path, (adapter, inner, name) =>
      adapter.list(inner).then((listed) => ({
        files: listed.files.map((file) => join(name, file)),
        folders: listed.folders.map((folder) => join(name, folder)),
      })),
    );
  }

  read(path: string): Promise<string> {
    return this.route(path, (adapter, inner) => adapter.read(inner));
  }

  override readBinary(path: string): Promise<ArrayBuffer> {
    return this.route(path, (adapter, inner) => adapter.readBinary(inner));
  }

  async write(path: string, data: string, options?: DataWriteOptions): Promise<void> {
    const existed = await this.exists(path);
    await this.route(path, (adapter, inner) => adapter.write(inner, data, options));
    await this.announceWrite(path, existed);
  }

  override async writeBinary(
    path: string,
    data: ArrayBuffer,
    options?: DataWriteOptions,
  ): Promise<void> {
    const existed = await this.exists(path);
    await this.route(path, (adapter, inner) => adapter.writeBinary(inner, data, options));
    await this.announceWrite(path, existed);
  }

  async delete(path: string): Promise<void> {
    const folder = (await this.stat(path))?.type === "folder";
    await this.route(path, (adapter, inner) => adapter.delete(inner));
    this.trigger(folder ? "folder-removed" : "file-removed", path);
  }

  async exists(path: string, sensitive = false): Promise<boolean> {
    if (path === "" || path === "/") return true;
    // Config paths are the config home's, not any mount's — and answering
    // "it exists" keeps the Vault from trying to create one here.
    if (this.isConfigPath(path)) return true;
    const split = this.split(path);
    if (!split) return false;
    // A mount root exists as long as it is mounted, whatever its adapter says
    // about the empty path.
    if (split.inner === "") return true;
    return split.mount.adapter.exists(split.inner, sensitive);
  }

  override async stat(path: string): Promise<Stat | null> {
    if (path === "" || path === "/") return { type: "folder", ctime: 0, mtime: 0, size: 0 };
    const split = this.split(path);
    if (!split) return null;
    if (split.inner === "") return { type: "folder", ctime: 0, mtime: 0, size: 0 };
    return split.mount.adapter.stat(split.inner);
  }

  async mkdir(path: string): Promise<void> {
    if (this.isConfigPath(path)) return;
    await this.route(path, (adapter, inner) => adapter.mkdir(inner));
    this.trigger("folder-created", path);
  }

  override getResourcePath(path: string): string {
    const split = this.split(path);
    if (!split || split.inner === "") return path;
    return split.mount.adapter.getResourcePath(split.inner);
  }

  override getFullPath(path: string): string {
    const split = this.split(path);
    if (!split || split.inner === "") return path;
    return split.mount.adapter.getFullPath(split.inner);
  }

  override async trashSystem(path: string): Promise<boolean> {
    const split = this.split(path);
    if (!split || split.inner === "") return false;
    return split.mount.adapter.trashSystem(split.inner);
  }

  override trashLocal(path: string): Promise<void> {
    return this.route(path, (adapter, inner) => adapter.trashLocal(inner));
  }

  override rmdir(path: string, recursive: boolean): Promise<void> {
    return this.route(path, (adapter, inner) => adapter.rmdir(inner, recursive));
  }

  /**
   * Within one mount the child adapter renames (identity-preserving where it
   * can). ACROSS mounts there is no such thing — a copy-then-delete moves the
   * bytes but not the file, so it is spelled out here rather than pretended.
   */
  override async rename(path: string, newPath: string): Promise<void> {
    if (path === newPath) return;
    const from = this.split(path);
    const to = this.split(newPath);
    if (!from || !to) throw new Error(`No such mount: ${path}`);
    if (from.mount === to.mount) {
      await from.mount.adapter.rename(from.inner, to.inner);
      return;
    }
    if (await this.exists(newPath)) throw new Error("Destination file already exists!");
    await this.copyAcross(from, to);
    await from.mount.adapter.delete(from.inner);
  }

  override async copy(path: string, newPath: string): Promise<void> {
    const from = this.split(path);
    const to = this.split(newPath);
    if (!from || !to) throw new Error(`No such mount: ${path}`);
    if (from.mount === to.mount) {
      await from.mount.adapter.copy(from.inner, to.inner);
      return;
    }
    if (await this.exists(newPath)) throw new Error(`File already exists: ${newPath}`);
    await this.copyAcross(from, to);
  }

  override async load(): Promise<void> {
    await Promise.all(this.mounts.map((mount) => mount.adapter.load()));
  }

  /**
   * Watching means watching every mount: each child's events are re-emitted
   * on this adapter with the mount name prefixed, so the Vault sees one
   * namespace. Mounts added later start watching immediately.
   */
  override async watch(handler: Parameters<DataAdapter["watch"]>[0]): Promise<() => void> {
    const unwatchSelf = await super.watch(handler);
    await Promise.all(this.mounts.map((mount) => this.watchMount(mount)));
    return () => {
      for (const unwatch of this.unwatchers.values()) unwatch();
      this.unwatchers.clear();
      unwatchSelf();
    };
  }

  // ----- mount management ------------------------------------------------

  getMounts(): readonly Mount[] {
    return this.mounts;
  }

  /** Add a root live — no reload, which is the whole point of the model. */
  async addMount(mount: Mount): Promise<void> {
    if (this.mounts.some((existing) => existing.name === mount.name))
      throw new Error(`A mount named "${mount.name}" already exists`);
    this.mounts.push(mount);
    await mount.adapter.load();
    this.trigger("folder-created", mount.name);
    await this.watchMount(mount);
    // The mount's existing contents announce themselves through the same
    // pipeline a live change would use — the Vault indexes from these.
    await this.announce(mount, "");
  }

  async removeMount(name: string): Promise<void> {
    const index = this.mounts.findIndex((mount) => mount.name === name);
    if (index === -1) return;
    this.unwatchers.get(name)?.();
    this.unwatchers.delete(name);
    this.mounts.splice(index, 1);
    this.trigger("folder-removed", name);
  }

  // ----- internals -------------------------------------------------------

  /**
   * Emit what a watching filesystem would have emitted. `supportsEvents`
   * means the Vault builds its index FROM these events rather than from the
   * call's return value (Vault.create re-reads getFileByPath afterwards), and
   * children that carry state in memory — the replica, the in-memory adapter
   * — have no watcher to notice their own writes. FileSystemAdapter does, so
   * on that mount this is the same event twice; the Vault is idempotent
   * about it (reconcile against an unchanged stat).
   */
  private async announceWrite(path: string, existed: boolean): Promise<void> {
    const stat = await this.stat(path);
    if (existed) {
      if (stat) this.trigger("modified", path, stat);
      else this.trigger("modified", path);
      return;
    }
    // A write creates missing parents; announce them so the tree has them.
    const segments = path.split("/");
    for (let depth = 2; depth < segments.length; depth += 1) {
      this.trigger("folder-created", segments.slice(0, depth).join("/"));
    }
    if (stat) this.trigger("file-created", path, stat);
    else this.trigger("file-created", path);
  }

  private async watchMount(mount: Mount): Promise<void> {
    if (this.unwatchers.has(mount.name)) return;
    const unwatch = await mount.adapter.watch((event, path, oldPath, stat) => {
      const prefixed = join(mount.name, path);
      if (event === "renamed") this.trigger(event, prefixed, join(mount.name, oldPath ?? ""));
      else if (stat) this.trigger(event, prefixed, stat);
      else this.trigger(event, prefixed);
    });
    this.unwatchers.set(mount.name, unwatch);
  }

  /** Depth-first announce of a mount's existing entries, folders first. */
  private async announce(mount: Mount, inner: string): Promise<void> {
    const listed = await mount.adapter.list(inner);
    for (const folder of listed.folders) {
      this.trigger("folder-created", join(mount.name, folder));
      await this.announce(mount, folder);
    }
    for (const file of listed.files) {
      const stat = await mount.adapter.stat(file);
      if (stat) this.trigger("file-created", join(mount.name, file), stat);
      else this.trigger("file-created", join(mount.name, file));
    }
  }

  private async copyAcross(
    from: { mount: Mount; inner: string },
    to: { mount: Mount; inner: string },
  ): Promise<void> {
    const data = await from.mount.adapter.readBinary(from.inner);
    await to.mount.adapter.writeBinary(to.inner, data);
  }

  private split(path: string): { mount: Mount; inner: string } | null {
    const normalized = path.replace(/^\/+/, "");
    const slash = normalized.indexOf("/");
    const name = slash === -1 ? normalized : normalized.slice(0, slash);
    const mount = this.mounts.find((candidate) => candidate.name === name);
    if (!mount) return null;
    return { mount, inner: slash === -1 ? "" : normalized.slice(slash + 1) };
  }

  private route<T>(
    path: string,
    run: (adapter: DataAdapter, inner: string, name: string) => Promise<T>,
  ): Promise<T> {
    const split = this.split(path);
    if (!split) return Promise.reject(new Error(`No such mount: ${path}`));
    return run(split.mount.adapter, split.inner, split.mount.name);
  }

  /**
   * Config lives in the config home, never in content — the single-config-home
   * decision (docs/superpowers/specs/2026-07-27-single-config-home-design.md).
   * The Vault still probes its config dir against whatever adapter backs the
   * content, so answer those probes here instead of routing them: a config
   * path belongs to no mount, and a rejected mkdir would take boot down.
   */
  private isConfigPath(path: string): boolean {
    return path.split("/")[0]?.startsWith(".") ?? false;
  }
}

function join(prefix: string, path: string): string {
  return path ? `${prefix}/${path}` : prefix;
}
