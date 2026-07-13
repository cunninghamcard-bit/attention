import { resolve } from "node:path";
import type { VaultRegistry } from "./vault-registry";
import type { IpcChannelName } from "../shared/ipc";

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
  registry: VaultRegistry;
  vaultWindows: {
    openVault(id: string, focus?: boolean): unknown;
    isOpen(id: string): boolean;
    vaultIdForWebContents(webContentsId: number): string | null;
  };
  paths: {
    resources: string;
    version: string;
    desktopDir: string;
    documentsDir: string;
    sandboxVaultPath: string;
    defaultVaultPath: string;
  };
  /** Open-or-focus the starter (vault chooser) window — real `pe()`. */
  openStarter(): void;
  /** shell.trashItem — real `trash` handler. */
  trashItem(path: string): Promise<void>;
  /** shell.openExternal — real `open-url` for external schemes. */
  openExternal(url: string): void;
  /** net.request wrapper — real `request-url`. */
  performRequest(params: RequestUrlParams): Promise<RequestUrlResult>;
  existsSync(path: string): boolean;
  mkdirp(path: string): void;
  onError?(error: unknown): void;
}

export function createIpcHandlers(deps: IpcDeps): Record<string, IpcListener> {
  const { registry, vaultWindows, paths } = deps;
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

    // --- Vault registry (sync) ---
    vault: (e) => {
      const id = vaultWindows.vaultIdForWebContents(e.sender.id);
      e.returnValue = id ? { id, path: resolve(registry.vaults[id].path) } : {};
    },
    "vault-list": (e) => (e.returnValue = registry.vaults),
    "vault-open": (e, pathArg, createArg) => {
      const path = pathArg as string;
      if (createArg) {
        if (deps.existsSync(path)) {
          e.returnValue = "Vault already exists";
          return;
        }
        try {
          deps.mkdirp(path);
        } catch (error) {
          e.returnValue = String(error);
          return;
        }
      }
      const result = registry.registerPath(path);
      if ("error" in result) {
        e.returnValue = result.error;
        return;
      }
      vaultWindows.openVault(result.id);
      e.returnValue = true;
    },
    "vault-remove": (e, pathArg) => {
      e.returnValue = registry.removeByPath(pathArg as string, (id) => vaultWindows.isOpen(id));
    },
    "vault-move": (e, fromArg, toArg) => {
      e.returnValue = registry.moveByPath(fromArg as string, toArg as string, (id) =>
        vaultWindows.isOpen(id),
      );
    },

    // Real: `ipcMain.on("starter", t => { t.returnValue = null; pe() })` —
    // sync so openVaultChooser callers can `window.close()` right after.
    starter: (e) => {
      e.returnValue = null;
      deps.openStarter();
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
    // channel name here must be declared in src/shared/ipc.ts.
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
