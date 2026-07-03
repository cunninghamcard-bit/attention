import { afterEach, describe, expect, it } from "vitest";
import { App } from "../app/App";
import type { AgentEvent } from "./AgentEvent";
import { MULTI_AGENT_VIEW_TYPE, MultiAgentView } from "./MultiAgentView";

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

const apps: App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) {
    for (const leaf of app.workspace.getLeavesOfType(MULTI_AGENT_VIEW_TYPE)) leaf.detach();
  }
});

describe("MultiAgentView", () => {
  it("renders authored messages and derives the participants strip", async () => {
    const app = new App(document.createElement("div"));
    apps.push(app);
    await app.ready;

    const roomId = "room-42";
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: MULTI_AGENT_VIEW_TYPE, active: true, state: { agentId: roomId } });
    const view = app.workspace.getActiveViewOfType(MultiAgentView)!;
    expect(view.getDisplayText()).toBe("Room – room-42");

    const agent = app.agents.get(roomId);
    const events: AgentEvent[] = [
      { type: "run.started", runId: "r1", seq: 1, agentId: roomId },
      { type: "message.started", messageId: "m1", role: "assistant", authorId: "researcher", authorName: "研究员", seq: 2, agentId: roomId },
      { type: "part.opened", messageId: "m1", partIndex: 0, partType: "text", seq: 3, agentId: roomId },
      { type: "part.delta", messageId: "m1", partIndex: 0, delta: "背景已查明。", seq: 4, agentId: roomId },
      { type: "part.closed", messageId: "m1", partIndex: 0, seq: 5, agentId: roomId },
      { type: "message.closed", messageId: "m1", seq: 6, agentId: roomId },
      { type: "message.started", messageId: "m2", role: "assistant", authorId: "coder", authorName: "工程师", seq: 7, agentId: roomId },
      { type: "message.closed", messageId: "m2", seq: 8, agentId: roomId },
    ];
    for (const event of events) agent.applyEvent(event);
    await nextFrame();
    await nextFrame();

    const el = view.contentEl;
    const labels = [...el.querySelectorAll(".chat-message-role")].map((n) => n.textContent);
    expect(labels).toEqual(["研究员", "工程师"]);
    expect((el.querySelector('.chat-message[data-author-id="researcher"]') as HTMLElement | null)).not.toBeNull();

    const chips = [...el.querySelectorAll(".multi-agent-chip")].map((n) => n.textContent);
    expect(chips).toEqual(["You", "研究员", "工程师"]);
  });
});
