import { describe, expect, it } from "vitest";
import type { ChatEvent } from "./ChatEvent";
import { ChatMessageList } from "./ChatMessageList";
import { ChatSession } from "./ChatSession";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Bare = DistributiveOmit<ChatEvent, "seq" | "threadId">;

function feed(session: ChatSession, list: Bare[], startSeq = 1): number {
  list.forEach((event, index) => session.applyEvent({ ...event, seq: startSeq + index, threadId: "t1" } as ChatEvent));
  return startSeq + list.length;
}

function setup() {
  const session = new ChatSession("t1");
  const parentEl = document.createElement("div");
  document.body.appendChild(parentEl);
  const list = new ChatMessageList(parentEl, session);
  list.load();
  return { session, parentEl, list };
}

describe("tool timeline grouping", () => {
  it("groups consecutive tool parts into one collapsible timeline", () => {
    const { session, parentEl, list } = setup();
    let seq = feed(session, [
      { type: "run.started", runId: "r1" },
      { type: "message.started", messageId: "a1", role: "assistant" },
      { type: "part.opened", messageId: "a1", partIndex: 0, partType: "text" },
      { type: "part.delta", messageId: "a1", partIndex: 0, delta: "先说一句" },
      { type: "part.closed", messageId: "a1", partIndex: 0 },
      { type: "part.opened", messageId: "a1", partIndex: 1, partType: "tool", toolName: "Bash" },
      { type: "part.closed", messageId: "a1", partIndex: 1, result: "ok" },
      { type: "part.opened", messageId: "a1", partIndex: 2, partType: "tool", toolName: "Read" },
    ]);
    list.sync();

    const timelines = parentEl.querySelectorAll(".chat-tool-timeline");
    expect(timelines).toHaveLength(1);
    expect(timelines[0].querySelectorAll(".chat-part-tool")).toHaveLength(2);
    expect(timelines[0].querySelector(".chat-tool-timeline-summary")?.textContent).toBe("2 tool calls · running");
    expect(timelines[0].classList.contains("is-running")).toBe(true);
    expect(timelines[0].classList.contains("is-collapsed")).toBe(false);

    seq = feed(session, [{ type: "part.closed", messageId: "a1", partIndex: 2, result: "done" }], seq);
    list.sync();
    expect(timelines[0].querySelector(".chat-tool-timeline-summary")?.textContent).toBe("2 tool calls · done");
    expect(timelines[0].classList.contains("is-collapsed")).toBe(true);
  });

  it("starts a new timeline after a text part interrupts the tool run", () => {
    const { session, parentEl, list } = setup();
    feed(session, [
      { type: "run.started", runId: "r1" },
      { type: "message.started", messageId: "a1", role: "assistant" },
      { type: "part.opened", messageId: "a1", partIndex: 0, partType: "tool", toolName: "Bash" },
      { type: "part.closed", messageId: "a1", partIndex: 0, result: "ok" },
      { type: "part.opened", messageId: "a1", partIndex: 1, partType: "text" },
      { type: "part.delta", messageId: "a1", partIndex: 1, delta: "中场解说" },
      { type: "part.closed", messageId: "a1", partIndex: 1 },
      { type: "part.opened", messageId: "a1", partIndex: 2, partType: "tool", toolName: "Grep" },
    ]);
    list.sync();
    expect(parentEl.querySelectorAll(".chat-tool-timeline")).toHaveLength(2);
  });

  it("keeps a manually expanded timeline open when it completes", () => {
    const { session, parentEl, list } = setup();
    let seq = feed(session, [
      { type: "run.started", runId: "r1" },
      { type: "message.started", messageId: "a1", role: "assistant" },
      { type: "part.opened", messageId: "a1", partIndex: 0, partType: "tool", toolName: "Bash" },
    ]);
    list.sync();
    const timeline = parentEl.querySelector(".chat-tool-timeline") as HTMLElement;

    (timeline.querySelector(".chat-tool-timeline-header") as HTMLElement).click();
    (timeline.querySelector(".chat-tool-timeline-header") as HTMLElement).click();

    feed(session, [{ type: "part.closed", messageId: "a1", partIndex: 0, result: "ok" }], seq);
    list.sync();
    expect(timeline.classList.contains("is-collapsed")).toBe(false);
  });
});
