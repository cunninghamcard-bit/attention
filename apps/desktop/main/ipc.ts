/**
 * Input: @app/shared/ipc
 * Output: IpcSyncEvent, IpcListener, RequestUrlParams, RequestUrlResult, IpcDeps, createIpcHandlers, IpcMainLike, registerIpcHandlers
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { IpcChannelName } from "@app/shared/ipc";

/**
 * The main-process IPC channel table (reverse note "IPC channels").
 *
 * Handlers are built as a pure channel→listener map so they can be tested
 * without a live Electron `ipcMain`. `registerIpcHandlers` wires the map onto
 * the real emitter. Boot-critical `file-url`/`is-quitting` live in
 * foundation-ipc; the native menu channels (`set-menu`/`update-menu-items`)
 * are L8; `vault-message` (renderer injection) is L6.
 */

/** Minimal shape of the Electron sync IPC event this layer touches. */
export interface IpcSyncEvent {
  returnValue?: unknown;
  sender: { id: number };
  reply(channel: string, payload: unknown): void;
}

export type IpcListener = (event: IpcSyncEvent, ...args: unknown[]) => void;

export interface RequestUrlParams {
  url: string;
  method?: string;
  contentType?: string;
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
}

export type RequestUrlResult =
  | { status: number; headers: Record<string, unknown>; body: ArrayBuffer }
  | { error: unknown };

export interface IpcDeps {
  paths: {
    resources: string;
    version: string;
    desktopDir: string;
    documentsDir: string;
    sandboxVaultPath: string;
    defaultVaultPath: string;
    /** Electron userData — the app's one config home. */
    configHome: string;
  };
  /** shell.trashItem — real `trash` handler. */
  trashItem(path: string): Promise<void>;
  /** shell.openExternal — real `open-url` for external schemes. */
  openExternal(url: string): void;
  /** net.request wrapper — real `request-url`. */
  performRequest(params: RequestUrlParams): Promise<RequestUrlResult>;
  /** E2E seam: folders the renderer should mount at boot (E2E_MOUNT_PATH). */
  seedMounts?: string[];
  appearance?: {
    frame(value?: "hidden" | "custom" | "native"): string;
    disableGpu(value?: boolean): boolean;
    getIcon(): string | null;
    setIcon(path: string | null): string | null;
    relaunch(): void;
  };
  onError?(error: unknown): void;
}

export function createIpcHandlers(deps: IpcDeps): Record<string, IpcListener> {
  const { paths } = deps;
  const report = (error: unknown) => deps.onError?.(error);

  return {
    // --- Environment getters (sync) ---
    resources: (e) => (e.returnValue = paths.resources),
    version: (e) => (e.returnValue = paths.version),
    "desktop-dir": (e) => (e.returnValue = paths.desktopDir),
    "documents-dir": (e) => (e.returnValue = paths.documentsDir),
    "get-documents-path": (e) => (e.returnValue = paths.documentsDir),
    "get-sandbox-vault-path": (e) => (e.returnValue = paths.sandboxVaultPath),
    "get-default-vault-path": (e) => (e.returnValue = paths.defaultVaultPath),
    frame: (e, value) =>
      (e.returnValue = deps.appearance?.frame(
        value === "hidden" || value === "custom" || value === "native" ? value : undefined,
      )),
    "disable-gpu": (e, value) =>
      (e.returnValue = deps.appearance?.disableGpu(typeof value === "boolean" ? value : undefined)),
    "get-icon": (e) => (e.returnValue = deps.appearance?.getIcon() ?? null),
    "set-icon": (e, path) =>
      (e.returnValue = deps.appearance?.setIcon(typeof path === "string" ? path : null) ?? null),
    relaunch: (e) => {
      deps.appearance?.relaunch();
      e.returnValue = undefined;
    },

    // --- Boot handshake (sync) ---
    // Real Obsidian's `vault` answer carried {id, path} — which folder this
    // window IS. The workspace form (one window, multi-root) has no such
    // identity: `home` is where config lives — one directory for the whole
    // app, never inside any mount — and `mounts` is the e2e seed seam.
    vault: (e) => {
      const home = deps.paths.configHome;
      e.returnValue = deps.seedMounts?.length ? { home, mounts: deps.seedMounts } : { home };
    },

    // --- Actions ---
    // Real handler: async, sets returnValue only after shell.trashItem settles
    // (sendSync blocks the renderer until then), reporting the true outcome —
    // so a delete is strictly ordered and a failed trash never acks true.
    trash: async (e, pathArg) => {
      try {
        await deps.trashItem(pathArg as string);
        e.returnValue = true;
      } catch (error) {
        report(error);
        e.returnValue = false;
      }
    },
    "open-url": (_e, urlArg) => {
      if (typeof urlArg === "string") deps.openExternal(urlArg);
    },
    "request-url": (e, replyIdArg, paramsArg) => {
      const replyId = replyIdArg as string;
      deps
        .performRequest(paramsArg as RequestUrlParams)
        .then((result) => e.reply(replyId, result))
        .catch((error) => e.reply(replyId, { error }));
    },
    // `satisfies` binds this handler map to the shared IPC channel table: every
    // channel name here must be declared in @app/shared/ipc.ts.
  } satisfies Partial<Record<IpcChannelName, IpcListener>>;
}

export interface IpcMainLike {
  on(channel: string, listener: IpcListener): void;
}

export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcDeps): void {
  const handlers = createIpcHandlers(deps);
  for (const channel of Object.keys(handlers)) {
    ipcMain.on(channel, handlers[channel]);
  }
}
