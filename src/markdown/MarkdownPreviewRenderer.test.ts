import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { Component } from "../core/Component";
import { MarkdownRenderChild } from "./MarkdownRenderChild";
import { MarkdownPreviewRenderer } from "./MarkdownPreviewRenderer";
import { MarkdownRenderer, type MarkdownPostProcessor } from "./MarkdownRenderer";

type InternalMarkdownPostProcessorContext = Parameters<MarkdownPostProcessor>[1] & {
  containerEl?: HTMLElement;
  el?: HTMLElement;
  displayMode?: boolean;
  usesFrontMatter?: boolean;
  replace?(source: string): void | Promise<void> | null;
};

describe("MarkdownPreviewRenderer", () => {
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

  it("collects rendered block sections and exposes Obsidian-style section info", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md");
    const markdown = "# Title\n\nParagraph";

    renderer.set(markdown);
    await renderer.whenIdle();

    const heading = container.querySelector<HTMLElement>("h1");
    const paragraph = container.querySelector<HTMLElement>("p");
    if (!heading || !paragraph) throw new Error("Expected rendered markdown blocks");

    expect(renderer.sections.filter((section) => !section.modUi)).toHaveLength(2);
    expect(renderer.sections.filter((section) => !section.modUi).every((section) => section.computed)).toBe(true);
    expect(renderer.getSectionForElement(heading)?.level).toBe(1);
    expect(renderer.getSectionForElement(paragraph)?.level).toBe(0);
    expect(renderer.getSectionInfo(heading)).toEqual({ text: markdown, lineStart: 0, lineEnd: 0 });
    expect(renderer.getSectionInfo(paragraph)).toEqual({ text: markdown, lineStart: 2, lineEnd: 2 });
  });

  it("exposes the public MarkdownRenderer.render app-first entrypoint", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const owner = new Component();
    owner.load();
    const container = document.createElement("div");

    await MarkdownRenderer.render(app, "# Rendered\n\nBody", container, "note.md", owner);

    expect(MarkdownRenderer.prototype instanceof MarkdownRenderChild).toBe(true);
    expect(container.querySelector("h1")?.textContent).toBe("Rendered");
    expect(container.querySelector("p")?.textContent).toBe("Body");
    owner.unload();
  });

  it("runs later postprocessors before waiting for earlier async postprocessors", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const owner = new Component();
    owner.load();
    const container = document.createElement("div");
    const order: string[] = [];
    let resolveFirst: (() => void) | undefined;
    let renderPromise: Promise<void> | null = null;
    const first: MarkdownPostProcessor = () => {
      order.push("first");
      return new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
    };
    const second: MarkdownPostProcessor = () => {
      order.push("second");
    };
    MarkdownPreviewRenderer.registerPostProcessor(first, 0);
    MarkdownPreviewRenderer.registerPostProcessor(second, 1);
    try {
      renderPromise = MarkdownRenderer.render(app, "Body", container, "note.md", owner);
      await vi.waitFor(() => expect(order).toEqual(["first", "second"]));
      resolveFirst?.();
      await renderPromise;
    } finally {
      resolveFirst?.();
      await renderPromise?.catch(() => {});
      MarkdownPreviewRenderer.unregisterPostProcessor(first);
      MarkdownPreviewRenderer.unregisterPostProcessor(second);
      owner.unload();
    }
  });

  it("waits for code block postprocessor thenables like Obsidian", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const owner = new Component();
    owner.load();
    const container = document.createElement("div");
    let thenCalled = false;
    const wrapper = MarkdownRenderer.createCodeBlockPostProcessor("thenable", () => ({
      then(resolve: () => void) {
        thenCalled = true;
        resolve();
      },
    }) as Promise<void>);
    MarkdownPreviewRenderer.registerPostProcessor(wrapper);
    try {
      await MarkdownRenderer.render(app, "```thenable\nbody\n```", container, "note.md", owner);
      expect(thenCalled).toBe(true);
    } finally {
      MarkdownPreviewRenderer.unregisterPostProcessor(wrapper);
      owner.unload();
    }
  });

  it("applies preview CSS classes from cssclasses frontmatter only", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md");

    renderer.set([
      "---",
      "cssclasses:",
      "  - alpha",
      "  - beta",
      "  - bad class",
      "cssclass: ignored",
      "tags:",
      "  - taggy",
      "---",
      "Body",
    ].join("\n"));
    await renderer.whenIdle();

    expect(container.classList.contains("alpha")).toBe(true);
    expect(container.classList.contains("beta")).toBe(true);
    expect(container.classList.contains("ignored")).toBe(false);
    expect(container.classList.contains("taggy")).toBe(false);

    renderer.set("Body");
    await renderer.whenIdle();

    expect(container.classList.contains("alpha")).toBe(false);
    expect(container.classList.contains("beta")).toBe(false);
  });

  it("unloads markdown render children whose container leaves the current preview", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const owner = new Component();
    owner.load();
    const container = document.createElement("div");
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md", owner);
    let loads = 0;
    let unloads = 0;
    const processor: MarkdownPostProcessor = (el, context) => {
      context.addChild(new CountingRenderChild(el, () => {
        loads += 1;
      }, () => {
        unloads += 1;
      }));
    };
    MarkdownPreviewRenderer.registerPostProcessor(processor);
    try {
      renderer.set("First");
      await renderer.whenIdle();

      expect(loads).toBe(1);
      expect(unloads).toBe(0);

      renderer.set("Second");
      await renderer.whenIdle();

      expect(loads).toBe(2);
      expect(unloads).toBe(1);
    } finally {
      MarkdownPreviewRenderer.unregisterPostProcessor(processor);
      owner.unload();
    }
  });

  it("passes preview-owned postprocessor context and supports preview text replacement", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md");
    let replaced = false;
    let contextEl: HTMLElement | null = null;
    let contextContainerEl: HTMLElement | null = null;
    let displayMode: boolean | null = null;
    const seenSectionTexts: Array<string | null> = [];
    const processor: MarkdownPostProcessor = (el, context) => {
      const internalContext = context as InternalMarkdownPostProcessorContext;
      contextEl = internalContext.el ?? null;
      contextContainerEl = internalContext.containerEl ?? null;
      displayMode = internalContext.displayMode ?? null;
      seenSectionTexts.push(context.getSectionInfo(el)?.text ?? null);
      if (!replaced) {
        replaced = true;
        internalContext.replace?.("Changed");
      }
    };
    MarkdownPreviewRenderer.registerPostProcessor(processor);
    try {
      renderer.set("Original");
      await renderer.whenIdle();

      expect(container.textContent).toContain("Changed");
      expect(contextEl?.textContent).toBe("Changed");
      expect(contextContainerEl).toBe(renderer.sizerEl);
      expect(displayMode).toBe(true);
      expect(seenSectionTexts).toEqual(["Original", "Changed"]);
    } finally {
      MarkdownPreviewRenderer.unregisterPostProcessor(processor);
    }
  });

  it("rewrites media linktext sources to vault resource paths through the default file-link postprocessor", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const image = await app.vault.createBinary("Assets/Image One.png", new ArrayBuffer(1));
    vi.spyOn(app.vault, "getResourcePath").mockImplementation((file) => `app://resource/${encodeURIComponent(file.path)}`);
    const container = document.createElement("div");
    const renderer = new MarkdownPreviewRenderer(app, container, "Notes/Source.md");
    const processor: MarkdownPostProcessor = (el) => {
      const internal = document.createElement("img");
      internal.dataset.kind = "internal";
      internal.setAttribute("src", "Assets/Image%20One.png?mtime=1");
      const external = document.createElement("img");
      external.dataset.kind = "external";
      external.setAttribute("src", "https://example.com/image.png");
      el.append(internal, external);
    };
    MarkdownPreviewRenderer.registerPostProcessor(processor, -20);
    try {
      renderer.set("Body");
      await renderer.whenIdle();

      expect(container.querySelector<HTMLImageElement>('img[data-kind="internal"]')?.getAttribute("src")).toBe(`app://resource/${encodeURIComponent(image.path)}`);
      expect(container.querySelector<HTMLImageElement>('img[data-kind="external"]')?.getAttribute("src")).toBe("https://example.com/image.png");
    } finally {
      MarkdownPreviewRenderer.unregisterPostProcessor(processor);
    }
  });

  it("records frontmatter usage requested by markdown postprocessors on preview sections", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md");
    const processor: MarkdownPostProcessor = (_el, context) => {
      (context as InternalMarkdownPostProcessorContext).usesFrontMatter = true;
    };
    MarkdownPreviewRenderer.registerPostProcessor(processor);
    try {
      renderer.set("---\ntype: note\n---\nBody");
      await renderer.whenIdle();

      const markdownSections = renderer.sections.filter((section) => !section.modUi);
      expect(markdownSections).toHaveLength(1);
      expect(markdownSections[0]?.usesFrontMatter).toBe(true);
    } finally {
      MarkdownPreviewRenderer.unregisterPostProcessor(processor);
    }
  });

  it("adds heading collapse indicators and hides deeper sections while folded", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md");

    renderer.set("# A\n\nhidden\n\n## B\n\nhidden b\n\n# C\n\nshown");
    await renderer.whenIdle();

    const indicator = container.querySelector<HTMLElement>("h1 .heading-collapse-indicator");
    if (!indicator) throw new Error("Expected heading collapse indicator");
    indicator.click();
    await renderer.whenIdle();

    const sections = renderer.sections.filter((section) => !section.modUi);
    expect(sections.map((section) => section.shown)).toEqual([true, false, false, false, true, true]);
    expect(container.querySelector("h1")?.classList.contains("is-collapsed")).toBe(true);
  });

  it("virtualizes preview sections with pusher spacing and total sizer height", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 200 });
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md");
    renderer.renderExtra = 0;
    renderer.renderExtraMinPx = 100;

    renderer.set(Array.from({ length: 20 }, (_, index) => `Paragraph ${index}`).join("\n\n"));
    await renderer.whenIdle();

    const sections = renderer.sections.filter((section) => !section.modUi);
    sections.forEach((section) => {
      section.height = 100;
      section.computed = true;
    });

    renderer.updateVirtualDisplay(1000);

    const mounted = sections.filter((section) => section.el.parentElement === renderer.sizerEl);
    expect(mounted.length).toBeLessThan(sections.length);
    expect(mounted.length).toBeGreaterThan(0);
    expect(parseFloat(renderer.pusherEl?.style.marginBottom || "0")).toBeGreaterThan(0);
    expect(parseFloat(renderer.sizerEl.style.minHeight)).toBeGreaterThan(1900);
  });

  it("keeps selected sections mounted while virtualizing outside the viewport", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    document.body.appendChild(container);
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 200 });
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md");
    renderer.renderExtra = 0;
    renderer.renderExtraMinPx = 100;

    renderer.set(Array.from({ length: 20 }, (_, index) => `Paragraph ${index}`).join("\n\n"));
    await renderer.whenIdle();

    const sections = renderer.sections.filter((section) => !section.modUi);
    sections.forEach((section) => {
      section.height = 100;
      section.computed = true;
    });
    const selection = document.getSelection();
    const range = document.createRange();
    const startNode = sections[0]?.el.firstChild ?? sections[0]?.el;
    const endNode = sections[1]?.el.firstChild ?? sections[1]?.el;
    if (!startNode || !endNode) throw new Error("Expected selectable section contents");
    range.setStart(startNode, 0);
    range.setEnd(endNode, endNode.textContent?.length ?? 0);
    selection?.removeAllRanges();
    selection?.addRange(range);

    renderer.updateVirtualDisplay(1000);

    expect(sections[0]?.el.parentElement).toBe(renderer.sizerEl);
    expect(sections[1]?.el.parentElement).toBe(renderer.sizerEl);

    selection?.removeAllRanges();
    container.remove();
  });

  it("mounts every section when progressive rendering is disabled", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 100 });
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md");
    renderer.progressiveRender = false;

    renderer.set("# Fold\n\nhidden\n\nshown");
    await renderer.whenIdle();
    container.querySelector<HTMLElement>("h1 .heading-collapse-indicator")?.click();
    await renderer.whenIdle();

    const sections = renderer.sections.filter((section) => !section.modUi);
    renderer.updateVirtualDisplay(1000);

    expect(sections.every((section) => section.el.parentElement === renderer.sizerEl)).toBe(true);
    expect(sections.map((section) => section.el.style.display)).toEqual(["", "none", "none"]);
    expect(renderer.pusherEl?.style.marginBottom).toBe("0px");
    expect(renderer.sizerEl.style.minHeight).toBe("");
  });

  it("builds search highlight ranges from rendered section text offsets", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md");

    renderer.set("Alpha beta\n\nBeta beta");
    await renderer.whenIdle();
    renderer.updateSearchQuery("beta", 1);

    const sections = renderer.sections.filter((section) => !section.modUi);
    expect(sections[0]?.highlightRanges).toEqual([
      expect.objectContaining({ section: sections[0], start: 6, end: 10, active: false }),
    ]);
    expect(sections[1]?.highlightRanges).toEqual([
      expect.objectContaining({ section: sections[1], start: 0, end: 4, active: true }),
      expect.objectContaining({ section: sections[1], start: 5, end: 9, active: false }),
    ]);

    renderer.updateSearchQuery("");
    expect(sections.every((section) => section.highlightRanges === null)).toBe(true);
  });

  it("renders cached search highlight rects in the preview sizer", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md");

    renderer.set("Alpha beta");
    await renderer.whenIdle();

    const section = renderer.sections.find((item) => !item.modUi);
    if (!section) throw new Error("Expected markdown section");
    section.highlightRanges = [{
      section,
      start: 6,
      end: 10,
      active: true,
      rects: [{ x: 10, y: 20, width: 30, height: 8 }],
    }];

    renderer.updateVirtualDisplay(0);

    const wrapper = renderer.sizerEl.querySelector<HTMLElement>(":scope > .search-highlight");
    const rectEl = wrapper?.querySelector<HTMLElement>("div");
    expect(wrapper).not.toBeNull();
    expect(rectEl?.classList.contains("is-active")).toBe(true);
    expect(rectEl?.style.left).toBe("10px");
    expect(rectEl?.style.top).toBe("20px");
    expect(rectEl?.style.width).toBe("30px");
    expect(rectEl?.style.height).toBe("8px");
  });

  it("adds list collapse indicators, stores list fold info, and restores list folds", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md");

    renderer.set("- Parent\n  - Child\n- Next");
    await renderer.whenIdle();

    const section = renderer.sections.find((item) => !item.modUi);
    if (!section) throw new Error("Expected markdown section");
    section.highlightRanges = [{
      section,
      start: 0,
      end: 6,
      active: false,
      rects: [{ x: 1, y: 2, width: 3, height: 4 }],
    }];

    const indicator = section.el.querySelector<HTMLElement>("li > .list-collapse-indicator");
    const li = indicator?.parentElement;
    if (!(indicator instanceof HTMLElement) || !(li instanceof HTMLLIElement)) throw new Error("Expected list collapse indicator");

    indicator.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    expect(li.classList.contains("is-collapsed")).toBe(true);
    expect(indicator.classList.contains("is-collapsed")).toBe(true);
    expect(section.computed).toBe(false);
    expect(section.highlightRanges?.[0]?.rects).toBeUndefined();
    expect(renderer.getFoldInfo().folds).toContainEqual({ from: section.start.line, to: section.start.line + 1 });
    await renderer.whenIdle();

    const restoredSection = renderer.sections.find((item) => !item.modUi);
    const restoredIndicator = restoredSection?.el.querySelector<HTMLElement>("li > .list-collapse-indicator");
    const restoredLi = restoredIndicator?.parentElement;
    if (!(restoredIndicator instanceof HTMLElement) || !(restoredLi instanceof HTMLLIElement)) throw new Error("Expected rerendered list collapse indicator");
    restoredLi.classList.remove("is-collapsed");
    restoredIndicator.classList.remove("is-collapsed");
    renderer.applyFoldInfo({ folds: [{ from: section.start.line, to: section.start.line + 1 }], lines: 3 });
    await renderer.whenIdle();

    expect(restoredLi.classList.contains("is-collapsed")).toBe(true);
    expect(restoredIndicator.classList.contains("is-collapsed")).toBe(true);
  });

  it("renders Obsidian-style task lists and toggles checklist source text", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md");

    renderer.set("- [ ] Todo\n- [x] Done\n- [X] Upper\n- [-] Maybe\n- [ ] Parent\n  - Child");
    await renderer.whenIdle();

    const list = container.querySelector<HTMLElement>("ul.contains-task-list");
    const items = container.querySelectorAll<HTMLLIElement>("li.task-list-item");
    const checkboxes = container.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox");
    expect(list).not.toBeNull();
    expect(items).toHaveLength(5);
    expect(checkboxes).toHaveLength(5);
    expect(items[0]?.dataset.task).toBe(" ");
    expect(items[0]?.classList.contains("is-checked")).toBe(false);
    expect(checkboxes[0]?.checked).toBe(false);
    expect(checkboxes[0]?.dataset.line).toBe("0");
    expect(items[1]?.dataset.task).toBe("x");
    expect(items[1]?.classList.contains("is-checked")).toBe(true);
    expect(checkboxes[1]?.checked).toBe(true);
    expect(items[2]?.dataset.task).toBe("X");
    expect(checkboxes[2]?.checked).toBe(true);
    expect(items[3]?.dataset.task).toBe("-");
    expect(checkboxes[3]?.checked).toBe(true);

    const parent = items[4];
    expect(parent?.firstElementChild?.classList.contains("list-collapse-indicator")).toBe(true);
    expect(parent?.firstElementChild?.nextElementSibling?.classList.contains("task-list-item-checkbox")).toBe(true);

    checkboxes[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(renderer.text).toBe("- [x] Todo\n- [x] Done\n- [X] Upper\n- [-] Maybe\n- [ ] Parent\n  - Child");
    await renderer.whenIdle();

    container.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox")[3]?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(renderer.text).toBe("- [x] Todo\n- [x] Done\n- [X] Upper\n- [ ] Maybe\n- [ ] Parent\n  - Child");
  });

  it("keeps static MarkdownRenderer section lookup and replacement unavailable", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    let sectionInfoAvailable = true;
    let replaceResult: void | Promise<void> | null | undefined = undefined;
    const processor: MarkdownPostProcessor = (el, context) => {
      const internalContext = context as InternalMarkdownPostProcessorContext;
      sectionInfoAvailable = context.getSectionInfo(el) !== null;
      replaceResult = internalContext.replace?.("Changed");
    };
    MarkdownPreviewRenderer.registerPostProcessor(processor);
    try {
      await MarkdownRenderer.render(app, "Original", container, "note.md");

      expect(sectionInfoAvailable).toBe(false);
      expect(replaceResult).toBeNull();
      expect(container.textContent).toContain("Original");
    } finally {
      MarkdownPreviewRenderer.unregisterPostProcessor(processor);
    }
  });

  it("uses MarkdownPostProcessor.sortOrder when no explicit order is passed", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    const order: string[] = [];
    const later: MarkdownPostProcessor = () => {
      order.push("later");
    };
    later.sortOrder = 20;
    const earlier: MarkdownPostProcessor = () => {
      order.push("earlier");
    };
    earlier.sortOrder = -10;

    MarkdownPreviewRenderer.registerPostProcessor(later);
    MarkdownPreviewRenderer.registerPostProcessor(earlier);
    try {
      await MarkdownRenderer.render(app, "Ordered", container, "note.md");

      expect(order).toEqual(["earlier", "later"]);
    } finally {
      MarkdownPreviewRenderer.unregisterPostProcessor(later);
      MarkdownPreviewRenderer.unregisterPostProcessor(earlier);
    }
  });
});

class CountingRenderChild extends MarkdownRenderChild {
  constructor(containerEl: HTMLElement, readonly onLoad: () => void, readonly onUnload: () => void) {
    super(containerEl);
  }

  override onload(): void {
    this.onLoad();
  }

  override onunload(): void {
    this.onUnload();
  }
}

describe("MarkdownPreviewRenderer rendered link context menus", () => {
  beforeEach(() => {
    document.body.querySelectorAll(".menu").forEach((element) => element.remove());
  });

  it("routes rendered internal link context menus through workspace link handling", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md");
    const viewportMenu = vi.fn();
    const handleLinkContextMenu = vi.spyOn(app.workspace, "handleLinkContextMenu");
    app.workspace.on("markdown-viewport-menu", viewportMenu);

    renderer.set("See [[Target|Alias]]");
    await renderer.whenIdle();

    const link = container.querySelector<HTMLElement>(".internal-link");
    if (!link) throw new Error("Expected rendered internal link");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 12 });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(handleLinkContextMenu).toHaveBeenCalledTimes(1);
    expect(handleLinkContextMenu.mock.calls[0]?.[1]).toBe("Target");
    expect(handleLinkContextMenu.mock.calls[0]?.[2]).toBe("note.md");
    expect(viewportMenu).not.toHaveBeenCalled();
    expect(findRenderedLinkMenuItem("Copy")).not.toBeNull();
    container.remove();
  });

  it("routes rendered external link context menus through workspace url handling", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new MarkdownPreviewRenderer(app, container, "note.md");
    const viewportMenu = vi.fn();
    const urlMenu = vi.fn();
    const handleExternalLinkContextMenu = vi.spyOn(app.workspace, "handleExternalLinkContextMenu");
    app.workspace.on("markdown-viewport-menu", viewportMenu);
    app.workspace.on("url-menu", urlMenu);

    renderer.set("[Web](https://example.com)");
    await renderer.whenIdle();

    const link = container.querySelector<HTMLElement>(".external-link");
    if (!link) throw new Error("Expected rendered external link");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 12 });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(handleExternalLinkContextMenu).toHaveBeenCalledTimes(1);
    expect(handleExternalLinkContextMenu.mock.calls[0]?.[1]).toBe("https://example.com");
    expect(urlMenu).toHaveBeenCalledTimes(1);
    expect(urlMenu.mock.calls[0]?.[1]).toBe("https://example.com");
    expect(viewportMenu).not.toHaveBeenCalled();
    expect(findRenderedLinkMenuItem("Copy")).not.toBeNull();
    expect(findRenderedLinkMenuItem("Copy URL")).not.toBeNull();
    container.remove();
  });
});

function findRenderedLinkMenuItem(title: string): HTMLElement | null {
  const titleEl = Array.from(document.querySelectorAll<HTMLElement>(".menu-item-title")).find(
    (element) => element.textContent === title,
  );
  return titleEl?.closest<HTMLElement>(".menu-item") ?? null;
}
