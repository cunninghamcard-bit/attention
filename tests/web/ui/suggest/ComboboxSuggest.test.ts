import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { App } from "@web/app/App";
import { Keymap } from "@web/app/hotkeys/Keymap";
import { ComboboxSuggest, type ComboboxItem } from "@web/ui/suggest/ComboboxSuggest";

let dom: JSDOM | null = null;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body><div id=\"host\"></div></body></html>", { pretendToBeVisual: true });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("KeyboardEvent", dom.window.KeyboardEvent);
  vi.stubGlobal("MouseEvent", dom.window.MouseEvent);
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

function createApp(): App {
  const keymap = new Keymap(window);
  return {
    keymap,
    scope: keymap.getRootScope(),
  } as unknown as App;
}

function hostEl(): HTMLElement {
  const host = document.querySelector<HTMLElement>("#host");
  if (!host) throw new Error("missing host");
  return host;
}

describe("ComboboxSuggest DOM parity", () => {
  it("constructs Obsidian's combobox button and suggestion shell", () => {
    const combobox = new ComboboxSuggest(createApp(), hostEl());

    expect(combobox.suggestEl.className).toBe("suggestion-container combobox");
    expect([...combobox.suggestEl.children].map((child) => child.className)).toEqual(["search-input-container", "suggestion"]);
    expect(combobox.bgEl.className).toBe("suggestion-bg");
    expect(combobox.bgEl.style.opacity).toBe("0");
    expect(combobox.buttonEl.className).toBe("combobox-button");
    expect(combobox.buttonEl.tabIndex).toBe(0);
    expect([...combobox.buttonEl.children]).toEqual([
      combobox.iconEl,
      combobox.labelEl,
      combobox.clearButtonEl,
      combobox.chevronEl,
    ]);
    expect(combobox.clearButtonEl.classList.contains("combobox-clear-button")).toBe(true);
    expect(combobox.chevronEl.classList.contains("combobox-button-chevron")).toBe(true);
  });

  it("opens from the button, renders filtered complex toggle items, and selects a value", () => {
    const selected: Array<ComboboxItem | null> = [];
    const combobox = new ComboboxSuggest(createApp(), hostEl())
      .setItems([
        { value: "ASC", display: "Sort A to Z", icon: "lucide-arrow-up" },
        { value: "DESC", display: "Sort Z to A" },
      ])
      .setClearable(true)
      .onSelect((value) => selected.push(value));

    combobox.open();

    expect(combobox.isOpen).toBe(true);
    expect(combobox.buttonEl.classList.contains("has-focus")).toBe(true);
    expect(combobox.suggestEl.parentElement).toBe(document.body);
    expect([...combobox.suggestInnerEl.querySelectorAll<HTMLElement>(".suggestion-item")].map((item) => item.textContent)).toEqual([
      "Sort A to Z",
      "Sort Z to A",
    ]);

    combobox.searchComponent.setValue("desc");
    combobox.searchComponent.onChanged();

    const itemEl = combobox.suggestInnerEl.querySelector<HTMLElement>(".suggestion-item");
    expect(itemEl?.classList.contains("mod-complex")).toBe(true);
    expect(itemEl?.classList.contains("mod-toggle")).toBe(true);
    expect(itemEl?.textContent).toContain("Sort Z to A");

    itemEl?.click();

    expect(combobox.getValue()?.value).toBe("DESC");
    expect(combobox.labelEl.textContent).toBe("Sort Z to A");
    expect(combobox.isOpen).toBe(false);
    expect(selected.map((value) => value?.value ?? null)).toEqual(["DESC"]);
  });

  it("marks the current value and clears through the combobox clear button", () => {
    const selected: Array<ComboboxItem | null> = [];
    const combobox = new ComboboxSuggest(createApp(), hostEl())
      .setItems([{ value: "table", display: "Table", icon: "lucide-table" }])
      .setClearable(true)
      .setValueById("table")
      .onSelect((value) => selected.push(value));

    combobox.open();

    expect(combobox.buttonEl.classList.contains("mod-clearable")).toBe(true);
    expect(combobox.iconEl.hidden).toBe(false);
    expect(combobox.suggestInnerEl.querySelector(".suggestion-icon.mod-checked")).not.toBeNull();

    combobox.clearButtonEl.click();

    expect(combobox.getValue()).toBeNull();
    expect(combobox.buttonEl.classList.contains("mod-clearable")).toBe(false);
    expect(selected).toEqual([null]);
  });
});
