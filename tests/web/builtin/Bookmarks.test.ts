import { beforeEach, describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import type { DragSource } from "@web/ui/drag/DragManager";
import {
  BookmarksController,
  createBookmarksPluginDefinition,
  type BookmarkItem,
} from "@web/builtin/Bookmarks";

describe("Bookmarks plugin", () => {
  beforeEach(() => {
    document.body.replaceChildren();
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

  it("creates a single bookmark drag source and selects the dragged item", async () => {
    const { app } = await openBookmarks([
      { type: "file", ctime: 1, path: "Alpha.md" },
      { type: "graph", ctime: 2, title: "Graph view" },
    ]);
    const rows = getBookmarkRows();

    expect(rows[0].classList.contains("bookmark")).toBe(true);
    expect(rows[0].classList.contains("is-clickable")).toBe(true);
    expect(rows[0].querySelector(".tree-item-icon")).not.toBeNull();
    expect(rows[0].querySelector(".tree-item-inner > .tree-item-inner-text")?.textContent).toBe(
      "Alpha.md",
    );
    dispatchDragStart(rows[1]);

    const source = getBookmarkDragSource(app);
    expect(rows[0].classList.contains("is-selected")).toBe(false);
    expect(rows[1].classList.contains("is-selected")).toBe(true);
    expect(rows[1].classList.contains("is-being-dragged")).toBe(true);
    expect(source.source).toBe("bookmarks");
    expect(source.icon).toBe("lucide-bookmark");
    expect(source.title).toBe("Graph view");
    expect(source.items.map((entry) => entry.item.type)).toEqual(["graph"]);
  });

  it("drags selected bookmarks in visual top-to-bottom order", async () => {
    const { app } = await openBookmarks([
      { type: "file", ctime: 1, path: "Alpha.md" },
      { type: "file", ctime: 2, path: "Beta.md" },
      { type: "url", ctime: 3, url: "https://example.com", title: "Example" },
    ]);
    const rows = getBookmarkRows();
    setOffsetTop(rows[0], 30);
    setOffsetTop(rows[1], 10);
    setOffsetTop(rows[2], 20);

    rows[0].dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }),
    );
    rows[1].dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }),
    );
    rows[2].dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }),
    );
    dispatchDragStart(rows[0]);

    const source = getBookmarkDragSource(app);
    expect(source.title).toBe("3 bookmarks");
    expect(
      source.items.map((entry) =>
        entry.item.type === "file" ? entry.item.path : entry.item.title,
      ),
    ).toEqual(["Beta.md", "Example", "Alpha.md"]);
    expect(rows.every((row) => row.classList.contains("is-being-dragged"))).toBe(true);
  });

  it("clears an existing multi-selection when dragging an unselected bookmark", async () => {
    const { app } = await openBookmarks([
      { type: "file", ctime: 1, path: "Alpha.md" },
      { type: "file", ctime: 2, path: "Beta.md" },
      { type: "file", ctime: 3, path: "Gamma.md" },
    ]);
    const rows = getBookmarkRows();

    rows[0].dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }),
    );
    rows[1].dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }),
    );
    dispatchDragStart(rows[2]);

    const source = getBookmarkDragSource(app);
    expect(rows[0].classList.contains("is-selected")).toBe(false);
    expect(rows[1].classList.contains("is-selected")).toBe(false);
    expect(rows[2].classList.contains("is-selected")).toBe(true);
    expect(
      source.items.map((entry) => (entry.item.type === "file" ? entry.item.path : "")),
    ).toEqual(["Gamma.md"]);
  });

  it("uses Alt toggle and Shift range selection without opening bookmarks", async () => {
    const { controller } = await openBookmarks([
      { type: "file", ctime: 1, path: "Alpha.md" },
      { type: "file", ctime: 2, path: "Beta.md" },
      { type: "file", ctime: 3, path: "Gamma.md" },
    ]);
    const rows = getBookmarkRows();
    const opened: BookmarkItem[] = [];
    controller.openItem = async (item) => {
      opened.push(item);
    };

    rows[0].dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }),
    );
    rows[2].dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }),
    );

    expect(opened).toEqual([]);
    expect(rows.map((row) => row.classList.contains("is-selected"))).toEqual([true, true, true]);
    expect(rows[2].classList.contains("has-focus")).toBe(true);

    rows[2].dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }),
    );

    expect(rows.map((row) => row.classList.contains("is-selected"))).toEqual([true, true, false]);
  });

  it("keeps graph bookmarks as a disabled seam until the Graph plugin is explicitly enabled", async () => {
    const graph: BookmarkItem = {
      type: "graph",
      ctime: 1,
      title: "Graph view",
      options: { "collapse-filter": true },
    };
    const { app, controller } = await openBookmarks([graph]);
    const leaf = app.workspace.getLeaf(true);

    await controller.openItem(graph);
    await controller.openBookmarkInLeaf(graph, leaf, { active: true });

    expect(app.workspace.getLeavesOfType("graph")).toHaveLength(0);
    expect(leaf.view?.getViewType()).not.toBe("graph");

    await app.internalPlugins.enable("graph");
    await controller.openBookmarkInLeaf(graph, leaf, { active: true });

    expect(leaf.view?.getViewType()).toBe("graph");
  });
});

async function openBookmarks(
  items: BookmarkItem[],
): Promise<{ app: App; controller: BookmarksController }> {
  const app = new App(document.body.appendChild(document.createElement("div")));
  if (!app.internalPlugins.getPluginById("bookmarks"))
    app.internalPlugins.register(createBookmarksPluginDefinition());
  await app.internalPlugins.enable("bookmarks");
  const controller = app.internalPlugins.getEnabledPluginById<BookmarksController>("bookmarks");
  if (!controller) throw new Error("Expected bookmarks controller");
  controller.items = items;
  await controller.openView(true);
  return { app, controller };
}

function getBookmarkRows(): HTMLElement[] {
  return [
    ...document.body.querySelectorAll<HTMLElement>(
      ".workspace-leaf-content[data-type='bookmarks'] .tree-item-self",
    ),
  ];
}

function dispatchDragStart(el: HTMLElement): void {
  const event = new Event("dragstart", { bubbles: true, cancelable: true }) as Event & {
    dataTransfer: TestDataTransfer;
  };
  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: createDataTransfer(),
  });
  el.dispatchEvent(event);
}

function getBookmarkDragSource(app: App): DragSource & {
  type: "bookmarks";
  source: "bookmarks";
  icon: string;
  items: Array<{ item: BookmarkItem }>;
} {
  const source = app.dragManager.getSource();
  if (!source || source.type !== "bookmarks") throw new Error("Expected bookmarks drag source");
  return source as DragSource & {
    type: "bookmarks";
    source: "bookmarks";
    icon: string;
    items: Array<{ item: BookmarkItem }>;
  };
}

function setOffsetTop(el: HTMLElement, value: number): void {
  Object.defineProperty(el, "offsetTop", { configurable: true, value });
}

function createDataTransfer(): TestDataTransfer {
  const store = new Map<string, string>();
  return {
    effectAllowed: "uninitialized",
    dropEffect: "none",
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? "",
  };
}

interface TestDataTransfer {
  effectAllowed: DataTransfer["effectAllowed"];
  dropEffect: DataTransfer["dropEffect"];
  setData(type: string, value: string): void;
  getData(type: string): string;
}
