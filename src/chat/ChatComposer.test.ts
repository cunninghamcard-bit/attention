import { describe, expect, it, vi } from "vitest";
import { ChatComposer } from "./ChatComposer";
import { registerChatSlashCommand } from "./ChatRegistry";

function setup() {
  const parentEl = document.createElement("div");
  document.body.appendChild(parentEl);
  const send = vi.fn();
  const composer = new ChatComposer(parentEl, { send, stop: vi.fn(), isRunning: () => false });
  composer.load();
  const inputEl = parentEl.querySelector(".chat-composer-input") as HTMLTextAreaElement;
  return { parentEl, composer, inputEl, send };
}

describe("ChatComposer", () => {
  it("sends on Enter and keeps newlines on Shift+Enter", () => {
    const { composer, inputEl, send } = setup();
    composer.setValue("hello");
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, cancelable: true }));
    expect(send).not.toHaveBeenCalled();
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    expect(send).toHaveBeenCalledWith("hello");
    expect(composer.getValue()).toBe("");
  });

  it("suggests slash commands and applies insertText on Enter", () => {
    const unregister = registerChatSlashCommand({ id: "table", name: "Insert table", insertText: "| a | b |\n| --- | --- |\n" });
    try {
      const { parentEl, composer, inputEl } = setup();
      composer.setValue("/tab");
      expect(parentEl.querySelector(".chat-slash-item")?.textContent).toContain("/table");

      inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
      expect(composer.getValue()).toContain("| a | b |");
    } finally {
      unregister();
    }
  });

  it("runs run-style slash commands instead of inserting text", () => {
    const run = vi.fn();
    const unregister = registerChatSlashCommand({ id: "new", name: "New thread", run });
    try {
      const { composer, inputEl } = setup();
      composer.setValue("/new");
      inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
      expect(run).toHaveBeenCalledOnce();
      expect(composer.getValue()).toBe("");
    } finally {
      unregister();
    }
  });
});
