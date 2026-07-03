import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./AgentEvent";
import { applyAgentEvent, Agent, createAgentState } from "./Agent";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function events(agentId: string, list: Array<DistributiveOmit<AgentEvent, "seq" | "agentId">>): AgentEvent[] {
  return list.map((event, index) => ({ ...event, seq: index + 1, agentId }) as AgentEvent);
}

const streamedRun = events("t1", [
  { type: "run.started", runId: "r1" },
  { type: "message.started", messageId: "u1", role: "user" },
  { type: "part.opened", messageId: "u1", partIndex: 0, partType: "text" },
  { type: "part.delta", messageId: "u1", partIndex: 0, delta: "hi" },
  { type: "part.closed", messageId: "u1", partIndex: 0 },
  { type: "message.closed", messageId: "u1" },
  { type: "message.started", messageId: "a1", role: "assistant" },
  { type: "part.opened", messageId: "a1", partIndex: 0, partType: "text" },
  { type: "part.delta", messageId: "a1", partIndex: 0, delta: "Hello " },
  { type: "part.delta", messageId: "a1", partIndex: 0, delta: "world" },
  { type: "part.opened", messageId: "a1", partIndex: 1, partType: "tool", toolName: "Bash" },
  { type: "part.delta", messageId: "a1", partIndex: 1, delta: '{"command":"ls"}' },
  { type: "part.closed", messageId: "a1", partIndex: 1 },
  { type: "part.closed", messageId: "a1", partIndex: 1, result: "file.txt" },
  { type: "part.closed", messageId: "a1", partIndex: 0 },
  { type: "message.closed", messageId: "a1" },
  { type: "run.closed", runId: "r1", status: "completed" },
]);

describe("applyAgentEvent", () => {
  it("folds a full run into messages with typed parts", () => {
    const state = createAgentState();
    for (const event of streamedRun) applyAgentEvent(state, event);

    expect(state.running).toBe(false);
    expect(state.messages).toHaveLength(2);

    const [user, assistant] = state.messages;
    expect(user.role).toBe("user");
    expect(user.parts[0]).toMatchObject({ type: "text", markdown: "hi", closed: true });

    expect(assistant.role).toBe("assistant");
    expect(assistant.parts[0]).toMatchObject({ type: "text", markdown: "Hello world", closed: true });
    expect(assistant.parts[1]).toMatchObject({ type: "tool", toolName: "Bash", input: '{"command":"ls"}', result: "file.txt", closed: true });
    expect(assistant.closed).toBe(true);
  });

  it("folds attachment parts on user messages", () => {
    const state = createAgentState();
    const attachmentRun: AgentEvent[] = events("t1", [
      { type: "run.started", runId: "r1" },
      { type: "message.started", messageId: "u1", role: "user" },
      { type: "part.opened", messageId: "u1", partIndex: 0, partType: "text" },
      { type: "part.delta", messageId: "u1", partIndex: 0, delta: "看看这个" },
      { type: "part.closed", messageId: "u1", partIndex: 0 },
      { type: "part.opened", messageId: "u1", partIndex: 1, partType: "attachment", name: "Pasted text" },
      { type: "part.delta", messageId: "u1", partIndex: 1, delta: "long pasted content" },
      { type: "part.closed", messageId: "u1", partIndex: 1 },
      { type: "message.closed", messageId: "u1" },
    ]);
    for (const event of attachmentRun) applyAgentEvent(state, event);
    expect(state.messages[0].parts[1]).toMatchObject({ type: "attachment", name: "Pasted text", content: "long pasted content", closed: true });
  });

  it("merges a late tool result via a second part.closed", () => {
    const state = createAgentState();
    for (const event of streamedRun.slice(0, 13)) applyAgentEvent(state, event);
    const tool = state.messages[1].parts[1];
    expect(tool).toMatchObject({ type: "tool", closed: true });
    expect((tool as { result?: string }).result).toBeUndefined();

    applyAgentEvent(state, streamedRun[13]);
    expect((state.messages[1].parts[1] as { result?: string }).result).toBe("file.txt");
  });

  it("drops replayed events at or below lastSeq, so history replay + live SSE share one path", () => {
    const state = createAgentState();
    for (const event of streamedRun) applyAgentEvent(state, event);
    const before = JSON.stringify(state.messages);

    for (const event of streamedRun) expect(applyAgentEvent(state, event)).toBe(false);
    expect(JSON.stringify(state.messages)).toBe(before);
  });

  it("marks the run failed and closes open parts on run.closed error", () => {
    const state = createAgentState();
    for (const event of streamedRun.slice(0, 10)) applyAgentEvent(state, event);
    expect(state.running).toBe(true);

    applyAgentEvent(state, { type: "run.closed", runId: "r1", status: "error", error: "boom", seq: 99, agentId: "t1" });
    expect(state.running).toBe(false);
    expect(state.lastError).toBe("boom");
    expect(state.messages[1].parts[0].closed).toBe(true);
  });

  it("records a tool failure, usage and part timing from the extended fields", () => {
    const state = createAgentState();
    applyAgentEvent(state, { type: "message.started", messageId: "a1", role: "assistant", seq: 1, agentId: "t1" });
    applyAgentEvent(state, { type: "part.opened", messageId: "a1", partIndex: 0, partType: "tool", toolName: "Read", seq: 2, agentId: "t1", ts: 1000 });
    applyAgentEvent(state, { type: "part.closed", messageId: "a1", partIndex: 0, result: "ENOENT", error: "ENOENT", seq: 3, agentId: "t1", ts: 3500 });
    const tool = state.messages[0].parts[0];
    expect(tool).toMatchObject({ type: "tool", closed: true, error: "ENOENT", openedAt: 1000, closedAt: 3500 });

    applyAgentEvent(state, {
      type: "run.closed", runId: "r1", status: "completed", seq: 4, agentId: "t1",
      usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500, costUsd: 0.01 },
    });
    expect(state.usage).toEqual({ inputTokens: 1200, outputTokens: 300, totalTokens: 1500, costUsd: 0.01 });
  });
});

describe("Agent", () => {
  it("triggers delta and changed events for subscribers", () => {
    const session = new Agent("t1");
    const seen: string[] = [];
    session.on("changed", () => seen.push("changed"));
    session.on<[string, number]>("delta", (messageId, partIndex) => seen.push(`delta:${messageId}:${partIndex}`));

    for (const event of streamedRun.slice(0, 4)) session.applyEvent(event);
    expect(seen).toContain("delta:u1:0");
    expect(seen.filter((item) => item === "changed")).toHaveLength(4);
  });
});
