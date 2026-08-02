/**
 * Input: None
 * Output: SyncChannels, InvokeChannels, IpcChannels, SyncChannelName, InvokeChannelName, IpcChannelName, IpcRequest, IpcResponse
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * The typed IPC channel table — the one contract the main-process handlers and
 * the renderer callers both reference. Channel name → request tuple + response.
 *
 * Plain TS types, no zod and no runtime validation: the seam is a trusted,
 * small, in-process surface (nodeIntegration renderer ↔ our own main), not an
 * untrusted sandbox. It exists so channel NAMES stay a single source of truth
 * instead of bare string literals scattered on both sides.
 */

/** Sync channels: `ipcRenderer.sendSync(channel, ...request)` → response. */
export interface SyncChannels {
  "file-url": { request: []; response: string };
  version: { request: []; response: string };
  "is-quitting": { request: []; response: boolean };
  resources: { request: []; response: string };
  "desktop-dir": { request: []; response: string };
  "documents-dir": { request: []; response: string };
  "get-documents-path": { request: []; response: string };
  "get-sandbox-vault-path": { request: []; response: string };
  "get-default-vault-path": { request: []; response: string };
  vault: {
    request: [];
    // The boot handshake. `home` is the app's one config directory; `mounts`
    // is the e2e seed seam (folders to mount into the workspace at boot).
    // Real Obsidian answered {id, path} — which folder this window IS; the
    // one-workspace-window form has no per-window folder identity.
    response: { home: string; mounts?: string[] } | Record<string, never>;
  };
  trash: { request: [path: string]; response: boolean };
  "open-url": { request: [url: string]; response: void };
  "request-url": { request: [replyId: string, params: unknown]; response: void };
  "set-menu": { request: [arg: { template: unknown[] }]; response: void };
  "update-menu-items": { request: [items: unknown[], updateShareMenu?: boolean]; response: void };
  frame: { request: [value?: "hidden" | "custom" | "native"]; response: string };
  "disable-gpu": { request: [value?: boolean]; response: boolean };
  "get-icon": { request: []; response: string | null };
  "set-icon": { request: [path: string | null]; response: string | null };
  relaunch: { request: []; response: void };
}

/** Invoke channels: `ipcRenderer.invoke(channel, ...request)` → Promise<response>. */
export interface InvokeChannels {
  "dialog:open": { request: [opts?: unknown]; response: string[] };
  "dialog:save": { request: [opts?: unknown]; response: string | null };
  "window:set-fullscreen": { request: [value: unknown]; response: void };
  "request-url": { request: [params: unknown]; response: unknown };
  /** OS font families — Obsidian's `get-fonts` seam (open-source `font-list`). */
  "get-fonts": { request: []; response: string[] };
}

export type IpcChannels = SyncChannels & InvokeChannels;

export type SyncChannelName = keyof SyncChannels;
export type InvokeChannelName = keyof InvokeChannels;
export type IpcChannelName = keyof IpcChannels;

export type IpcRequest<C extends IpcChannelName> = IpcChannels[C]["request"];
export type IpcResponse<C extends IpcChannelName> = IpcChannels[C]["response"];
