import { BrowserWindow } from "electron";
import { enable as enableRemote } from "@electron/remote/main";
import type { JsonStore } from "./json-store";
import type { VaultRegistry } from "./vault-registry";
import {
  loadWindowState,
  resolveWindowBounds,
  saveWindowState,
  type DisplayProvider,
  type WindowState,
} from "./window-state";
import { OBSIDIAN_WEB_PREFERENCES } from "./window";
import { resolveRendererUrl } from "./renderer-target";

/** A vault window plus the mutable bookkeeping real Obsidian hangs off it. */
interface TrackedWindow {
  win: BrowserWindow;
  state: WindowState;
  focusTime: number;
  loaded: boolean;
}

export interface VaultWindowDeps {
  store: JsonStore;
  registry: VaultRegistry;
  displays: DisplayProvider;
  preloadPath: string;
  isQuitting: () => boolean;
}

/**
 * The vault-id → BrowserWindow map and window factory — real symbols `H` and
 * `de(id, focus)`, with the exact lifecycle from the reverse note:
 *
 * - open-or-focus: an existing window is restored/focused, not duplicated;
 * - created hidden with `fe()`-validated bounds and the faithful frameless
 *   options; shown on ready-to-show (maximize/devTools/zoom applied there);
 * - resize/move persist bounds debounced at 100ms; close persists state and
 *   force-destroys after 3s if the renderer holds the close;
 * - closed removes the window from the map and clears the registry `open`
 *   flag — except while quitting, so relaunch restores the same windows;
 * - focus stamps `focusTime`, which backs `ve()` (most-recent vault).
 */
export class VaultWindowManager {
  private readonly tracked = new Map<string, TrackedWindow>();

  constructor(private readonly deps: VaultWindowDeps) {}

  /** Real `de(vaultId, focus = true)`. */
  openVault(vaultId: string, focus = true): BrowserWindow {
    const existing = this.tracked.get(vaultId);
    if (existing && !existing.win.isDestroyed()) {
      if (focus) {
        if (existing.win.isMinimized()) existing.win.restore();
        existing.win.focus();
      }
      return existing.win;
    }

    const state = loadWindowState(this.deps.store, vaultId);
    const bounds = resolveWindowBounds(state, this.deps.displays);
    const win = new BrowserWindow({
      minWidth: 200,
      minHeight: 150,
      backgroundColor: "#00000000",
      trafficLightPosition: { x: 19, y: 12 },
      show: false,
      frame: false,
      titleBarStyle: "hidden",
      webPreferences: {
        ...OBSIDIAN_WEB_PREFERENCES,
        preload: this.deps.preloadPath,
      },
      ...bounds,
    });
    const entry: TrackedWindow = { win, state, focusTime: Date.now(), loaded: false };
    this.tracked.set(vaultId, entry);

    enableRemote(win.webContents);
    win.setMenuBarVisibility(false);

    // Shown once the renderer is ready (real `t()`): apply maximize/devTools/
    // zoom from the saved state, then reveal.
    let revealed = false;
    const reveal = () => {
      if (revealed || win.isDestroyed()) return;
      revealed = true;
      if (entry.state.isMaximized) win.maximize();
      if (entry.state.devTools) win.webContents.openDevTools();
      win.show();
      const zoom = entry.state.zoom;
      if (zoom && typeof zoom === "number") {
        void win.webContents.executeJavaScript(
          `require('electron').webFrame.setZoomLevel(${zoom})`,
        );
      }
    };

    win.webContents.on("did-finish-load", () => {
      entry.loaded = true;
    });
    win.on("focus", () => {
      entry.focusTime = Date.now();
    });

    // Real `o()` — capture live bounds into the state object.
    const captureState = () => {
      try {
        if (win.isDestroyed()) return;
        const rect = win.getBounds();
        const normal = !win.isMaximized() && !win.isMinimized() && !win.isFullScreen();
        if (normal) {
          entry.state.x = rect.x;
          entry.state.y = rect.y;
          entry.state.width = rect.width;
          entry.state.height = rect.height;
        }
        entry.state.isMaximized = win.isMaximized();
        entry.state.devTools = win.webContents.isDevToolsOpened();
        entry.state.zoom = win.webContents.zoomLevel;
      } catch {
        // Window mid-teardown — ignore.
      }
    };
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const captureSoon = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(captureState, 100);
    };
    win.on("resize", captureSoon);
    win.on("move", captureSoon);
    win.once("ready-to-show", reveal);

    win.on("close", (event) => {
      captureState();
      saveWindowState(this.deps.store, vaultId, entry.state);
      // Real: 3s failsafe destroy unless the close was default-prevented.
      setTimeout(() => {
        if (!event.defaultPrevented && !win.isDestroyed()) win.destroy();
      }, 3000);
    });
    win.on("closed", () => {
      this.tracked.delete(vaultId);
      if (!this.deps.isQuitting()) this.deps.registry.setOpen(vaultId, false);
    });

    void win.loadURL(resolveRendererUrl()).then(reveal, reveal);
    this.deps.registry.setOpen(vaultId, true);
    return win;
  }

  /** Real `ve()` — the open vault with the most recent focus. */
  mostRecentVaultId(): string | null {
    let bestId: string | null = null;
    let bestTime = -1;
    for (const [id, entry] of this.tracked) {
      if (entry.win.isDestroyed()) continue;
      if (entry.focusTime > bestTime) {
        bestTime = entry.focusTime;
        bestId = id;
      }
    }
    return bestId;
  }

  /** Whether a vault currently has a live window (backs vault-remove/move). */
  isOpen(vaultId: string): boolean {
    const entry = this.tracked.get(vaultId);
    return Boolean(entry && !entry.win.isDestroyed());
  }

  /** The vault id owning the given webContents (backs the `vault` IPC). */
  vaultIdForWebContents(webContentsId: number): string | null {
    for (const [id, entry] of this.tracked) {
      if (!entry.win.isDestroyed() && entry.win.webContents.id === webContentsId) return id;
    }
    return null;
  }

  get openCount(): number {
    return this.tracked.size;
  }

  /**
   * Real `ke()` (vault half): open every vault whose registry entry has
   * `open: true`. Returns how many windows were opened.
   */
  openAllPersisted(): number {
    let opened = 0;
    for (const id of Object.keys(this.deps.registry.vaults)) {
      if (this.deps.registry.vaults[id].open) {
        this.openVault(id);
        opened += 1;
      }
    }
    return opened;
  }
}
