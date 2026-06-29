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
      new Promise<string>((resolve) => window.setTimeout(() => resolve("timed-out"), 200)),
    ]);

    expect(result).toBe("resolved");
    expect(calls).toEqual(["hung", "after"]);
  });

  it("emits layout-ready from loadLayout after visible deferred leaves materialize and layoutReady flips", async () => {
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

    await app.workspaceLayouts.writeWorkspaceFile({
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
    await app.workspace.loadLayout();
    const leaf = app.workspace.getLeavesOfType("layout-ready-test")[0];

    expect(seen).toEqual([{ deferred: false, ready: true }]);
    expect(leaf?.isDeferred).toBe(false);
    expect(app.workspace.isLayoutReady()).toBe(true);
  });

  it("does not emit layout-ready again for direct setLayout calls after startup", async () => {
    const app = new App(document.createElement("div"));
    let readyEvents = 0;
    app.workspace.on("layout-ready", () => {
      readyEvents += 1;
    });
    app.workspace.markLayoutReady();
    await app.workspace.waitForLayoutReadyCallbacks();

    await app.workspace.setLayout({});

    expect(readyEvents).toBe(1);
  });

  it("queues onLayoutReady callbacks registered during layout-ready until a later task", async () => {
    const app = new App(document.createElement("div"));
    const calls: string[] = [];
    app.workspace.on("layout-ready", () => {
      calls.push("event");
      app.workspace.onLayoutReady(() => calls.push("queued-in-event"));
      queueMicrotask(() => calls.push("microtask"));
      calls.push("event-end");
    });

    app.workspace.markLayoutReady();

    expect(calls).toEqual(["event", "event-end"]);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(calls).toEqual(["event", "event-end", "microtask"]);
    await app.workspace.waitForLayoutReadyCallbacks();
    expect(calls).toEqual(["event", "event-end", "microtask", "queued-in-event"]);
  });
});
