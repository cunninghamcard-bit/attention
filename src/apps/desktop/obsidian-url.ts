import { resolve } from "node:path";
import type { VaultRegistryData } from "./vault-registry";
import { URL_SCHEME } from "@app/web/app/protocol/scheme";

/**
 * `obsidian://` URL parsing and routing — real `$e(url)` (reverse note
 * "obsidian:// URL routing").
 *
 * The parse and vault-resolution are pure and tested here; the delivery into a
 * renderer via `window.OBS_ACT` is `VaultWindowManager.deliverAction`, and the
 * OS registration is in `obsidian-protocol.ts`.
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
    const parts = rest.substring("vault/".length).split("/").map((p) => decodeURIComponent(p));
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

export interface ResolvedVault {
  /** The action, with `file` filled in when resolved by path. */
  action: ObsidianAction;
  /** The target vault id, or null if none matched. */
  vaultId: string | null;
  /** When true the caller uses the most-recent vault (real `ve()`), opening one if none. */
  useMostRecent: boolean;
}

/**
 * Real `$e` vault-resolution half: by longest matching vault path (setting the
 * relative `file`), else by vault name, else defer to the most-recent vault.
 */
export function resolveVaultForAction(
  action: ObsidianAction,
  vaults: VaultRegistryData,
): ResolvedVault {
  if (typeof action.path === "string") {
    const target = resolve(action.path);
    let bestRoot = "";
    let vaultId: string | null = null;
    for (const id of Object.keys(vaults)) {
      const root = vaults[id].path;
      if (target.startsWith(root) && bestRoot.length < root.length) {
        bestRoot = root;
        vaultId = id;
      }
    }
    const next = { ...action };
    if (vaultId) next.file = target.substring(bestRoot.length);
    return { action: next, vaultId, useMostRecent: false };
  }
  if (typeof action.vault === "string") {
    let vaultId: string | null = null;
    for (const id of Object.keys(vaults)) {
      const path = vaults[id].path;
      if (id === action.vault || basename(path).toUpperCase() === action.vault.toUpperCase()) {
        vaultId = id;
        break;
      }
    }
    return { action, vaultId, useMostRecent: false };
  }
  return { action, vaultId: null, useMostRecent: true };
}

/** Real `it()` injection payload: install or queue `window.OBS_ACT`. */
export function buildObsActScript(action: ObsidianAction): string {
  return `(function(){var w=window,o=${JSON.stringify(action)};if(typeof w.OBS_ACT === "function"){w.OBS_ACT(o)}else{w.OBS_ACT=o}})()`;
}

function basename(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  return idx >= 0 ? norm.substring(idx + 1) : norm;
}
