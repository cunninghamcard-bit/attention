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

    const { Platform } = await import("./Platform");

    expect(sendSync).toHaveBeenCalledWith("file-url");
    expect(Platform.resourcePathPrefix).toBe("app://obsidian/");
  });

  it("falls back to Obsidian's default file URL prefix outside desktop electron", async () => {
    vi.resetModules();
    delete (window as Window & { electron?: unknown }).electron;

    const { Platform } = await import("./Platform");

    expect(Platform.resourcePathPrefix).toBe("file:///");
  });
});
