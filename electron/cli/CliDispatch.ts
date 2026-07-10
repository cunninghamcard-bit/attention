import { routeVault, type VaultRouterDeps } from "./CliVaultRouter";

/**
 * The CLI dispatch — reconstructed from real Obsidian's `et(socket, argv, tty,
 * cwd)`, transport-free so it is unit-testable. Given a request it decides what
 * text to write back:
 *
 *   1. non-tty + empty argv  → open the Starter window (side effect), then fall
 *      through so the renderer's `handleCli([])` returns the help text.
 *   2. last arg is a URL     → hand it to the URL router, don't treat as a command.
 *   3. otherwise             → route to a vault and run the argv in its renderer.
 *
 * The interactive REPL (tty + empty argv) is not reconstructed; a tty request
 * with a command still dispatches one-shot.
 */

export interface CliRequest {
  argv: string[];
  tty: boolean;
  cwd: string;
}

export interface CliDispatchDeps extends VaultRouterDeps {
  // Opens the Starter / startup window (real `pe()`), a no-op if one is up.
  openStarter(): void;
  // Handles an `obsidian://…` URL; returns the confirmation text to write back.
  handleUrl(url: string): string;
  // Runs argv in the vault's renderer and returns the text to write back.
  executeCliRequest(vaultId: string | null, argv: string[]): Promise<string>;
}

const URL_SCHEME = "obsidian://";

export async function dispatchCli(request: CliRequest, deps: CliDispatchDeps): Promise<string> {
  const { argv, tty, cwd } = request;

  if (!tty && argv.length === 0) deps.openStarter();

  const last = argv[argv.length - 1];
  if (last && last.startsWith(URL_SCHEME)) return deps.handleUrl(last);

  const routed = routeVault(argv, cwd, deps);
  return deps.executeCliRequest(routed.vaultId, routed.argv);
}
