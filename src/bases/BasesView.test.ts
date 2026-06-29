import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import type { FileDragSource } from "../drag/DragManager";
import { BasesFileView, BasesView } from "./BasesView";
import { QueryController } from "./QueryController";

class PluginBasesView extends BasesView {
  type = "plugin-grid";
  updates = 0;

  constructor(controller: QueryController, readonly outputEl: HTMLElement) {
    super(controller);
  }

  onDataUpdated(): void {
    this.updates += 1;
    this.outputEl.classList.add("plugin-bases-view");
    this.outputEl.textContent = `${this.controller.getDisplayName("file.name")}: ${this.data.data.length}`;
  }
}

describe("BasesView drag and drop", () => {
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

  it("imports external files into the inferred folder and applies base frontmatter", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Projects");
    const view = await openBasesView(app);
    const bodyEl = queryRequired<HTMLElement>(view.contentEl, ".bases-view-body");
    const file = createBrowserFile("Idea.md", [1, 2, 3]);
    const fileArrayBuffer = vi.spyOn(file, "arrayBuffer");
    const dataTransfer = createDropDataTransfer([file]);

    const dragover = dispatchDragEvent(bodyEl, "dragover", dataTransfer);

    expect(app.bases.getViewFactory("table")).toBe(app.bases.getRegistration("table")?.factory);
    expect(bodyEl.querySelector(".bases-custom-view")).not.toBeNull();
    expect(dragover.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(bodyEl.classList.contains("is-being-dragged-over")).toBe(true);
    expect(fileArrayBuffer).not.toHaveBeenCalled();

    const drop = dispatchDragEvent(bodyEl, "drop", dataTransfer);

    expect(drop.defaultPrevented).toBe(true);
    expect(fileArrayBuffer).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => {
      const file = app.vault.getFileByPath("Projects/Idea.md");
      expect(file).not.toBeNull();
      if (!file) throw new Error("missing imported file");
      expect(await app.vault.read(file)).toContain("tags:");
      expect(view.contentEl.querySelector<HTMLTableRowElement>('tr[data-path="Projects/Idea.md"]')).not.toBeNull();
    });
  });

  it("adds internal file drops to the base without importing a new attachment", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Projects");
    const source = await app.vault.create("Loose.md", "");
    await app.metadataCache.computeFileMetadata(source);
    const view = await openBasesView(app);
    const bodyEl = queryRequired<HTMLElement>(view.contentEl, ".bases-view-body");
    const sourceDrag: FileDragSource = { type: "file", payload: source, elements: [], file: source };
    app.dragManager.setSource(sourceDrag);

    dispatchDragEvent(bodyEl, "drop", createDropDataTransfer([]));

    await vi.waitFor(async () => {
      const moved = app.vault.getFileByPath("Projects/Loose.md");
      expect(moved).not.toBeNull();
      if (!moved) throw new Error("missing moved file");
      expect(await app.vault.read(moved)).toContain("tags:");
      expect(app.vault.getFileByPath("Loose.md")).toBeNull();
    });
  });

  it("renders plugin Bases views through the official factory and QueryController bridge", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    await app.internalPlugins.enable("bases");
    let receivedController: QueryController | null = null;
    let receivedContainer: HTMLElement | null = null;

    app.bases.registerBasesView("plugin-grid", {
      name: "Plugin grid",
      icon: "lucide-grid",
      factory: (controller, containerEl) => {
        receivedController = controller;
        receivedContainer = containerEl;
        return new PluginBasesView(controller, containerEl);
      },
    });

    expect(app.bases.getViewFactory("plugin-grid")).toBe(app.bases.getRegistration("plugin-grid")?.factory);
    expect(app.bases.getRegistrations().some((registration) => registration.id === "plugin-grid")).toBe(true);

    await app.vault.create("Plugin.base", JSON.stringify({
      name: "Plugin",
      query: {},
      columns: [{ id: "name", property: "file.name", title: "File" }],
      views: [{ id: "plugin", name: "Plugin", type: "plugin-grid" }],
      activeView: "plugin",
    }));
    await app.vault.create("Note.md", "Body");
    const file = app.vault.getFileByPath("Plugin.base");
    if (!file) throw new Error("missing base file");

    const leaf = await app.workspace.openFile(file, { active: true });
    expect(leaf.view).toBeInstanceOf(BasesFileView);
    const view = leaf.view as BasesFileView;
    const bodyEl = queryRequired<HTMLElement>(view.contentEl, ".bases-view-body");

    expect(receivedController).toBeInstanceOf(QueryController);
    expect(receivedContainer).toBe(bodyEl);
    expect(bodyEl.classList.contains("plugin-bases-view")).toBe(true);
    expect(bodyEl.textContent).toBe("File: 1");
  });
});

async function openBasesView(app: App): Promise<BasesFileView> {
  const base = await app.vault.create("Projects.base", JSON.stringify({
    name: "Projects",
    query: {
      filters: [
        { property: "file.folder", operator: "equals", value: "Projects" },
        { property: "note.tags", operator: "contains", value: "project" },
      ],
    },
    columns: [
      { id: "file", property: "file.path", title: "File", type: "file" },
      { id: "tags", property: "note.tags", title: "Tags", type: "tags" },
    ],
    views: [{ id: "table", name: "Table", type: "table" }],
    activeView: "table",
  }));
  const leaf = await app.workspace.openFile(base, { active: true });
  expect(leaf.view).toBeInstanceOf(BasesFileView);
  return leaf.view as BasesFileView;
}

function queryRequired<T extends Element>(parent: ParentNode, selector: string): T {
  const el = parent.querySelector<T>(selector);
  if (!el) throw new Error(`Missing selector: ${selector}`);
  return el;
}

function dispatchDragEvent(target: HTMLElement, type: string, dataTransfer: DataTransfer): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { configurable: true, value: dataTransfer });
  target.dispatchEvent(event);
  return event;
}

function createDropDataTransfer(files: File[]): DataTransfer {
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
    types: files.length ? ["Files"] : [],
    clearData: () => {},
    getData: () => "",
    setData: () => {},
    setDragImage: () => {},
  } as unknown as DataTransfer;
}

function createBrowserFile(name: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name);
}
