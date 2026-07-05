import { ipcMain } from "electron";
import { mainState } from "./state";

/**
 * Boot-critical synchronous IPC channels.
 *
 * The renderer reads these during startup (`Platform.ts` → `file-url`,
 * `WorkspaceWindow.ts` → `is-quitting`, `AgentTransport.ts` → `loom-url`).
 * Registering them here keeps the very first paint clean. The *full* channel
 * table (vault*, trash, request-url, menu, dialogs, ...) is L5 — this file
 * only owns the channels the foundation itself is responsible for.
 */
export function registerFoundationIpc(): void {
  // Real: `s.ipcMain.on("file-url", t => t.returnValue = Be)`.
  ipcMain.on("file-url", (event) => {
    event.returnValue = mainState.fileUrlPrefix;
  });

  // Real: `s.ipcMain.on("is-quitting", t => t.returnValue = ye)`.
  ipcMain.on("is-quitting", (event) => {
    event.returnValue = mainState.isQuitting;
  });

  // Loom sidecar URL, if the desktop process spawned (or was pointed at) one.
  // Null when neither `LOOM_SIDECAR_BIN` nor `LOOM_EXTERNAL_URL` is set, or
  // while a spawned child hasn't printed its ready line yet — the renderer
  // falls back to its own default in that case.
  ipcMain.on("loom-url", (event) => {
    event.returnValue = mainState.loomUrl;
  });
}
