import { BrowserWindow } from "electron";
import { enable as enableRemote } from "@electron/remote/main";
import { resolveStarterUrl } from "./renderer-target";

/**
 * The starter (vault chooser) window — real symbols `Ze` (utility-window
 * factory) and `pe`/`le` (open-starter + module singleton).
 *
 * Faithful shape from the reverse of the real main bundle:
 * - `Ze`: 800x600 base, resizable/maximizable/fullscreenable all false,
 *   `show:false`, frameless with hidden titleBarStyle, backgroundColor
 *   #1e1e1e, webPreferences only `{contextIsolation:false, nodeIntegration:
 *   true}` (no webviewTag / worker node — those are vault-window-only),
 *   remote enabled, menu bar hidden.
 * - `pe()`: singleton — a second call restores+focuses instead of creating;
 *   overrides height to 650; `closed` clears the singleton; shown once
 *   `loadURL(se + "starter.html")` settles (fulfilled or rejected).
 *
 * The starter closes ITSELF: its renderer calls `window.close()` after a
 * `vault-open` sendSync returns true — main never force-closes it.
 *
 * Divergence: we pass our preload so the page gets the same `window.electron`
 * bridge the rest of the renderer uses (real starter.js requires electron
 * directly via nodeIntegration).
 */

export interface StarterWindowDeps {
  preloadPath: string;
}

let starterWindow: BrowserWindow | null = null;

/** Real `pe()` — open or focus the starter singleton. */
export function openStarter(deps: StarterWindowDeps): BrowserWindow {
  if (starterWindow && !starterWindow.isDestroyed()) {
    if (starterWindow.isMinimized()) starterWindow.restore();
    starterWindow.focus();
    return starterWindow;
  }
  const win = new BrowserWindow({
    width: 800,
    height: 650,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
      preload: deps.preloadPath,
    },
  });
  starterWindow = win;
  enableRemote(win.webContents);
  win.setMenuBarVisibility(false);
  win.on("closed", () => {
    starterWindow = null;
  });
  const reveal = () => {
    if (!win.isDestroyed()) win.show();
  };
  void win.loadURL(resolveStarterUrl()).then(reveal, reveal);
  return win;
}

/**
 * Whether the starter is currently open — backs the vault-window `closed`
 * parity rule (the persisted `open` flag survives closing the last vault
 * window unless the starter or another vault window remains).
 */
export function isStarterOpen(): boolean {
  return starterWindow !== null && !starterWindow.isDestroyed();
}
