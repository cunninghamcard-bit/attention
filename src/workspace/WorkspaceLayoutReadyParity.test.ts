import { describe, expect, it } from "vitest";
import { App } from "../app/App";
import { View } from "../views/View";

class LayoutReadyView extends View {
  getViewType(): string {
    return "layout-ready-test";
  }
}

describe("Workspace layout-ready parity", () => {
  it("does not await promises returned from queued onLayoutReady callbacks", async () => {
    const app = new App(document.createElement("div"));
    const calls: string[] = [];
    app.workspace.onLayoutReady(() => {
      calls.push("hung");
      return new Promise<void>(() => {});
    }, "hung-plugin");
    app.workspace.onLayoutReady(() => {
      calls.push("after");
    }, "after-plugin");

    app.workspace.markLayoutReady();
    const result = await Promise.race([
      app.workspace.waitForLayoutReadyCallbacks().then(() => "resolved"),
      new Promise<string>((resolve) => window.setTimeout(() => resolve("timed-out"), 20)),
    ]);

    expect(result).toBe("resolved");
    expect(calls).toEqual(["hung", "after"]);
  });

  it("emits layout-ready before visible deferred leaves materialize and layoutReady flips", async () => {
    const app = new App(document.createElement("div"));
    const seen: Array<{ deferred: boolean | null; ready: boolean }> = [];
    app.viewRegistry.registerView("layout-ready-test", (leaf) => new LayoutReadyView(leaf));
    app.workspace.on("layout-ready", () => {
      const leaf = app.workspace.getLeavesOfType("layout-ready-test")[0];
      seen.push({
        deferred: leaf?.isDeferred ?? null,
        ready: app.workspace.isLayoutReady(),
      });
    });

    await app.workspace.setLayout({
      active: "layout-ready-leaf",
      main: {
        id: "layout-ready-root",
        type: "split",
        direction: "vertical",
        children: [{
          id: "layout-ready-leaf",
          type: "leaf",
          state: { type: "layout-ready-test", state: {} },
        }],
      },
    });
    const leaf = app.workspace.getLeavesOfType("layout-ready-test")[0];

    expect(seen).toEqual([{ deferred: true, ready: false }]);
    expect(leaf?.isDeferred).toBe(false);
    expect(app.workspace.isLayoutReady()).toBe(true);
  });
});
