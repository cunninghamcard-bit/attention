import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { FakeBrowserWindow, enableRemote } = vi.hoisted(() => {
  const enableRemote = vi.fn();
/**
 * A minimal in-memory BrowserWindow standing in for Electron's, with just the
 * surface VaultWindowManager touches. Event emitter semantics included.
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
    on: vi.fn(),
    executeJavaScript: vi.fn(() => Promise.resolve()),
    openDevTools: vi.fn(),
    isDevToolsOpened: () => false,
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
      this.listeners.set(event, list.filter((h) => h !== wrapped));
    };
    return this.on(event, wrapped);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const handler of [...(this.listeners.get(event) ?? [])]) handler(...args);
  }

  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  isMaximized() { return this.maximized; }
  isFullScreen() { return this.fullScreen; }
  getBounds() { return this.bounds; }
  restore() { this.minimized = false; }
  focus() { this.focused = true; }
  show() { this.shown = true; }
  maximize() { this.maximized = true; }
  setMenuBarVisibility(visible: boolean) { this.menuBarVisible = visible; }
  loadURL(url: string) { this.loadedUrl = url; return Promise.resolve(); }
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

import { JsonStore } from "./json-store";
import { VaultRegistry } from "./vault-registry";
import { VaultWindowManager } from "./vault-windows";
import { saveWindowState, type DisplayProvider } from "./window-state";
import type { ObsidianSettings } from "./settings";

const DISPLAYS: DisplayProvider = {
  getPrimaryWorkArea: () => ({ x: 0, y: 25, width: 1512, height: 944 }),
  getAllWorkAreas: () => [{ x: 0, y: 25, width: 1512, height: 944 }],
};

let dir: string;
let store: JsonStore;
let registry: VaultRegistry;
let manager: VaultWindowManager;
let quitting: boolean;
let vaultId: string;

beforeEach(() => {
  vi.useFakeTimers();
  FakeBrowserWindow.instances = [];
  quitting = false;
  dir = fs.mkdtempSync(join(tmpdir(), "vault-windows-"));
  const vaultPath = join(dir, "Vault");
  fs.mkdirSync(vaultPath);
  store = new JsonStore(join(dir, "userData"));
  const settings: ObsidianSettings = {};
  registry = new VaultRegistry(settings, store, () => {});
  vaultId = (registry.registerPath(vaultPath) as { id: string }).id;
  manager = new VaultWindowManager({
    store,
    registry,
    displays: DISPLAYS,
    preloadPath: "/tmp/preload.cjs",
    isQuitting: () => quitting,
  });
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("VaultWindowManager (real de/H/ve)", () => {
  it("creates a hidden frameless window with the faithful options", () => {
    manager.openVault(vaultId);
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

  it("open-or-focus: a second openVault focuses instead of duplicating", () => {
    const first = manager.openVault(vaultId);
    const again = manager.openVault(vaultId);
    expect(again).toBe(first);
    expect(FakeBrowserWindow.instances).toHaveLength(1);
    expect((first as unknown as InstanceType<typeof FakeBrowserWindow>).focused).toBe(true);
  });

  it("marks the vault open in the registry, and closed on window close", () => {
    manager.openVault(vaultId);
    expect(registry.vaults[vaultId].open).toBe(true);
    (FakeBrowserWindow.instances[0]).close();
    expect(registry.vaults[vaultId].open).toBeUndefined();
    expect(manager.openCount).toBe(0);
  });

  it("keeps the open flag while quitting so relaunch restores windows", () => {
    manager.openVault(vaultId);
    quitting = true;
    FakeBrowserWindow.instances[0].close();
    expect(registry.vaults[vaultId].open).toBe(true);
  });

  it("restores saved bounds and applies maximize/zoom on reveal", () => {
    saveWindowState(store, vaultId, { x: 50, y: 60, width: 900, height: 700, isMaximized: true, zoom: 1.5 });
    manager.openVault(vaultId);
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

  it("persists bounds on close (real o() capture)", () => {
    manager.openVault(vaultId);
    const win = FakeBrowserWindow.instances[0];
    win.bounds = { x: 111, y: 222, width: 1000, height: 750 };
    win.close();
    const saved = store.read<Record<string, unknown>>(vaultId, {});
    expect(saved.x).toBe(111);
    expect(saved.width).toBe(1000);
  });

  it("debounces resize/move captures at 100ms", () => {
    manager.openVault(vaultId);
    const win = FakeBrowserWindow.instances[0];
    win.bounds = { x: 1, y: 2, width: 640, height: 480 };
    win.emit("resize");
    win.emit("move");
    vi.advanceTimersByTime(99);
    win.emit("resize");
    vi.advanceTimersByTime(100);
    // State captured in memory; persisted on close.
    win.close();
    expect(store.read<Record<string, unknown>>(vaultId, {}).width).toBe(640);
  });

  it("tracks the most recently focused vault (real ve)", () => {
    const secondPath = join(dir, "Vault2");
    fs.mkdirSync(secondPath);
    const secondId = (registry.registerPath(secondPath) as { id: string }).id;

    vi.setSystemTime(1000);
    manager.openVault(vaultId);
    vi.setSystemTime(2000);
    manager.openVault(secondId);
    expect(manager.mostRecentVaultId()).toBe(secondId);

    vi.setSystemTime(3000);
    FakeBrowserWindow.instances[0].emit("focus");
    expect(manager.mostRecentVaultId()).toBe(vaultId);
  });

  it("reopens persisted-open vaults (real ke)", () => {
    registry.setOpen(vaultId, true);
    expect(manager.openAllPersisted()).toBe(1);
    expect(FakeBrowserWindow.instances).toHaveLength(1);
    expect(manager.isOpen(vaultId)).toBe(true);
  });

  it("maps webContents ids back to vault ids (backs the vault IPC)", () => {
    manager.openVault(vaultId);
    const win = FakeBrowserWindow.instances[0];
    expect(manager.vaultIdForWebContents(win.webContents.id)).toBe(vaultId);
    expect(manager.vaultIdForWebContents(99999)).toBeNull();
  });
});
