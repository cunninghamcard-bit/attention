import { afterEach, describe, expect, it, vi } from "vitest";
import { CompletionContext, type Completion, type CompletionResult } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { ChatComposer, type ChatComposerCallbacks } from "./ChatComposer";
import { registerChatComposerExtension, registerChatSlashCommand } from "./ChatRegistry";

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
});
