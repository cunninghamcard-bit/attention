/**
 * Input: ./obsidian-url, @app/shared/scheme
 * Output: ObsidianUrlDeps, handleObsidianUrl, obsidianUrlFromArgv
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { parseObsidianUrl, type ObsidianAction } from "./obsidian-url";
import { URL_SCHEME } from "@app/shared/scheme";

/**
 * `obsidian://` routing orchestrator — real `$e(url)`, collapsed to the
 * one-workspace-window form: parsing and OBS_ACT delivery are kept verbatim,
 * but there is no vault to resolve — every action lands in THE window. Real's
 * resolveVaultForAction (vault name match, longest-containing-path match,
 * most-recent-focus fallback) died with the vault registry; an action's
 * `vault`/`path` params ride along untouched for the renderer to interpret
 * against its mounts.
 */
export interface ObsidianUrlDeps {
  /** Open-or-get the workspace window and inject the action. */
  deliverAction(action: ObsidianAction): void;
  /** The starter forms (sync-setup / choose-vault): ensure the window is up. */
  openStarter(): void;
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
  deps.deliverAction(parsed.action);
}

/** Extract a trailing `obsidian://` argument from a process argv (win/linux). */
export function obsidianUrlFromArgv(argv: string[]): string | null {
  const last = argv[argv.length - 1];
  return last && last.startsWith(URL_SCHEME) ? last : null;
}
