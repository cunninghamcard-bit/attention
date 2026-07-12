import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { View } from "../View";

class ClearLayoutView extends View {
  getViewType(): string {
    return "clear-layout-test";
  }
}

describe("Workspace clearLayout parity", () => {
  beforeEach(() => {
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens existing leaves as empty views before removing the layout tree", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    app.viewRegistry.registerView("clear-layout-test", (leaf) => new ClearLayoutView(leaf));
    const leaf = app.workspace.getLeaf();
    await leaf.setViewState({ type: "clear-layout-test", active: true });
    const activeTabGroup = app.workspace.activeTabGroup;

    await app.workspace.clearLayout();

    expect(app.workspace.layoutReady).toBe(false);
    expect(app.workspace.activeLeaf).toBeNull();
    expect(app.workspace.activeTabGroup).toBeNull();
    expect(activeTabGroup?.containerEl.classList.contains("mod-active")).toBe(false);
    expect(leaf.parent).toBeNull();
    expect(leaf.view.getViewType()).toBe("empty");
    expect(app.workspace.rootSplit.children).toEqual([]);
    expect(app.workspace.leftSplit.children).toEqual([]);
    expect(app.workspace.rightSplit.children).toEqual([]);
    expect(app.workspace.floatingSplit.children).toEqual([]);
  });

  it("cancels pending layout-change notifications while clearing", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const events: string[] = [];
    vi.useFakeTimers();
    app.workspace.on("layout-change", () => events.push("layout-change"));

    app.workspace.onLayoutChange();
    await app.workspace.clearLayout();
    await vi.advanceTimersByTimeAsync(20);

    expect(events).toEqual([]);
  });

  it("clears the old layout before applying changeLayout", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    app.viewRegistry.registerView("clear-layout-test", (leaf) => new ClearLayoutView(leaf));
    const oldLeaf = app.workspace.getLeaf();
    await oldLeaf.setViewState({ type: "clear-layout-test", active: true });

    await app.workspace.changeLayout({
      active: "new-leaf",
      main: {
        id: "new-root",
        type: "split",
        direction: "vertical",
        children: [
          {
            id: "new-tabs",
            type: "tabs",
            currentTab: 0,
            children: [{ id: "new-leaf", type: "leaf", state: { type: "empty" } }],
          },
        ],
      },
    });

    expect(app.workspace.layoutReady).toBe(true);
    expect(oldLeaf.parent).toBeNull();
    expect(oldLeaf.view.getViewType()).toBe("empty");
    expect(app.workspace.activeLeaf?.id).toBe("new-leaf");
    expect(app.workspace.getLeafById("new-leaf")).not.toBeNull();
  });
});
