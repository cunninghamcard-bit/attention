import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import type { AgentEvent } from "./AgentEvent";
import { AgentPropertiesView, AGENT_PROPERTIES_VIEW_TYPE } from "./AgentPropertiesView";

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

describe("AgentPropertiesView", () => {
  it("renders the agent's sections and live state", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;

    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: AGENT_PROPERTIES_VIEW_TYPE, active: true, state: { agentId: "a-77" } });
    const view = app.workspace.getActiveViewOfType(AgentPropertiesView)!;
    expect(view).not.toBeNull();

    const agent = app.agents.get("a-77");
    const feed = (events: Array<Omit<AgentEvent, "agentId">>) =>
      events.forEach((event) => agent.applyEvent({ ...event, agentId: "a-77" } as AgentEvent));

    feed([
      { type: "run.started", runId: "r1", seq: 1 },
      { type: "message.started", messageId: "u1", role: "user", seq: 2 },
      { type: "message.closed", messageId: "u1", seq: 3 },
    ] as never);
    await nextFrame();

    const el = view.contentEl;
    const sections = [...el.querySelectorAll(".agent-view-section")].map((s) => (s as HTMLElement).dataset.section);
    expect(sections).toEqual(["identity", "status", "activity", "config", "actions"]);
    expect(el.querySelector('[data-prop="id"] .agent-prop-value')?.textContent).toBe("a-77");
    expect(el.querySelector('[data-prop="state"] .agent-prop-value')?.textContent).toBe("Running");
    expect(el.querySelector('[data-prop="messages"] .agent-prop-value')?.textContent).toBe("1");

    feed([
      {
        type: "run.closed", runId: "r1", status: "completed", seq: 4,
        usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.01 },
      },
    ] as never);
    await nextFrame();
    expect(el.querySelector('[data-prop="state"] .agent-prop-value')?.textContent).toBe("Idle");
    expect(el.querySelector('[data-prop="usage"] .agent-prop-value')?.textContent).toBe("1.5k tokens · $0.010");
    expect(view.getDisplayText()).toBe("Agent – a-77");
  });
});
