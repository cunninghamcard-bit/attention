import { describe, expect, it } from "vitest";
import { TreeItem } from "@web/ui/TreeItem";

describe("TreeItem", () => {
  it("builds Obsidian's shared tree row structure", () => {
    const parent = document.createElement("div");
    const item = new TreeItem(parent);

    expect(item.el.matches(".tree-item")).toBe(true);
    expect(item.el.parentElement).toBe(parent);
    expect(item.selfEl.matches(".tree-item-self")).toBe(true);
    expect(item.selfEl.parentElement).toBe(item.el);
    expect(item.innerEl.matches(".tree-item-inner")).toBe(true);
    expect(item.selfEl.contains(item.innerEl)).toBe(true);
    expect(item.childrenEl.matches(".tree-item-children")).toBe(true);
    expect(item.el.contains(item.childrenEl)).toBe(true);
  });

  it("adds a collapse chevron and mod-collapsible gutter when collapsible", () => {
    const item = new TreeItem(document.createElement("div"));
    expect(item.collapseEl).toBeNull();

    item.setCollapsible(true);
    expect(item.selfEl.matches(".mod-collapsible")).toBe(true);
    expect(item.selfEl.querySelector(".collapse-icon")).not.toBeNull();
    // Chevron leads the row (prepended before the inner content).
    expect(item.collapseEl).toBe(item.selfEl.firstElementChild);
  });

  it("reflects collapsed state on the item, chevron and children", () => {
    const item = new TreeItem(document.createElement("div"));
    item.setCollapsible(true);

    item.setCollapsed(true);
    expect(item.el.matches(".is-collapsed")).toBe(true);
    expect(item.collapseEl?.matches(".is-collapsed")).toBe(true);
    expect(item.selfEl.getAttribute("aria-expanded")).toBe("false");
    expect(item.childrenEl.hidden).toBe(true);

    item.setCollapsed(false);
    expect(item.el.classList.contains("is-collapsed")).toBe(false);
    expect(item.selfEl.getAttribute("aria-expanded")).toBe("true");
    expect(item.childrenEl.hidden).toBe(false);
  });

  it("layers view classes onto the base structure", () => {
    const item = new TreeItem(document.createElement("div"), {
      itemClass: "nav-folder",
      selfClass: "nav-folder-title tappable is-clickable",
      innerClass: "nav-folder-title-content",
      childrenClass: "nav-folder-children",
      collapseClass: "nav-folder-collapse-indicator",
    });
    item.setCollapsible(true);

    expect(item.el.matches(".tree-item.nav-folder")).toBe(true);
    expect(item.selfEl.matches(".tree-item-self.nav-folder-title")).toBe(true);
    expect(item.innerEl.matches(".tree-item-inner.nav-folder-title-content")).toBe(true);
    expect(item.childrenEl.matches(".tree-item-children.nav-folder-children")).toBe(true);
    expect(item.collapseEl?.matches(".collapse-icon.nav-folder-collapse-indicator")).toBe(true);
  });

  it("nests a child TreeItem's el under childrenEl", () => {
    const parent = new TreeItem(document.createElement("div"));
    const child = new TreeItem(document.createElement("div"));

    parent.addChild(child);
    expect(child.el.parentElement).toBe(parent.childrenEl);
  });
});
