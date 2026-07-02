import { app, BrowserWindow, screen } from "electron";
import { initialize as initializeRemote } from "@electron/remote/main";
import { join } from "node:path";
import { createRendererWindow, defaultPreloadPath } from "./window";
import { registerFoundationIpc } from "./foundation-ipc";
import { mainState } from "./state";
import { JsonStore } from "./json-store";
import { loadSettings, saveSettings } from "./settings";
import { VaultRegistry } from "./vault-registry";
import { VaultWindowManager } from "./vault-windows";
import type { DisplayProvider } from "./window-state";
import { createFileOrigin } from "./app-protocol";
import { registerAppProtocol, registerAppSchemePrivileges } from "./app-protocol-register";

/**
 * Electron main entry for the reconstructed Obsidian desktop app.
 *
 * Composition root: single-instance lock, app lifecycle, obsidian.json
 * settings + vault registry (L2), vault-window lifecycle (L3), the faithful
 * webPreferences and preload bridge (L0/L1). Later layers add the `app://`
 * protocol, the full IPC table, and `obsidian://` routing.
 */

// Bundled to `dist-electron/main.cjs`; `__dirname` therefore points at the
// build output dir where `preload.cjs` sits beside it.
const here = __dirname;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  initializeRemote();

  // Must run before app.ready: makes `app://` a standard/secure scheme so the
  // renderer served from app://obsidian.md/ is a secure context.
  registerAppSchemePrivileges();

  // Renderer bundle dir (unpackaged: repo `dist/`). Real symbol `c`.
  const resourcesDir = join(here, "..", "dist");
  // Real `Be`: the per-launch file-access origin returned by `file-url`.
  const fileOrigin = createFileOrigin();
  mainState.fileUrlPrefix = fileOrigin;

  const store = new JsonStore(join(app.getPath("userData")));
  const settings = loadSettings(store);
  const registry = new VaultRegistry(settings, store, () => saveSettings(store, settings));

  const displays: DisplayProvider = {
    getPrimaryWorkArea: () => screen.getPrimaryDisplay().workArea,
    getAllWorkAreas: () => screen.getAllDisplays().map((d) => d.workArea),
  };
  const vaultWindows = new VaultWindowManager({
    store,
    registry,
    displays,
    preloadPath: defaultPreloadPath(here),
    isQuitting: () => mainState.isQuitting,
  });

  // Real `ke()`: reopen every vault persisted as open; fall back to a plain
  // renderer window until the starter page exists (renderer seam).
  const openStartupWindows = () => {
    const opened = vaultWindows.openAllPersisted();
    if (opened === 0 && BrowserWindow.getAllWindows().length === 0) {
      createRendererWindow({ preloadPath: defaultPreloadPath(here) });
    }
  };

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
    mainState.isQuitting = false;
    if (BrowserWindow.getAllWindows().length === 0) openStartupWindows();
  });

  void app.whenReady().then(() => {
    registerAppProtocol({
      resourcesDir,
      fileOrigin,
      isWindows: process.platform === "win32",
    });
    registry.pruneMissing();
    registerFoundationIpc();
    openStartupWindows();
  });
}
