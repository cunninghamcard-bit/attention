import { describe, expect, it } from "vitest";
import { App } from "../app/App";

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
});
