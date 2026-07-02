import { app, BrowserWindow } from "electron";
import { initialize as initializeRemote } from "@electron/remote/main";
import { createRendererWindow, defaultPreloadPath } from "./window";
import { registerFoundationIpc } from "./foundation-ipc";
import { mainState } from "./state";

/**
 * Electron main entry for the reconstructed Obsidian desktop app.
 *
 * L0 scope: single-instance lock, app lifecycle, one renderer window with the
 * faithful `webPreferences`, `@electron/remote` wiring, and the boot-critical
 * IPC channels. Later layers extend this into the full vault-window factory
 * (`de`), `app://` protocol, `obsidian://` routing, and complete IPC table.
 */

// Bundled to `dist-electron/main.cjs`; `__dirname` therefore points at the
// build output dir where `preload.cjs` sits beside it.
const here = __dirname;

// Single-instance lock (reverse note: `app.requestSingleInstanceLock()`); a
// second launch focuses the existing window instead of starting a new process.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  initializeRemote();

  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on("before-quit", () => {
    mainState.isQuitting = true;
  });

  // macOS: quit only on explicit Cmd+Q (reverse note `window-all-closed`).
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createRendererWindow({ preloadPath: defaultPreloadPath(here) });
    }
  });

  void app.whenReady().then(() => {
    registerFoundationIpc();
    createRendererWindow({ preloadPath: defaultPreloadPath(here) });
  });
}
