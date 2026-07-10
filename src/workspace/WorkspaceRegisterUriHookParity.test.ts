import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import type { ObsidianProtocolData } from "../protocol/UriRouter";

describe("Workspace registerUriHook parity", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
    vi.spyOn(console, "log").mockImplementation(() => {});
    delete (window as { OBS_ACT?: unknown }).OBS_ACT;
    delete (window as { electron?: unknown }).electron;
  });

  afterEach(() => {
    delete (window as { OBS_ACT?: unknown }).OBS_ACT;
    delete (window as { electron?: unknown }).electron;
    vi.restoreAllMocks();
  });

  it("replaces pending window.OBS_ACT with the runtime URL action hook", async () => {
    const pending: ObsidianProtocolData = { action: "plugin-action", source: "startup" };
    (window as { OBS_ACT?: ObsidianProtocolData }).OBS_ACT = pending;
    const app = new App(document.createElement("div"));
    const handler = vi.fn();
    app.workspace.registerObsidianProtocolHandler("plugin-action", handler);

    app.workspace.registerUriHook();

    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(pending));
    expect(typeof (window as { OBS_ACT?: unknown }).OBS_ACT).toBe("function");
  });

  it("routes native appUrlOpen events into workspace protocol handlers", async () => {
    let appUrlOpen: ((event: { url?: string }) => void) | null = null;
    (window as { electron?: unknown }).electron = {
      addListener: vi.fn((_name: "appUrlOpen", callback: (event: { url?: string }) => void) => {
        appUrlOpen = callback;
        return { remove: vi.fn() };
      }),
    };
    const app = new App(document.createElement("div"));
    const handler = vi.fn();
    app.workspace.registerObsidianProtocolHandler("plugin-action", handler);

    app.workspace.registerUriHook();
    appUrlOpen?.({ url: "arkloop://plugin-action?source=native&empty" });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({
      action: "plugin-action",
      source: "native",
      empty: "true",
    }));
  });
});
