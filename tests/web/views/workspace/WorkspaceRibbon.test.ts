import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";

describe("WorkspaceRibbon Obsidian parity", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  it("reorders ribbon actions through native drag and drop", () => {
    const app = new App(document.createElement("div"));
    const saveLayout = vi.fn();
    Object.defineProperty(app.workspace, "requestSaveLayout", { configurable: true, value: saveLayout });
    const ribbon = app.workspace.leftRibbon;
    const alpha = ribbon.addRibbonItemButton("alpha", "lucide-a-large-small", "Alpha", () => {});
    ribbon.addRibbonItemButton("beta", "lucide-bold", "Beta", () => {});
    const gamma = ribbon.addRibbonItemButton("gamma", "lucide-gem", "Gamma", () => {});
    Object.defineProperty(gamma, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ x: 0, y: 40, width: 24, height: 24, top: 40, left: 0, right: 24, bottom: 64, toJSON: () => ({}) }),
    });
    const dataTransfer = createDataTransfer();

    dispatchDragEvent(alpha, "dragstart", dataTransfer);
    dispatchDragEvent(gamma, "dragover", dataTransfer, 60);
    dispatchDragEvent(gamma, "drop", dataTransfer, 60);

    expect(Array.from(ribbon.actionsEl?.children ?? []).map((el) => el.getAttribute("aria-label"))).toEqual(["Beta", "Gamma", "Alpha"]);
    expect(Object.keys(ribbon.serialize().hiddenItems as Record<string, boolean>)).toEqual(["beta", "gamma", "alpha"]);
    expect(saveLayout).toHaveBeenCalledOnce();
  });
});

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "none",
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => {
      values.set(type, value);
    },
    clearData: (type?: string) => {
      if (type) values.delete(type);
      else values.clear();
    },
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [] as unknown as readonly string[],
  } as DataTransfer;
}

function dispatchDragEvent(target: HTMLElement, type: string, dataTransfer: DataTransfer, clientY = 0): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(event, "clientY", { value: clientY });
  target.dispatchEvent(event);
  return event;
}
