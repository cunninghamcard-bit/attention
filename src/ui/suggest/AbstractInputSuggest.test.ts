import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { App } from "../../app/App";
import { Scope } from "../../app/hotkeys/Scope";
import { Platform } from "../../platform/Platform";
import { closeTopActiveCloseable, getActiveCloseables } from "../ActiveCloseableRegistry";
import { Modal } from "../Modal";
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

interface TestApp extends App {
  pushedScopes: Scope[];
  poppedScopes: Scope[];
}

function createApp(): TestApp {
  const scope = new Scope(null);
  const pushedScopes: Scope[] = [];
  const poppedScopes: Scope[] = [];
  return {
    scope,
    pushedScopes,
    poppedScopes,
    keymap: {
      pushScope(next: Scope) {
        pushedScopes.push(next);
      },
      popScope(next: Scope) {
        poppedScopes.push(next);
        const index = pushedScopes.lastIndexOf(next);
        if (index !== -1) pushedScopes.splice(index, 1);
      },
    },
  } as unknown as TestApp;
}

function inputEl(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("#suggest-input");
  if (!input) throw new Error("missing input");
  return input;
}

describe("AbstractInputSuggest value element (real isTextValueElement)", () => {
  it("reads/writes an <input> through .value", () => {
    const suggest = new FruitSuggest(createApp(), inputEl());
    suggest.setValue("apple");
    expect(inputEl().value).toBe("apple");
    expect(suggest.getValue()).toBe("apple");
  });

  it("reads/writes a <textarea> through .innerText, not .value", () => {
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    const suggest = new FruitSuggest(createApp(), textarea);
    suggest.setValue("multi\nline");
    // Real Obsidian treats textarea as a non-value element -> innerText.
    expect(textarea.innerText).toBe("multi\nline");
    expect(textarea.value).toBe("");
    expect(suggest.getValue()).toBe("multi\nline");
  });
});

describe("AbstractInputSuggest", () => {
  it("keeps PopoverSuggest scope registration paired across close and repeated open", () => {
    const app = createApp();
    const suggest = new FruitSuggest(app, inputEl());
    suggest.values = ["apple"];

    suggest.close();

    expect(app.pushedScopes).toEqual([]);
    expect(app.poppedScopes).toEqual([suggest.scope]);

    suggest.open();
    suggest.open();

    expect(app.pushedScopes).toEqual([suggest.scope]);
    expect(app.poppedScopes).toEqual([suggest.scope]);
    expect(document.body.querySelectorAll(".suggestion-container")).toHaveLength(1);
    expect(getActiveCloseables()).toEqual([suggest]);

    suggest.suggestions.setSuggestions(["apple"]);
    suggest.close();
    suggest.close();

    expect(app.pushedScopes).toEqual([]);
    expect(app.poppedScopes).toEqual([suggest.scope, suggest.scope, suggest.scope]);
    expect(document.body.querySelector(".suggestion-container")).toBeNull();
    expect(suggest.suggestions.length).toBe(0);
    expect(getActiveCloseables()).toEqual([]);
  });

  it("registers popover suggestions and modals in the same mobile back closeable stack", () => {
    const app = createApp();
    const input = inputEl();
    const suggest = new FruitSuggest(app, input);
    const modal = new Modal(app);

    suggest.open();
    modal.open();

    expect(getActiveCloseables()).toEqual([suggest, modal]);
    expect(Modal.getOpenModals()).toEqual([modal]);

    expect(closeTopActiveCloseable()).toBe(true);

    expect(getActiveCloseables()).toEqual([suggest]);
    expect(modal.containerEl.isConnected).toBe(false);
    expect(suggest.isOpen).toBe(true);

    expect(closeTopActiveCloseable()).toBe(true);

    expect(getActiveCloseables()).toEqual([]);
    expect(suggest.isOpen).toBe(false);
    expect(Modal.getOpenModals()).toEqual([]);
  });

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

  it("updates suggestions immediately on non-iOS focus", () => {
    const originalIos = Platform.isIosApp;
    Platform.isIosApp = false;
    try {
      const input = inputEl();
      const suggest = new FruitSuggest(createApp(), input);
      suggest.values = ["apple"];
      input.value = "a";

      input.focus();

      expect(suggest.isOpen).toBe(true);
      expect(document.body.querySelector(".suggestion-item")?.textContent).toBe("apple");
    } finally {
      Platform.isIosApp = originalIos;
    }
  });

  it("defers focus suggestions on iOS until the next tick", () => {
    vi.useFakeTimers();
    const originalIos = Platform.isIosApp;
    Platform.isIosApp = true;
    try {
      const input = inputEl();
      const suggest = new FruitSuggest(createApp(), input);
      suggest.values = ["apple"];
      input.value = "a";

      input.focus();

      expect(suggest.isOpen).toBe(false);
      expect(document.body.querySelector(".suggestion-item")).toBeNull();

      vi.advanceTimersByTime(50);
      expect(suggest.isOpen).toBe(false);
      vi.advanceTimersByTime(10);

      expect(suggest.isOpen).toBe(true);
      expect(document.body.querySelector(".suggestion-item")?.textContent).toBe("apple");
      suggest.close();
    } finally {
      Platform.isIosApp = originalIos;
      vi.useRealTimers();
    }
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

  it("positions suggestions from input rect plus document scroll", () => {
    const input = inputEl();
    const suggest = new FruitSuggest(createApp(), input);
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 600 });
    Object.defineProperty(document.documentElement, "scrollLeft", { configurable: true, value: 30 });
    Object.defineProperty(document.documentElement, "scrollTop", { configurable: true, value: 200 });
    Object.defineProperty(input, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 20, right: 120, top: 30, bottom: 50, width: 100, height: 20 }),
    });

    suggest.open();

    expect(suggest.suggestEl.style.left).toBe("50px");
    expect(suggest.suggestEl.style.top).toBe("255px");
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
