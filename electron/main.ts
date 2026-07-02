import { app, BrowserWindow, ipcMain, screen, shell } from "electron";
import { initialize as initializeRemote } from "@electron/remote/main";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
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
import { registerIpcHandlers } from "./ipc";
import { performNetRequest } from "./net-request";
import { handleObsidianUrl, obsidianUrlFromArgv } from "./obsidian-protocol";
import { registerSessionHardening } from "./session-hardening";
import { registerDesktopBridgeIpc } from "./desktop-bridge";
import { applyMenu, updateMenuItems } from "./menu";
import type { SystemMenuItem } from "../src/desktop/SystemMenuBuilder";

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

  // app.getPath throws for unconfigured locations; fall back to userData.
  const safePath = (name: "desktop" | "documents"): string => {
    try {
      return app.getPath(name);
    } catch {
      return app.getPath("userData");
    }
  };

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

  // First-run default vault. Real Obsidian shows a starter to pick a vault;
  // that page is a renderer seam here, so we create/open a real default folder
  // (`Documents/Obsidian Vault`, real `bt`) so the app opens on a real vault.
  const ensureDefaultVault = (): string | null => {
    const defaultPath =
      process.env.OBSIDIAN_VAULT_PATH || join(safePath("documents"), "Obsidian Vault");
    try {
      mkdirSync(defaultPath, { recursive: true });
    } catch (error) {
      console.error(error);
    }
    const result = registry.registerPath(defaultPath);
    return "id" in result ? result.id : null;
  };

  // Real `ke()`: reopen every vault persisted as open; otherwise open the
  // default vault window (falling back to a plain window if it can't be made).
  const openStartupWindows = () => {
    const opened = vaultWindows.openAllPersisted();
    if (opened > 0 || BrowserWindow.getAllWindows().length > 0) return;
    const defaultVaultId = ensureDefaultVault();
    if (defaultVaultId) vaultWindows.openVault(defaultVaultId);
    else createRendererWindow({ preloadPath: defaultPreloadPath(here) });
  };

  // Real `$e(url)` dispatch. Starter page is a renderer seam, so for
  // sync-setup/choose-vault we fall back to opening the app.
  const dispatchObsidianUrl = (url: string) =>
    handleObsidianUrl(url, {
      registry,
      vaultWindows,
      openStarter: openStartupWindows,
      showVaultNotFound: (u) => console.error(`No vault for URL ${u}`),
      isWindows: process.platform === "win32",
    });

  // A protocol URL may arrive before `whenReady` (real `Oe` capture).
  let pendingUrl: string | null = obsidianUrlFromArgv(process.argv);
  app.on("will-finish-launching", () => {
    app.once("open-url", (event, url) => {
      event.preventDefault();
      pendingUrl = url;
    });
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (app.isReady()) dispatchObsidianUrl(url);
    else pendingUrl = url;
  });

  app.on("second-instance", (_event, argv) => {
    const url = obsidianUrlFromArgv(argv);
    if (url) dispatchObsidianUrl(url);
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  if (!app.isDefaultProtocolClient("obsidian")) {
    app.setAsDefaultProtocolClient("obsidian");
  }

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
    registerSessionHardening();
    registerDesktopBridgeIpc();
    ipcMain.on("set-menu", (event, arg: { template: SystemMenuItem[] }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) applyMenu(win, arg.template);
    });
    ipcMain.on("update-menu-items", (_event, items: Parameters<typeof updateMenuItems>[0]) => {
      updateMenuItems(items);
    });
    registry.pruneMissing();
    registerFoundationIpc();
    registerIpcHandlers(ipcMain, {
      registry,
      vaultWindows,
      paths: {
        resources: resourcesDir,
        version: app.getVersion(),
        desktopDir: safePath("desktop"),
        documentsDir: safePath("documents"),
        sandboxVaultPath: join(app.getPath("userData"), "Obsidian Sandbox"),
        defaultVaultPath: join(safePath("documents"), "Obsidian Vault"),
      },
      trashItem: (p) => shell.trashItem(p),
      openExternal: (url) => void shell.openExternal(url),
      performRequest: performNetRequest,
      existsSync,
      mkdirp: (p) => void mkdirSync(p, { recursive: true }),
      onError: (error) => console.error(error),
    });
    openStartupWindows();
    if (pendingUrl) {
      dispatchObsidianUrl(pendingUrl);
      pendingUrl = null;
    }
  });
}
