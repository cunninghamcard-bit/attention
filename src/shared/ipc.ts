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
  vault: { request: []; response: { id: string; path: string } | Record<string, never> };
  "vault-list": { request: []; response: Record<string, { path: string }> };
  "vault-open": { request: [path: string, create?: boolean]; response: string | boolean };
  "vault-remove": { request: [path: string]; response: boolean };
  "vault-move": { request: [from: string, to: string]; response: boolean };
  starter: { request: []; response: null };
  trash: { request: [path: string]; response: boolean };
  "open-url": { request: [url: string]; response: void };
  "request-url": { request: [replyId: string, params: unknown]; response: void };
  "set-menu": { request: [arg: { template: unknown[] }]; response: void };
  "update-menu-items": { request: [items: unknown[], updateShareMenu?: boolean]; response: void };
}

/** Invoke channels: `ipcRenderer.invoke(channel, ...request)` → Promise<response>. */
export interface InvokeChannels {
  "dialog:open": { request: [opts?: unknown]; response: string[] };
  "dialog:save": { request: [opts?: unknown]; response: string | null };
  "window:set-fullscreen": { request: [value: unknown]; response: void };
  "request-url": { request: [params: unknown]; response: unknown };
}

export type IpcChannels = SyncChannels & InvokeChannels;

export type SyncChannelName = keyof SyncChannels;
export type InvokeChannelName = keyof InvokeChannels;
export type IpcChannelName = keyof IpcChannels;

export type IpcRequest<C extends IpcChannelName> = IpcChannels[C]["request"];
export type IpcResponse<C extends IpcChannelName> = IpcChannels[C]["response"];
