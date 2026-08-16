/**
 * Input: ./MountAdapter, ./MountRegistry, ../vault/FileSystemAdapter, ../vault/DataAdapter, ../ui/Notice
 * Output: buildWorkspaceAdapter, addRepositoryMount, WorkspaceBoot
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { Notice } from "../ui/Notice";
import { FileSystemAdapter } from "../vault/FileSystemAdapter";
import { InMemoryAdapter } from "../vault/DataAdapter";
import { MountAdapter } from "./MountAdapter";
import { HOME_MOUNT_NAME, mountRegistry } from "./MountRegistry";

/**
 * Boot assembly of the multi-root workspace: Home first (always present, an
 * in-memory root), then every remembered repository as its own mount.
 */

export interface WorkspaceBoot {
  adapter: MountAdapter;
}

export async function buildWorkspaceAdapter(seedPaths: string[] = []): Promise<WorkspaceBoot> {
  const home = new InMemoryAdapter();

  // Seeded mounts (the desktop e2e seam) become registry records like any
  // folder the user added — idempotent across relaunches in one profile.
  for (const path of seedPaths) {
    if (!mountRegistry.has(path)) mountRegistry.add(path);
  }

  const adapter = new MountAdapter([{ name: HOME_MOUNT_NAME, adapter: home }]);
  for (const record of mountRegistry.list()) {
    // A folder that moved or was deleted must not take the workspace down
    // with it; it stays in the registry so the user can see and remove it.
    try {
      await adapter.addMount({ name: record.name, adapter: new FileSystemAdapter(record.path) });
    } catch (error) {
      new Notice(
        `Could not mount ${record.name}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  return { adapter };
}

/** The "Add folder to workspace" action: pick, remember, mount live. */
export async function addRepositoryMount(adapter: MountAdapter): Promise<void> {
  const ipc = (
    window as {
      electron?: { ipcRenderer?: { invoke?(channel: string, payload: unknown): Promise<unknown> } };
    }
  ).electron?.ipcRenderer;
  if (!ipc?.invoke) {
    new Notice("Adding folders needs the desktop app.");
    return;
  }
  const paths = await ipc.invoke("dialog:open", { title: "Add folder", directory: true });
  const path = Array.isArray(paths) && typeof paths[0] === "string" ? paths[0] : null;
  if (!path) return;
  if (mountRegistry.has(path)) {
    new Notice("That folder is already in this workspace.");
    return;
  }
  const record = mountRegistry.add(path);
  try {
    await adapter.addMount({ name: record.name, adapter: new FileSystemAdapter(record.path) });
    new Notice(`Added ${record.name}`);
  } catch (error) {
    mountRegistry.remove(record.name);
    new Notice(`Could not add folder: ${error instanceof Error ? error.message : error}`);
  }
}

/** Detach a repository from the workspace; its files are left untouched. */
export async function removeRepositoryMount(adapter: MountAdapter, name: string): Promise<void> {
  if (name === HOME_MOUNT_NAME) {
    new Notice("Home is always part of the workspace.");
    return;
  }
  await adapter.removeMount(name);
  mountRegistry.remove(name);
  new Notice(`Removed ${name}`);
}
