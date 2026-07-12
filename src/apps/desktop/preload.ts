import { ipcRenderer, shell, webUtils } from "electron";
import { getCurrentWindow } from "@electron/remote";
import { installTerminalBridge } from "./terminal-bridge";
import { installGitBridge } from "./git-bridge";

/**
 * Preload bridge — installs the exact globals the reconstructed renderer reads.
 *
 * Runs with `contextIsolation:false` + `nodeIntegration:true` (see
 * `OBSIDIAN_WEB_PREFERENCES`), so it assigns onto `window`/`globalThis`
 * directly, matching how the renderer probes for the bridge:
 *   - `Platform.ts`      → `window.electron.ipcRenderer.sendSync("file-url")`
 *   - `WorkspaceWindow`  → `window.electron.ipcRenderer.sendSync("is-quitting")`
 *   - `FileSystemAdapter`→ `window.electron.ipcRenderer.sendSync("trash", path)`
 *   - `DesktopMenu`      → `window.electron.ipcRenderer.send("set-menu" | "update-menu-items")`
 *   - `App.ts`           → `window.electron.shell.showItemInFolder(path)`
 *   - `AttachmentImport` → `window.electron.webUtils.getPathForFile(file)`
 *   - `FrameDom`         → `window.electronWindow.{minimize,maximize,isMaximized,...}`
 */

export interface ElectronBridgeApi {
  ipcRenderer: typeof ipcRenderer;
  shell: typeof shell;
  webUtils: typeof webUtils;
}

export function installElectronBridge(target: typeof globalThis): void {
  const api: ElectronBridgeApi = { ipcRenderer, shell, webUtils };
  // `window.electron` — the renderer's channel/shell entry point.
  Object.defineProperty(target, "electron", {
    value: api,
    configurable: true,
    enumerable: true,
    writable: false,
  });
  // `window.electronWindow` — remote proxy of this BrowserWindow, backing the
  // frameless titlebar controls (real Obsidian exposes it via `remote.enable`).
  Object.defineProperty(target, "electronWindow", {
    value: getCurrentWindow(),
    configurable: true,
    enumerable: true,
    writable: false,
  });
}

installElectronBridge(globalThis);
installTerminalBridge(globalThis);
installGitBridge(globalThis);
