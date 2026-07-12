import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@web/builtin/agent/AgentEvent";
import { Agent } from "@web/builtin/agent/Agent";
import type { AgentTransport } from "@web/builtin/agent/AgentTransport";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function events(agentId: string, list: Array<DistributiveOmit<AgentEvent, "seq" | "agentId">>): AgentEvent[] {
  return list.map((event, index) => ({ ...event, seq: index + 1, agentId }) as AgentEvent);
}

// Structurally an AgentTransport; only sendMessage is exercised here.
function fakeTransport(): AgentTransport {
  return {
    connect: () => () => undefined,
    sendMessage: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentTransport;
}

describe("Agent queued prompts", () => {
  it("stores a queued message and triggers changed while a run is active", () => {
    const session = new Agent("t1", fakeTransport());
    for (const event of events("t1", [{ type: "run.started", runId: "r1" }])) session.applyEvent(event);

    const seen: string[] = [];
    session.on("changed", () => seen.push("changed"));
    session.queueMessage("second thought", []);

    expect(session.queued).toEqual([{ text: "second thought", attachments: [] }]);
    expect(seen).toContain("changed");
  });

  it("auto-sends the first queued item when run.closed arrives", async () => {
    const transport = fakeTransport();
    const session = new Agent("t1", transport);
    session.queueMessage("queued text", [{ name: "a.txt", content: "hi" }]);

    session.applyEvent({ type: "run.closed", runId: "r1", status: "completed", seq: 1, agentId: "t1" });
    // sendMessage fires fire-and-forget; let its microtask settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(transport.sendMessage).toHaveBeenCalledWith("t1", "queued text", [{ name: "a.txt", content: "hi" }]);
    expect(session.queued).toHaveLength(0);
  });

  it("cancelQueued removes an item without sending it", () => {
    const transport = fakeTransport();
    const session = new Agent("t1", transport);
    session.queueMessage("keep me", []);
    session.queueMessage("drop me", []);

    session.cancelQueued(1);

    expect(session.queued).toEqual([{ text: "keep me", attachments: [] }]);

    session.applyEvent({ type: "run.closed", runId: "r1", status: "completed", seq: 1, agentId: "t1" });
    expect(transport.sendMessage).toHaveBeenCalledWith("t1", "keep me", []);
    expect(transport.sendMessage).not.toHaveBeenCalledWith("t1", "drop me", []);
  });
});
