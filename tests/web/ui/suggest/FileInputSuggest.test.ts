import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { App } from "@web/app/App";
import { Keymap } from "@web/app/hotkeys/Keymap";
import { Vault } from "@web/vault/Vault";
import {
  FileInputSuggest,
  FilteredFileInputSuggest,
  FilteredFolderInputSuggest,
  FolderInputSuggest,
  FullPathFileInputSuggest,
  MarkdownFileInputSuggest,
  type FolderSuggestion,
  type InputFileSuggestion,
} from "@web/ui/suggest/FileInputSuggest";

let dom: JSDOM | null = null;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><input id="path-input"></body></html>', {
    pretendToBeVisual: true,
  });
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

function inputEl(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("#path-input");
  if (!input) throw new Error("missing input");
  return input;
}

function createApp(vault: Vault): App {
  const keymap = new Keymap(window);
  return {
    keymap,
    scope: keymap.getRootScope(),
    vault,
  } as unknown as App;
}

async function createVault(): Promise<Vault> {
  const vault = new Vault();
  await vault.create("Notes/Alpha.md", "alpha");
  await vault.create("Notes/Beta.canvas", "{}");
  await vault.create("Archive/Gamma.md", "gamma");
  await vault.createFolder("Empty");
  return vault;
}

describe("FileInputSuggest DOM and behavior parity", () => {
  it("renders file suggestions as nowrap items and selects markdown paths without .md", async () => {
    const vault = await createVault();
    const input = inputEl();
    const suggest = new FileInputSuggest(createApp(vault), input);
    const selected: Array<InputFileSuggestion<never>> = [];
    const inputListener = vi.fn();
    const changeListener = vi.fn();
    suggest.onSelect((value) => selected.push(value as InputFileSuggestion<never>));
    input.addEventListener("input", inputListener);
    input.addEventListener("change", changeListener);

    input.focus();
    input.value = "alpha";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const itemEl = document.body.querySelector<HTMLElement>(".suggestion-item");
    expect(itemEl?.classList.contains("mod-nowrap")).toBe(true);
    expect(itemEl?.textContent).toBe("Notes/Alpha");

    itemEl?.click();

    expect(input.value).toBe("Notes/Alpha");
    expect(inputListener).toHaveBeenCalledTimes(2);
    expect(changeListener).toHaveBeenCalledTimes(1);
    expect(selected).toHaveLength(0);
  });

  it("filters markdown files and predicate files like the original file suggest subclasses", async () => {
    const vault = await createVault();
    const input = inputEl();
    const app = createApp(vault);
    const markdownSuggest = new MarkdownFileInputSuggest(app, input);
    const filteredSuggest = new FilteredFileInputSuggest(
      app,
      input,
      (file) => file.extension === "canvas",
    );

    expect(markdownSuggest.getSuggestions("").map((suggestion) => suggestion.item.path)).toEqual([
      "Notes/Alpha.md",
      "Archive/Gamma.md",
    ]);
    expect(filteredSuggest.getSuggestions("").map((suggestion) => suggestion.item.path)).toEqual([
      "Notes/Beta.canvas",
    ]);
  });

  it("supports full-path file selection for declarative file setting controls", async () => {
    const vault = await createVault();
    const input = inputEl();
    const suggest = new FullPathFileInputSuggest(
      createApp(vault),
      input,
      (file) => file.extension === "md",
    );

    input.focus();
    input.value = "alpha";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const itemEl = document.body.querySelector<HTMLElement>(".suggestion-item");
    expect(itemEl?.textContent).toBe("Notes/Alpha.md");

    itemEl?.click();

    expect(input.value).toBe("Notes/Alpha.md");
    expect(suggest.getSuggestions("").map((suggestion) => suggestion.item.path)).toEqual([
      "Notes/Alpha.md",
      "Archive/Gamma.md",
    ]);
  });

  it("suggests folders, optionally includes root, and appends null selection", async () => {
    const vault = await createVault();
    const input = inputEl();
    const selected: FolderSuggestion[] = [];
    const inputListener = vi.fn();
    const changeListener = vi.fn();
    const suggest = new FolderInputSuggest(createApp(vault), input, true, true).onSelect((value) =>
      selected.push(value),
    );
    input.addEventListener("input", inputListener);
    input.addEventListener("change", changeListener);

    expect(vault.getAllFolders(false).map((folder) => folder.path)).toEqual([
      "Notes",
      "Archive",
      "Empty",
    ]);
    expect(vault.getAllFolders(true).map((folder) => folder.path)).toEqual([
      "/",
      "Notes",
      "Archive",
      "Empty",
    ]);

    input.focus();
    input.value = "NewFolder";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const items = [...document.body.querySelectorAll<HTMLElement>(".suggestion-item")];
    expect(items.map((item) => item.textContent)).toContain("+ NewFolder");

    items.at(-1)?.click();

    expect(selected).toEqual([null]);
    expect(inputListener).toHaveBeenCalledTimes(1);
    expect(changeListener).not.toHaveBeenCalled();
  });

  it("selects a folder with input-only events and calls onSelect", async () => {
    const vault = await createVault();
    const input = inputEl();
    const selected: FolderSuggestion[] = [];
    const inputListener = vi.fn();
    const changeListener = vi.fn();
    new FolderInputSuggest(createApp(vault), input).onSelect((value) => selected.push(value));
    input.addEventListener("input", inputListener);
    input.addEventListener("change", changeListener);

    input.focus();
    input.value = "Archive";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    document.body.querySelector<HTMLElement>(".suggestion-item")?.click();

    expect(input.value).toBe("Archive");
    expect(inputListener).toHaveBeenCalledTimes(2);
    expect(changeListener).not.toHaveBeenCalled();
    expect(selected.map((value) => value?.item.path ?? null)).toEqual(["Archive"]);
  });

  it("applies folder predicates", async () => {
    const vault = await createVault();
    const suggest = new FilteredFolderInputSuggest(createApp(vault), inputEl(), (folder) =>
      folder.path.startsWith("A"),
    );

    expect(suggest.getSuggestions("").map((value) => value?.item.path)).toEqual(["Archive"]);
  });

  it("passes includeRoot through filtered folder suggestions", async () => {
    const vault = await createVault();
    const suggest = new FilteredFolderInputSuggest(
      createApp(vault),
      inputEl(),
      (folder) => folder.path === "/" || folder.path.startsWith("A"),
      false,
      true,
    );

    expect(suggest.getSuggestions("").map((value) => value?.item.path)).toEqual(["/", "Archive"]);
  });
});
