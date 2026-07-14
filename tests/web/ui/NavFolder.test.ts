import { describe, expect, it } from "vitest";
import { createNavFolder } from "@web/ui/NavFolder";

describe("createNavFolder", () => {
  it("owns Obsidian nav-folder structure and collapse state", () => {
    const parent = document.createElement("div");
    const nav = createNavFolder(parent, true);

    expect(nav.folderEl.matches(".tree-item.nav-folder.is-collapsed")).toBe(true);
    expect(nav.titleEl.matches(".tree-item-self.nav-folder-title.mod-collapsible")).toBe(true);
    expect(nav.titleEl.querySelector(".nav-folder-collapse-indicator.is-collapsed")).not.toBeNull();
    expect(nav.childrenEl.hidden).toBe(true);

    nav.setCollapsed(false);
    expect(nav.folderEl.classList).not.toContain("is-collapsed");
    expect(nav.titleEl.getAttribute("aria-expanded")).toBe("true");
    expect(nav.childrenEl.hidden).toBe(false);
  });
});
