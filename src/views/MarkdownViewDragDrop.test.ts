import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import type { DragSource } from "../drag/DragManager";
import type { TFile } from "../vault/TAbstractFile";
import { MarkdownView } from "./MarkdownView";

interface TestDragSource {
  type: string;
  payload?: unknown;
  elements?: Element[];
  [key: string]: unknown;
}

describe("MarkdownView drag and drop", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  it("inserts dragged files as markdown links and embeds only embeddable extensions", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "Links:");
    const target = await app.vault.create("Target.md", "target");
    const image = await app.vault.create("image.png", "");
    const view = await openMarkdownView(app, current);
    let editorDropCount = 0;
    app.workspace.on("editor-drop", () => {
      editorDropCount += 1;
    });

    view.sourceTextAreaEl.setSelectionRange("Links:".length, "Links:".length);
    setDragSource(app, { type: "files", files: [target, image] });

    const event = dropIntoEditor(view);

    expect(event.defaultPrevented).toBe(true);
    expect(view.sourceTextAreaEl.value).toBe("Links:[[Target]]\n![[image]]");
    expect(editorDropCount).toBe(0);
  });

  it("fires quick-preview with the unsaved markdown text when editor content changes", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "Draft");
    const view = await openMarkdownView(app, current);
    const previews: Array<{ file: TFile; data: string }> = [];
    let editorChangeCount = 0;
    app.workspace.on("quick-preview", (file: TFile, data: string) => previews.push({ file, data }));
    app.workspace.on("editor-change", () => {
      editorChangeCount += 1;
    });

    view.sourceTextAreaEl.setSelectionRange("Draft".length, "Draft".length);
    view.insertText(" update");

    expect(editorChangeCount).toBe(1);
    expect(previews).toEqual([{ file: current, data: "Draft update" }]);
  });

  it("uses editor drop coordinates instead of the previous cursor for internal drops", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "Alpha\nOmega");
    const target = await app.vault.create("Target.md", "target");
    const view = await openMarkdownView(app, current);
    view.sourceTextAreaEl.setSelectionRange(0, 0);
    view.editor.posAtCoords = vi.fn(() => ({ line: 1, ch: 0 }));

    setDragSource(app, { type: "file", file: target });
    const event = dropIntoEditor(view, { clientX: 80, clientY: 40 });

    expect(event.defaultPrevented).toBe(true);
    expect(view.editor.posAtCoords).toHaveBeenCalledWith({ x: 80, y: 40 });
    expect(view.sourceTextAreaEl.value).toBe("Alpha\n[[Target]]Omega");
  });

  it("uses a dragged link file subpath and keeps unresolved links as raw linktext", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "");
    const target = await app.vault.create("Target.md", "target");
    const view = await openMarkdownView(app, current);

    setDragSource(app, { type: "link", file: target, linktext: "Target#Section|Alias", sourcePath: current.path });
    dropIntoEditor(view);
    expect(view.sourceTextAreaEl.value).toBe("[[Target#Section]]");

    view.sourceTextAreaEl.setSelectionRange(view.sourceTextAreaEl.value.length, view.sourceTextAreaEl.value.length);
    setDragSource(app, { type: "link", linktext: "Missing#Section", sourcePath: current.path });
    dropIntoEditor(view);
    expect(view.sourceTextAreaEl.value).toBe("[[Target#Section]]Missing#Section");
  });

  it("converts heading and bookmark drag sources with the reverse-engineered subpath rules", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "");
    const target = await app.vault.create("Target.md", "target");
    const view = await openMarkdownView(app, current);

    setDragSource(app, { type: "heading", file: target, heading: { heading: "A:# bad [[x]] %% tag" } });
    dropIntoEditor(view);
    expect(view.sourceTextAreaEl.value).toBe("[[Target#A bad x tag]]");

    view.sourceTextAreaEl.setSelectionRange(view.sourceTextAreaEl.value.length, view.sourceTextAreaEl.value.length);
    setDragSource(app, {
      type: "bookmarks",
      items: [{ item: { type: "file", path: target.path, subpath: "#Section", title: "Nice title" } }],
    });
    dropIntoEditor(view);
    expect(view.sourceTextAreaEl.value).toBe("[[Target#A bad x tag]][[Target#Section|Nice title]]");
  });

  it("sets source dragover dropEffect only when the effect is allowed", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "");
    const target = await app.vault.create("Target.md", "target");
    const view = await openMarkdownView(app, current);

    setDragSource(app, { type: "file", file: target });
    const linkEvent = dragOverEditor(view, "copyLink");
    expect(linkEvent.dataTransfer?.dropEffect).toBe("link");

    const disallowedEvent = dragOverEditor(view, "copyMove");
    expect(disallowedEvent.dataTransfer?.dropEffect).toBe("none");
  });

  it("lets open-in-leaf modifier bubble to the leaf dragover path and ignores non-file bookmarks", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "");
    const target = await app.vault.create("Target.md", "target");
    const view = await openMarkdownView(app, current);

    setDragSource(app, { type: "file", file: target });
    const openInLeafEvent = dragOverEditor(view, "all", { [isMacLikePlatform() ? "shiftKey" : "altKey"]: true });
    expect(openInLeafEvent.dataTransfer?.dropEffect).toBe("move");

    setDragSource(app, { type: "bookmarks", items: [{ item: { type: "graph" } }] });
    const bookmarkEvent = dragOverEditor(view, "all");
    expect(bookmarkEvent.dataTransfer?.dropEffect).toBe("none");
  });

  it("uses copy for external source dragover and link when Ctrl is held", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "");
    const view = await openMarkdownView(app, current);

    clearDragSource(app);
    const copyEvent = dragOverEditor(view, "copyLink");
    expect(copyEvent.dataTransfer?.dropEffect).toBe("copy");

    const linkEvent = dragOverEditor(view, "copyLink", { ctrlKey: true });
    expect(linkEvent.dataTransfer?.dropEffect).toBe("link");
  });

  it("fires editor-drop for external drops and inserts text/markdown before file fallback", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "");
    const view = await openMarkdownView(app, current);
    let editorDropCount = 0;
    app.workspace.on("editor-drop", () => {
      editorDropCount += 1;
    });

    clearDragSource(app);
    const event = dropIntoEditor(view, {
      dataTransfer: createDropDataTransfer({ "text/markdown": "**bold**", "text/plain": "plain" }),
    });

    expect(event.defaultPrevented).toBe(true);
    expect(editorDropCount).toBe(1);
    expect(view.sourceTextAreaEl.value).toBe("**bold**");
  });

  it("uses editor drop coordinates for external markdown drops", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "Alpha\nOmega");
    const view = await openMarkdownView(app, current);
    view.sourceTextAreaEl.setSelectionRange(0, 0);
    view.editor.posAtCoords = vi.fn(() => ({ line: 1, ch: 5 }));

    clearDragSource(app);
    const event = dropIntoEditor(view, {
      clientX: 120,
      clientY: 64,
      dataTransfer: createDropDataTransfer({ "text/markdown": "**bold**" }),
    });

    expect(event.defaultPrevented).toBe(true);
    expect(view.editor.posAtCoords).toHaveBeenCalledWith({ x: 120, y: 64 });
    expect(view.sourceTextAreaEl.value).toBe("Alpha\nOmega**bold**");
  });

  it("falls back to textarea coordinates when the editor has no posAtCoords", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "Alpha\nOmega");
    const view = await openMarkdownView(app, current);
    view.sourceTextAreaEl.setSelectionRange(0, 0);
    view.sourceTextAreaEl.style.fontSize = "10px";
    view.sourceTextAreaEl.style.lineHeight = "20px";
    view.sourceTextAreaEl.style.padding = "0";
    Object.defineProperty(view.sourceTextAreaEl, "scrollTop", { configurable: true, value: 0 });
    Object.defineProperty(view.sourceTextAreaEl, "scrollLeft", { configurable: true, value: 0 });
    view.sourceTextAreaEl.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 80,
      width: 200,
      height: 80,
      toJSON: () => ({}),
    });

    clearDragSource(app);
    const event = dropIntoEditor(view, {
      clientX: 999,
      clientY: 25,
      dataTransfer: createDropDataTransfer({ "text/markdown": "**bold**" }),
    });

    expect(event.defaultPrevented).toBe(true);
    expect(view.sourceTextAreaEl.value).toBe("Alpha\nOmega**bold**");
  });

  it("converts external HTML drops when autoConvertHtml is enabled", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("autoConvertHtml", true);
    const current = await app.vault.create("Current.md", "");
    const view = await openMarkdownView(app, current);

    clearDragSource(app);
    const event = dropIntoEditor(view, {
      dataTransfer: createDropDataTransfer({
        "text/html": "<h3>Title</h3><p>Hello <strong>world</strong></p>",
      }),
    });

    expect(event.defaultPrevented).toBe(true);
    expect(view.sourceTextAreaEl.value).toBe("### Title\n\nHello **world**");
  });

  it("uses the Obsidian HTML marker guard only when plain text is present", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("autoConvertHtml", true);
    const current = await app.vault.create("Current.md", "");
    const view = await openMarkdownView(app, current);

    clearDragSource(app);
    const guarded = dropIntoEditor(view, {
      dataTransfer: createDropDataTransfer({
        "text/html": "<!-- obsidian --><p>Rich</p>",
        "text/plain": "Plain",
      }),
    });
    expect(guarded.defaultPrevented).toBe(false);
    expect(view.sourceTextAreaEl.value).toBe("");

    const converted = dropIntoEditor(view, {
      dataTransfer: createDropDataTransfer({
        "text/html": "<!-- obsidian --><p>Rich</p>",
      }),
    });
    expect(converted.defaultPrevented).toBe(true);
    expect(view.sourceTextAreaEl.value).toBe("Rich");
  });

  it("detaches long HTML data images, saves them as attachments, and inserts embeds asynchronously", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("autoConvertHtml", true);
    const current = await app.vault.create("Current.md", "");
    const view = await openMarkdownView(app, current);
    const dataUrl = makeDataUrl("image/png", 800, 5);
    const saveAttachment = vi.spyOn(app, "saveAttachment");

    clearDragSource(app);
    const event = dropIntoEditor(view, {
      dataTransfer: createDropDataTransfer({
        "text/html": `<p>Before</p><img src="${dataUrl}" alt="inline"><p>After</p>`,
      }),
    });

    expect(event.defaultPrevented).toBe(true);
    expect(view.sourceTextAreaEl.value).toBe("Before\n\nAfter");
    await vi.waitFor(() => {
      expect(view.sourceTextAreaEl.value).toMatch(/^Before\n\nAfter!\[\[Pasted image \d{14}]]\n\n$/);
    });
    expect(saveAttachment).toHaveBeenCalledWith("Pasted image", "png", expect.any(ArrayBuffer), current);
    expect(app.vault.getFiles().some((file) => /^Pasted image \d{14}\.png$/.test(file.path))).toBe(true);
  });

  it("does not convert external HTML drops when autoConvertHtml is disabled", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("autoConvertHtml", false);
    const current = await app.vault.create("Current.md", "");
    const view = await openMarkdownView(app, current);

    clearDragSource(app);
    const event = dropIntoEditor(view, {
      dataTransfer: createDropDataTransfer({
        "text/html": "<p>Hello <strong>world</strong></p>",
      }),
    });

    expect(event.defaultPrevented).toBe(false);
    expect(view.sourceTextAreaEl.value).toBe("");
  });

  it("converts external URI drops and leaves plain text alone", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "");
    const view = await openMarkdownView(app, current);

    clearDragSource(app);
    dropIntoEditor(view, {
      dataTransfer: createDropDataTransfer({
        "text/uri-list": "https://example.com/page",
        "text/plain": "Example page",
      }),
    });
    expect(view.sourceTextAreaEl.value).toBe("[Example page](https://example.com/page)");

    view.sourceTextAreaEl.setSelectionRange(view.sourceTextAreaEl.value.length, view.sourceTextAreaEl.value.length);
    dropIntoEditor(view, {
      dataTransfer: createDropDataTransfer({
        "text/uri-list": "https://example.com/image.png",
        "text/plain": "Example image",
      }),
    });
    expect(view.sourceTextAreaEl.value).toBe("[Example page](https://example.com/page)![Example image](https://example.com/image.png)");

    view.sourceTextAreaEl.value = "";
    view.sourceTextAreaEl.setSelectionRange(0, 0);
    const plainEvent = dropIntoEditor(view, { dataTransfer: createDropDataTransfer({ "text/plain": "plain" }) });
    expect(plainEvent.defaultPrevented).toBe(false);
    expect(view.sourceTextAreaEl.value).toBe("");
  });

  it("uses the first .webloc or .url filename for URI drops without plain text", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "");
    const view = await openMarkdownView(app, current);
    const file = createBrowserFile("Example Site.webloc", [1]);
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");

    clearDragSource(app);
    const event = dropIntoEditor(view, {
      dataTransfer: createDropDataTransfer({
        "text/uri-list": "https://example.com/from-file",
      }, [file]),
    });

    expect(event.defaultPrevented).toBe(true);
    expect(view.sourceTextAreaEl.value).toBe("Example Site");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("imports external dropped files as attachments and inserts embeds", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "");
    const view = await openMarkdownView(app, current);
    const image = createBrowserFile("image.png", [1, 2, 3]);

    clearDragSource(app);
    const event = dropIntoEditor(view, { dataTransfer: createDropDataTransfer({}, [image]) });

    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(view.sourceTextAreaEl.value).toBe("![[image]]");
    });
    expect(app.vault.getFileByPath("image.png")).not.toBeNull();
  });

  it("timestamps unnamed PNG/JPEG file drops as pasted images", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "");
    const view = await openMarkdownView(app, current);
    const image = new File([new Uint8Array([1, 2, 3])], "", { type: "image/png" });

    clearDragSource(app);
    const event = dropIntoEditor(view, { dataTransfer: createDropDataTransfer({}, [image]) });

    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(view.sourceTextAreaEl.value).toMatch(/^!\[\[Pasted image \d{14}]]$/);
    });
    expect(app.vault.getFiles().some((file) => /^Pasted image \d{14}\.png$/.test(file.path))).toBe(true);
  });

  it("links external dropped files when the platform file-link modifier is held", async () => {
    const app = new App(document.createElement("div"));
    const current = await app.vault.create("Current.md", "");
    const view = await openMarkdownView(app, current);
    const image = createBrowserFile("photo.png", [1], "/tmp/photo.png");

    clearDragSource(app);
    dropIntoEditor(view, {
      dataTransfer: createDropDataTransfer({}, [image]),
      [isMacLikePlatform() ? "altKey" : "ctrlKey"]: true,
    });

    await vi.waitFor(() => {
      expect(view.sourceTextAreaEl.value).toBe("![photo.png](file:///tmp/photo.png)");
    });
    expect(app.vault.getFileByPath("photo.png")).toBeNull();
  });
});

async function openMarkdownView(app: App, file: TFile): Promise<MarkdownView> {
  const leaf = await app.workspace.openFile(file, { active: true });
  expect(leaf.view).toBeInstanceOf(MarkdownView);
  return leaf.view as MarkdownView;
}

function setDragSource(app: App, source: TestDragSource): void {
  const sourceWithElements = { payload: null, elements: [], ...source } as unknown as DragSource;
  const dragManager = app.dragManager as unknown as {
    setSource?: (nextSource: DragSource | null) => void;
    draggable?: DragSource | null;
    source?: DragSource | null;
  };
  if (dragManager.setSource) {
    dragManager.setSource(sourceWithElements);
  } else if ("draggable" in dragManager) {
    dragManager.draggable = sourceWithElements;
  } else {
    dragManager.source = sourceWithElements;
  }
}

function clearDragSource(app: App): void {
  const dragManager = app.dragManager as unknown as {
    clearSource?: () => void;
    draggable?: DragSource | null;
    source?: DragSource | null;
  };
  if (dragManager.clearSource) {
    dragManager.clearSource();
  } else if ("draggable" in dragManager) {
    dragManager.draggable = null;
  } else {
    dragManager.source = null;
  }
}

function dropIntoEditor(
  view: MarkdownView,
  init: { altKey?: boolean; clientX?: number; clientY?: number; ctrlKey?: boolean; dataTransfer?: DataTransfer | null; shiftKey?: boolean } = {},
): DragEvent {
  const event = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperties(event, {
    altKey: { configurable: true, value: init.altKey ?? false },
    ctrlKey: { configurable: true, value: init.ctrlKey ?? false },
    shiftKey: { configurable: true, value: init.shiftKey ?? false },
    clientX: { configurable: true, value: init.clientX ?? 0 },
    clientY: { configurable: true, value: init.clientY ?? 0 },
    dataTransfer: { configurable: true, value: init.dataTransfer ?? null },
  });
  view.editorViewHost.contentEl.dispatchEvent(event);
  return event;
}

function dragOverEditor(
  view: MarkdownView,
  effectAllowed: DataTransfer["effectAllowed"],
  init: { altKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {},
): DragEvent {
  const dataTransfer = {
    effectAllowed,
    dropEffect: "none" as DataTransfer["dropEffect"],
  } as DataTransfer;
  const event = new Event("dragover", { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperties(event, {
    altKey: { configurable: true, value: init.altKey ?? false },
    ctrlKey: { configurable: true, value: init.ctrlKey ?? false },
    shiftKey: { configurable: true, value: init.shiftKey ?? false },
    dataTransfer: { configurable: true, value: dataTransfer },
  });
  view.editorViewHost.contentEl.dispatchEvent(event);
  return event;
}

function isMacLikePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(globalThis.navigator?.platform ?? "");
}

function createDropDataTransfer(data: Record<string, string>, files: File[] = []): DataTransfer {
  const store = new Map(Object.entries(data));
  const items = files.map((file) => ({
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  })) as DataTransferItem[];
  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: files as unknown as FileList,
    items: items as unknown as DataTransferItemList,
    types: [...store.keys()],
    clearData: (format?: string) => {
      if (format) store.delete(format);
      else store.clear();
    },
    getData: (format: string) => store.get(format) ?? "",
    setData: (format: string, value: string) => {
      store.set(format, value);
    },
    setDragImage: () => {},
  } as unknown as DataTransfer;
}

function createBrowserFile(name: string, bytes: number[], path = ""): File {
  const file = new File([new Uint8Array(bytes)], name);
  if (path) Object.defineProperty(file, "path", { configurable: true, value: path });
  return file;
}

function makeDataUrl(mime: string, length: number, byte: number): string {
  const bytes = new Uint8Array(length).fill(byte);
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return `data:${mime};base64,${btoa(binary)}`;
}
