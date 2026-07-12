import { afterEach, describe, expect, it, vi } from "vitest";

describe("Platform runtime contract", () => {
  afterEach(() => {
    vi.resetModules();
    delete (window as Window & { electron?: unknown }).electron;
  });

  it("hydrates resourcePathPrefix from Obsidian's desktop electron bridge", async () => {
    vi.resetModules();
    const sendSync = vi.fn((channel: string) => channel === "file-url" ? "app://obsidian/" : "");
    (window as Window & { electron?: unknown }).electron = { ipcRenderer: { sendSync } };

    const { Platform } = await import("@web/platform/Platform");

    expect(sendSync).toHaveBeenCalledWith("file-url");
    expect(Platform.resourcePathPrefix).toBe("app://obsidian/");
  });

  it("falls back to Obsidian's default file URL prefix outside desktop electron", async () => {
    vi.resetModules();
    delete (window as Window & { electron?: unknown }).electron;

    const { Platform } = await import("@web/platform/Platform");

    expect(Platform.resourcePathPrefix).toBe("file:///");
  });

  it("matches Obsidian by deriving desktop OS flags from navigator.appVersion", async () => {
    vi.resetModules();
    const originalAppVersion = window.navigator.appVersion;
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "appVersion", { configurable: true, value: "5.0 (Windows NT 10.0)" });
    Object.defineProperty(window.navigator, "platform", { configurable: true, value: "MacIntel" });

    try {
      const { Platform } = await import("@web/platform/Platform");

      expect(Platform.isWin).toBe(true);
      expect(Platform.isMacOS).toBe(false);
      expect(Platform.isLinux).toBe(false);
    } finally {
      Object.defineProperty(window.navigator, "appVersion", { configurable: true, value: originalAppVersion });
      Object.defineProperty(window.navigator, "platform", { configurable: true, value: originalPlatform });
    }
  });
});
