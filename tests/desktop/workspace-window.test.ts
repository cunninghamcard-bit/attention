import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { FakeBrowserWindow, enableRemote } = vi.hoisted(() => {
  const enableRemote = vi.fn();
  /**
   * A minimal in-memory BrowserWindow standing in for Electron's, with just
   * the surface WorkspaceWindow touches. Event emitter semantics included,
   * on the window and on its webContents (did-finish-load drives the CLI and
   * OBS_ACT deferral).
   */
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];
    static nextWebContentsId = 100;

    options: Record<string, unknown>;
    destroyed = false;
    minimized = false;
    maximized = false;
    fullScreen = false;
    shown = false;
    focused = false;
    bounds = { x: 10, y: 20, width: 800, height: 600 };
    loadedUrl: string | null = null;
    menuBarVisible = true;
    webContents = {
      id: FakeBrowserWindow.nextWebContentsId++,
      zoomLevel: 0,
      listeners: new Map<string, Array<(...args: unknown[]) => void>>(),
      on(event: string, handler: (...args: unknown[]) => void) {
        const list = this.listeners.get(event) ?? [];
        list.push(handler);
        this.listeners.set(event, list);
      },
      once(event: string, handler: (...args: unknown[]) => void) {
        const wrapped = (...args: unknown[]) => {
          handler(...args);
          this.listeners.set(
            event,
            (this.listeners.get(event) ?? []).filter((h) => h !== wrapped),
          );
        };
        this.on(event, wrapped);
      },
      emit(event: string, ...args: unknown[]) {
        // oxlint-disable-next-line unicorn/no-useless-spread -- Handlers may unsubscribe while emitting, so the fake preserves snapshot semantics.
        for (const handler of [...(this.listeners.get(event) ?? [])]) handler(...args);
      },
      executeJavaScript: vi.fn<(script: string) => Promise<unknown>>(() =>
        Promise.resolve(undefined),
      ),
      openDevTools: vi.fn(),
      isDevToolsOpened: () => false,
      setWindowOpenHandler: vi.fn(),
      reload: vi.fn(),
    };
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      FakeBrowserWindow.instances.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
      const list = this.listeners.get(event) ?? [];
      list.push(handler);
      this.listeners.set(event, list);
      return this;
    }
    once(event: string, handler: (...args: unknown[]) => void): this {
      const wrapped = (...args: unknown[]) => {
        handler(...args);
        const list = this.listeners.get(event) ?? [];
        this.listeners.set(
          event,
          list.filter((h) => h !== wrapped),
        );
      };
      return this.on(event, wrapped);
    }
    emit(event: string, ...args: unknown[]): void {
      // oxlint-disable-next-line unicorn/no-useless-spread -- Handlers may unsubscribe while emitting, so the fake preserves snapshot semantics.
      for (const handler of [...(this.listeners.get(event) ?? [])]) handler(...args);
    }

    isDestroyed() {
      return this.destroyed;
    }
    isMinimized() {
      return this.minimized;
    }
    isMaximized() {
      return this.maximized;
    }
    isFullScreen() {
      return this.fullScreen;
    }
    getBounds() {
      return this.bounds;
    }
    restore() {
      this.minimized = false;
    }
    focus() {
      this.focused = true;
    }
    show() {
      this.shown = true;
    }
    maximize() {
      this.maximized = true;
    }
    setMenuBarVisibility(visible: boolean) {
      this.menuBarVisible = visible;
    }
    loadURL(url: string) {
      this.loadedUrl = url;
      return Promise.resolve();
    }
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
    close() {
      this.emit("close", { defaultPrevented: false });
      this.destroy();
    }
  }
  return { FakeBrowserWindow, enableRemote };
});

vi.mock("electron", () => ({ BrowserWindow: FakeBrowserWindow }));
vi.mock("@electron/remote/main", () => ({ enable: enableRemote, initialize: vi.fn() }));

import { JsonStore } from "@desktop/json-store";
import { WorkspaceWindow } from "@desktop/workspace-window";
import { saveWindowState, type DisplayProvider } from "@desktop/window-state";

const DISPLAYS: DisplayProvider = {
  getPrimaryWorkArea: () => ({ x: 0, y: 25, width: 1512, height: 944 }),
  getAllWorkAreas: () => [{ x: 0, y: 25, width: 1512, height: 944 }],
};

let dir: string;
let store: JsonStore;
let workspace: WorkspaceWindow;
let quitting: boolean;
let cliEnabled: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  FakeBrowserWindow.instances = [];
  quitting = false;
  cliEnabled = true;
  dir = fs.mkdtempSync(join(tmpdir(), "workspace-window-"));
  store = new JsonStore(join(dir, "userData"));
  workspace = new WorkspaceWindow({
    store,
    displays: DISPLAYS,
    preloadPath: "/tmp/preload.cjs",
    isQuitting: () => quitting,
    isCliEnabled: () => cliEnabled,
  });
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("WorkspaceWindow", () => {
  it("creates a hidden frameless window with the faithful options", () => {
    workspace.open();
    const [win] = FakeBrowserWindow.instances;
    expect(win.options.show).toBe(false);
    expect(win.options.frame).toBe(false);
    expect(win.options.titleBarStyle).toBe("hidden");
    expect(win.options.backgroundColor).toBe("#00000000");
    expect(win.options.trafficLightPosition).toEqual({ x: 19, y: 12 });
    const prefs = win.options.webPreferences as Record<string, unknown>;
    expect(prefs.contextIsolation).toBe(false);
    expect(prefs.nodeIntegration).toBe(true);
    expect(prefs.preload).toBe("/tmp/preload.cjs");
    expect(enableRemote).toHaveBeenCalledWith(win.webContents);
    expect(win.menuBarVisible).toBe(false);
    expect(win.loadedUrl).toBeTruthy();
  });

  it("applies desktop appearance settings", () => {
    const configured = new WorkspaceWindow({
      store,
      displays: DISPLAYS,
      preloadPath: "/tmp/preload.cjs",
      isQuitting: () => quitting,
      frameStyle: () => "native",
      iconPath: () => "/tmp/custom-icon.png",
    });

    configured.open();
    const [win] = FakeBrowserWindow.instances;
    expect(win.options.frame).toBe(true);
    expect(win.options.titleBarStyle).toBeUndefined();
    expect(win.options.icon).toBe("/tmp/custom-icon.png");
  });

  it("open-or-focus: a second open focuses instead of duplicating", () => {
    const first = workspace.open();
    const again = workspace.open();
    expect(again).toBe(first);
    expect(FakeBrowserWindow.instances).toHaveLength(1);
    expect((first as unknown as InstanceType<typeof FakeBrowserWindow>).focused).toBe(true);
  });

  it("reopens after the window closes", () => {
    workspace.open();
    FakeBrowserWindow.instances[0].close();
    expect(workspace.isOpen).toBe(false);
    workspace.open();
    expect(FakeBrowserWindow.instances).toHaveLength(2);
    expect(workspace.isOpen).toBe(true);
  });

  it("restores saved bounds and applies maximize/zoom on reveal", () => {
    // One window, one geometry file: state lives under the fixed key.
    saveWindowState(store, "workspace", {
      x: 50,
      y: 60,
      width: 900,
      height: 700,
      isMaximized: true,
      zoom: 1.5,
    });
    workspace.open();
    const win = FakeBrowserWindow.instances[0];
    expect(win.options.x).toBe(50);
    expect(win.options.width).toBe(900);
    win.emit("ready-to-show");
    expect(win.maximized).toBe(true);
    expect(win.shown).toBe(true);
    expect(win.webContents.executeJavaScript).toHaveBeenCalledWith(
      "require('electron').webFrame.setZoomLevel(1.5)",
    );
  });

  it("persists bounds on close under the fixed key (real o() capture)", () => {
    workspace.open();
    const win = FakeBrowserWindow.instances[0];
    win.bounds = { x: 111, y: 222, width: 1000, height: 750 };
    win.close();
    const saved = store.read<Record<string, unknown>>("workspace", {});
    expect(saved.x).toBe(111);
    expect(saved.width).toBe(1000);
  });

  it("debounces resize/move captures at 100ms", () => {
    workspace.open();
    const win = FakeBrowserWindow.instances[0];
    win.bounds = { x: 1, y: 2, width: 640, height: 480 };
    win.emit("resize");
    win.emit("move");
    vi.advanceTimersByTime(99);
    win.emit("resize");
    vi.advanceTimersByTime(100);
    // State captured in memory; persisted on close.
    win.close();
    expect(store.read<Record<string, unknown>>("workspace", {}).width).toBe(640);
  });
});

describe("WorkspaceWindow CLI + OBS_ACT delivery", () => {
  it("runs handleCli in a loaded renderer and returns its text", async () => {
    workspace.open();
    const win = FakeBrowserWindow.instances[0];
    win.webContents.emit("did-finish-load");
    win.webContents.executeJavaScript.mockResolvedValueOnce("help text");
    await expect(workspace.executeCliRequest(["version"])).resolves.toBe("help text");
    const script = win.webContents.executeJavaScript.mock.calls.at(-1)?.[0] as string;
    expect(script).toContain('["version"]');
    expect(script).toContain("window.handleCli");
  });

  it("opens the window for a CLI request and defers to did-finish-load", async () => {
    // A request against a closed window OPENS it, exactly as a request
    // against a closed vault did.
    expect(workspace.isOpen).toBe(false);
    const pending = workspace.executeCliRequest(["version"]);
    expect(workspace.isOpen).toBe(true);
    const win = FakeBrowserWindow.instances[0];
    win.webContents.executeJavaScript.mockResolvedValueOnce("late");
    win.webContents.emit("did-finish-load");
    await expect(pending).resolves.toBe("late");
  });

  it("keeps gate ②: the disabled text without touching the renderer", async () => {
    cliEnabled = false;
    await expect(workspace.executeCliRequest(["version"])).resolves.toContain("not enabled");
    expect(FakeBrowserWindow.instances).toHaveLength(0);
  });

  it("wraps a thrown string as Error: (the reference's catch clause)", async () => {
    workspace.open();
    const win = FakeBrowserWindow.instances[0];
    win.webContents.emit("did-finish-load");
    win.webContents.executeJavaScript.mockRejectedValueOnce("no such command");
    await expect(workspace.executeCliRequest(["nope"])).resolves.toBe("Error: no such command");
  });

  it("delivers OBS_ACT to the window, deferring until loaded", () => {
    workspace.deliverAction({ action: "open", file: "Home/Note.md" });
    const win = FakeBrowserWindow.instances[0];
    // Not loaded yet: nothing injected until did-finish-load.
    expect(win.webContents.executeJavaScript).not.toHaveBeenCalled();
    win.webContents.emit("did-finish-load");
    const script = win.webContents.executeJavaScript.mock.calls.at(-1)?.[0] as string;
    expect(script).toContain("OBS_ACT");
    expect(script).toContain("Home/Note.md");
  });
});
