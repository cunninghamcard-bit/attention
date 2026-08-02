/**
 * Input: ./LoroDataAdapter, ./SyncClient, ./SyncSession, ../ui/Notice
 * Output: SyncedBoot, connectSyncClient
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { Notice } from "../ui/Notice";
import type { LoroDataAdapter } from "./LoroDataAdapter";
import { SyncClient } from "./SyncClient";
import type { SyncedVaultChoice, SyncSession } from "./SyncSession";

/**
 * Boot-time wiring for the synced Home. When a session and a vault choice
 * are stored, MountBoot binds the Home replica to the account (local-first —
 * the vault is usable offline), and the SyncClient connects after boot, in
 * the background.
 */

export interface SyncedBoot {
  adapter: LoroDataAdapter;
  session: SyncSession;
  vault: SyncedVaultChoice;
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
