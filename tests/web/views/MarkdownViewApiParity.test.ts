import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { Scope } from "@web/app/hotkeys/Scope";
import type { TFile } from "@web/vault/TAbstractFile";
import { MarkdownView } from "@web/views/MarkdownView";

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

  it("exposes the current file through getFile", async () => {
    const { file, view } = await openMarkdown("# hi");

    expect(view.getFile()).toBe(file);
  });

  it("replaces and restores the MarkdownView scope", async () => {
    const { view } = await openMarkdown("# hi");
    const initialScope = view.scope;
    const nextScope = new Scope(null);

    view.replaceScope(nextScope);
    expect(view.scope).toBe(nextScope);

    view.replaceScope(null);
    expect(view.scope).toBe(initialScope);
  });

  it("exposes Obsidian mode toggle APIs including mod-click split behavior", async () => {
    const { app, view } = await openMarkdown("Body text");

    view.toggleMode();
    await vi.waitFor(() => expect(view.getMode()).toBe("preview"));
    await vi.waitFor(() => expect(view.leaf.working).toBe(false));

    view.updateButtons();
    expect(view.modeButtonEl.getAttribute("aria-label")).toBe("Switch to edit view");

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    await view.onSwitchView(click);

    expect(click.defaultPrevented).toBe(true);
    expect(view.getMode()).toBe("source");

    const modClick = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    await view.onSwitchView(modClick);
    const markdownLeaves = app.workspace.getLeavesOfType("markdown");
    const splitLeaf = markdownLeaves.find((leaf) => leaf !== view.leaf);

    expect(modClick.defaultPrevented).toBe(true);
    expect(splitLeaf).not.toBeUndefined();
    expect(splitLeaf?.view).toBeInstanceOf(MarkdownView);
    expect((splitLeaf?.view as MarkdownView | undefined)?.getMode()).toBe("preview");
  });

  it("exposes hover source, undo/redo, spellcheck config, and saveFrontmatter APIs", async () => {
    const { app, file, view } = await openMarkdown("---\nstatus: old\n---\nBody text");
    const undo = vi.spyOn(view.editor, "undo");
    const redo = vi.spyOn(view.editor, "redo");

    expect(view.getHoverSource()).toBe("editor");
    view.undo();
    view.redo();

    expect(undo).toHaveBeenCalled();
    expect(redo).toHaveBeenCalled();

    await view.setMode("preview");
    expect(view.getHoverSource()).toBe("preview");

    app.vault.setConfig("spellcheck", false);
    view.onConfigChanged("spellcheck");
    expect(view.inlineTitleEl.spellcheck).toBe(false);

    app.vault.setConfig("spellcheck", true);
    view.onConfigChanged("spellcheck");
    expect(view.inlineTitleEl.spellcheck).toBe(true);

    await view.saveFrontmatter((frontmatter) => {
      frontmatter.status = "new";
      frontmatter.count = 2;
    });

    const data = await app.vault.read(file);
    expect(data).toContain("status: new");
    expect(data).toContain("count: 2");
  });

  it("reports whether markdown metadata has focus", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const file = await app.vault.create("Note.md", "---\ntitle: Focus\n---\nBody");
    const leaf = app.workspace.getLeaf();
    await leaf.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;

    expect(view.metadataHasFocus()).toBe(false);

    view.metadataContainerEl.focus();

    expect(view.metadataHasFocus()).toBe(true);
  });

  it("exposes Obsidian-style focus shifting around metadata", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const file = await app.vault.create("Note.md", "---\ntitle: Focus\nstatus: open\n---\nBody");
    const leaf = app.workspace.getLeaf();
    await leaf.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;

    view.editor.setCursor(4, 4);
    view.shiftFocusAfter();
    expect(view.editor.getCursor()).toEqual({ line: 0, ch: 0 });

    view.editor.setCursor(4, 4);
    view.setEphemeralState({
      focus: true,
      focusOnMobile: true,
      cursor: { from: { line: 0, ch: 1 } },
    });
    expect(view.editor.getCursor()).toEqual({ line: 0, ch: 1 });

    view.shiftFocusBefore();
    expect(view.metadataHasFocus()).toBe(true);
    expect(document.activeElement).toBe(
      view.metadataContainerEl.querySelectorAll(".metadata-property").item(1),
    );

    view.shiftFocusBefore();
    expect(document.activeElement).toBe(view.inlineTitleEl);

    await view.setMode("preview");
    await view.previewMode.renderer.whenIdle();
    view.shiftFocusAfter();
    expect(document.activeElement).toBe(view.previewMode.renderer.previewEl);
  });

  it("routes clickable tokens through Obsidian-style handlers", async () => {
    const { app, file, view } = await openMarkdown(
      "[[Target]] [Docs][docs] #todo\n\n[docs]: https://example.com",
    );
    await app.metadataCache.computeFileMetadata(file);
    const openLinkText = vi.spyOn(app.workspace, "openLinkText").mockResolvedValue();

    view.triggerClickableToken({ type: "internal-link", text: "Target" });
    await vi.waitFor(() =>
      expect(openLinkText).toHaveBeenCalledWith("Target", "Note.md", undefined),
    );
    openLinkText.mockClear();

    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 8,
      clientY: 1,
    });
    view.editorViewHost.contentEl.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(openLinkText).toHaveBeenCalledWith("Target", "Note.md", false));

    const open = vi.fn();
    Object.defineProperty(window, "open", { configurable: true, value: open });
    view.triggerClickableToken({ type: "external-link", text: "mailto:x@example.com" });
    expect(open).toHaveBeenCalledWith("mailto:x@example.com");
    view.triggerClickableToken({ type: "external-ref-link", text: "docs" }, "pane");
    expect(open).toHaveBeenCalledWith("https://example.com", "pane");
    expect(view.getClickableTokenHref({ type: "external-ref-link", id: "docs" })).toBe(
      "https://example.com",
    );

    const openGlobalSearch = vi.fn();
    vi.spyOn(app.internalPlugins, "getEnabledPluginById").mockReturnValue({
      openGlobalSearch,
    } as never);
    view.triggerClickableToken({ type: "tag", text: "todo" });
    expect(openGlobalSearch).toHaveBeenCalledWith("tag:#todo");
  });

  it("gets selection from the active markdown mode", async () => {
    const { app, view } = await openMarkdown("Alpha beta");
    document.body.appendChild(app.containerEl);

    view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 });
    expect(view.getSelection()).toBe("Alpha");

    await view.setMode("preview");
    await view.previewMode.renderer.whenIdle();

    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(view.previewMode.renderer.sizerEl);
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(view.getSelection()).toContain("Alpha beta");
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
    expect(view.editor.posToOffset(view.editor.getCursor("from"))).toBe("Alpha beta ".length);
    expect(view.editor.posToOffset(view.editor.getCursor("to"))).toBe("Alpha beta alpha".length);
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
    expectSvgIcon(
      view.containerEl.querySelector<HTMLElement>("button[aria-label='Switch to reading view']"),
    );
    expect(view.containerEl.querySelector("button.markdown-toggle-source-mode")).toBeNull();
    expectSvgIcon(
      view.metadataContainerEl.querySelector<HTMLElement>(
        ".metadata-properties-heading .collapse-icon",
      ),
    );
    expectSvgIcon(
      view.metadataContainerEl.querySelector<HTMLElement>(".metadata-add-button .text-button-icon"),
    );
    expectSvgIcon(view.metadataContainerEl.querySelector<HTMLElement>(".metadata-property-icon"));
    expectSvgIcon(view.metadataContainerEl.querySelector<HTMLElement>(".metadata-property-delete"));
  });

  it("does not keep data-icon assignments in MarkdownView source", async () => {
    const fs = (await import("node:" + "fs")) as {
      readFileSync(path: string, encoding: "utf8"): string;
    };
    const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
    const source = fs.readFileSync(`${cwd}/src/renderer/views/MarkdownView.ts`, "utf8");

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
    expect(view.editor.getValue()).toBe("");
    expect(view.previewRendererEl.textContent).not.toContain("Body text");

    await view.setMode("source");

    expect(view.getViewData()).toBe("");
    expect(view.editor.getValue()).toBe("");
  });
});

async function openMarkdown(
  source: string,
): Promise<{ app: App; file: TFile; view: MarkdownView }> {
  const app = new App(document.createElement("div"));
  await app.ready;
  const file = await app.vault.create("Note.md", source);
  const leaf = app.workspace.getLeaf();
  await leaf.openFile(file, { active: true, state: { mode: "source" } });
  return { app, file, view: leaf.view as MarkdownView };
}

function getDocumentSearchContainer(view: MarkdownView): HTMLElement {
  const containerEl = view.editorContainerEl.querySelector<HTMLElement>(
    ".document-search-container",
  );
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
  const buttonEl = [
    ...view.editorContainerEl.querySelectorAll<HTMLButtonElement>(".document-search-button"),
  ].find((element) => element.getAttribute("aria-label") === label);
  if (!buttonEl) throw new Error(`Missing search button: ${label}`);
  return buttonEl;
}

function expectSvgIcon(element: HTMLElement | null): asserts element is HTMLElement {
  expect(element).not.toBeNull();
  if (!element) return;
  expect(element.hasAttribute("data-icon")).toBe(false);
  expect(element.querySelector("svg.svg-icon")).not.toBeNull();
}
