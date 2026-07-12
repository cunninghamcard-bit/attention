import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
});
import { ChatComposer } from "@web/builtin/agent/ChatComposer";
import { triagePastedText } from "@web/builtin/agent/ChatComposerPaste";
import { appendChatInputHistory, readChatDraft, readChatInputHistory, writeChatDraft } from "@web/builtin/agent/ChatComposerDrafts";

describe("triagePastedText", () => {
  it("collapses blank-line runs for short pastes", () => {
    expect(triagePastedText("a\n\n\nb", 20)).toEqual({ kind: "inline", text: "a\nb" });
  });

  it("turns long pastes into cards", () => {
    const text = Array.from({ length: 25 }, (_, index) => `line ${index}`).join("\n");
    expect(triagePastedText(text, 20)).toEqual({ kind: "card", text });
  });
});

const composers: ChatComposer[] = [];
afterEach(() => {
  for (const composer of composers.splice(0)) composer.unload();
});

function setupComposer() {
  const parentEl = document.createElement("div");
  document.body.appendChild(parentEl);
  const send = vi.fn();
  const composer = new ChatComposer(parentEl, { send, queue: vi.fn(), stop: vi.fn(), isRunning: () => false });
  composer.load();
  composers.push(composer);
  return { parentEl, composer, send };
}

describe("composer attachments", () => {
  it("submits attachment payloads alongside the text and clears the bar", () => {
    const { parentEl, composer, send } = setupComposer();
    composer.attachmentBar.addText("Pasted text", "long content\nsecond line");
    expect(parentEl.querySelectorAll(".chat-attachment-card")).toHaveLength(1);
    expect(parentEl.querySelector(".chat-attachment-meta")?.textContent).toBe("2 lines");

    composer.setValue("看看这个");
    (parentEl.querySelector(".chat-composer-send") as HTMLButtonElement).click();
    expect(send).toHaveBeenCalledWith("看看这个", [{ name: "Pasted text", content: "long content\nsecond line" }]);
    expect(parentEl.querySelectorAll(".chat-attachment-card")).toHaveLength(0);
  });

  it("allows sending attachments without any text", () => {
    const { parentEl, composer, send } = setupComposer();
    composer.attachmentBar.addText("Pasted text", "content");
    (parentEl.querySelector(".chat-composer-send") as HTMLButtonElement).click();
    expect(send).toHaveBeenCalledWith("", [{ name: "Pasted text", content: "content" }]);
    void composer;
  });

  it("removes a card via its remove button", () => {
    const { parentEl, composer } = setupComposer();
    composer.attachmentBar.addText("One", "a");
    composer.attachmentBar.addText("Two", "b");
    (parentEl.querySelector(".chat-attachment-remove") as HTMLButtonElement).click();
    expect(composer.attachmentBar.list().map((item) => item.name)).toEqual(["Two"]);
  });
});

describe("chat drafts and input history", () => {
  it("round-trips thread drafts and clears empty ones", () => {
    writeChatDraft("t-draft", "unfinished thought");
    expect(readChatDraft("t-draft")).toBe("unfinished thought");
    writeChatDraft("t-draft", "   ");
    expect(readChatDraft("t-draft")).toBeNull();
  });

  it("expires drafts past the TTL", () => {
    window.localStorage.setItem("agent-draft:t-old", JSON.stringify({ text: "stale", updatedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }));
    expect(readChatDraft("t-old")).toBeNull();
    expect(window.localStorage.getItem("agent-draft:t-old")).toBeNull();
  });

  it("deduplicates history and caps it at 50", () => {
    window.localStorage.removeItem("chat-input-history");
    for (let index = 0; index < 55; index++) appendChatInputHistory(`msg ${index}`);
    appendChatInputHistory("msg 54");
    const history = readChatInputHistory();
    expect(history).toHaveLength(50);
    expect(history[history.length - 1]).toBe("msg 54");
    expect(history.filter((item) => item === "msg 54")).toHaveLength(1);
  });
});
