import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { MarkdownPreviewRenderer } from "@web/markdown/MarkdownPreviewRenderer";
import { MarkdownView } from "@web/views/MarkdownView";

// The reading-view heal path (reading-view-stale-layout contract): section
// heights stamped at transient geometry are only recoverable if the leaf's
// resize signal reaches the renderer and a width change forces a re-render.
describe("reading view resize heal path", () => {
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
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  it("forwards resize to the preview renderer", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const file = await app.vault.create("Note.md", "# hi\n\nbody");
    const leaf = app.workspace.getLeaf();
    await leaf.openFile(file, { active: true, state: { mode: "preview" } });
    const view = leaf.view as MarkdownView;
    expect(view.getMode()).toBe("preview");

    const onResize = vi.spyOn(view.previewMode.renderer, "onResize");
    view.onResize();

    expect(onResize).toHaveBeenCalled();
  });

  it("re-renders when the preview width changes", async () => {
    const { renderer, sections, setWidth } = await renderAtWidth(300);
    setWidth(600);
    const queueRender = vi.spyOn(renderer, "queueRender");

    renderer.onResize();

    expect(sections.some((section) => section.computed)).toBe(false);
    expect(queueRender).toHaveBeenCalled();
    await renderer.whenIdle();
  });

  it("refreshes the virtual display when width is unchanged", async () => {
    const { renderer, sections } = await renderAtWidth(300);
    const queueRender = vi.spyOn(renderer, "queueRender");
    const updateVirtualDisplay = vi.spyOn(renderer, "updateVirtualDisplay");

    renderer.onResize();

    expect(queueRender).not.toHaveBeenCalled();
    expect(updateVirtualDisplay).toHaveBeenCalled();
    expect(sections.every((section) => section.computed)).toBe(true);
    expect(renderer.viewportHeight).toBe(200);
  });
});

async function renderAtWidth(initialWidth: number) {
  const app = new App(document.createElement("div"));
  await app.ready;
  const container = document.createElement("div");
  let width = initialWidth;
  Object.defineProperty(container, "offsetWidth", { configurable: true, get: () => width });
  Object.defineProperty(container, "clientHeight", { configurable: true, value: 200 });
  const renderer = new MarkdownPreviewRenderer(app, container, "note.md");
  renderer.set("First\n\nSecond\n\nThird");
  await renderer.whenIdle();
  const sections = renderer.sections.filter((section) => !section.modUi);
  for (const section of sections) {
    section.height = 100;
    section.computed = true;
  }
  return { renderer, sections, setWidth: (next: number) => (width = next) };
}
