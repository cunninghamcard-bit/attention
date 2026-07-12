import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import type { DragSource } from "@web/ui/drag/DragManager";
import { isDropEffectAllowed } from "@web/ui/drag/DragManager";

describe("DragManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    document.body.replaceChildren();
  });

  it("shows action text, hover state, and overlay during preview, then clears them on leave", () => {
    const app = new App(document.createElement("div"));
    const targetEl = document.createElement("div");
    const hoverEl = document.createElement("div");
    document.body.append(targetEl, hoverEl);
    app.dragManager.handleDrop(targetEl, (_event, _source, hovering) => {
      if (!hovering) return { action: "Dropped", dropEffect: "copy" };
      app.dragManager.showOverlay({ x: 1, y: 2, width: 30, height: 40 });
      return {
        action: "Open as tab",
        dropEffect: "copy",
        hoverEl,
        hoverClass: "is-highlighted",
      };
    });
    app.dragManager.setSource(createSource());

    const dragover = createDragEvent("dragover", createDataTransfer("copyMove"), {
      clientX: 10,
      clientY: 20,
    });
    targetEl.dispatchEvent(dragover);

    expect(dragover.defaultPrevented).toBe(true);
    expect(dragover.dataTransfer?.dropEffect).toBe("copy");
    expect(hoverEl.classList.contains("is-highlighted")).toBe(true);
    expect(app.dragManager.actionEl.textContent).toBe("Open as tab");
    expect(app.dragManager.actionEl.isConnected).toBe(true);
    expect(app.dragManager.actionEl.style.left).toBe("22px");
    expect(app.dragManager.actionEl.style.top).toBe("32px");
    expect(app.dragManager.overlayEl.isConnected).toBe(true);

    targetEl.dispatchEvent(createDragEvent("dragleave", createDataTransfer("copyMove")));

    expect(hoverEl.classList.contains("is-highlighted")).toBe(false);
    expect(app.dragManager.actionEl.isConnected).toBe(false);
    expect(app.dragManager.overlayEl.isConnected).toBe(false);
  });

  it("only writes dropEffect when the browser effectAllowed value permits it", () => {
    const app = new App(document.createElement("div"));
    const targetEl = document.createElement("div");
    document.body.appendChild(targetEl);
    app.dragManager.handleDrop(targetEl, () => ({ action: "Copy", dropEffect: "copy" }));
    app.dragManager.setSource(createSource());

    const disallowed = createDragEvent("dragover", createDataTransfer("move"));
    targetEl.dispatchEvent(disallowed);

    expect(disallowed.defaultPrevented).toBe(true);
    expect(disallowed.dataTransfer?.dropEffect).toBe("none");
    expect(isDropEffectAllowed("copyMove", "copy")).toBe(true);
    expect(isDropEffectAllowed("copyMove", "link")).toBe(false);
    expect(isDropEffectAllowed("uninitialized", "copy")).toBe(false);
    expect(isDropEffectAllowed("none", "copy")).toBe(false);
  });

  it("clears preview state after external drops without an internal drag source", () => {
    const app = new App(document.createElement("div"));
    const targetEl = document.createElement("div");
    const hoverEl = document.createElement("div");
    document.body.append(targetEl, hoverEl);
    app.dragManager.handleDrop(
      targetEl,
      (_event, source) => {
        expect(source).toBeNull();
        return {
          action: "Import attachments",
          dropEffect: "copy",
          hoverEl,
          hoverClass: "is-being-dragged-over",
        };
      },
      true,
    );

    targetEl.dispatchEvent(createDragEvent("dragover", createDataTransfer("copy")));

    expect(hoverEl.classList.contains("is-being-dragged-over")).toBe(true);
    expect(app.dragManager.actionEl.textContent).toBe("Import attachments");

    const drop = createDragEvent("drop", createDataTransfer("copy"));
    targetEl.dispatchEvent(drop);

    expect(drop.defaultPrevented).toBe(true);
    expect(hoverEl.classList.contains("is-being-dragged-over")).toBe(false);
    expect(app.dragManager.actionEl.isConnected).toBe(false);
  });
});

function createSource(): DragSource {
  return {
    type: "test",
    payload: null,
    elements: [],
  };
}

function createDataTransfer(effectAllowed: DataTransfer["effectAllowed"]): DataTransfer {
  return {
    effectAllowed,
    dropEffect: "none",
    setData: vi.fn(),
    getData: vi.fn(() => ""),
    clearData: vi.fn(),
    setDragImage: vi.fn(),
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
  };
}

function createDragEvent(
  type: string,
  dataTransfer: DataTransfer,
  init: MouseEventInit = {},
): DragEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: dataTransfer,
  });
  return event;
}
