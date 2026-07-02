import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { CHAT_THREADS_VIEW_TYPE, ChatThreadsView } from "./ChatThreadsView";
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
      if (String(input).endsWith("/threads")) {
        return new Response(JSON.stringify({ threads }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    }),
  );
}

describe("ChatThreadsView", () => {
  it("registers as a builtin side view and lists bridge threads", async () => {
    stubThreads([
      { id: "thread-a", title: "聊架构设计", updatedAt: Date.now() - 90_000, running: true },
      { id: "thread-b", title: null, updatedAt: Date.now() - 7_200_000, running: false },
    ]);
    const app = new App(document.createElement("div"));
    apps.push(app);
    await app.ready;
    expect(app.viewRegistry.getViewCreatorByType(CHAT_THREADS_VIEW_TYPE)).toBeTypeOf("function");

    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: CHAT_THREADS_VIEW_TYPE, active: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const view = leaf.view as ChatThreadsView;
    expect(view.getDisplayText()).toBe("Chat threads");
    const items = [...view.contentEl.querySelectorAll(".chat-thread-item")];
    expect(items).toHaveLength(2);
    expect(items[0].querySelector(".chat-thread-title")?.textContent).toContain("聊架构设计");
    expect(items[0].querySelector(".chat-thread-running")).not.toBeNull();
    expect(items[1].querySelector(".chat-thread-title")?.textContent).toContain("thread-b");
    expect(items[1].querySelector(".chat-thread-time")?.textContent).toBe("2h ago");
  });

  it("opens the clicked thread in a chat leaf", async () => {
    stubThreads([{ id: "thread-open-me", title: "旧对话", updatedAt: Date.now(), running: false }]);
    const app = new App(document.createElement("div"));
    apps.push(app);
    await app.ready;

    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: CHAT_THREADS_VIEW_TYPE, active: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    ((leaf.view as ChatThreadsView).contentEl.querySelector(".chat-thread-item") as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const chatView = app.workspace.getActiveViewOfType(ChatView);
    expect(chatView?.getState()).toEqual({ threadId: "thread-open-me" });
  });
});
