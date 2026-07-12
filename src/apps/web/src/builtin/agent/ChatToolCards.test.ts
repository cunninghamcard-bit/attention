import { describe, expect, it, beforeEach } from "vitest";
import type { AgentEvent } from "./AgentEvent";
import { ChatMessageList } from "./ChatMessageList";
import { Agent } from "./Agent";
import { registerBuiltinToolCards } from "./ChatToolCards";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Bare = DistributiveOmit<AgentEvent, "seq" | "agentId">;

function feed(session: Agent, list: Bare[]): void {
  list.forEach((event, index) => session.applyEvent({ ...event, seq: index + 1, agentId: "t1" } as AgentEvent));
}

function mount(events: Bare[]): HTMLElement {
  const session = new Agent("t1");
  feed(session, events);
  const parentEl = document.createElement("div");
  document.body.appendChild(parentEl);
  const list = new ChatMessageList(parentEl, session);
  list.load();
  list.sync();
  return parentEl;
}

// Register once; the registry is module-global.
beforeEach(() => registerBuiltinToolCards());

describe("builtin tool cards", () => {
  it("renders a bash card with command and output, not raw JSON", () => {
    const el = mount([
      { type: "message.started", messageId: "a1", role: "assistant" },
      { type: "part.opened", messageId: "a1", partIndex: 0, partType: "tool", toolName: "bash" },
      { type: "part.delta", messageId: "a1", partIndex: 0, delta: JSON.stringify({ command: "echo hi" }) },
      { type: "part.closed", messageId: "a1", partIndex: 0, result: "hi\n" },
      { type: "message.closed", messageId: "a1" },
    ]);
    expect(el.querySelector(".chat-tool-verb")?.textContent).toBe("bash");
    expect(el.querySelector(".chat-tool-title")?.textContent).toBe("echo hi");
    expect(el.querySelector(".chat-tool-cmd")?.textContent).toBe("echo hi");
    expect(el.querySelector(".chat-tool-output")?.textContent).toBe("hi\n");
    // no raw JSON leaking through
    expect(el.textContent).not.toContain('{"command"');
  });

  it("renders an edit card as a diff of old -> new", () => {
    const el = mount([
      { type: "message.started", messageId: "a1", role: "assistant" },
      { type: "part.opened", messageId: "a1", partIndex: 0, partType: "tool", toolName: "Edit" },
      { type: "part.delta", messageId: "a1", partIndex: 0, delta: JSON.stringify({ file_path: "/x/foo.ts", old_string: "a\nb", new_string: "a\nc" }) },
      { type: "part.closed", messageId: "a1", partIndex: 0, result: "ok" },
      { type: "message.closed", messageId: "a1" },
    ]);
    expect(el.querySelector(".chat-tool-title")?.textContent).toBe("foo.ts");
    const dels = [...el.querySelectorAll(".chat-diff-del .chat-diff-text")].map((n) => n.textContent);
    const adds = [...el.querySelectorAll(".chat-diff-add .chat-diff-text")].map((n) => n.textContent);
    expect(dels).toEqual(["a", "b"]);
    expect(adds).toEqual(["a", "c"]);
  });

  it("shows the diff stat badge on the edit card", () => {
    const el = mount([
      { type: "message.started", messageId: "a1", role: "assistant" },
      { type: "part.opened", messageId: "a1", partIndex: 0, partType: "tool", toolName: "edit" },
      { type: "part.delta", messageId: "a1", partIndex: 0, delta: JSON.stringify({ file_path: "x.ts", old_string: "a", new_string: "b\nc\nd" }) },
      { type: "part.closed", messageId: "a1", partIndex: 0, result: "ok" },
    ]);
    expect(el.querySelector(".chat-diffstat-add")?.textContent).toBe("+3");
    expect(el.querySelector(".chat-diffstat-del")?.textContent).toBe("−1");
  });

  it("renders a failed tool with error text instead of a duplicate output block", () => {
    const el = mount([
      { type: "message.started", messageId: "a1", role: "assistant" },
      { type: "part.opened", messageId: "a1", partIndex: 0, partType: "tool", toolName: "read" },
      { type: "part.delta", messageId: "a1", partIndex: 0, delta: JSON.stringify({ file_path: "gone.ts" }) },
      { type: "part.closed", messageId: "a1", partIndex: 0, result: "ENOENT: no such file", error: "ENOENT: no such file" },
      { type: "message.closed", messageId: "a1" },
    ]);
    expect(el.querySelector(".chat-tool-status")?.textContent).toBe("failed");
    expect(el.querySelector(".chat-tool-error")?.textContent).toBe("ENOENT: no such file");
    expect(el.querySelector(".chat-tool-output")).toBeNull();
    // failure keeps details visible without a click
    expect((el.querySelector(".chat-tool-details") as HTMLElement).style.display).not.toBe("none");
  });

  it("survives partial/invalid JSON while streaming", () => {
    const el = mount([
      { type: "message.started", messageId: "a1", role: "assistant" },
      { type: "part.opened", messageId: "a1", partIndex: 0, partType: "tool", toolName: "bash" },
      { type: "part.delta", messageId: "a1", partIndex: 0, delta: '{"command":"echo ' },
    ]);
    // no title yet (input not parseable), but the verb + running status render
    expect(el.querySelector(".chat-tool-verb")?.textContent).toBe("bash");
    expect(el.querySelector(".chat-tool-status.is-running")).not.toBeNull();
  });
});
