import { afterEach, describe, expect, it, vi } from "vitest";
import { CompletionContext, type Completion, type CompletionResult } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { ChatComposer, type ChatComposerCallbacks } from "@web/builtin/agent/ChatComposer";
import { registerChatComposerExtension, registerChatSlashCommand } from "@web/builtin/agent/ChatRegistry";

// Unload composers so their CodeMirror editors destroy with this file's
// window; leaked editors fire measure timers into other test files.
const composers: ChatComposer[] = [];
afterEach(() => {
  for (const composer of composers.splice(0)) composer.unload();
});

interface ComposerInternals {
  editor: EditorView;
  completeSlashCommand(context: CompletionContext): CompletionResult | null;
  completeWikilink(context: CompletionContext): CompletionResult | null;
}

function setup(overrides: Partial<ChatComposerCallbacks> = {}) {
  const parentEl = document.createElement("div");
  document.body.appendChild(parentEl);
  const send = vi.fn();
  const composer = new ChatComposer(parentEl, {
    send,
    queue: vi.fn(),
    stop: vi.fn(),
    isRunning: () => false,
    getWikilinkTargets: () => ["Welcome", "设计笔记"],
    ...overrides,
  });
  composer.load();
  composers.push(composer);
  const internals = composer as unknown as ComposerInternals;
  return { parentEl, composer, internals, send };
}

function contextAt(editor: EditorView, pos: number): CompletionContext {
  return new CompletionContext(editor.state, pos, false);
}

function applyOption(editor: EditorView, result: CompletionResult, label: string): void {
  const option = result.options.find((item) => item.label === label) as Completion;
  const apply = option.apply;
  if (typeof apply === "string") {
    editor.dispatch({ changes: { from: result.from, to: editor.state.doc.length, insert: apply } });
    return;
  }
  apply?.(editor, option, result.from, editor.state.doc.length);
}

describe("ChatComposer (CodeMirror host)", () => {
  it("round-trips the draft and sends through the send button", () => {
    const { parentEl, composer, send } = setup();
    composer.setValue("hello world");
    expect(composer.getValue()).toBe("hello world");

    (parentEl.querySelector(".chat-composer-send") as HTMLButtonElement).click();
    expect(send).toHaveBeenCalledWith("hello world", []);
    expect(composer.getValue()).toBe("");
  });

  it("completes insert-style slash commands at the start of the draft", () => {
    const unregister = registerChatSlashCommand({ id: "table", name: "Insert table", insertText: "| a | b |\n" });
    try {
      const { composer, internals } = setup();
      composer.setValue("/ta");
      const result = internals.completeSlashCommand(contextAt(internals.editor, 3));
      expect(result?.options.map((option) => option.label)).toContain("/table");

      applyOption(internals.editor, result!, "/table");
      expect(composer.getValue()).toBe("| a | b |\n");
    } finally {
      unregister();
    }
  });

  it("runs run-style slash commands and clears the draft", () => {
    const run = vi.fn();
    const unregister = registerChatSlashCommand({ id: "go", name: "Go", run });
    try {
      const { composer, internals } = setup();
      composer.setValue("/go");
      const result = internals.completeSlashCommand(contextAt(internals.editor, 3));
      applyOption(internals.editor, result!, "/go");
      expect(run).toHaveBeenCalledOnce();
      expect(composer.getValue()).toBe("");
    } finally {
      unregister();
    }
  });

  it("does not offer slash completions mid-draft", () => {
    const unregister = registerChatSlashCommand({ id: "table", name: "Insert table", insertText: "x" });
    try {
      const { composer, internals } = setup();
      composer.setValue("see /ta");
      expect(internals.completeSlashCommand(contextAt(internals.editor, 7))).toBeNull();
    } finally {
      unregister();
    }
  });

  it("completes wikilink targets from the vault after [[", () => {
    const { composer, internals } = setup();
    composer.setValue("参考 [[We");
    const result = internals.completeWikilink(contextAt(internals.editor, composer.getValue().length));
    expect(result?.options.map((option) => option.label)).toEqual(["Welcome", "设计笔记"]);
    expect(result?.from).toBe("参考 [[".length);

    applyOption(internals.editor, result!, "Welcome");
    expect(composer.getValue()).toBe("参考 [[Welcome]] ");
  });

  it("reconfigures live composers when plugin extensions register", () => {
    const updates = vi.fn();
    const { composer } = setup();
    const unregister = registerChatComposerExtension(EditorView.updateListener.of(() => updates()));
    try {
      composer.setValue("trigger");
      expect(updates).toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("shows an attach button in the toolbar", () => {
    const { parentEl } = setup();
    const attachButton = parentEl.querySelector(".chat-composer-attach");
    expect(attachButton).not.toBeNull();
    expect(attachButton?.getAttribute("title")).toBe("Attach file");
  });

  it("attaches a file chosen through the picker input", async () => {
    const { parentEl, composer } = setup();
    const inputEl = parentEl.querySelector(".chat-composer-attach-input") as HTMLInputElement;
    const file = fakeTextFile("notes.txt", "hello");
    Object.defineProperty(inputEl, "files", { configurable: true, value: [file] });

    inputEl.dispatchEvent(new Event("change"));
    await flushMicrotasks();

    expect(composer.attachmentBar.list()).toEqual([expect.objectContaining({ name: "notes.txt", content: "hello" })]);
  });

  it("attaches files dropped on the composer card and clears the drag state", async () => {
    const { parentEl, composer } = setup();
    const cardEl = parentEl.querySelector(".chat-composer-card") as HTMLElement;
    const file = fakeTextFile("dropped.md", "# hi");

    const dragoverEvent = new Event("dragover", { cancelable: true });
    cardEl.dispatchEvent(dragoverEvent);
    expect(cardEl.hasClass("is-dragging")).toBe(true);

    const dropEvent = new Event("drop", { cancelable: true }) as Event & { dataTransfer?: unknown };
    dropEvent.dataTransfer = { files: [file] };
    cardEl.dispatchEvent(dropEvent);
    await flushMicrotasks();

    expect(cardEl.hasClass("is-dragging")).toBe(false);
    expect(composer.attachmentBar.list()).toEqual([expect.objectContaining({ name: "dropped.md", content: "# hi" })]);
  });
});

// Synthetic file-like object rather than a real File: only the surface
// ChatComposer touches (name, type, text()) needs to exist.
function fakeTextFile(name: string, content: string): File {
  return { name, type: "text/plain", text: async () => content } as unknown as File;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("slash command grammar and interception", () => {
  it("parseSlashInput classifies command references and prose", async () => {
    const { parseSlashInput } = await import("@web/builtin/agent/ChatComposer");
    expect(parseSlashInput("/stop")).toEqual({ id: "stop", args: "" });
    expect(parseSlashInput("/fix-tests 先跑一遍")).toEqual({ id: "fix-tests", args: "先跑一遍" });
    expect(parseSlashInput("/skill:brave-search 查询")).toEqual({ id: "skill:brave-search", args: "查询" });
    expect(parseSlashInput("plain /middle")).toBeNull();
    expect(parseSlashInput("/")).toBeNull();
  });

  it("submit runs a registered command with args instead of sending", () => {
    const ran = vi.fn();
    const unregister = registerChatSlashCommand({ id: "echo-cmd", name: "Echo", args: "text", run: (_c, args) => ran(args) });
    try {
      const { composer, send, internals } = setup();
      composer.setValue("/echo-cmd 你好 世界");
      internals.editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(ran).toHaveBeenCalledWith("你好 世界");
      expect(send).not.toHaveBeenCalled();
      expect(composer.getValue()).toBe("");
    } finally {
      unregister();
    }
  });

  it("unregistered /command forwards verbatim — the harness interprets, not the composer", () => {
    const { composer, send, internals } = setup();
    composer.setValue("/fix-tests 先跑一遍");
    internals.editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(send).toHaveBeenCalledWith("/fix-tests 先跑一遍", []);
    expect(composer.getValue()).toBe("");
  });

  it("the / menu relays harness-native commands and inserts /name ", () => {
    const { composer, internals } = setup({
      getHarnessCommands: () => [{ name: "fix-tests", description: "修测试" }],
    });
    composer.setValue("/fi");
    const result = internals.completeSlashCommand(contextAt(internals.editor, 3));
    applyOption(internals.editor, result!, "/fix-tests");
    expect(composer.getValue()).toBe("/fix-tests ");
  });

  it("menu apply: arg-less runs immediately, arg-taking inserts /id ", () => {
    const ranNow = vi.fn();
    const u1 = registerChatSlashCommand({ id: "now-cmd", name: "Now", run: () => ranNow() });
    const u2 = registerChatSlashCommand({ id: "later-cmd", name: "Later", args: "text", run: vi.fn() });
    try {
      const { composer, internals } = setup();
      composer.setValue("/no");
      const result = internals.completeSlashCommand(contextAt(internals.editor, 3));
      applyOption(internals.editor, result!, "/now-cmd");
      expect(ranNow).toHaveBeenCalled();
      expect(composer.getValue()).toBe("");

      composer.setValue("/la");
      const result2 = internals.completeSlashCommand(contextAt(internals.editor, 3));
      applyOption(internals.editor, result2!, "/later-cmd");
      expect(composer.getValue()).toBe("/later-cmd ");
    } finally {
      u1();
      u2();
    }
  });
});
