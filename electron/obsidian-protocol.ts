import {
  parseObsidianUrl,
  resolveVaultForAction,
  type ObsidianAction,
} from "./obsidian-url";
import type { VaultRegistry } from "./vault-registry";
import { URL_SCHEME } from "../src/protocol/scheme";

/**
 * `obsidian://` routing orchestrator — real `$e(url)` end to end, plus the OS
 * registration entry points.
 */
export interface ObsidianUrlDeps {
  registry: VaultRegistry;
  vaultWindows: {
    deliverAction(vaultId: string, action: ObsidianAction): void;
    mostRecentVaultId(): string | null;
    openAllPersisted(): number;
  };
  /** Open the starter window (sync-setup / choose-vault). */
  openStarter(): void;
  /** Show the "Vault not found" error. */
  showVaultNotFound(url: string): void;
  isWindows?: boolean;
}

/** Real `$e(url)`. */
export function handleObsidianUrl(rawUrl: string, deps: ObsidianUrlDeps): void {
  const parsed = parseObsidianUrl(rawUrl, { isWindows: deps.isWindows });
  if (parsed.kind === "invalid") return;
  if (parsed.kind === "starter") {
    deps.openStarter();
    return;
  }

  const resolved = resolveVaultForAction(parsed.action, deps.registry.vaults);
  let vaultId = resolved.vaultId;
  if (resolved.useMostRecent) {
    vaultId = deps.vaultWindows.mostRecentVaultId();
    if (!vaultId) {
      deps.vaultWindows.openAllPersisted();
      vaultId = deps.vaultWindows.mostRecentVaultId();
    }
  }

  if (vaultId) deps.vaultWindows.deliverAction(vaultId, resolved.action);
  else deps.showVaultNotFound(rawUrl);
}

/** Extract a trailing `obsidian://` argument from a process argv (win/linux). */
export function obsidianUrlFromArgv(argv: string[]): string | null {
  const last = argv[argv.length - 1];
  return last && last.startsWith(URL_SCHEME) ? last : null;
}
