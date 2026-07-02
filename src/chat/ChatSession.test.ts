import { describe, expect, it } from "vitest";
import type { ChatEvent } from "./ChatEvent";
import { applyChatEvent, ChatSession, createChatSessionState } from "./ChatSession";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function events(threadId: string, list: Array<DistributiveOmit<ChatEvent, "seq" | "threadId">>): ChatEvent[] {
  return list.map((event, index) => ({ ...event, seq: index + 1, threadId }) as ChatEvent);
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

describe("applyChatEvent", () => {
  it("folds a full run into messages with typed parts", () => {
    const state = createChatSessionState();
    for (const event of streamedRun) applyChatEvent(state, event);

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
    const state = createChatSessionState();
    const attachmentRun: ChatEvent[] = events("t1", [
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
    for (const event of attachmentRun) applyChatEvent(state, event);
    expect(state.messages[0].parts[1]).toMatchObject({ type: "attachment", name: "Pasted text", content: "long pasted content", closed: true });
  });

  it("merges a late tool result via a second part.closed", () => {
    const state = createChatSessionState();
    for (const event of streamedRun.slice(0, 13)) applyChatEvent(state, event);
    const tool = state.messages[1].parts[1];
    expect(tool).toMatchObject({ type: "tool", closed: true });
    expect((tool as { result?: string }).result).toBeUndefined();

    applyChatEvent(state, streamedRun[13]);
    expect((state.messages[1].parts[1] as { result?: string }).result).toBe("file.txt");
  });

  it("drops replayed events at or below lastSeq, so history replay + live SSE share one path", () => {
    const state = createChatSessionState();
    for (const event of streamedRun) applyChatEvent(state, event);
    const before = JSON.stringify(state.messages);

    for (const event of streamedRun) expect(applyChatEvent(state, event)).toBe(false);
    expect(JSON.stringify(state.messages)).toBe(before);
  });

  it("marks the run failed and closes open parts on run.closed error", () => {
    const state = createChatSessionState();
    for (const event of streamedRun.slice(0, 10)) applyChatEvent(state, event);
    expect(state.running).toBe(true);

    applyChatEvent(state, { type: "run.closed", runId: "r1", status: "error", error: "boom", seq: 99, threadId: "t1" });
    expect(state.running).toBe(false);
    expect(state.lastError).toBe("boom");
    expect(state.messages[1].parts[0].closed).toBe(true);
  });
});

describe("ChatSession", () => {
  it("triggers delta and changed events for subscribers", () => {
    const session = new ChatSession("t1");
    const seen: string[] = [];
    session.on("changed", () => seen.push("changed"));
    session.on<[string, number]>("delta", (messageId, partIndex) => seen.push(`delta:${messageId}:${partIndex}`));

    for (const event of streamedRun.slice(0, 4)) session.applyEvent(event);
    expect(seen).toContain("delta:u1:0");
    expect(seen.filter((item) => item === "changed")).toHaveLength(4);
  });
});
