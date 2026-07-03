import { BrowserWindow } from "electron";
import { enable as enableRemote } from "@electron/remote/main";
import { join } from "node:path";
import { resolveRendererUrl } from "./renderer-target";

/**
 * Faithful `webPreferences` for an Obsidian renderer window.
 *
 * Copied from the reverse note (`decode-obsidian/.../electron-main-api.md`,
 * vault window factory `de`): Obsidian runs the renderer with full Node
 * integration and no context isolation. The reconstructed renderer relies on
 * this exact shape — `Platform.ts` does `require("electron")`, and
 * `FileSystemAdapter` dynamically imports `node:fs`. Do not "harden" these to
 * the modern secure defaults; that would break the renderer contract.
 */
export const OBSIDIAN_WEB_PREFERENCES = {
  contextIsolation: false,
  nodeIntegration: true,
  nodeIntegrationInWorker: true,
  // Non-sandboxed so the renderer gets a CommonJS `require` (FileSystemAdapter
  // loads node:fs/path through it). Real Obsidian's renderer is non-sandboxed.
  sandbox: false,
  spellcheck: true,
  webviewTag: true,
} as const;

/**
 * Faithful base BrowserWindow options (reverse note `de`): frameless with a
 * hidden titlebar, transparent background, macOS traffic-light inset, shown
 * only after the renderer is ready. Bounds restore (`fe`) and per-vault state
 * arrive in L3; here we use the documented defaults.
 */
export interface CreateWindowOptions {
  preloadPath: string;
}

export function createRendererWindow(options: CreateWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1024,
    height: 800,
    minWidth: 200,
    minHeight: 150,
    backgroundColor: "#00000000",
    trafficLightPosition: { x: 19, y: 12 },
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      ...OBSIDIAN_WEB_PREFERENCES,
      preload: options.preloadPath,
    },
  });

  // Real Obsidian `Z(webContents)` == `remote.enable(webContents)`: gives the
  // renderer a remote proxy of this BrowserWindow, exposed by the preload as
  // `window.electronWindow` (minimize/maximize/isMaximized/... contract).
  enableRemote(win.webContents);

  win.setMenuBarVisibility(false);

  // Shown on ready-to-show (reverse note: window is created with `show:false`
  // and revealed once the renderer paints, avoiding a white flash).
  win.once("ready-to-show", () => win.show());

  void win.loadURL(resolveRendererUrl());
  return win;
}

/** Absolute path to the built preload script for a packaged/dev main process. */
export function defaultPreloadPath(dirname: string): string {
  return join(dirname, "preload.cjs");
}
