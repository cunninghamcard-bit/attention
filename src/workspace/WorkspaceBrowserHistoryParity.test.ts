import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../app/App";
import { View, type ViewStateResult } from "../views/View";

class BrowserHistoryView extends View {
  navigation = true;
  private payload: Record<string, unknown> = {};

  getViewType(): string {
    return "browser-history-test";
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    this.payload = state && typeof state === "object" && !Array.isArray(state) ? state as Record<string, unknown> : {};
    if (result) result.history = true;
  }

  getState(): Record<string, unknown> {
    return this.payload;
  }
}

function historyBack(): Promise<boolean | undefined> {
  return (window.history.back as unknown as () => Promise<boolean | undefined>)();
}

function historyForward(): Promise<boolean | undefined> {
  return (window.history.forward as unknown as () => Promise<boolean | undefined>)();
}

function historyGo(delta: number): Promise<boolean | undefined> {
  return (window.history.go as unknown as (delta: number) => Promise<boolean | undefined>)(delta);
}

describe("Workspace browser history parity", () => {
  beforeEach(() => {
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  it("routes window.history back, forward, and go through the active leaf history", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("browser-history-test", (leaf) => new BrowserHistoryView(leaf));
    const leaf = app.workspace.getLeaf();
    await leaf.setViewState({ type: "browser-history-test", state: { step: 1 }, active: true });
    await leaf.setViewState({ type: "browser-history-test", state: { step: 2 }, active: true });
    await leaf.setViewState({ type: "browser-history-test", state: { step: 3 }, active: true });

    expect(await historyBack()).toBe(true);
    expect(leaf.view.getState()).toEqual({ step: 2 });

    expect(await historyBack()).toBe(true);
    expect(leaf.view.getState()).toEqual({ step: 1 });

    expect(await historyForward()).toBe(true);
    expect(leaf.view.getState()).toEqual({ step: 2 });

    expect(await historyGo(1)).toBe(true);
    expect(leaf.view.getState()).toEqual({ step: 3 });
  });
});
