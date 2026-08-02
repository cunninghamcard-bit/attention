/**
 * Input: @app/shared/scheme
 * Output: CliRequest, CliDispatchDeps, dispatchCli
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { URL_SCHEME } from "@app/shared/scheme";

/**
 * The CLI dispatch — reconstructed from real Obsidian's `et(socket, argv, tty,
 * cwd)`, transport-free so it is unit-testable. Given a request it decides what
 * text to write back:
 *
 *   1. non-tty + empty argv  → open the workspace window (side effect), then
 *      fall through so the renderer's `handleCli([])` returns the help text.
 *   2. last arg is a URL     → hand it to the URL router, don't treat as a command.
 *   3. otherwise             → run the argv in the workspace renderer.
 *
 * Real `et` also routed to a vault here (`vault=<name>` / cwd containment /
 * most-recent focus). The one-workspace-window form has nothing to route
 * between, so that whole step is gone — see docs/architecture.md deviations.
 *
 * The interactive REPL (tty + empty argv) is not reconstructed; a tty request
 * with a command still dispatches one-shot.
 */

export interface CliRequest {
  argv: string[];
  tty: boolean;
  cwd: string;
}

export interface CliDispatchDeps {
  // The CLI-enable gate (real `C.cli`): when off, no command runs. Real
  // Obsidian gates in both `et` and `Xe`; our `executeCliRequest` is only
  // reachable through here, so this single gate covers it.
  isCliEnabled(): boolean;
  // Opens the workspace window (real `pe()`), a no-op if it is up.
  openStarter(): void;
  // Handles an `obsidian://…` URL; returns the confirmation text to write back.
  handleUrl(url: string): string;
  // Runs argv in the workspace renderer and returns the text to write back.
  executeCliRequest(argv: string[]): Promise<string>;
}

const CLI_DISABLED =
  "Command line interface is not enabled. Please turn it on in Settings > General > Advanced.";

export async function dispatchCli(request: CliRequest, deps: CliDispatchDeps): Promise<string> {
  const { argv, tty } = request;

  if (!tty && argv.length === 0) deps.openStarter();

  // A URL is handled even when the CLI is disabled (real `et` short-circuits
  // the URL before the `C.cli` gate).
  const last = argv[argv.length - 1];
  if (last && last.startsWith(URL_SCHEME)) return deps.handleUrl(last);

  if (!deps.isCliEnabled()) return CLI_DISABLED;

  return deps.executeCliRequest(argv);
}
