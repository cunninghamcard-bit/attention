import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { AGENTS_VIEW_TYPE, AgentsView } from "./AgentsView";
import { ChatView } from "./ChatView";

const apps: App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) {
    for (const leaf of app.workspace.getLeavesOfType("chat")) leaf.detach();
  }
  vi.unstubAllGlobals();
});

beforeEach(() => {
  Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
});

function stubThreads(threads: Array<{ id: string; title: string | null; updatedAt: number; running: boolean }>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/agents")) {
        return new Response(JSON.stringify({ agents: threads }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    }),
  );
}

describe("AgentsView", () => {
  it("registers as a builtin side view and lists bridge threads", async () => {
    stubThreads([
      { id: "thread-a", title: "聊架构设计", updatedAt: Date.now() - 90_000, running: true },
      { id: "thread-b", title: null, updatedAt: Date.now() - 7_200_000, running: false },
    ]);
    const app = new App(document.createElement("div"));
    apps.push(app);
    await app.ready;
    expect(app.viewRegistry.getViewCreatorByType(AGENTS_VIEW_TYPE)).toBeTypeOf("function");

    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: AGENTS_VIEW_TYPE, active: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const view = leaf.view as AgentsView;
    expect(view.getDisplayText()).toBe("Agents");
    const items = [...view.contentEl.querySelectorAll(".agent-item")];
    expect(items).toHaveLength(2);
    expect(items[0].querySelector(".agent-item-title")?.textContent).toContain("聊架构设计");
    expect(items[0].querySelector(".agent-item-running")).not.toBeNull();
    expect(items[1].querySelector(".agent-item-title")?.textContent).toContain("thread-b");
    expect(items[1].querySelector(".agent-item-time")?.textContent).toBe("2h ago");
  });

  it("opens the clicked thread in a chat leaf", async () => {
    stubThreads([{ id: "thread-open-me", title: "旧对话", updatedAt: Date.now(), running: false }]);
    const app = new App(document.createElement("div"));
    apps.push(app);
    await app.ready;

    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: AGENTS_VIEW_TYPE, active: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    ((leaf.view as AgentsView).contentEl.querySelector(".agent-item") as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const chatView = app.workspace.getActiveViewOfType(ChatView);
    expect(chatView?.getState()).toEqual({ agentId: "thread-open-me" });
  });
});
