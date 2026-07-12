import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { App } from "@web/app/App";
import type { Editor, EditorPosition } from "@web/editor/Editor";
import { Keymap } from "@web/app/hotkeys/Keymap";
import { EditorSuggest, type EditorSuggestContext, EditorSuggestManager, type EditorSuggestTriggerInfo } from "@web/ui/suggest/EditorSuggest";

let dom: JSDOM | null = null;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("KeyboardEvent", dom.window.KeyboardEvent);
  vi.stubGlobal("MouseEvent", dom.window.MouseEvent);
  vi.stubGlobal("Node", dom.window.Node);
  const values = new Map<string, string>();
  Object.defineProperty(dom.window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  dom?.window.close();
  dom = null;
});

class TestEditorSuggest extends EditorSuggest<string> {
  onTriggerMock = vi.fn<(cursor: EditorPosition, editor: Editor, file?: unknown) => EditorSuggestTriggerInfo | null>();
  get = vi.fn<(context: EditorSuggestContext) => string[] | null | Promise<string[] | null>>();
  render = vi.fn<(value: string, el: HTMLElement) => void>((value, el) => {
    el.textContent = value;
  });
  select = vi.fn<(value: string, event: MouseEvent | KeyboardEvent) => void>();

  onTrigger(cursor: EditorPosition, editor: Editor, file?: unknown): EditorSuggestTriggerInfo | null {
    return this.onTriggerMock(cursor, editor, file);
  }

  getSuggestions(context: EditorSuggestContext): string[] | null | Promise<string[] | null> {
    return this.get(context);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    this.render(value, el);
  }

  selectSuggestion(value: string, event: MouseEvent | KeyboardEvent): void {
    this.select(value, event);
  }
}

function createApp(): App {
  const keymap = new Keymap(window);
  return {
    keymap,
    scope: keymap.getRootScope(),
  } as unknown as App;
}

function createEditor(options: { from?: EditorPosition; to?: EditorPosition; focused?: boolean; ownerDocument?: Document } = {}): Editor {
  const from = options.from ?? { line: 0, ch: 1 };
  const to = options.to ?? from;
  const containerEl = (options.ownerDocument ?? document).createElement("div");
  Object.defineProperty(containerEl, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 40, right: 360, top: 80, bottom: 104, width: 320, height: 24 }),
  });
  return {
    containerEl,
    getCursor(mode?: "from" | "to") {
      return mode === "to" ? to : from;
    },
    getLine() {
      return "alpha";
    },
    coordsAtPos(pos: EditorPosition) {
      return {
        left: 20 + pos.ch * 8,
        right: 28 + pos.ch * 8,
        top: 30 + pos.line * 20,
        bottom: 48 + pos.line * 20,
      };
    },
    hasFocus() {
      return options.focused ?? true;
    },
  } as unknown as Editor;
}

function createContext(_editor: Editor, _file?: unknown): EditorSuggestTriggerInfo {
  return {
    start: { line: 0, ch: 0 },
    end: { line: 0, ch: 1 },
    query: "a",
  };
}

describe("EditorSuggestManager", () => {
  it("uses registration order and stops after the first matching suggest", async () => {
    const manager = new EditorSuggestManager();
    const editor = createEditor();
    const file = { path: "Note.md" };
    const first = new TestEditorSuggest(createApp());
    const second = new TestEditorSuggest(createApp());
    first.onTriggerMock.mockReturnValue(createContext(editor));
    first.get.mockReturnValue([]);
    second.onTriggerMock.mockReturnValue(createContext(editor));
    manager.addSuggest(first);
    manager.addSuggest(second);

    await manager.trigger(editor, file, true);

    expect(first.onTriggerMock).toHaveBeenCalledWith({ line: 0, ch: 1 }, editor, file);
    expect(first.context).toBeNull();
    expect(second.onTriggerMock).not.toHaveBeenCalled();
    expect(manager.isShowingSuggestion()).toBe(false);
  });

  it("carries the source file into the active context", async () => {
    const manager = new EditorSuggestManager();
    const editor = createEditor();
    const file = { path: "Daily.md" };
    const suggest = new TestEditorSuggest(createApp());
    suggest.onTriggerMock.mockReturnValue(createContext(editor));
    suggest.get.mockReturnValue(["one"]);
    manager.addSuggest(suggest);

    await manager.trigger(editor, file, true);

    expect(suggest.context?.file).toBe(file);
    expect(manager.isShowingSuggestion()).toBe(true);
    expect(suggest.suggestEl.parentElement).toBe(document.body);
    expect(suggest.suggestInnerEl.parentElement).toBe(suggest.suggestEl);
    expect(suggest.suggestInnerEl.className).toBe("suggestion");
    expect(suggest.suggestInnerEl.querySelector(".suggestion-item")?.textContent).toBe("one");
  });

  it("attaches editor suggestions to the editor ownerDocument", async () => {
    const popoutDom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
    try {
      const manager = new EditorSuggestManager();
      const editor = createEditor({ ownerDocument: popoutDom.window.document });
      const suggest = new TestEditorSuggest(createApp());
      suggest.onTriggerMock.mockReturnValue(createContext(editor));
      suggest.get.mockReturnValue(["popout"]);
      manager.addSuggest(suggest);

      await manager.trigger(editor, { path: "Popout.md" }, true);

      expect(suggest.suggestEl.parentElement).toBe(popoutDom.window.document.body);
      expect(popoutDom.window.document.body.querySelector(".suggestion-container")).toBe(suggest.suggestEl);
      expect(document.body.querySelector(".suggestion-container")).toBeNull();
    } finally {
      popoutDom.window.close();
    }
  });

  it("treats null suggestions as a cancelled result", async () => {
    const manager = new EditorSuggestManager();
    const editor = createEditor();
    const suggest = new TestEditorSuggest(createApp());
    suggest.onTriggerMock.mockReturnValue(createContext(editor));
    suggest.get.mockResolvedValue(null);
    manager.addSuggest(suggest);

    await manager.trigger(editor, { path: "Blurred.md" }, true);

    expect(suggest.render).not.toHaveBeenCalled();
    expect(suggest.context).not.toBeNull();
    expect(manager.isShowingSuggestion()).toBe(false);
  });

  it("closes instead of rendering async results after editor blur", async () => {
    const manager = new EditorSuggestManager();
    const editor = createEditor({ focused: false });
    const suggest = new TestEditorSuggest(createApp());
    suggest.onTriggerMock.mockReturnValue(createContext(editor));
    suggest.get.mockResolvedValue(["late"]);
    manager.addSuggest(suggest);

    await manager.trigger(editor, { path: "Blurred.md" }, true);

    expect(suggest.render).not.toHaveBeenCalled();
    expect(suggest.context).toBeNull();
    expect(manager.isShowingSuggestion()).toBe(false);
  });

  it("keeps an open suggest mounted when a direct trigger sees a non-collapsed selection", async () => {
    const editor = createEditor();
    const suggest = new TestEditorSuggest(createApp());
    suggest.onTriggerMock.mockReturnValue(createContext(editor));
    suggest.get.mockReturnValue(["one"]);
    await suggest.trigger(editor, { path: "Open.md" }, true);
    const selectedEditor = createEditor({ from: { line: 0, ch: 1 }, to: { line: 0, ch: 2 } });

    await expect(suggest.trigger(selectedEditor, { path: "Open.md" }, true)).resolves.toBe(false);

    expect(suggest.context).toBeNull();
    expect(suggest.isOpen).toBe(true);
    expect(suggest.suggestEl.parentElement).toBe(document.body);
  });

  it("applies the suggest limit before rendering", async () => {
    const manager = new EditorSuggestManager();
    const editor = createEditor();
    const suggest = new TestEditorSuggest(createApp());
    suggest.limit = 2;
    suggest.onTriggerMock.mockReturnValue(createContext(editor));
    suggest.get.mockReturnValue(["one", "two", "three"]);
    manager.addSuggest(suggest);

    await manager.trigger(editor, document.body, true);

    expect(suggest.render).toHaveBeenCalledTimes(2);
    expect(suggest.render.mock.calls.map(([value]) => value)).toEqual(["one", "two"]);
  });

  it("does not trigger suggestions for a non-collapsed selection", async () => {
    const manager = new EditorSuggestManager();
    const editor = createEditor({ from: { line: 0, ch: 1 }, to: { line: 0, ch: 2 } });
    const suggest = new TestEditorSuggest(createApp());
    manager.addSuggest(suggest);

    await manager.trigger(editor, document.body, true);

    expect(suggest.onTriggerMock).not.toHaveBeenCalled();
    expect(manager.isShowingSuggestion()).toBe(false);
  });
});
