/**
 * Input: ./MountAdapter, ./MountRegistry, ../sync/SyncBoot, ../vault/FileSystemAdapter, ../ui/Notice
 * Output: buildWorkspaceAdapter, addRepositoryMount, WorkspaceBoot
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { Notice } from "../ui/Notice";
import { FileSystemAdapter } from "../vault/FileSystemAdapter";
import { LoroDataAdapter } from "../sync/LoroDataAdapter";
import { createSyncStore } from "../sync/SyncStore";
import { sessionStore } from "../sync/SyncSession";
import type { SyncedBoot } from "../sync/SyncBoot";
import { MountAdapter } from "./MountAdapter";
import { HOME_MOUNT_NAME, mountRegistry } from "./MountRegistry";

/**
 * Boot assembly of the multi-root workspace: Home first (the synced replica,
 * always present), then every remembered repository as its own mount. The
 * home replica is local-first — it exists signed out too, keyed by a local
 * id, and signing in is what gives it an account's vault id and a server.
 */

export interface WorkspaceBoot {
  adapter: MountAdapter;
  /** Present when Home is bound to an account — the SyncClient's input. */
  synced: SyncedBoot | null;
}

/** The signed-out Home replica: local-first, adopted by the account on
 * sign-in. */
export const LOCAL_HOME_ID = "local-home";

export async function buildWorkspaceAdapter(): Promise<WorkspaceBoot> {
  const session = sessionStore.session();
  const vault = sessionStore.vault();
  const homeId = vault?.id ?? LOCAL_HOME_ID;
  const home = await LoroDataAdapter.load(createSyncStore(homeId), homeId);

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

  const synced = session && vault ? { adapter: home, session, vault } : null;
  return { adapter, synced };
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
