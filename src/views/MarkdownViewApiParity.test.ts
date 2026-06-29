import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import type { TFile } from "../vault/TAbstractFile";
import { MarkdownView } from "./MarkdownView";

describe("MarkdownView public API parity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
    });
    Object.defineProperty(window, "focus", {
      configurable: true,
      value: () => {},
    });
  });

  it("exposes hoverPopover and an Obsidian-style document search panel", async () => {
    const { view } = await openMarkdown("Alpha beta alpha");

    expect(view.hoverPopover).toBeNull();

    view.showSearch();

    const containerEl = getDocumentSearchContainer(view);
    const searchInputEl = getSearchInput(view);
    const countEl = getSearchCount(view);
    expect(containerEl.parentElement).toBe(view.editorContainerEl);
    expect(containerEl.hidden).toBe(false);
    expect(containerEl.classList.contains("mod-replace-mode")).toBe(false);
    expect(view.editorContainerEl.classList.contains("is-searching")).toBe(true);

    searchInputEl.value = "alpha";
    searchInputEl.dispatchEvent(new Event("input", { bubbles: true }));

    expect(countEl.textContent).toBe("1/2");
    getSearchButton(view, "Next match").click();
    await Promise.resolve();
    expect(countEl.textContent).toBe("2/2");
    expect(view.sourceTextAreaEl.selectionStart).toBe("Alpha beta ".length);
    expect(view.sourceTextAreaEl.selectionEnd).toBe("Alpha beta alpha".length);
  });

  it("uses the same search panel for replace mode and edits through the view buffer", async () => {
    const { view } = await openMarkdown("Alpha beta alpha");

    view.showSearch(true);

    const containerEl = getDocumentSearchContainer(view);
    const searchInputEl = getSearchInput(view);
    const replaceInputEl = getReplaceInput(view);
    expect(containerEl.classList.contains("mod-replace-mode")).toBe(true);
    expect(view.editorContainerEl.classList.contains("is-replacing")).toBe(true);

    searchInputEl.value = "alpha";
    searchInputEl.dispatchEvent(new Event("input", { bubbles: true }));
    replaceInputEl.value = "gamma";
    getSearchButton(view, "Replace current match").click();

    expect(view.getViewData()).toBe("gamma beta alpha");

    searchInputEl.value = "alpha";
    searchInputEl.dispatchEvent(new Event("input", { bubbles: true }));
    getSearchButton(view, "Replace all matches").click();

    expect(view.getViewData()).toBe("gamma beta gamma");
  });

  it("renders MarkdownView controls through the svg icon contract instead of data-icon", async () => {
    const { view } = await openMarkdown("---\ntitle: Alpha\n---\nAlpha beta");

    view.showSearch();

    expectSvgIcon(getSearchButton(view, "Previous match"));
    expectSvgIcon(getSearchButton(view, "Next match"));
    expectSvgIcon(view.containerEl.querySelector<HTMLElement>("button[aria-label='Show reading view']"));
    expectSvgIcon(view.containerEl.querySelector<HTMLElement>("button[aria-label='Use live preview'], button[aria-label='Use source mode']"));
    expectSvgIcon(view.metadataContainerEl.querySelector<HTMLElement>(".metadata-properties-heading .collapse-icon"));
    expectSvgIcon(view.metadataContainerEl.querySelector<HTMLElement>(".metadata-add-button .text-button-icon"));
    expectSvgIcon(view.metadataContainerEl.querySelector<HTMLElement>(".metadata-property-icon"));
    expectSvgIcon(view.metadataContainerEl.querySelector<HTMLElement>(".metadata-property-delete"));
  });

  it("does not keep data-icon assignments in MarkdownView source", async () => {
    const fs = await import("node:" + "fs") as { readFileSync(path: string, encoding: "utf8"): string };
    const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
    const source = fs.readFileSync(`${cwd}/src/views/MarkdownView.ts`, "utf8");

    expect(source).not.toContain("dataset.icon");
  });

  it("clears source and preview modes through MarkdownView.clear", async () => {
    const { view } = await openMarkdown("Body text");

    await view.setMode("preview");
    await view.previewMode.renderer.whenIdle();
    expect(view.previewRendererEl.textContent).toContain("Body text");

    view.clear();
    await view.previewMode.renderer.whenIdle();

    expect(view.getViewData()).toBe("");
    expect(view.editor.getValue()).toBe("");
    expect(view.sourceTextAreaEl.value).toBe("");
    expect(view.previewRendererEl.textContent).not.toContain("Body text");

    await view.setMode("source");

    expect(view.getViewData()).toBe("");
    expect(view.sourceTextAreaEl.value).toBe("");
  });
});

async function openMarkdown(source: string): Promise<{ app: App; file: TFile; view: MarkdownView }> {
  const app = new App(document.createElement("div"));
  await app.ready;
  const file = await app.vault.create("Note.md", source);
  const leaf = app.workspace.getLeaf();
  await leaf.openFile(file, { active: true, state: { mode: "source" } });
  return { app, file, view: leaf.view as MarkdownView };
}

function getDocumentSearchContainer(view: MarkdownView): HTMLElement {
  const containerEl = view.editorContainerEl.querySelector<HTMLElement>(".document-search-container");
  if (!containerEl) throw new Error("Missing document search container");
  return containerEl;
}

function getSearchInput(view: MarkdownView): HTMLInputElement {
  const inputEl = view.editorContainerEl.querySelector<HTMLInputElement>(".document-search-input");
  if (!inputEl) throw new Error("Missing document search input");
  return inputEl;
}

function getReplaceInput(view: MarkdownView): HTMLInputElement {
  const inputEl = view.editorContainerEl.querySelector<HTMLInputElement>(".document-replace-input");
  if (!inputEl) throw new Error("Missing document replace input");
  return inputEl;
}

function getSearchCount(view: MarkdownView): HTMLElement {
  const countEl = view.editorContainerEl.querySelector<HTMLElement>(".document-search-count");
  if (!countEl) throw new Error("Missing document search count");
  return countEl;
}

function getSearchButton(view: MarkdownView, label: string): HTMLButtonElement {
  const buttonEl = [...view.editorContainerEl.querySelectorAll<HTMLButtonElement>(".document-search-button")]
    .find((element) => element.getAttribute("aria-label") === label);
  if (!buttonEl) throw new Error(`Missing search button: ${label}`);
  return buttonEl;
}

function expectSvgIcon(element: HTMLElement | null): asserts element is HTMLElement {
  expect(element).not.toBeNull();
  if (!element) return;
  expect(element.hasAttribute("data-icon")).toBe(false);
  expect(element.querySelector("svg.svg-icon")).not.toBeNull();
}
