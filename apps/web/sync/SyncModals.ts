/**
 * Input: ../app/App, ../ui/Modal, ../ui/Setting, ../ui/Notice, ./FolderImport, ./LoroDataAdapter, ./SyncStore, ./SyncSession
 * Output: SyncLoginModal, openSyncFlow
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { App } from "../app/App";
import { Modal } from "../ui/Modal";
import { Setting } from "../ui/Setting";
import { Notice } from "../ui/Notice";
import { LOCAL_HOME_ID } from "../mount/MountBoot";
import { importFolder } from "./FolderImport";
import { LoroDataAdapter } from "./LoroDataAdapter";
import { createSyncStore } from "./SyncStore";
import { sessionStore, syncApi, type SyncSession } from "./SyncSession";

/**
 * The product model: sync is a property of THE vault, not a vault kind.
 * Signing in means "what I have here is synced from now on" — the account's
 * vault is found or created silently, the CURRENT contents are imported
 * into the replica, and the window reloads showing the same files with the
 * status bar reading Synced. There is no vault picker anywhere; a second
 * device signs in and its local contents merge into the same documents by
 * path (CRDT semantics absorb the overlap).
 */

/** Sign-in / register against an attentiond; success syncs this vault. */
export class SyncLoginModal extends Modal {
  private url = defaultServerUrl();
  private email = "";
  private password = "";

  constructor(app: App) {
    super(app);
    this.setTitle("Sign in to sync");
  }

  override onOpen(): void {
    super.onOpen();
    const { contentEl } = this;
    contentEl.replaceChildren();
    new Setting(contentEl)
      .setName("Server")
      .setDesc("Your attentiond URL. Everything in this vault syncs there once you sign in.")
      .addText((text) =>
        text
          .setPlaceholder("https://…")
          .setValue(this.url)
          .onChange((value) => {
            this.url = value.trim().replace(/\/+$/, "");
          }),
      );
    new Setting(contentEl).setName("Email").addText((text) => {
      text.inputEl.type = "email";
      text.setValue(this.email).onChange((value) => {
        this.email = value.trim();
      });
    });
    new Setting(contentEl).setName("Password").addText((text) => {
      text.inputEl.type = "password";
      text.onChange((value) => {
        this.password = value;
      });
    });
    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Create account").onClick(() => void this.submit("register")),
      )
      .addButton((button) =>
        button
          .setCta()
          .setButtonText("Sign in")
          .onClick(() => void this.submit("login")),
      );
  }

  private async submit(kind: "register" | "login"): Promise<void> {
    if (!this.url || !this.email || !this.password) {
      new Notice("Server, email and password are all required.");
      return;
    }
    try {
      const session = await syncApi.credentials(this.url, kind, this.email, this.password);
      this.close();
      await enableSync(this.app as App, session);
    } catch (error) {
      new Notice(`Sign in failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * The whole sign-in consequence: find or create the account's HOME vault —
 * the one synced place where 产物 live. The workspace always has a Home
 * replica; signing in binds it to the account. Its local contents carry over
 * on reload — the replica is re-keyed to the account's vault id (offline into
 * IndexedDB — the SyncClient pushes after the reload, so a flaky network
 * cannot half-sync the switch). Repositories are never touched: git is their
 * sync.
 */
async function enableSync(_app: App, session: SyncSession): Promise<void> {
  const vaults = await syncApi.listVaults(session);
  const vault = vaults[0] ?? (await syncApi.createVault(session, "Home"));
  sessionStore.saveSession(session);
  sessionStore.saveVault(vault);

  if (vault.id !== LOCAL_HOME_ID) {
    const local = await LoroDataAdapter.load(createSyncStore(LOCAL_HOME_ID), LOCAL_HOME_ID);
    const bound = await LoroDataAdapter.load(createSyncStore(vault.id), vault.id);
    await importFolder(local, bound);
  }
  new Notice(`Synced as ${session.email} — reloading…`);
  window.location.reload();
}

/** The command entry: already synced is a statement, not a picker. */
export function openSyncFlow(app: App): void {
  const session = sessionStore.session();
  const vault = sessionStore.vault();
  if (session && vault) {
    new Notice(`Synced as ${session.email}`);
    return;
  }
  new SyncLoginModal(app).open();
}

function defaultServerUrl(): string {
  // The Web head is served BY the server; its own origin is the default.
  // Electron and dev servers get an empty field instead of a wrong guess.
  const origin = window.location?.origin ?? "";
  return origin.startsWith("http") && !origin.includes("localhost:5173") ? origin : "";
}
