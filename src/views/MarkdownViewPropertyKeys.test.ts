import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { editorLivePreviewField } from "../editor/EditorStateField";
import { MarkdownPreviewRenderer } from "../markdown/MarkdownPreviewRenderer";
import type { MarkdownPostProcessor } from "../markdown/MarkdownRenderer";
import type { Menu } from "../ui/Menu";
import type { TFile } from "../vault/TAbstractFile";
import { MarkdownView } from "./MarkdownView";

describe("MarkdownView property key input", () => {
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
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    document.body.querySelectorAll(".menu, .modal-container, .notice").forEach((el) => el.remove());
  });

  it("renames a frontmatter key from the metadata key input", async () => {
    const { view } = await openPropertyNote("---\nrating: 5\nstatus: open\n---\nBody");
    const inputEl = getKeyInput(view, "rating");

    inputEl.value = "score";
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(view.getViewData()).toContain("score: 5");
    expect(view.getViewData()).not.toContain("rating: 5");
    expect(view.metadataContainerEl.querySelector('[data-property-key="score"]')).not.toBeNull();
  });

  it("rejects empty and duplicate frontmatter keys without saving", async () => {
    const { view } = await openPropertyNote("---\nrating: 5\nstatus: open\n---\nBody");
    const inputEl = getKeyInput(view, "rating");

    inputEl.value = "status";
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(inputEl.classList.contains("mod-error")).toBe(true);
    expect(view.getViewData()).toContain("rating: 5");
    expect(view.getViewData()).toContain("status: open");

    inputEl.value = "";
    inputEl.dispatchEvent(new FocusEvent("blur", { bubbles: true }));

    expect(inputEl.value).toBe("rating");
    expect(view.getViewData()).toContain("rating: 5");
  });

  it("adds an empty property row and saves it after the key is confirmed", async () => {
    const { view } = await openPropertyNote("Body");
    const addButton = view.metadataContainerEl.querySelector<HTMLButtonElement>(".metadata-add-button");
    if (!addButton) throw new Error("missing add property button");

    addButton.click();
    const inputEl = getKeyInput(view, "");
    inputEl.value = "created";
    inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(view.getViewData()).toBe([
      "---",
      "created:",
      "---",
      "Body",
    ].join("\n"));
    expect(view.metadataContainerEl.querySelector('[data-property-key="created"]')).not.toBeNull();
  });

  it("reorders properties by dragging the metadata property icon", async () => {
    const { view } = await openPropertyNote("---\nfirst: 1\nsecond: 2\nthird: 3\n---\nBody");
    const draggedIcon = getPropertyRow(view, "third").querySelector<HTMLElement>(".metadata-property-icon");
    const targetRow = getPropertyRow(view, "first");
    if (!draggedIcon) throw new Error("missing drag icon");
    const dataTransfer = createDataTransfer();

    dispatchDragEvent(draggedIcon, "dragstart", dataTransfer);
    dispatchDragEvent(targetRow, "drop", dataTransfer);

    expect(view.getViewData()).toBe([
      "---",
      "third: 3",
      "first: 1",
      "second: 2",
      "---",
      "Body",
    ].join("\n"));
  });

  it("collapses metadata content and exposes heading sort/clear actions", async () => {
    const { view } = await openPropertyNote("---\nz10: ten\nA2: two\na1: one\n---\nBody");
    let headingEl = view.metadataContainerEl.querySelector<HTMLElement>(".metadata-properties-heading");
    let contentEl = view.metadataContainerEl.querySelector<HTMLElement>(".metadata-content");
    if (!headingEl || !contentEl) throw new Error("missing metadata heading");

    headingEl.click();
    expect(view.metadataContainerEl.classList.contains("is-collapsed")).toBe(true);
    expect(view.metadataContainerEl.querySelector<HTMLElement>(".metadata-content")?.hidden).toBe(true);

    headingEl = view.metadataContainerEl.querySelector<HTMLElement>(".metadata-properties-heading");
    contentEl = view.metadataContainerEl.querySelector<HTMLElement>(".metadata-content");
    if (!headingEl || !contentEl) throw new Error("missing metadata heading after collapse");
    headingEl.click();
    expect(view.metadataContainerEl.classList.contains("is-collapsed")).toBe(false);

    headingEl = view.metadataContainerEl.querySelector<HTMLElement>(".metadata-properties-heading");
    if (!headingEl) throw new Error("missing metadata heading after expand");
    headingEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    findMenuItem("Sort").dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    findMenuItem("Sort properties A to Z").click();

    expect(getPropertyKeys(view)).toEqual(["a1", "A2", "z10"]);
    expect(view.getViewData()).toBe([
      "---",
      "z10: ten",
      "A2: two",
      "a1: one",
      "---",
      "Body",
    ].join("\n"));

    headingEl = view.metadataContainerEl.querySelector<HTMLElement>(".metadata-properties-heading");
    if (!headingEl) throw new Error("missing metadata heading after sort");
    headingEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    findMenuItem("Clear properties").click();

    expect(view.getViewData()).toBe("Body");
  });

  it("persists metadata collapse through Obsidian's zero-line fold sentinel", async () => {
    const { app, file, view } = await openPropertyNote("---\nstatus: open\n---\nBody");
    const headingEl = view.metadataContainerEl.querySelector<HTMLElement>(".metadata-properties-heading");
    if (!headingEl) throw new Error("missing metadata heading");

    headingEl.click();

    expect(app.foldManager.get(file)).toEqual({ folds: [{ from: 0, to: 0 }], lines: 4 });
    expect(view.getState()).not.toHaveProperty("propertiesCollapsed");
    expect(view.getState()).not.toHaveProperty("foldInfo");

    view.setMode("preview");
    expect(view.metadataContainerEl.querySelector<HTMLElement>(".metadata-content")?.hidden).toBe(true);

    app.foldManager.save(file, { folds: [], lines: 4 });
    await view.setState({ mode: "source", source: true });
    expect(view.canShowProperties()).toBe(false);
    expect(view.metadataContainerEl.hidden).toBe(true);

    await view.setState({ mode: "source", source: false });
    expect(view.metadataContainerEl.querySelector<HTMLElement>(".metadata-content")?.hidden).toBe(false);

    view.setMode("preview");
    view.metadataContainerEl.querySelector<HTMLElement>(".metadata-properties-heading")?.click();
    expect(app.foldManager.get(file)).toEqual({ folds: [{ from: 0, to: 2 }], lines: 4 });

    await view.setState({ mode: "source", source: true });
    expect(view.canShowProperties()).toBe(false);
    expect(view.metadataContainerEl.hidden).toBe(true);
  });

  it("drives mode state through currentMode and editMode sourceMode", async () => {
    const { view } = await openPropertyNote("---\nstatus: open\n---\nBody");

    expect(view.currentMode).toBe(view.editMode);
    expect(view.getState()).toMatchObject({ mode: "source", source: false });
    expect(view.containerEl.dataset.mode).toBe("source");
    expect(view.contentEl.dataset.mode).toBe("source");
    expect(view.containerEl.classList.contains("is-read-mode")).toBe(false);
    expect(view.containerEl.classList.contains("is-live-preview")).toBe(false);
    expect(view.editorContainerEl.parentElement).toBe(view.contentEl);
    expect(view.previewContainerEl.parentElement).toBe(view.contentEl);
    expect(view.editorContainerEl.hidden).toBe(false);
    expect(view.previewContainerEl.hidden).toBe(false);
    expect(view.editorContainerEl.style.display).toBe("");
    expect(view.previewContainerEl.style.display).toBe("none");
    expect(view.sourceMode.cmEditor).toBe(view.editor);
    expect(view.inlineTitleEl.parentElement).toBe(view.editorViewHost.sizerEl);
    expect(view.metadataContainerEl.parentElement).toBe(view.editorViewHost.sizerEl);
    expect(view.backlinksEl.parentElement).toBe(view.editorViewHost.sizerEl);
    expect(view.editorViewHost.sizerEl.firstElementChild).toBe(view.inlineTitleEl);
    expect(view.editorContainerEl.classList.contains("cm-editor")).toBe(false);
    expect(view.editorViewHost.dom.classList.contains("cm-editor")).toBe(true);
    expect(view.editorViewHost.scrollerEl.classList.contains("cm-scroller")).toBe(true);
    expect(view.editorViewHost.sizerEl.classList.contains("cm-sizer")).toBe(true);
    expect(view.editorViewHost.contentContainerEl.classList.contains("cm-contentContainer")).toBe(true);
    expect(view.editorViewHost.contentEl.classList.contains("cm-content")).toBe(true);
    expect(view.sourceTextAreaEl.parentElement).toBe(view.editorViewHost.contentEl);
    expect(view.editorViewHost.getStateField(editorLivePreviewField)).toBe(true);
    expect(view.editorViewHost.dom.dataset.livePreview).toBe("true");
    expect(view.previewMode.renderer.header).not.toBeNull();
    expect(view.previewMode.renderer.footer).not.toBeNull();
    expect(view.editorContainerEl.classList.contains("cm-s-obsidian")).toBe(true);
    expect(view.editorContainerEl.classList.contains("mod-cm6")).toBe(true);
    expect(view.editorContainerEl.classList.contains("is-live-preview")).toBe(true);
    expect(view.sourceTextAreaEl.classList.contains("is-live-preview")).toBe(false);

    view.setMode("source", true);
    expect(view.currentMode).toBe(view.editMode);
    expect(view.getSourceMode()).toBe("source");
    expect(view.getState()).toMatchObject({ mode: "source", source: true });
    expect(view.containerEl.classList.contains("is-source-mode")).toBe(false);
    expect(view.containerEl.classList.contains("is-live-preview")).toBe(false);
    expect(view.editorContainerEl.classList.contains("is-source-mode")).toBe(false);
    expect(view.editorContainerEl.classList.contains("is-live-preview")).toBe(false);
    expect(view.sourceTextAreaEl.classList.contains("is-live-preview")).toBe(false);
    expect(view.editorContainerEl.parentElement).toBe(view.contentEl);
    expect(view.previewContainerEl.parentElement).toBe(view.contentEl);
    expect(view.editorContainerEl.style.display).toBe("");
    expect(view.previewContainerEl.style.display).toBe("none");
    expect(view.editorViewHost.getStateField(editorLivePreviewField)).toBe(false);
    expect(view.editorViewHost.dom.dataset.livePreview).toBe("false");
    expect(view.canShowProperties()).toBe(false);
    expect(view.metadataContainerEl.hidden).toBe(true);

    view.setMode("preview");
    await view.previewMode.renderer.whenIdle();
    expect(view.currentMode).toBe(view.previewMode);
    expect(view.getState()).toMatchObject({ mode: "preview", source: true });
    expect(view.containerEl.dataset.mode).toBe("preview");
    expect(view.contentEl.dataset.mode).toBe("preview");
    expect(view.containerEl.classList.contains("is-read-mode")).toBe(false);
    expect(view.containerEl.classList.contains("is-source-mode")).toBe(false);
    expect(view.containerEl.classList.contains("is-live-preview")).toBe(false);
    expect(view.editorContainerEl.parentElement).toBe(view.contentEl);
    expect(view.previewContainerEl.parentElement).toBe(view.contentEl);
    expect(view.editorContainerEl.hidden).toBe(false);
    expect(view.previewContainerEl.hidden).toBe(false);
    expect(view.editorContainerEl.style.display).toBe("none");
    expect(view.previewContainerEl.style.display).toBe("");
    expect(view.previewContainerEl.classList.contains("markdown-reading-view")).toBe(true);
    expect(view.inlineTitleEl.parentElement).toBe(view.previewMode.renderer.header?.el);
    expect(view.metadataContainerEl.parentElement).toBe(view.previewMode.renderer.header?.el);
    expect(view.backlinksEl.parentElement).toBe(view.previewMode.renderer.footer?.el);
    expect(view.previewRendererEl.classList.contains("markdown-preview-view")).toBe(true);
    expect(view.previewRendererEl.classList.contains("markdown-rendered")).toBe(true);
    expect(view.previewRendererEl.classList.contains("show-properties")).toBe(true);
    expect(view.metadataContainerEl.hidden).toBe(false);
    expect(view.previewRendererEl.querySelector(".markdown-preview-sizer.markdown-preview-section")).not.toBeNull();
    expect(view.previewRendererEl.querySelector(".markdown-preview-pusher")).not.toBeNull();

    await view.setState({ mode: "source", source: false });
    expect(view.currentMode).toBe(view.editMode);
    expect(view.getSourceMode()).toBe("live");
    expect(view.getState()).toMatchObject({ mode: "source", source: false });
    expect(view.containerEl.dataset.mode).toBe("source");
    expect(view.contentEl.dataset.mode).toBe("source");
    expect(view.containerEl.classList.contains("is-read-mode")).toBe(false);
    expect(view.containerEl.classList.contains("is-source-mode")).toBe(false);
    expect(view.containerEl.classList.contains("is-live-preview")).toBe(false);
    expect(view.editorContainerEl.parentElement).toBe(view.contentEl);
    expect(view.previewContainerEl.parentElement).toBe(view.contentEl);
    expect(view.editorContainerEl.style.display).toBe("");
    expect(view.previewContainerEl.style.display).toBe("none");
    expect(view.inlineTitleEl.parentElement).toBe(view.editorViewHost.sizerEl);
    expect(view.metadataContainerEl.parentElement).toBe(view.editorViewHost.sizerEl);
    expect(view.backlinksEl.parentElement).toBe(view.editorViewHost.sizerEl);
    expect(view.editorContainerEl.classList.contains("is-live-preview")).toBe(true);
    expect(view.sourceTextAreaEl.classList.contains("is-live-preview")).toBe(false);
    expect(view.editorViewHost.getStateField(editorLivePreviewField)).toBe(true);
    expect(view.editorViewHost.dom.dataset.livePreview).toBe("true");
    expect(view.canShowProperties()).toBe(true);
    expect(view.metadataContainerEl.hidden).toBe(false);
  });

  it("updates properties in document visibility from vault config", async () => {
    const { app, view } = await openPropertyNote("---\nstatus: open\n---\nBody");

    expect(view.canShowProperties()).toBe(true);
    expect(view.metadataContainerEl.hidden).toBe(false);
    expect(view.previewRendererEl.classList.contains("show-properties")).toBe(false);

    app.vault.setConfig("propertiesInDocument", "hidden");

    expect(view.canShowProperties()).toBe(false);
    expect(view.metadataContainerEl.hidden).toBe(true);
    expect(view.contentEl.classList.contains("show-properties")).toBe(false);

    await view.setState({ mode: "preview", source: false });
    expect(view.previewRendererEl.classList.contains("show-properties")).toBe(false);
    expect(view.metadataContainerEl.hidden).toBe(true);

    app.vault.setConfig("propertiesInDocument", "visible");

    expect(view.canShowProperties()).toBe(true);
    expect(view.previewRendererEl.classList.contains("show-properties")).toBe(true);
    expect(view.metadataContainerEl.hidden).toBe(false);

    app.vault.setConfig("propertiesInDocument", "source");

    expect(view.canShowProperties()).toBe(false);
    expect(view.previewRendererEl.classList.contains("show-properties")).toBe(true);
    expect(view.metadataContainerEl.hidden).toBe(true);
  });

  it("fires source editor selection and editor menu workspace events", async () => {
    const { app, view } = await openPropertyNote("Alpha beta");
    const selectionEvents: Array<{ editor: unknown; view: unknown }> = [];
    let menuEvent: { editor: unknown; view: unknown } | null = null;
    app.workspace.on("editor-selection-change", (editor, eventView) => {
      selectionEvents.push({ editor, view: eventView });
    });
    app.workspace.on("editor-menu", (menu, editor, eventView) => {
      menuEvent = { editor, view: eventView };
      (menu as Menu).addItem((item) => item.setTitle("Plugin action"));
    });

    view.sourceTextAreaEl.focus();
    view.sourceTextAreaEl.setSelectionRange(0, 5);
    view.sourceTextAreaEl.dispatchEvent(new Event("select", { bubbles: true }));

    expect(selectionEvents).toEqual([{ editor: view.editor, view }]);
    expect(view.editor.getCursor()).toEqual({ line: 0, ch: 5 });

    const menuEventObject = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 12 });
    view.sourceTextAreaEl.dispatchEvent(menuEventObject);

    expect(menuEvent).toEqual({ editor: view.editor, view });
    expect(menuEventObject.defaultPrevented).toBe(true);
    expect(findMenuItem("Insert link")).not.toBeNull();
    expect(findMenuItem("Insert external link")).not.toBeNull();
    expect(findMenuItem("Cut")).not.toBeNull();
    expect(findMenuItem("Copy")).not.toBeNull();
    expect(findMenuItem("Paste")).not.toBeNull();
    expect(findMenuItem("Paste as plain text")).not.toBeNull();
    expect(findMenuItem("Select all")).not.toBeNull();
    expect(findMenuItem("Plugin action")).not.toBeNull();
  });

  it("fires source and preview markdown viewport gutter menus", async () => {
    const { app, view } = await openPropertyNote("Alpha beta");
    const events: Array<{ view: unknown; mode: unknown; source: unknown }> = [];
    app.workspace.on("markdown-viewport-menu", (menu, eventView, mode, source) => {
      events.push({ view: eventView, mode, source });
      (menu as Menu).addItem((item) => item.setTitle("Viewport action"));
    });

    const sourceEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 8 });
    view.editorViewHost.guttersEl.dispatchEvent(sourceEvent);

    expect(sourceEvent.defaultPrevented).toBe(true);
    expect(events).toEqual([{ view, mode: "source", source: "gutter" }]);

    await view.setMode("preview");
    await view.previewMode.renderer.whenIdle();
    const previewEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 9, clientY: 11 });
    view.previewRendererEl.dispatchEvent(previewEvent);

    expect(previewEvent.defaultPrevented).toBe(true);
    expect(events).toEqual([
      { view, mode: "source", source: "gutter" },
      { view, mode: "preview", source: "gutter" },
    ]);
  });

  it("adds editor link context actions when source contextmenu hits an internal link", async () => {
    const { view } = await openPropertyNote("See [[Target]]");

    const menuEventObject = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 52, clientY: 1 });
    view.sourceTextAreaEl.dispatchEvent(menuEventObject);

    expect(menuEventObject.defaultPrevented).toBe(true);
    findMenuItem("Edit link").click();

    expect(view.editor.getSelection()).toBe("[[Target]]");
    expect(view.sourceTextAreaEl.selectionStart).toBe(4);
    expect(view.sourceTextAreaEl.selectionEnd).toBe(14);
  });

  it("adds editor tag context actions when source contextmenu hits a tag", async () => {
    const { view } = await openPropertyNote("Task #project/today");

    const menuEventObject = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 62, clientY: 1 });
    view.sourceTextAreaEl.dispatchEvent(menuEventObject);

    expect(menuEventObject.defaultPrevented).toBe(true);
    findMenuItem("Edit tag").click();

    expect(view.editor.getSelection()).toBe("project/today");
    expect(view.sourceTextAreaEl.selectionStart).toBe("Task #".length);
    expect(view.sourceTextAreaEl.selectionEnd).toBe("Task #project/today".length);
  });

  it("adds editor footref context actions that remove the reference and note definition", async () => {
    const { app, file, view } = await openPropertyNote("Text [^one]\n\n[^one]: Footnote\nNext");
    await app.metadataCache.computeFileMetadata(file);

    const menuEventObject = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 42, clientY: 1 });
    view.sourceTextAreaEl.dispatchEvent(menuEventObject);

    expect(menuEventObject.defaultPrevented).toBe(true);
    findMenuItem("Delete footref and note").click();

    expect(view.getViewData()).toBe("Text \n\nNext");
    expect(view.sourceTextAreaEl.value).toBe("Text \n\nNext");
  });

  it("adds editor external reference link actions through metadata cache", async () => {
    const { app, file, view } = await openPropertyNote("Read [Docs][docs]\n\n[docs]: https://example.com");
    await app.metadataCache.computeFileMetadata(file);
    const urlMenu = vi.fn((menu: unknown, url: unknown) => {
      expect(url).toBe("https://example.com");
      (menu as Menu).addItem((item) => item.setTitle("Plugin URL action"));
    });
    app.workspace.on("url-menu", urlMenu);

    const menuEventObject = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 1 });
    view.sourceTextAreaEl.dispatchEvent(menuEventObject);

    expect(menuEventObject.defaultPrevented).toBe(true);
    expect(document.body.textContent).not.toContain("Edit link");
    expect(findMenuItem("Open link")).not.toBeNull();
    expect(findMenuItem("Copy URL")).not.toBeNull();
    expect(findMenuItem("Plugin URL action")).not.toBeNull();
    expect(urlMenu).toHaveBeenCalled();
  });

  it("forwards source editor paste and drop events with editor context", async () => {
    const { app, view } = await openPropertyNote("Alpha beta");
    let pasteEvent: { event: ClipboardEvent; editor: unknown; view: unknown } | null = null;
    let dropEvent: { event: DragEvent; editor: unknown; view: unknown } | null = null;
    app.workspace.on("editor-paste", (event, editor, eventView) => {
      pasteEvent = { event: event as ClipboardEvent, editor, view: eventView };
      (event as ClipboardEvent).preventDefault();
    });
    app.workspace.on("editor-drop", (event, editor, eventView) => {
      dropEvent = { event: event as DragEvent, editor, view: eventView };
      (event as DragEvent).preventDefault();
    });

    const nativePaste = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    view.editorViewHost.contentEl.dispatchEvent(nativePaste);

    expect(pasteEvent).toEqual({ event: nativePaste, editor: view.editor, view });
    expect(nativePaste.defaultPrevented).toBe(true);

    const nativeDrop = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
    view.editorViewHost.contentEl.dispatchEvent(nativeDrop);

    expect(dropEvent).toEqual({ event: nativeDrop, editor: view.editor, view });
    expect(nativeDrop.defaultPrevented).toBe(true);
  });

  it("flows direct public editor mutations back into MarkdownView data and save", async () => {
    const { app, file, view } = await openPropertyNote("alpha\nbody");
    const changes: unknown[] = [];
    app.workspace.on("editor-change", (editor, owner) => changes.push({ editor, owner }));

    view.editor.replaceRange("updated", { line: 0, ch: 0 }, { line: 0, ch: 5 }, "+plugin");

    expect(view.getViewData()).toBe("updated\nbody");
    expect(view.sourceTextAreaEl.value).toBe("updated\nbody");
    expect(view.sourceTextAreaEl.selectionStart).toBe("updated".length);
    expect(changes).toEqual([{ editor: view.editor, owner: view }]);

    await view.save();

    expect(await app.vault.read(file)).toBe("updated\nbody");
  });

  it("flows direct public editor selection changes back into the source selection event", async () => {
    const { app, view } = await openPropertyNote("alpha\nbody");
    const selectionEvents: Array<{ editor: unknown; owner: unknown }> = [];
    app.workspace.on("editor-selection-change", (editor, owner) => selectionEvents.push({ editor, owner }));

    view.editor.setSelection({ line: 0, ch: 1 }, { line: 0, ch: 4 });

    expect(view.sourceTextAreaEl.selectionStart).toBe(1);
    expect(view.sourceTextAreaEl.selectionEnd).toBe(4);
    expect(selectionEvents).toEqual([{ editor: view.editor, owner: view }]);

    view.editor.setCursor({ line: 1, ch: 2 });

    expect(view.sourceTextAreaEl.selectionStart).toBe("alpha\nbo".length);
    expect(view.sourceTextAreaEl.selectionEnd).toBe("alpha\nbo".length);
    expect(selectionEvents).toEqual([
      { editor: view.editor, owner: view },
      { editor: view.editor, owner: view },
    ]);
  });

  it("uses Obsidian's default URL paste behavior after editor-paste handlers run", async () => {
    const { app, view } = await openPropertyNote("Alpha beta");
    const events: Array<{ editor: unknown; view: unknown }> = [];
    app.workspace.on("editor-paste", (_event, editor, eventView) => {
      events.push({ editor, view: eventView });
    });
    view.sourceTextAreaEl.setSelectionRange(0, 5);
    const clipboard = createClipboardData();
    clipboard.setData("text/plain", "https://example.com");
    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(events).toEqual([{ editor: view.editor, view }]);
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(view.getViewData()).toBe("[Alpha](https://example.com) beta");
    expect(view.editor.getValue()).toBe("[Alpha](https://example.com) beta");
    expect(view.sourceTextAreaEl.value).toBe("[Alpha](https://example.com) beta");
  });

  it("wraps selected text with URL schemes accepted by new URL", async () => {
    const { view } = await openPropertyNote("Alpha beta");
    view.sourceTextAreaEl.setSelectionRange(0, 5);
    const clipboard = createClipboardData();
    clipboard.setData("text/plain", "mailto:x@y.com");

    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(view.getViewData()).toBe("[Alpha](mailto:x@y.com) beta");
  });

  it("does not trim URL paste payloads before link wrapping", async () => {
    const { view } = await openPropertyNote("Alpha beta");
    view.sourceTextAreaEl.setSelectionRange(0, 5);
    const clipboard = createClipboardData();
    clipboard.setData("text/plain", " https://example.com");

    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(view.getViewData()).toBe(" https://example.com beta");
  });

  it("passes data-transfer markdown payloads through URL selection wrapping first", async () => {
    const { view } = await openPropertyNote("Alpha beta");
    view.sourceTextAreaEl.setSelectionRange(0, 5);
    const clipboard = createClipboardData();
    clipboard.setData("text/uri-list", "https://example.com");

    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(view.getViewData()).toBe("[Alpha](https://example.com) beta");
  });

  it("uses one pasted URL per existing editor selection range", async () => {
    const { view } = await openPropertyNote("Alpha beta");
    view.editor.setSelections([
      { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 5 } },
      { anchor: { line: 0, ch: 6 }, head: { line: 0, ch: 10 } },
    ]);
    const clipboard = createClipboardData();
    clipboard.setData("text/plain", "https://alpha.example\nhttps://beta.example");

    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(view.getViewData()).toBe("[Alpha](https://alpha.example) [beta](https://beta.example)");
  });

  it("skips default URL paste when editor-paste is prevented", async () => {
    const { app, view } = await openPropertyNote("Alpha beta");
    app.workspace.on("editor-paste", (event) => {
      (event as ClipboardEvent).preventDefault();
    });
    view.sourceTextAreaEl.setSelectionRange(0, 5);
    const clipboard = createClipboardData();
    clipboard.setData("text/plain", "https://example.com");
    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(view.getViewData()).toBe("Alpha beta");
  });

  it("inserts a bare URL through the default paste path without a source selection", async () => {
    const { view } = await openPropertyNote("Alpha ");
    view.sourceTextAreaEl.setSelectionRange(6, 6);
    const clipboard = createClipboardData();
    clipboard.setData("text/plain", "https://example.com");
    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(view.getViewData()).toBe("Alpha https://example.com");
  });

  it("uses normal paste insertion when selected text spans multiple lines", async () => {
    const { view } = await openPropertyNote("Alpha\nbeta");
    view.sourceTextAreaEl.setSelectionRange(0, 10);
    const clipboard = createClipboardData();
    clipboard.setData("text/plain", "https://example.com");
    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(view.getViewData()).toBe("https://example.com");
  });

  it("pastes text/markdown before URL selection wrapping", async () => {
    const { view } = await openPropertyNote("Alpha");
    view.sourceTextAreaEl.setSelectionRange(0, 5);
    const clipboard = createClipboardData();
    clipboard.setData("text/plain", "https://example.com");
    clipboard.setData("text/markdown", "**bold**");

    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(view.getViewData()).toBe("**bold**");
  });

  it("converts HTML paste when autoConvertHtml is enabled", async () => {
    const { app, view } = await openPropertyNote("");
    app.vault.setConfig("autoConvertHtml", true);
    const clipboard = createClipboardData();
    clipboard.setData("text/html", "<h2>Title</h2><p>Hello <strong>world</strong></p>");

    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(view.getViewData()).toBe("## Title\n\nHello **world**");
  });

  it("uses .url clipboard filename for uri-list paste without plain text", async () => {
    const { view } = await openPropertyNote("");
    const clipboard = createClipboardData({ "text/uri-list": "https://example.com/from-file" }, [
      createBrowserFile("Example Site.url", [1]),
    ]);

    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(view.getViewData()).toBe("Example Site");
  });

  it("ignores uri-list paste when plain text already matches the decoded uri", async () => {
    const { view } = await openPropertyNote("");
    const clipboard = createClipboardData({
      "text/uri-list": "https://example.com/a%20b",
      "text/plain": "https://example.com/a b",
    });

    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(view.getViewData()).toBe("https://example.com/a b");
  });

  it("pastes clipboard images as attachments after URL handling", async () => {
    const { app, view } = await openPropertyNote("");
    const clipboard = createClipboardData(undefined, [createBrowserFile("image.png", [1, 2, 3])]);

    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(pasteEvent.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(view.getViewData()).toBe("![[image]]");
    });
    expect(app.vault.getFileByPath("image.png")).not.toBeNull();
  });

  it("persists and renders embedded backlinks in markdown view state", async () => {
    const { view } = await openPropertyNote("# Target");

    await view.setState({ mode: "preview", source: false, backlinks: true });
    await view.previewMode.renderer.whenIdle();

    expect(view.showBacklinks).toBe(true);
    expect(view.getState()).toMatchObject({ backlinks: true });
    expect(view.backlinksEl.hidden).toBe(false);
    expect(view.backlinksEl.classList.contains("embedded-backlinks")).toBe(true);
    expect(view.backlinksEl.querySelector(".backlink-pane")).not.toBeNull();
    expect(view.backlinksEl.parentElement).toBe(view.previewMode.renderer.footer?.el);

    await view.setState({ mode: "source", source: false, backlinks: false });
    expect(view.showBacklinks).toBe(false);
    expect(view.backlinksEl.hidden).toBe(true);
    expect(view.backlinksEl.parentElement).toBe(view.editorViewHost.sizerEl);
  });

  it("renames the markdown file from the inline title", async () => {
    const { app, view } = await openPropertyNote("# Body");

    view.inlineTitleEl.dispatchEvent(new FocusEvent("focus"));
    view.inlineTitleEl.textContent = "Renamed";
    view.inlineTitleEl.dispatchEvent(new InputEvent("input", { bubbles: true }));
    view.inlineTitleEl.dispatchEvent(new FocusEvent("blur"));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(view.file?.path).toBe("Renamed.md");
    expect(app.vault.getFileByPath("Note.md")).toBeNull();
    expect(app.vault.getFileByPath("Renamed.md")).not.toBeNull();
    expect(view.inlineTitleEl.textContent).toBe("Renamed");
  });

  it("rejects invalid inline title edits and restores the basename on Escape", async () => {
    const { app, view } = await openPropertyNote("# Body");

    view.inlineTitleEl.dispatchEvent(new FocusEvent("focus"));
    view.inlineTitleEl.textContent = "Unsafe#Name";
    view.inlineTitleEl.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(view.inlineTitleEl.classList.contains("mod-warning")).toBe(true);
    expect(view.inlineTitleEl.classList.contains("mod-error")).toBe(false);
    expect(view.inlineTitleEl.title).toContain("unsafe characters");

    view.inlineTitleEl.textContent = "Bad/Name";
    view.inlineTitleEl.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(view.inlineTitleEl.classList.contains("mod-error")).toBe(true);

    view.inlineTitleEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(view.inlineTitleEl.textContent).toBe("Note");
    expect(view.inlineTitleEl.classList.contains("mod-error")).toBe(false);
    expect(app.vault.getFileByPath("Note.md")).not.toBeNull();
  });

  it("focuses inline title from rename ephemeral state", async () => {
    const { app, view } = await openPropertyNote("# Body");
    document.body.appendChild(app.containerEl);

    view.setEphemeralState({ rename: "all" });

    let selection = document.getSelection();
    expect(selection?.toString()).toBe("Note");
    expect(view.getEphemeralState()).toEqual({ line: 0 });

    view.setEphemeralState({ rename: "start" });
    selection = document.getSelection();
    expect(selection?.rangeCount).toBe(1);
    expect(selection?.getRangeAt(0).collapsed).toBe(true);
    expect(selection?.getRangeAt(0).startOffset).toBe(0);

    view.setEphemeralState({ rename: "end" });
    selection = document.getSelection();
    expect(selection?.rangeCount).toBe(1);
    expect(selection?.getRangeAt(0).collapsed).toBe(true);
    expect(selection?.getRangeAt(0).startContainer).toBe(view.inlineTitleEl);
    expect(selection?.getRangeAt(0).startOffset).toBe(view.inlineTitleEl.childNodes.length);

    app.containerEl.remove();
  });

  it("falls back to the file rename prompt when the inline title cannot be focused", async () => {
    const { app, view } = await openPropertyNote("# Body");
    document.body.appendChild(app.containerEl);
    view.inlineTitleEl.hidden = true;

    view.setEphemeralState({ rename: "all" });
    let modal: HTMLElement | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      modal = document.body.querySelector<HTMLElement>(".modal");
      if (modal) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const input = modal?.querySelector<HTMLTextAreaElement>("textarea.rename-textarea");

    expect(modal?.classList.contains("mod-file-rename")).toBe(true);
    expect(input?.value).toBe("Note");
    expect(view.getEphemeralState()).toEqual({ line: 0 });
  });

  it("applies reading mode ephemeral focus and scroll state without switching to source", async () => {
    const { app, view } = await openPropertyNote("---\nstatus: open\n---\n# One\n\n## Two\n\nBody");
    document.body.appendChild(app.containerEl);
    view.setMode("preview");
    await view.previewMode.renderer.whenIdle();

    view.setEphemeralState({ line: 4 });

    expect(view.getMode()).toBe("preview");
    expect(view.previewMode.renderer.lastAppliedScrollLine).toBe(4);
    expect(view.previewMode.renderer.sizerEl.classList.contains("is-flashing")).toBe(true);

    view.setEphemeralState({ scroll: 2 });
    expect(view.previewMode.renderer.lastAppliedScrollLine).toBe(2);

    view.setEphemeralState({ match: { content: "a\nb\nc", matches: [[2, 3]] } });
    expect(view.previewMode.renderer.lastAppliedScrollLine).toBe(1);

    view.setEphemeralState({ subpath: "Two" });
    expect(view.getMode()).toBe("preview");
    expect(view.previewMode.renderer.lastAppliedScrollLine).toBe(5);

    view.setEphemeralState({ focusMetadata: true });
    expect(document.activeElement).toBe(view.metadataContainerEl.querySelector(".metadata-property"));

    app.containerEl.remove();
  });

  it("queues reading renderer updates and renders the latest preview text", async () => {
    const { view } = await openPropertyNote("# First");

    view.setMode("preview");
    view.previewMode.renderer.set("# Older");
    view.previewMode.renderer.set("# Newer");
    await view.previewMode.renderer.whenIdle();

    expect(view.previewMode.renderer.text).toBe("# Newer");
    expect(view.previewMode.renderer.sizerEl.textContent).toContain("Newer");
    expect(view.previewMode.renderer.sizerEl.textContent).not.toContain("Older");

    view.previewMode.renderer.clear();
    await view.previewMode.renderer.whenIdle();

    expect(view.previewMode.renderer.text).toBe("");
    expect(view.previewMode.renderer.lastText).toBe("");
    expect(view.previewMode.renderer.pusherEl).not.toBeNull();
    expect(view.previewMode.renderer.sizerEl.querySelector(".markdown-preview-pusher")).not.toBeNull();
  });

  it("keeps reading renderer header and footer sections around markdown content", async () => {
    const { view } = await openPropertyNote("# Body");
    const headerEl = view.previewMode.renderer.addHeader();
    const footerEl = view.previewMode.renderer.addFooter();
    headerEl.textContent = "Header UI";
    footerEl.textContent = "Footer UI";

    view.setMode("preview");
    await view.previewMode.renderer.whenIdle();

    const children = [...view.previewMode.renderer.sizerEl.children];
    expect(children[0]).toBe(view.previewMode.renderer.pusherEl);
    expect(children[1]).toBe(headerEl);
    expect(children.at(-1)).toBe(footerEl);
    expect(view.previewMode.renderer.sections[0]).toBe(view.previewMode.renderer.header);
    expect(view.previewMode.renderer.sections.at(-1)).toBe(view.previewMode.renderer.footer);

    view.setViewData("# Replaced", true);
    await view.previewMode.renderer.whenIdle();

    expect(view.previewMode.renderer.text).toBe("# Replaced");
    expect(view.previewMode.renderer.sizerEl.textContent).toContain("Header UI");
    expect(view.previewMode.renderer.sizerEl.textContent).toContain("Replaced");
    expect(view.previewMode.renderer.sizerEl.textContent).toContain("Footer UI");
  });

  it("routes reading checklist clicks through MarkdownView source data", async () => {
    const { view } = await openPropertyNote("- [ ] Todo\n- [-] Maybe");

    await view.setMode("preview");
    await view.previewMode.renderer.whenIdle();

    const firstCheckbox = view.previewRendererEl.querySelector<HTMLInputElement>("input.task-list-item-checkbox");
    if (!firstCheckbox) throw new Error("Expected checklist checkbox");
    firstCheckbox.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    expect(view.getViewData()).toBe("- [x] Todo\n- [-] Maybe");
    expect(view.editor.getValue()).toBe("- [x] Todo\n- [-] Maybe");
    expect(view.sourceTextAreaEl.value).toBe("- [x] Todo\n- [-] Maybe");
    await view.previewMode.renderer.whenIdle();
    expect(view.previewMode.renderer.text).toBe("- [x] Todo\n- [-] Maybe");

    const maybeCheckbox = view.previewRendererEl.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox")[1];
    maybeCheckbox?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    expect(view.getViewData()).toBe("- [x] Todo\n- [ ] Maybe");
  });

  it("rerenders already-open reading previews when markdown post processors change", async () => {
    const { app, view } = await openPropertyNote("Body");

    view.setMode("preview");
    await view.previewMode.renderer.whenIdle();
    expect(view.previewMode.renderer.sizerEl.querySelector(".post-processor-marker")).toBeNull();

    const processor: MarkdownPostProcessor = (el) => {
      const marker = document.createElement("span");
      marker.className = "post-processor-marker";
      marker.textContent = "processed";
      el.appendChild(marker);
    };
    MarkdownPreviewRenderer.registerPostProcessor(processor);
    try {
      app.workspace.trigger("post-processor-change");
      await view.previewMode.renderer.whenIdle();

      expect(view.previewMode.renderer.sizerEl.querySelector(".post-processor-marker")?.textContent).toBe("processed");
    } finally {
      MarkdownPreviewRenderer.unregisterPostProcessor(processor);
    }
  });

  it("selects metadata rows and copies/cuts them using Obsidian clipboard formats", async () => {
    const { view } = await openPropertyNote("---\nalpha: 1\nbeta: 2\ngamma: 3\n---\nBody");

    getPropertyIcon(view, "beta").dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
    getPropertyIcon(view, "gamma").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));

    expect(getPropertyRow(view, "beta").classList.contains("is-selected")).toBe(true);
    expect(getPropertyRow(view, "gamma").classList.contains("is-selected")).toBe(true);

    const copyClipboard = createClipboardData();
    getPropertyRow(view, "gamma").focus();
    dispatchClipboardEvent(getPropertyRow(view, "gamma"), "copy", copyClipboard);

    expect(copyClipboard.getData("Text")).toBe("beta: 2\ngamma: 3");
    expect(JSON.parse(copyClipboard.getData("obsidian/properties"))).toEqual({ beta: 2, gamma: 3 });

    const cutClipboard = createClipboardData();
    getPropertyRow(view, "gamma").focus();
    dispatchClipboardEvent(getPropertyRow(view, "gamma"), "cut", cutClipboard);

    expect(JSON.parse(cutClipboard.getData("obsidian/properties"))).toEqual({ beta: 2, gamma: 3 });
    expect(view.getViewData()).toBe("---\nalpha: 1\n---\nBody");
  });

  it("pastes Obsidian property clipboard data by merging it into frontmatter", async () => {
    const { view } = await openPropertyNote("---\ntags:\n  - existing\nstatus: old\n---\nBody");
    const clipboard = createClipboardData();
    clipboard.setData("obsidian/properties", JSON.stringify({
      tags: ["existing", "incoming"],
      status: "new",
      created: null,
    }));

    dispatchClipboardEvent(getPropertyRow(view, "status"), "paste", clipboard);

    expect(view.getViewData()).toBe([
      "---",
      "tags:",
      "  - existing",
      "  - incoming",
      "status: new",
      "created:",
      "---",
      "Body",
    ].join("\n"));
  });

  it("pastes Obsidian property clipboard data from the source editor before plain text insertion", async () => {
    const { app, view } = await openPropertyNote("---\nstatus: old\n---\nBody");
    const seen: Array<{ path: string; properties: unknown }> = [];
    app.workspace.on("properties-paste", (path, properties) => {
      seen.push({ path: String(path), properties });
    });
    const clipboard = createClipboardData();
    clipboard.setData("Text", "status: new");
    clipboard.setData("obsidian/properties", JSON.stringify({ status: "new", rating: 5 }));

    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(view.getViewData()).toBe("---\nstatus: new\nrating: 5\n---\nBody");
    expect(seen).toEqual([{ path: "Note.md", properties: { status: "new", rating: 5 } }]);
  });

  it("does not paste Obsidian property clipboard data when editor-paste is prevented", async () => {
    const { app, view } = await openPropertyNote("---\nstatus: old\n---\nBody");
    app.workspace.on("editor-paste", (event) => {
      (event as ClipboardEvent).preventDefault();
    });
    const clipboard = createClipboardData();
    clipboard.setData("obsidian/properties", JSON.stringify({ status: "new" }));

    const pasteEvent = dispatchClipboardEvent(view.editorViewHost.contentEl, "paste", clipboard);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(view.getViewData()).toBe("---\nstatus: old\n---\nBody");
  });

  it("shows Obsidian-style invalid properties UI and jumps back to source", async () => {
    const { view } = await openPropertyNote("---\n: bad\n---\nBody");

    expect(view.metadataContainerEl.classList.contains("mod-error")).toBe(true);
    expect(view.metadataContainerEl.dataset.propertyCount).toBe("0");
    expect(view.metadataContainerEl.querySelector(".metadata-properties-heading")).toBeNull();
    expect(view.metadataContainerEl.querySelector(".metadata-add-button")).toBeNull();
    expect(view.metadataContainerEl.querySelector(".metadata-error-title")?.textContent).toBe("Invalid properties");

    view.setMode("preview");
    view.metadataContainerEl.querySelector<HTMLButtonElement>(".metadata-show-source-button")?.click();

    expect(view.getMode()).toBe("source");
    expect(view.sourceTextAreaEl.selectionStart).toBe(0);
  });
});

async function openPropertyNote(source: string): Promise<{ app: App; file: TFile; view: MarkdownView }> {
  const app = new App(document.createElement("div"));
  await app.ready;
  const file = await app.vault.create("Note.md", source);
  const leaf = app.workspace.getLeaf();
  await leaf.openFile(file, { active: true, state: { mode: "source" } });
  return { app, file, view: leaf.view as MarkdownView };
}

function getKeyInput(view: MarkdownView, key: string): HTMLInputElement {
  const input = view.metadataContainerEl.querySelector<HTMLInputElement>(`[data-property-key="${key}"] .metadata-property-key-input`);
  if (!input) throw new Error(`Missing key input: ${key}`);
  return input;
}

function getPropertyRow(view: MarkdownView, key: string): HTMLElement {
  const row = view.metadataContainerEl.querySelector<HTMLElement>(`[data-property-key="${key}"]`);
  if (!row) throw new Error(`Missing property row: ${key}`);
  return row;
}

function getPropertyIcon(view: MarkdownView, key: string): HTMLElement {
  const icon = getPropertyRow(view, key).querySelector<HTMLElement>(".metadata-property-icon");
  if (!icon) throw new Error(`Missing property icon: ${key}`);
  return icon;
}

function getPropertyKeys(view: MarkdownView): string[] {
  return [...view.metadataContainerEl.querySelectorAll<HTMLElement>(".metadata-property")]
    .map((row) => row.dataset.propertyKey ?? "");
}

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  const transfer = {
    effectAllowed: "move",
    types: [] as string[],
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => {
      values.set(type, value);
      if (!transfer.types.includes(type)) transfer.types.push(type);
    },
  };
  return transfer as unknown as DataTransfer;
}

function createClipboardData(initial: Record<string, string> = {}, files: File[] = []): DataTransfer {
  const values = new Map<string, string>(Object.entries(initial));
  const items = files.map((file) => ({
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  })) as DataTransferItem[];
  return {
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
    files: files as unknown as FileList,
    items: items as unknown as DataTransferItemList,
  } as unknown as DataTransfer;
}

function dispatchDragEvent(target: HTMLElement, type: string, dataTransfer: DataTransfer): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  target.dispatchEvent(event);
}

function dispatchClipboardEvent(target: HTMLElement, type: string, clipboardData: DataTransfer): ClipboardEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  target.dispatchEvent(event);
  return event;
}

function createBrowserFile(name: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name);
}

function findMenuItem(title: string): HTMLElement {
  const item = [...document.body.querySelectorAll<HTMLElement>(".menu-item")]
    .find((element) => element.querySelector(".menu-item-title")?.textContent?.trim() === title);
  if (!item) throw new Error(`Missing menu item: ${title}`);
  return item;
}
