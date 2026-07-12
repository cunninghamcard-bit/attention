import { afterEach, describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import type { AgentEvent } from "@web/builtin/agent/AgentEvent";
import { newAgentId } from "@web/builtin/agent/AgentManager";
import { ChatView } from "@web/builtin/agent/ChatView";

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

// Detach chat leaves so composer editors destroy with the test's window;
// CodeMirror otherwise schedules measure timers that outlive the file.
const apps: App[] = [];
function trackApp(app: App): App {
  apps.push(app);
  return app;
}
afterEach(() => {
  for (const app of apps.splice(0)) {
    for (const leaf of app.workspace.getLeavesOfType("chat")) leaf.detach();
  }
});

describe("Chat builtin", () => {
  it("registers the chat view and commands as builtins, not as a togglable core plugin", async () => {
    const app = trackApp(new App(document.createElement("div")));
    await app.ready;

    expect(app.internalPlugins.getPluginById("chat")).toBeNull();
    expect(app.viewRegistry.getViewCreatorByType("chat")).toBeTypeOf("function");

    app.commands.executeCommandById("agent:open");
    await nextFrame();
    const view = app.workspace.getActiveViewOfType(ChatView);
    expect(view).not.toBeNull();
    expect(view?.getViewType()).toBe("chat");
    expect(view?.getState()).toEqual({ agentId: "default" });
  });

  it("derives the tab title from the first user message, like file views derive it from the file", async () => {
    const app = trackApp(new App(document.createElement("div")));
    await app.ready;

    const agentId = newAgentId();
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: "chat", active: true, state: { agentId } });
    const view = app.workspace.getActiveViewOfType(ChatView);
    expect(view?.getDisplayText()).toBe(`Chat – ${agentId}`);

    const session = app.agents.get(agentId);
    const events: AgentEvent[] = [
      { type: "run.started", runId: "r1", seq: 1, agentId },
      { type: "message.started", messageId: "u1", role: "user", seq: 2, agentId },
      { type: "part.opened", messageId: "u1", partIndex: 0, partType: "text", seq: 3, agentId },
      { type: "part.delta", messageId: "u1", partIndex: 0, delta: "帮我看看这个架构设计的问题\n后面还有第二行", seq: 4, agentId },
    ];
    for (const event of events) session.applyEvent(event);
    await nextFrame();
    await nextFrame();

    expect(view?.getDisplayText()).toBe("帮我看看这个架构设计的问题");
    expect(leaf.tabHeaderInnerTitleEl.textContent).toBe("帮我看看这个架构设计的问题");
  });

  it("exposes a working stop command only while a run is active", async () => {
    const app = trackApp(new App(document.createElement("div")));
    await app.ready;

    const agentId = newAgentId();
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: "chat", active: true, state: { agentId } });

    const view = app.workspace.getActiveViewOfType(ChatView);
    expect(view?.isRunning()).toBe(false);

    const session = app.agents.get(agentId);
    session.applyEvent({ type: "run.started", runId: "r1", seq: 1, agentId });
    expect(view?.isRunning()).toBe(true);
    app.commands.executeCommandById("agent:stop");
    session.applyEvent({ type: "run.closed", runId: "r1", status: "aborted", seq: 2, agentId });
    expect(view?.isRunning()).toBe(false);
  });
});
