import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import type { CanvasFileNodeData, CanvasLinkNodeData, CanvasTextNodeData } from "@web/builtin/canvas/CanvasData";
import type { FileDragSource, FilesDragSource, FolderDragSource, LinkDragSource } from "@web/ui/drag/DragManager";
import { CanvasView } from "@web/builtin/canvas/CanvasView";

describe("CanvasView external drops", () => {
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

  it("imports external files as attachments and creates file nodes in the original grid", async () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("attachmentFolderPath", "./assets");
    const view = await openCanvasView(app, "Boards/Board.canvas");
    const wrapper = queryRequired<HTMLElement>(view.contentEl, ".canvas-wrapper");
    const image = createBrowserFile("image.png", [1, 2, 3]);
    const imageArrayBuffer = vi.spyOn(image, "arrayBuffer");
    const dataTransfer = createDropDataTransfer({}, [
      image,
      createBrowserFile("diagram.svg", [4, 5]),
    ]);

    const dragover = dispatchDragEvent(wrapper, "dragover", dataTransfer, 120, 80);

    expect(dragover.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(imageArrayBuffer).not.toHaveBeenCalled();

    const drop = dispatchDragEvent(wrapper, "drop", dataTransfer, 120, 80);

    expect(drop.defaultPrevented).toBe(true);
    expect(imageArrayBuffer).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(app.vault.getFileByPath("Boards/assets/image.png")).not.toBeNull();
      expect(app.vault.getFileByPath("Boards/assets/diagram.svg")).not.toBeNull();
      expect(view.canvas.nodes.size).toBe(2);
    });

    const nodes = [...view.canvas.nodes.values()].map((node) => node.getData() as CanvasFileNodeData);
    expect(nodes.map((node) => node.file)).toEqual(["Boards/assets/image.png", "Boards/assets/diagram.svg"]);
    expect(nodes.map((node) => ({ x: node.x, y: node.y }))).toEqual([{ x: 120, y: 80 }, { x: 485, y: 80 }]);
  });

  it("uses text/plain URL drops for centered link nodes and ignores uri-list-only drops", async () => {
    const app = new App(document.createElement("div"));
    const view = await openCanvasView(app, "Board.canvas");
    const wrapper = queryRequired<HTMLElement>(view.contentEl, ".canvas-wrapper");
    const uriOnly = createDropDataTransfer({ "text/uri-list": "https://uri.example" });

    const uriDragover = dispatchDragEvent(wrapper, "dragover", uriOnly, 100, 100);

    expect(uriDragover.defaultPrevented).toBe(false);
    expect(view.canvas.nodes.size).toBe(0);

    const plainUrl = createDropDataTransfer({
      "text/plain": "https://plain.example",
      "text/uri-list": "https://uri.example",
    });

    dispatchDragEvent(wrapper, "drop", plainUrl, 400, 300);

    const node = [...view.canvas.nodes.values()][0].getData() as CanvasLinkNodeData;
    expect(node.type).toBe("link");
    expect(node.url).toBe("https://plain.example");
    expect({ x: node.x, y: node.y }).toEqual({ x: 240, y: 200 });
  });

  it("creates centered text nodes from non-url text/plain drops", async () => {
    const app = new App(document.createElement("div"));
    const view = await openCanvasView(app, "Board.canvas");
    const wrapper = queryRequired<HTMLElement>(view.contentEl, ".canvas-wrapper");
    const dataTransfer = createDropDataTransfer({ "text/plain": "hello canvas" });

    dispatchDragEvent(wrapper, "drop", dataTransfer, 260, 180);

    const node = [...view.canvas.nodes.values()][0].getData() as CanvasTextNodeData;
    expect(node.type).toBe("text");
    expect(node.text).toBe("hello canvas");
    expect({ x: node.x, y: node.y }).toEqual({ x: 130, y: 100 });
  });

  it("creates file nodes from internal file and resolved link drag sources", async () => {
    const app = new App(document.createElement("div"));
    const target = await app.vault.create("Target.md", "");
    const linked = await app.vault.create("Linked.md", "");
    const view = await openCanvasView(app, "Board.canvas");
    const wrapper = queryRequired<HTMLElement>(view.contentEl, ".canvas-wrapper");

    const fileSource: FileDragSource = { type: "file", payload: target, elements: [], file: target };
    app.dragManager.setSource(fileSource);
    const fileDragover = dispatchDragEvent(wrapper, "dragover", createDropDataTransfer({}), 100, 90);
    expect(fileDragover.defaultPrevented).toBe(true);
    expect(fileDragover.dataTransfer?.dropEffect).toBe("copy");
    dispatchDragEvent(wrapper, "drop", createDropDataTransfer({}), 100, 90);

    const linkSource: LinkDragSource = { type: "link", payload: linked, elements: [], linktext: "Linked", sourcePath: "", file: linked };
    app.dragManager.setSource(linkSource);
    dispatchDragEvent(wrapper, "drop", createDropDataTransfer({}), 200, 190);

    const nodes = [...view.canvas.nodes.values()].map((node) => node.getData() as CanvasFileNodeData);
    expect(nodes.map((node) => node.file)).toEqual(["Target.md", "Linked.md"]);
    expect(nodes.map((node) => ({ x: node.x, y: node.y }))).toEqual([{ x: 100, y: 90 }, { x: 200, y: 190 }]);
  });

  it("expands internal files drops, sorts them by basename, and selects the created nodes", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Folder/Nested");
    const zeta = await app.vault.create("Folder/Zeta.md", "");
    const alpha = await app.vault.create("Folder/Nested/Alpha.md", "");
    const loose = await app.vault.create("Loose.md", "");
    const folder = app.vault.getFolderByPath("Folder");
    if (!folder) throw new Error("missing folder");
    const view = await openCanvasView(app, "Board.canvas");
    const wrapper = queryRequired<HTMLElement>(view.contentEl, ".canvas-wrapper");
    const source: FilesDragSource = { type: "files", payload: [folder, loose, alpha], elements: [], files: [folder, loose, alpha] };
    app.dragManager.setSource(source);

    dispatchDragEvent(wrapper, "drop", createDropDataTransfer({}), 20, 30);

    const nodes = [...view.canvas.nodes.values()].map((node) => node.getData() as CanvasFileNodeData);
    expect(nodes.map((node) => node.file)).toEqual([alpha.path, loose.path, zeta.path]);
    expect(nodes.map((node) => ({ x: node.x, y: node.y }))).toEqual([{ x: 20, y: 30 }, { x: 385, y: 30 }, { x: 750, y: 30 }]);
    expect([...view.canvas.selection]).toHaveLength(3);
  });

  it("expands internal folder drops without replacing the previous selection", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.createFolder("Folder");
    const beta = await app.vault.create("Folder/Beta.md", "");
    const alpha = await app.vault.create("Folder/Alpha.md", "");
    const folder = app.vault.getFolderByPath("Folder");
    if (!folder) throw new Error("missing folder");
    const view = await openCanvasView(app, "Board.canvas");
    const existing = view.canvas.createTextNode("selected", -100, -100);
    view.canvas.selectOnly(existing.id);
    const wrapper = queryRequired<HTMLElement>(view.contentEl, ".canvas-wrapper");
    const source: FolderDragSource = { type: "folder", payload: folder, elements: [], file: folder };
    app.dragManager.setSource(source);

    dispatchDragEvent(wrapper, "drop", createDropDataTransfer({}), 40, 50);

    const fileNodes = [...view.canvas.nodes.values()]
      .map((node) => node.getData())
      .filter((node): node is CanvasFileNodeData => node.type === "file");
    expect(fileNodes.map((node) => node.file)).toEqual([alpha.path, beta.path]);
    expect([...view.canvas.selection]).toEqual([existing.id]);
  });
});

async function openCanvasView(app: App, path: string): Promise<CanvasView> {
  await app.corePluginsReady;
  await app.internalPlugins.enable("canvas");
  const file = await app.vault.create(path, "{\n  \"nodes\": [],\n  \"edges\": []\n}\n");
  const leaf = await app.workspace.openFile(file, { active: true });
  expect(leaf.view).toBeInstanceOf(CanvasView);
  return leaf.view as CanvasView;
}

function queryRequired<T extends Element>(parent: ParentNode, selector: string): T {
  const el = parent.querySelector<T>(selector);
  if (!el) throw new Error(`Missing selector: ${selector}`);
  return el;
}

function dispatchDragEvent(target: HTMLElement, type: string, dataTransfer: DataTransfer, clientX: number, clientY: number): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperties(event, {
    clientX: { configurable: true, value: clientX },
    clientY: { configurable: true, value: clientY },
    dataTransfer: { configurable: true, value: dataTransfer },
  });
  target.dispatchEvent(event);
  return event;
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

function createBrowserFile(name: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name);
}
