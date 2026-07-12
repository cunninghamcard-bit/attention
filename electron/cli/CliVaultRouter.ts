/**
 * Vault routing for a CLI request, reconstructed from real Obsidian's `et`:
 *
 *   let m = argv[0]?.startsWith("vault=") ? argv.shift() : "";
 *   let t = m ? Re(m.slice(6)) : Ge(cwd || "") || ve() || "";
 *
 * `vault=<name>` picks by name (`Re` = getIdByName); otherwise the vault
 * containing the cwd (`Ge` = getIdByContainedPath), else the most-recently
 * focused vault (`ve` = mostRecentVaultId). A `vault=` prefix is stripped from
 * the argv the renderer sees.
 */

export interface VaultRouterDeps {
  getIdByName(name: string): string | null;
  getIdByContainedPath(path: string): string | null;
  mostRecentVaultId(): string | null;
}

export function routeVault(
  argv: string[],
  cwd: string,
  deps: VaultRouterDeps,
): { vaultId: string | null; argv: string[] } {
  const first = argv[0];
  if (first && first.startsWith("vault=")) {
    return { vaultId: deps.getIdByName(first.slice("vault=".length)), argv: argv.slice(1) };
  }
  return { vaultId: deps.getIdByContainedPath(cwd) ?? deps.mostRecentVaultId(), argv };
}
