import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { AGENT_VIEW_TYPE, AgentView } from "./AgentView";

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
});

function stubAgents(agents: Array<{ id: string; title: string | null; updatedAt: number; running: boolean }>): void {
  const threads = agents.map((a) => ({ id: a.id, title: a.title ?? "", updatedAt: a.updatedAt, running: a.running }));
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

describe("AgentView", () => {
  it("renders one card per agent with status and actions", async () => {
    stubAgents([
      { id: "a-1", title: "重构讨论", updatedAt: Date.now() - 60_000, running: true },
      { id: "a-2", title: null, updatedAt: Date.now() - 7_200_000, running: false },
    ]);
    const app = new App(document.createElement("div"));
    await app.ready;
    expect(app.viewRegistry.getViewCreatorByType(AGENT_VIEW_TYPE)).toBeTypeOf("function");

    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: AGENT_VIEW_TYPE, active: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const view = leaf.view as AgentView;
    expect(view.getDisplayText()).toBe("Agent board");
    const cards = [...view.contentEl.querySelectorAll(".agent-card")];
    expect(cards).toHaveLength(2);
    expect((cards[0] as HTMLElement).dataset.agentId).toBe("a-1");
    expect(cards[0].classList.contains("is-running")).toBe(true);
    expect(cards[0].querySelector(".agent-card-title")?.textContent).toBe("重构讨论");
    expect(cards[0].querySelector(".agent-card-state")?.textContent).toBe("Running");
    expect(cards[1].querySelector(".agent-card-title")?.textContent).toBe("a-2");
    expect([...cards[0].querySelectorAll(".agent-card-action")].map((el) => el.textContent)).toEqual(["Chat", "Properties"]);
    leaf.detach();
  });

  it("shows the empty state when the bridge has no agents", async () => {
    stubAgents([]);
    const app = new App(document.createElement("div"));
    await app.ready;
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: AGENT_VIEW_TYPE, active: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((leaf.view as AgentView).contentEl.querySelector(".agent-board-empty")).not.toBeNull();
    leaf.detach();
  });
});
