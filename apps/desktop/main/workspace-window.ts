/**
 * Input: electron, @electron/remote/main, ./json-store, ./window-state, ./window, ./renderer-target, ./obsidian-url
 * Output: WorkspaceWindowDeps, WorkspaceWindow
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { BrowserWindow } from "electron";
import { enable as enableRemote } from "@electron/remote/main";
import type { JsonStore } from "./json-store";
import {
  loadWindowState,
  resolveWindowBounds,
  saveWindowState,
  type DisplayProvider,
  type WindowState,
} from "./window-state";
import { denyChildWindows, OBSIDIAN_WEB_PREFERENCES } from "./window";
import { resolveRendererUrl } from "./renderer-target";
import { buildObsActScript, type ObsidianAction } from "./obsidian-url";

/**
 * THE window. The product form is one multi-root workspace — Home plus every
 * mounted repository under a single namespace — so the app has exactly one
 * window to open, focus, deliver URL actions to, and run CLI requests in.
 *
 * Deviation from real Obsidian, recorded in docs/architecture.md: the
 * vault-id-keyed window map (real `H`/`de(id, focus)`), the registry, and
 * switchVault are replaced by this single window. The window CHROME — faithful
 * frameless options, hidden-until-ready reveal, bounds/maximize/zoom/devTools
 * persistence, the 3s close failsafe — is kept verbatim from that machinery;
 * only the multiplicity is gone. Window geometry persists under one fixed key
 * instead of per vault id.
 */

/** The state-file key: one window, one geometry file (userData/workspace.json). */
const WINDOW_STATE_KEY = "workspace";

interface TrackedWindow {
  win: BrowserWindow;
  state: WindowState;
  loaded: boolean;
}

export interface WorkspaceWindowDeps {
  store: JsonStore;
  displays: DisplayProvider;
  preloadPath: string;
  isQuitting: () => boolean;
  // The CLI-enable gate (real `C.cli`). `executeCliRequest` re-checks it —
  // real `Xe` gates independently of `et`. Absent (tests) means enabled.
  isCliEnabled?: () => boolean;
  frameStyle?: () => string;
  iconPath?: () => string | undefined;
}

export class WorkspaceWindow {
  private tracked: TrackedWindow | null = null;

  constructor(private readonly deps: WorkspaceWindowDeps) {}

  /** Open-or-focus the workspace window. */
  open(focus = true): BrowserWindow {
    const existing = this.tracked;
    if (existing && !existing.win.isDestroyed()) {
      if (focus) {
        if (existing.win.isMinimized()) existing.win.restore();
        existing.win.focus();
      }
      return existing.win;
    }

    const state = loadWindowState(this.deps.store, WINDOW_STATE_KEY);
    const bounds = resolveWindowBounds(state, this.deps.displays);
    const nativeFrame = this.deps.frameStyle?.() === "native";
    const win = new BrowserWindow({
      minWidth: 200,
      minHeight: 150,
      backgroundColor: "#00000000",
      trafficLightPosition: { x: 19, y: 12 },
      show: false,
      frame: nativeFrame,
      ...(nativeFrame ? {} : { titleBarStyle: "hidden" as const }),
      icon: this.deps.iconPath?.(),
      webPreferences: {
        ...OBSIDIAN_WEB_PREFERENCES,
        preload: this.deps.preloadPath,
      },
      ...bounds,
    });
    const entry: TrackedWindow = { win, state, loaded: false };
    this.tracked = entry;

    enableRemote(win.webContents);
    denyChildWindows(win);
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
    // Menu/pinch zoom updates webContents.zoomLevel; capture so restarts restore it.
    win.webContents.on("zoom-changed", captureSoon);
    win.once("ready-to-show", reveal);

    win.on("close", (event) => {
      captureState();
      saveWindowState(this.deps.store, WINDOW_STATE_KEY, entry.state);
      // Real: 3s failsafe destroy unless the close was default-prevented.
      setTimeout(() => {
        if (!event.defaultPrevented && !win.isDestroyed()) win.destroy();
      }, 3000);
    });
    win.on("closed", () => {
      if (this.tracked === entry) this.tracked = null;
    });

    void win.loadURL(resolveRendererUrl()).then(reveal, reveal);
    return win;
  }

  /** Whether the workspace window is currently live. */
  get isOpen(): boolean {
    return Boolean(this.tracked && !this.tracked.win.isDestroyed());
  }

  /**
   * Real `it(...)` minus the vault half: open-or-get the window and inject the
   * `OBS_ACT` payload, deferring to `did-finish-load` if it hasn't loaded yet.
   */
  deliverAction(action: ObsidianAction): void {
    const win = this.open(false);
    const entry = this.tracked;
    if (!entry) return;
    const script = buildObsActScript(action);
    if (entry.loaded) {
      void win.webContents.executeJavaScript(script);
    } else {
      win.webContents.once("did-finish-load", () => {
        void win.webContents.executeJavaScript(script);
      });
    }
  }

  /**
   * Real `Xe(vaultId, argv)` minus the routing: run one CLI request in the
   * workspace renderer and return the text to write back to the socket. A
   * loaded window runs `window.handleCli(argv)` now, an unloaded one queues
   * onto `window.cliQueue` and drains when the renderer installs the global
   * (`app.cli.init`). A CLI request against a closed window OPENS it, exactly
   * as a request against a closed vault did. A thrown string surfaces as
   * `Error: <string>` (the reference's catch clause).
   */
  async executeCliRequest(argv: string[]): Promise<string> {
    // Gate ② (real Xe checks C.cli again, independent of et's gate ①).
    if (this.deps.isCliEnabled && !this.deps.isCliEnabled()) {
      return "Command line interface is not enabled. Please turn it on in Settings > General > Advanced.";
    }
    const win = this.open(false);
    const entry = this.tracked;
    if (!entry) return "Workspace window unavailable.";
    const script = `
      new Promise((resolve, reject) => {
        let argv = ${JSON.stringify(argv)};
        if (window.handleCli) {
          Promise.resolve(window.handleCli(argv)).then(resolve, reject);
        } else {
          window.cliQueue = window.cliQueue || [];
          window.cliQueue.push({ argv, resolve, reject });
        }
      })
    `;
    const run = (): Promise<string> => win.webContents.executeJavaScript(script) as Promise<string>;
    try {
      if (entry.loaded) return await run();
      return await new Promise<string>((resolve, reject) => {
        win.webContents.once("did-finish-load", () => run().then(resolve, reject));
      });
    } catch (error) {
      return typeof error === "string" ? `Error: ${error}` : String(error);
    }
  }
}
