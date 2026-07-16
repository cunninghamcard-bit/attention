import { describe, expect, it, vi } from "vitest";

const { fakeIpcRenderer, fakeShell, fakeWebUtils, fakeWebFrame, fakeWindow } = vi.hoisted(() => ({
  fakeIpcRenderer: { send: vi.fn(), sendSync: vi.fn(), on: vi.fn() },
  fakeShell: { showItemInFolder: vi.fn(), openExternal: vi.fn() },
  fakeWebUtils: { getPathForFile: vi.fn(() => "/abs/path") },
  fakeWebFrame: { getZoomLevel: vi.fn(() => 0), setZoomLevel: vi.fn() },
  fakeWindow: { id: 1, minimize: vi.fn(), isMaximized: vi.fn(() => false) },
}));

vi.mock("electron", () => ({
  ipcRenderer: fakeIpcRenderer,
  shell: fakeShell,
  webUtils: fakeWebUtils,
  webFrame: fakeWebFrame,
}));
vi.mock("@electron/remote", () => ({ getCurrentWindow: () => fakeWindow }));

import { installElectronBridge } from "@preload/preload";

describe("installElectronBridge", () => {
  it("exposes window.electron with ipcRenderer, shell, webUtils and webFrame", () => {
    const target = {} as typeof globalThis;
    installElectronBridge(target);
    const electron = (target as { electron?: Record<string, unknown> }).electron;
    expect(electron?.ipcRenderer).toBe(fakeIpcRenderer);
    expect(electron?.shell).toBe(fakeShell);
    expect(electron?.webUtils).toBe(fakeWebUtils);
    expect(electron?.webFrame).toBe(fakeWebFrame);
  });

  it("exposes window.electronWindow as the current BrowserWindow", () => {
    const target = {} as typeof globalThis;
    installElectronBridge(target);
    expect((target as { electronWindow?: unknown }).electronWindow).toBe(fakeWindow);
  });

  it("satisfies the renderer contract surface it probes for", () => {
    const target = {} as typeof globalThis;
    installElectronBridge(target);
    const electron = (
      target as {
        electron?: {
          ipcRenderer: typeof fakeIpcRenderer;
          shell: typeof fakeShell;
          webUtils: typeof fakeWebUtils;
        };
      }
    ).electron!;
    // Platform.ts / WorkspaceWindow.ts / FileSystemAdapter.ts
    expect(typeof electron.ipcRenderer.sendSync).toBe("function");
    expect(typeof electron.ipcRenderer.send).toBe("function");
    // App.ts / AttachmentImport.ts
    expect(typeof electron.shell.showItemInFolder).toBe("function");
    expect(typeof electron.webUtils.getPathForFile).toBe("function");
  });
});
