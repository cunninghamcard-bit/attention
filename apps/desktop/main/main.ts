import { app, BrowserWindow, ipcMain, nativeImage, screen, shell } from "electron";
import { initialize as initializeRemote } from "@electron/remote/main";
import { join } from "node:path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { defaultPreloadPath } from "./window";
import { isStarterOpen, openStarter } from "./starter-window";
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
import type { SystemMenuItem } from "@app/shared/menu";
import { CliServer, defaultCliSocketPath } from "./cli/CliServer";
import { runCliClient } from "./cli/CliClient";
import { dispatchCli } from "./cli/CliDispatch";

// The CLI args this instance was launched with — real Obsidian's `f(argv)`.
// In dev (`electron .`) the executable and script lead argv[0..1]; packaged,
// only the executable leads.
function cliArgvFromProcess(argv: string[]): string[] {
  return process.defaultApp ? argv.slice(2) : argv.slice(1);
}

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

// Our own identity: userData resolves to ~/Library/Application Support/Workbench
// (etc.), never the generic Electron dir and never anything of real Obsidian's.
// Must run before the first app.getPath("userData").
app.setName("Workbench");
// Hermetic-test seam (mirrors E2E_VAULT_PATH): an isolated userData also
// isolates the single-instance lock, so e2e runs never touch the real profile.
if (process.env.E2E_USER_DATA) app.setPath("userData", process.env.E2E_USER_DATA);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // The primary instance owns the app; this one becomes the CLI client —
  // connect to its socket, relay argv/cwd, print the response, exit. (Real
  // Obsidian's `!requestSingleInstanceLock()` branch; replaces app.quit().)
  runCliClient(defaultCliSocketPath(), cliArgvFromProcess(process.argv), process.cwd());
} else {
  initializeRemote();

  // Must run before app.ready: makes `app://` a standard/secure scheme so the
  // renderer served from app://obsidian.md/ is a secure context.
  registerAppSchemePrivileges();

  // Renderer bundle dir (unpackaged: sibling out/web). Real symbol `c`.
  const resourcesDir = join(here, "..", "web");
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
  if (settings.disableGpu) app.disableHardwareAcceleration();
  const customIconPath = join(app.getPath("userData"), "custom-icon.png");
  const configuredIconPath = (): string | undefined =>
    settings.icon && existsSync(customIconPath) ? customIconPath : undefined;
  const getCustomIcon = (): string | null => {
    const path = configuredIconPath();
    if (!path) return null;
    const image = nativeImage.createFromPath(path);
    return image.isEmpty() ? null : image.toDataURL();
  };
  const applyCustomIcon = (): void => {
    const path = configuredIconPath();
    if (!path) return;
    const image = nativeImage.createFromPath(path);
    if (image.isEmpty()) return;
    app.dock?.setIcon(image);
    for (const win of BrowserWindow.getAllWindows()) win.setIcon(image);
  };
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
    // Workbench product divergence: the CLI is ON by default (an agent
    // workbench wants its command surface always up); real Obsidian defaults
    // off behind Settings > General > Advanced. `cli: false` still gates.
    isCliEnabled: () => settings.cli !== false,
    isStarterOpen,
    frameStyle: () => settings.frame ?? "hidden",
    iconPath: configuredIconPath,
  });

  const openStarterWindow = () => openStarter({ preloadPath: defaultPreloadPath(here) });

  // Hermetic-test seam: E2E_VAULT_PATH pins a vault that is created and
  // opened directly, so e2e runs land in a window without driving the starter.
  const ensureSeededVault = (): string | null => {
    const seededPath = process.env.E2E_VAULT_PATH;
    if (!seededPath) return null;
    try {
      mkdirSync(seededPath, { recursive: true });
    } catch (error) {
      console.error(error);
    }
    const result = registry.registerPath(seededPath);
    return "id" in result ? result.id : null;
  };

  // Real `ke()`: reopen every vault persisted as open; zero windows means the
  // starter (vault chooser) comes up instead.
  const openStartupWindows = () => {
    const opened = vaultWindows.openAllPersisted();
    if (opened > 0 || BrowserWindow.getAllWindows().length > 0) return;
    const seededVaultId = ensureSeededVault();
    if (seededVaultId) vaultWindows.openVault(seededVaultId);
    else openStarterWindow();
  };

  // Real `$e(url)` dispatch — sync-setup/choose-vault open the starter.
  const dispatchObsidianUrl = (url: string) =>
    handleObsidianUrl(url, {
      registry,
      vaultWindows,
      openStarter: openStarterWindow,
      showVaultNotFound: (u) => console.error(`No vault for URL ${u}`),
      isWindows: process.platform === "win32",
    });

  // The CLI socket server (real `Ve`): dispatches each request to a vault
  // renderer via `window.handleCli`. All transport lives in CliServer; the
  // deps here are the app's real vault routing and window bridge.
  const cliServer = new CliServer(
    (request) =>
      dispatchCli(request, {
        getIdByName: (name) => registry.getIdByName(name),
        getIdByContainedPath: (path) => registry.getIdByContainedPath(path),
        mostRecentVaultId: () => vaultWindows.mostRecentVaultId(),
        // Real `C.cli` gate, kept verbatim in shape — but Workbench defaults it ON
        // (deliberate product divergence; set `cli: false` in obsidian.json to
        // disable, same persisted flag as real Obsidian).
        isCliEnabled: () => settings.cli !== false,
        // Real second-instance-no-args behavior is `pe()` — the starter itself.
        openStarter: openStarterWindow,
        handleUrl: (url) => {
          dispatchObsidianUrl(url);
          return `Processed URI ${url}`;
        },
        executeCliRequest: (vaultId, argv) => vaultWindows.executeCliRequest(vaultId, argv),
      }),
    defaultCliSocketPath(),
  );

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

  // Our own scheme. Registering "obsidian" would hijack the real app's links
  // at the OS level; obsidian:// URLs arriving via the CLI/second instance are
  // still parsed internally.
  if (!app.isDefaultProtocolClient("workbench")) {
    app.setAsDefaultProtocolClient("workbench");
  }

  app.on("before-quit", () => {
    mainState.isQuitting = true;
    cliServer.stop();
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
      openStarter: openStarterWindow,
      paths: {
        resources: resourcesDir,
        version: app.getVersion(),
        desktopDir: safePath("desktop"),
        documentsDir: safePath("documents"),
        sandboxVaultPath: join(app.getPath("userData"), "Workbench Sandbox"),
        defaultVaultPath: join(safePath("documents"), "Workbench Vault"),
      },
      trashItem: (p) => shell.trashItem(p),
      openExternal: (url) => void shell.openExternal(url),
      performRequest: performNetRequest,
      existsSync,
      mkdirp: (p) => void mkdirSync(p, { recursive: true }),
      appearance: {
        frame: (value) => {
          if (value) {
            settings.frame = value;
            saveSettings(store, settings);
          }
          return settings.frame ?? "hidden";
        },
        disableGpu: (value) => {
          if (value !== undefined) {
            settings.disableGpu = value;
            saveSettings(store, settings);
          }
          return Boolean(settings.disableGpu);
        },
        getIcon: getCustomIcon,
        setIcon: (path) => {
          if (!path) {
            rmSync(customIconPath, { force: true });
            delete settings.icon;
            saveSettings(store, settings);
            return null;
          }
          const image = nativeImage.createFromPath(path);
          if (image.isEmpty()) return getCustomIcon();
          writeFileSync(customIconPath, image.toPNG());
          settings.icon = "custom-icon.png";
          saveSettings(store, settings);
          applyCustomIcon();
          return image.toDataURL();
        },
        relaunch: () => {
          app.relaunch();
          app.quit();
        },
      },
      onError: (error) => console.error(error),
    });
    applyCustomIcon();
    openStartupWindows();
    cliServer.start();
    if (pendingUrl) {
      dispatchObsidianUrl(pendingUrl);
      pendingUrl = null;
    }
  });
}
