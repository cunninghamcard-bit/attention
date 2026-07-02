import type { JsonStore } from "./json-store";
import type { VaultRegistryData } from "./vault-registry";

/**
 * `userData/obsidian.json` — the main-process settings object (real symbol `C`).
 *
 * Keys observed in the reverse note: `vaults`, `frame` ("native" or unset),
 * `updateDisabled`, `disableGpu`, `insider`, `cli`, `adblock`,
 * `adblockFrequency`, `icon`, `openSchemes`. Out-of-scope seams (updater, CLI,
 * adblock) keep their keys so a config written by real Obsidian round-trips
 * unmodified, but this reconstruction only acts on the in-scope ones.
 */
export interface ObsidianSettings {
  vaults?: VaultRegistryData;
  frame?: string;
  openSchemes?: Record<string, boolean>;
  // Out-of-scope seams, persisted verbatim:
  updateDisabled?: boolean;
  disableGpu?: boolean;
  insider?: boolean;
  cli?: boolean;
  adblock?: string[];
  adblockFrequency?: number;
  icon?: string;
  [key: string]: unknown;
}

export const SETTINGS_STORE_NAME = "obsidian";

/** Real `C = G("obsidian")` with the same non-object guard. */
export function loadSettings(store: JsonStore): ObsidianSettings {
  const raw = store.read<ObsidianSettings>(SETTINGS_STORE_NAME, {});
  return raw && typeof raw === "object" ? raw : {};
}

/** Real `q()` — persist the settings object. */
export function saveSettings(store: JsonStore, settings: ObsidianSettings): void {
  store.write(SETTINGS_STORE_NAME, settings);
}
