/**
 * Input: @app/shared/scheme
 * Output: ObsidianAction, ParsedObsidianUrl, parseObsidianUrl, buildObsActScript
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { URL_SCHEME } from "@app/shared/scheme";

/**
 * `obsidian://` URL parsing — real `$e(url)`'s parse half (reverse note
 * "obsidian:// URL routing").
 *
 * The parse is pure and tested here; the delivery into the workspace renderer
 * via `window.OBS_ACT` is `WorkspaceWindow.deliverAction`, and the OS
 * registration is in `obsidian-protocol.ts`. Real's vault-resolution half
 * (resolveVaultForAction) died with the vault registry — one workspace window
 * means there is nothing to resolve; `vault`/`path` params pass through to the
 * renderer.
 */

const PREFIX = URL_SCHEME;

/** An action object handed to the renderer's `OBS_ACT`. */
export interface ObsidianAction {
  action: string;
  path?: string;
  vault?: string;
  file?: string;
  hash?: string;
  [key: string]: string | undefined;
}

export type ParsedObsidianUrl =
  | { kind: "invalid" }
  | { kind: "starter" } // sync-setup / choose-vault
  | { kind: "action"; action: ObsidianAction };

/** Real `$e` parse half (before vault resolution). */
export function parseObsidianUrl(
  rawUrl: string,
  opts: { isWindows?: boolean } = {},
): ParsedObsidianUrl {
  if (!rawUrl.startsWith(PREFIX)) return { kind: "invalid" };
  let rest = rawUrl.substring(PREFIX.length);
  const action: ObsidianAction = { action: "" };

  if (rest.startsWith("/")) {
    const raw = opts.isWindows ? rest.substring(1) : rest;
    action.action = "open";
    action.path = decodeURI(raw);
    return { kind: "action", action };
  }
  if (rest.startsWith("sync-setup") || rest.startsWith("choose-vault")) {
    return { kind: "starter" };
  }
  if (rest.startsWith("vault/")) {
    const parts = rest
      .substring("vault/".length)
      .split("/")
      .map((p) => decodeURIComponent(p));
    action.action = "open";
    action.vault = parts[0];
    action.file = parts.slice(1).join("/");
    return { kind: "action", action };
  }

  // Generic: `<action>?a=b&...#hash`.
  let query = "";
  const q = rest.indexOf("?");
  const h = rest.indexOf("#", Math.max(0, q));
  if (h >= 0) {
    action.hash = rest.substring(h + 1);
    rest = rest.substring(0, h);
  }
  if (q >= 0) {
    query = rest.substring(q + 1);
    rest = rest.substring(0, q);
  }
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.split("=");
    const value = eq.length > 1 ? decodeURIComponent(eq[1]) : "true";
    action[decodeURIComponent(eq[0])] = value;
  }
  action.action = rest.replace(/\/+$/g, "");
  return { kind: "action", action };
}

/** Real `it()` injection payload: install or queue `window.OBS_ACT`. */
export function buildObsActScript(action: ObsidianAction): string {
  return `(function(){var w=window,o=${JSON.stringify(action)};if(typeof w.OBS_ACT === "function"){w.OBS_ACT(o)}else{w.OBS_ACT=o}})()`;
}
