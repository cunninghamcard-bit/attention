/**
 * Input: ./App, ../ui/suggest/SuggestModal, ../ui/Notice, ../dom/dom
 * Output: VaultSuggestion, VaultSwitcherModal
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { App } from "./App";
import { FuzzySuggestModal, type FuzzySuggestion } from "../ui/suggest/SuggestModal";
import { Notice } from "../ui/Notice";
import { createSpan } from "../dom/dom";

export interface VaultSuggestion {
  path: string;
  name: string;
  isCurrentVault: boolean;
}

interface VaultIpcHost {
  electron?: { ipcRenderer?: { sendSync?(channel: string, ...args: unknown[]): unknown } };
}

/**
 * Obsidian's own in-app vault list, ported from app.js `SD` + `xD` — the
 * surface behind `app:switch-vault` and `app:open-another-vault`. It is a
 * FuzzySuggestModal over the `vault-list` registry, not a view and not a
 * page: the vault CHOOSER (`app:open-vault` → `openVaultChooser()`) is the
 * separate starter window, and that window is gone here by design.
 *
 * Real's `switchVault` flag is deliberately NOT ported. It exists there to
 * choose between replacing the current vault and opening another alongside,
 * and it does that with one line — `this.switchVault && window.close()` after
 * a successful open, because opening a vault SPAWNS a window there and the old
 * one has to go. Here `vault-open` always retargets and reloads the CALLING
 * window (`vaultWindows.switchVault(e.sender.id, ...)`, ipc.ts), a consequence
 * of the one-window model: the reload IS the switch, closing would take the
 * app down, and there is no renderer-reachable way to open a second window.
 * With no behavior left to select, the flag and its `app:open-another-vault`
 * command would be a duplicate wearing a different name, so neither ships.
 */
export class VaultSwitcherModal extends FuzzySuggestModal<VaultSuggestion> {
  private items: VaultSuggestion[] = [];

  constructor(app: App) {
    super(app);
    // Real sets both in `SD`, unconditionally — the placeholder is the
    // "Change vault..." string even for the open-another-vault instance, and
    // the instructions are the command palette's own three.
    this.setPlaceholder("Change vault...");
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to use" },
      { command: "esc", purpose: "to dismiss" },
    ]);
  }

  override onOpen(): void {
    super.onOpen();
    this.loadVaults();
  }

  /** Real `loadVaults`: the registry, keyed by id, folder name as the label. */
  loadVaults(): void {
    this.items = [];
    const ipc = (window as VaultIpcHost).electron?.ipcRenderer;
    if (!ipc?.sendSync) {
      // Browser build: no vault registry to list. Real gates the whole command
      // on isDesktopApp; the empty state says the same thing without throwing.
      this.updateSuggestions();
      return;
    }
    const current = (ipc.sendSync("vault") as { path?: string } | undefined)?.path;
    const vaults = (ipc.sendSync("vault-list") ?? {}) as Record<string, { path?: string }>;
    for (const id of Object.keys(vaults)) {
      const path = vaults[id]?.path;
      if (!path) continue;
      this.items.push({ path, name: basename(path), isCurrentVault: current === path });
    }
    this.updateSuggestions();
  }

  getItems(): VaultSuggestion[] {
    return this.items;
  }

  getItemText(item: VaultSuggestion): string {
    return item.name;
  }

  override renderSuggestion(value: FuzzySuggestion<VaultSuggestion>, el: HTMLElement): void {
    super.renderSuggestion(value, el);
    if (value.item.isCurrentVault)
      createSpan({ cls: "flair mod-pop", text: "Currently active" }, el);
  }

  onChooseItem(item: VaultSuggestion): void {
    if (item.isCurrentVault) return;
    const ipc = (window as VaultIpcHost).electron?.ipcRenderer;
    if (ipc?.sendSync?.("vault-open", item.path, false) !== true)
      new Notice("Failed to open vault.");
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
