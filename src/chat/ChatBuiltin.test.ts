import { describe, expect, it } from "vitest";
import { App } from "../app/App";
import type { ChatEvent } from "./ChatEvent";
import { newChatThreadId } from "./ChatBuiltin";
import { getChatSession } from "./ChatSession";
import { ChatTransport } from "./ChatTransport";
import { ChatView } from "./ChatView";

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

describe("Chat builtin", () => {
  it("registers the chat view and commands as builtins, not as a togglable core plugin", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;

    expect(app.internalPlugins.getPluginById("chat")).toBeNull();
    expect(app.viewRegistry.getViewCreatorByType("chat")).toBeTypeOf("function");

    app.commands.executeCommandById("chat:open");
    await nextFrame();
    const view = app.workspace.getActiveViewOfType(ChatView);
    expect(view).not.toBeNull();
    expect(view?.getViewType()).toBe("chat");
    expect(view?.getState()).toEqual({ threadId: "default" });
  });

  it("derives the tab title from the first user message, like file views derive it from the file", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;

    const threadId = newChatThreadId();
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: "chat", active: true, state: { threadId } });
    const view = app.workspace.getActiveViewOfType(ChatView);
    expect(view?.getDisplayText()).toBe(`Chat – ${threadId}`);

    const session = getChatSession(threadId, new ChatTransport());
    const events: ChatEvent[] = [
      { type: "run.started", runId: "r1", seq: 1, threadId },
      { type: "message.started", messageId: "u1", role: "user", seq: 2, threadId },
      { type: "part.opened", messageId: "u1", partIndex: 0, partType: "text", seq: 3, threadId },
      { type: "part.delta", messageId: "u1", partIndex: 0, delta: "帮我看看这个架构设计的问题\n后面还有第二行", seq: 4, threadId },
    ];
    for (const event of events) session.applyEvent(event);
    await nextFrame();
    await nextFrame();

    expect(view?.getDisplayText()).toBe("帮我看看这个架构设计的问题");
    expect(leaf.tabHeaderInnerTitleEl.textContent).toBe("帮我看看这个架构设计的问题");
  });

  it("exposes a working stop command only while a run is active", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;

    const threadId = newChatThreadId();
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: "chat", active: true, state: { threadId } });

    const view = app.workspace.getActiveViewOfType(ChatView);
    expect(view?.isRunning()).toBe(false);

    const session = getChatSession(threadId, new ChatTransport());
    session.applyEvent({ type: "run.started", runId: "r1", seq: 1, threadId });
    expect(view?.isRunning()).toBe(true);
    app.commands.executeCommandById("chat:stop");
    session.applyEvent({ type: "run.closed", runId: "r1", status: "aborted", seq: 2, threadId });
    expect(view?.isRunning()).toBe(false);
  });
});
