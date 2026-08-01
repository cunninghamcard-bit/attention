/**
 * Input: ./LoroDataAdapter, ./SyncStore, ./SyncClient, ./SyncSession, ../ui/Notice
 * Output: SyncedBoot, loadSyncedAdapter, connectSyncClient
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { Notice } from "../ui/Notice";
import { LoroDataAdapter } from "./LoroDataAdapter";
import { SyncClient } from "./SyncClient";
import { createSyncStore } from "./SyncStore";
import { sessionStore, type SyncedVaultChoice, type SyncSession } from "./SyncSession";

/**
 * Boot-time wiring for synced-vault mode. When a session and a vault choice
 * are stored, the window opens ON the replica: the adapter loads from
 * IndexedDB before the App constructs (local-first — the vault is usable
 * offline), and the SyncClient connects after boot, in the background.
 */

export interface SyncedBoot {
  adapter: LoroDataAdapter;
  session: SyncSession;
  vault: SyncedVaultChoice;
}

export async function loadSyncedAdapter(): Promise<SyncedBoot | null> {
  const session = sessionStore.session();
  const vault = sessionStore.vault();
  if (!session || !vault) return null;
  const adapter = await LoroDataAdapter.load(createSyncStore(vault.id), vault.id);
  return { adapter, session, vault };
}

/** Connect in the background; offline is a Notice, never a broken vault. */
export async function connectSyncClient(boot: SyncedBoot): Promise<SyncClient | null> {
  try {
    return await SyncClient.connect(boot.adapter.vaultDocs(), {
      url: `${boot.session.url.replace(/^http/, "ws")}/sync`,
      vaultId: boot.vault.id,
      auth: () => new TextEncoder().encode(boot.session.token),
    });
  } catch (error) {
    new Notice(
      `Working offline — sync unavailable: ${error instanceof Error ? error.message : error}`,
    );
    return null;
  }
}
