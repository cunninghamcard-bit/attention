import { beforeEach, describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import { MarkdownView } from "@web/views/MarkdownView";

describe("MarkdownView property type menu", () => {
  beforeEach(() => {
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
  });

  it("sets the expected type, shows mismatch, and lets Update render the expected widget", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create("Note.md", "---\nrating: high\n---\nBody");

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const rowEl = view.metadataContainerEl.querySelector<HTMLElement>('[data-property-key="rating"]');
    if (!rowEl) throw new Error("missing rating row");

    expect(rowEl.classList.contains("has-type-mismatch")).toBe(false);
    rowEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    const propertyTypeItem = findMenuItem(document.body, "Property type");
    propertyTypeItem.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    findMenuItem(document.body, "Number").click();

    expect(app.metadataTypeManager.getAssignedWidget("rating")).toBe("number");
    expect(rowEl.classList.contains("has-type-mismatch")).toBe(true);
    expect(rowEl.querySelector<HTMLElement>(".metadata-property-value")?.dataset.propertyType).toBe("text");
    expect(document.body.querySelector(".modal-title")?.textContent).toBe("Change property type to Number");

    findButton("Update").click();

    expect(rowEl.classList.contains("has-type-mismatch")).toBe(false);
    expect(rowEl.querySelector<HTMLElement>(".metadata-property-value")?.dataset.propertyType).toBe("number");
  });
});

function findMenuItem(root: ParentNode, title: string): HTMLElement {
  const item = [...root.querySelectorAll<HTMLElement>(".menu-item")]
    .find((element) => element.querySelector(".menu-item-title")?.textContent?.trim() === title);
  if (!item) throw new Error(`Missing menu item: ${title}`);
  return item;
}

function findButton(title: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
    .find((element) => element.textContent?.trim() === title);
  if (!button) throw new Error(`Missing button: ${title}`);
  return button;
}
