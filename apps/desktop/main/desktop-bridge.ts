import { dialog, ipcMain, BrowserWindow } from "electron";
import { performNetRequest } from "./net-request";
import { listSystemFontFamilies } from "./system-fonts";

/**
 * Main-process handlers for the renderer's NativeBridge channels (dialog,
 * fullscreen, request-url, get-fonts). The renderer forwards these via
 * `window.electron.ipcRenderer.invoke` when running under Electron; in the
 * browser/tests they fall back to the in-process mocks in `apps/web/platform/native`.
 */

export interface OpenDialogOptions {
  title?: string;
  directory?: boolean;
  multiple?: boolean;
  extensions?: string[];
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  extensions?: string[];
}

export function toOpenProperties(
  opts: OpenDialogOptions,
): Array<"openFile" | "openDirectory" | "multiSelections"> {
  if (opts.directory) return ["openDirectory"];
  return opts.multiple ? ["openFile", "multiSelections"] : ["openFile"];
}

export function toFilters(
  extensions?: string[],
): Array<{ name: string; extensions: string[] }> | undefined {
  return extensions && extensions.length > 0 ? [{ name: "Files", extensions }] : undefined;
}

export function registerDesktopBridgeIpc(): void {
  ipcMain.handle("dialog:open", async (event, opts: OpenDialogOptions = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: opts.title,
      properties: toOpenProperties(opts),
      filters: toFilters(opts.extensions),
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("dialog:save", async (event, opts: SaveDialogOptions = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: opts.title,
      defaultPath: opts.defaultPath,
      filters: toFilters(opts.extensions),
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    return result.canceled ? null : (result.filePath ?? null);
  });

  ipcMain.handle("window:set-fullscreen", (event, value: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setFullScreen(Boolean(value));
  });

  ipcMain.handle("request-url", (_event, params: Parameters<typeof performNetRequest>[0]) =>
    performNetRequest(params),
  );

  // Obsidian: require("get-fonts").getFonts() — same seam name, open-source impl.
  ipcMain.handle("get-fonts", () => listSystemFontFamilies());
}
