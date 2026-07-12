import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";

describe("Workspace event parity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
  });

  it("emits layout-ready before queued callbacks and runs late callbacks immediately", async () => {
    const app = new App(document.createElement("div"));
    const seen: string[] = [];

    app.workspace.on("layout-ready", () => seen.push("event"));
    app.workspace.onLayoutReady(() => seen.push("queued"));

    app.workspace.markLayoutReady();

    expect(seen).toEqual(["event"]);

    await app.workspace.waitForLayoutReadyCallbacks();

    expect(seen).toEqual(["event", "queued"]);

    app.workspace.onLayoutReady(() => seen.push("late"));

    expect(seen).toEqual(["event", "queued", "late"]);
  });

  it("routes main window resize events through the workspace resize request", async () => {
    const app = new App(document.createElement("div"));
    const resize = vi.fn();
    app.workspace.on("resize", resize);
    await new Promise((resolve) => setTimeout(resolve, 1));
    const before = resize.mock.calls.length;

    window.dispatchEvent(new Event("resize"));

    await vi.waitFor(() => expect(resize.mock.calls.length).toBeGreaterThan(before));
  });

  it("associates queued layout-ready callback failures with the loading plugin", async () => {
    const app = new App(document.createElement("div"));
    const error = new Error("layout failed");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    app.pluginInstaller.loadingPluginId = "layout-plugin";
    app.workspace.onLayoutReady(() => {
      throw error;
    });
    app.pluginInstaller.loadingPluginId = null;

    app.workspace.markLayoutReady();
    await app.workspace.waitForLayoutReadyCallbacks();

    expect(errorSpy).toHaveBeenCalledWith(
      "Plugin layout-plugin failed in onLayoutReady callback",
      error,
    );
  });
});
