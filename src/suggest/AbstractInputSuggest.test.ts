import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { App } from "../app/App";
import { Scope } from "../hotkeys/Scope";
import { AbstractInputSuggest } from "./AbstractInputSuggest";

let dom: JSDOM | null = null;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body><input id=\"suggest-input\"></body></html>", { pretendToBeVisual: true });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("HTMLInputElement", dom.window.HTMLInputElement);
  vi.stubGlobal("HTMLTextAreaElement", dom.window.HTMLTextAreaElement);
  vi.stubGlobal("KeyboardEvent", dom.window.KeyboardEvent);
  vi.stubGlobal("MouseEvent", dom.window.MouseEvent);
  vi.stubGlobal("InputEvent", dom.window.InputEvent);
  vi.stubGlobal("Node", dom.window.Node);
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

class FruitSuggest extends AbstractInputSuggest<string> {
  values: string[] | Promise<string[]> = [];

  getSuggestions(inputStr: string): string[] | Promise<string[]> {
    const source = this.values;
    if (Array.isArray(source)) return source.filter((value) => value.includes(inputStr));
    return source;
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.textContent = value;
  }
}

function createApp(): App {
  const scope = new Scope(null);
  const pushed: Scope[] = [];
  return {
    scope,
    keymap: {
      pushed,
      pushScope(next: Scope) {
        pushed.push(next);
      },
      popScope(next: Scope) {
        const index = pushed.lastIndexOf(next);
        if (index !== -1) pushed.splice(index, 1);
      },
    },
  } as unknown as App;
}

function inputEl(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("#suggest-input");
  if (!input) throw new Error("missing input");
  return input;
}

describe("AbstractInputSuggest", () => {
  it("opens from a focused input and applies the Obsidian default limit", () => {
    const app = createApp();
    const input = inputEl();
    const suggest = new FruitSuggest(app, input);
    suggest.limit = 2;
    suggest.values = ["apple", "apricot", "banana"];

    input.focus();
    input.value = "a";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(suggest.isOpen).toBe(true);
    expect([...document.body.querySelectorAll(".suggestion-item")].map((el) => el.textContent)).toEqual(["apple", "apricot"]);
  });

  it("closes when suggestions become empty", () => {
    const app = createApp();
    const input = inputEl();
    const suggest = new FruitSuggest(app, input);
    suggest.values = ["apple"];

    input.focus();
    input.value = "a";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.value = "z";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(suggest.isOpen).toBe(false);
    expect(document.body.querySelector(".suggestion-container")).toBeNull();
  });

  it("supports async suggestions from onInputChange", async () => {
    const app = createApp();
    const input = inputEl();
    const suggest = new FruitSuggest(app, input);
    suggest.values = Promise.resolve(["remote"]);

    input.focus();
    input.value = "r";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await Promise.resolve();

    expect(document.body.querySelector(".suggestion-item")?.textContent).toBe("remote");
  });

  it("auto-destroys when the input is no longer shown", () => {
    vi.useFakeTimers();
    const app = createApp();
    const input = inputEl();
    const suggest = new FruitSuggest(app, input);
    suggest.values = ["apple"];

    input.focus();
    input.value = "a";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.style.display = "none";

    vi.advanceTimersByTime(500);

    expect(suggest.isOpen).toBe(false);
    expect(document.body.querySelector(".suggestion-container")).toBeNull();
    vi.useRealTimers();
  });

  it("does not close from outside mousedown while the input remains visible", () => {
    const app = createApp();
    const input = inputEl();
    const suggest = new FruitSuggest(app, input);
    suggest.values = ["apple"];

    input.focus();
    input.value = "a";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(suggest.isOpen).toBe(true);
  });

  it("calls onSelect without forcing close so subclasses can decide", () => {
    const app = createApp();
    const input = inputEl();
    const suggest = new FruitSuggest(app, input);
    const select = vi.fn();
    suggest.values = ["apple"];
    suggest.onSelect(select);

    input.focus();
    input.value = "a";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    suggest.suggestions.useSelectedItem(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(select).toHaveBeenCalledWith("apple", expect.any(KeyboardEvent));
    expect(suggest.isOpen).toBe(true);
  });

  it("keeps input value helpers compatible with input elements", () => {
    const suggest = new FruitSuggest(createApp(), inputEl());

    suggest.setValue("folder/note");

    expect(suggest.getValue()).toBe("folder/note");
  });

  it("attaches suggestions to the input ownerDocument for popout-like documents", () => {
    const popoutDom = new JSDOM("<!doctype html><html><body><input id=\"popout-input\"></body></html>", { pretendToBeVisual: true });
    try {
      const input = popoutDom.window.document.querySelector<HTMLInputElement>("#popout-input");
      if (!input) throw new Error("missing popout input");
      Object.defineProperty(popoutDom.window.HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: vi.fn(),
      });
      const suggest = new FruitSuggest(createApp(), input as HTMLElement as HTMLInputElement);
      suggest.values = ["pear"];

      input.focus();
      input.value = "p";
      input.dispatchEvent(new popoutDom.window.InputEvent("input", { bubbles: true }));

      expect(suggest.isOpen).toBe(true);
      expect(suggest.suggestEl.ownerDocument).toBe(popoutDom.window.document);
      expect(popoutDom.window.document.body.querySelector(".suggestion-container")).toBe(suggest.suggestEl);
      expect(document.body.querySelector(".suggestion-container")).toBeNull();
      expect(suggest.getValue()).toBe("p");

      suggest.setValue("pe");

      expect(input.value).toBe("pe");
    } finally {
      popoutDom.window.close();
    }
  });
});
