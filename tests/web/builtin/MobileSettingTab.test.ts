import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { Platform } from "@web/platform/Platform";
import { MarkdownView } from "@web/views/MarkdownView";
import { MobileSettingTab } from "@web/builtin/MobileSettingTab";

describe("MobileSettingTab Obsidian mobile toolbar settings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  it("renders selected mobile toolbar commands with Obsidian option rows", () => {
    const app = new App(document.createElement("div"));
    app.vault.setConfig("mobileToolbarCommands", ["editor:insert-link", "missing-command", "editor:toggle-bold"]);
    const tab = new MobileSettingTab(app);

    tab.display();

    expect(tab.id).toBe("mobile");
    expect(tab.name).toBe("Mobile");
    expect(tab.containerEl.className).toBe("vertical-tab-content mobile-settings");
    const rows = [...tab.containerEl.querySelectorAll<HTMLElement>(".mobile-toolbar-selected-list .mobile-option-setting-item")];
    expect(rows.map((row) => row.querySelector(".mobile-option-setting-item-name")?.textContent)).toEqual([
      "Insert Markdown link",
      "Toggle bold",
    ]);
    expect(app.vault.getConfig("mobileToolbarCommands")).toEqual(["editor:insert-link", "editor:toggle-bold"]);
    expect(rows[0].querySelector(".mobile-option-setting-item-remove-icon")).not.toBeNull();
    expect(rows[0].querySelector(".mobile-option-setting-drag-icon")).not.toBeNull();
  });

  it("removes, moves, drags, and adds toolbar commands through vault config", () => {
    const app = new App(document.createElement("div"));
    app.commands.addCommand({ id: "editor:alpha", name: "Alpha", showOnMobileToolbar: true, editorCallback: () => {} });
    app.commands.addCommand({ id: "editor:beta", name: "Beta", showOnMobileToolbar: true, editorCallback: () => {} });
    app.commands.addCommand({ id: "global:gamma", name: "Gamma", callback: () => {} });
    app.vault.setConfig("mobileToolbarCommands", ["editor:insert-link", "editor:toggle-bold"]);
    const compile = vi.spyOn(app.mobileToolbar, "compileToolbar");
    const tab = new MobileSettingTab(app);

    tab.display();

    let rows = [...tab.containerEl.querySelectorAll<HTMLElement>(".mobile-toolbar-selected-list .mobile-option-setting-item")];
    rows[0].querySelector<HTMLElement>('.clickable-icon[aria-label="Delete"]')?.click();
    expect(app.vault.getConfig("mobileToolbarCommands")).toEqual(["editor:toggle-bold"]);
    expect(compile).toHaveBeenCalled();

    const moreRows = [...tab.containerEl.querySelectorAll<HTMLElement>(".mobile-toolbar-more-list .mobile-option-setting-item")];
    const alphaMore = moreRows.find((row) => row.textContent?.includes("Alpha"));
    expect(alphaMore?.querySelector(".mobile-option-setting-item-add-icon")).not.toBeNull();
    alphaMore?.querySelector<HTMLElement>('.clickable-icon[aria-label="Add"]')?.click();
    expect(app.vault.getConfig("mobileToolbarCommands")).toEqual(["editor:toggle-bold", "editor:alpha"]);

    tab.display();
    const search = tab.containerEl.querySelector<HTMLInputElement>(".mobile-toolbar-command-search");
    if (!search) throw new Error("Missing search");
    search.value = "Gamma";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const result = tab.containerEl.querySelector<HTMLElement>(".mobile-toolbar-command-results .suggestion-item");
    expect(result?.textContent).toBe("Gamma");
    result?.click();
    expect(app.vault.getConfig("mobileToolbarCommands")).toEqual(["editor:toggle-bold", "editor:alpha", "global:gamma"]);

    tab.display();
    rows = [...tab.containerEl.querySelectorAll<HTMLElement>(".mobile-toolbar-selected-list .mobile-option-setting-item")];
    rows[1].querySelector<HTMLElement>('.clickable-icon[aria-label="Move up"]')?.click();
    expect(app.vault.getConfig("mobileToolbarCommands")).toEqual(["editor:alpha", "editor:toggle-bold", "global:gamma"]);

    tab.display();
    rows = [...tab.containerEl.querySelectorAll<HTMLElement>(".mobile-toolbar-selected-list .mobile-option-setting-item")];
    const dataTransfer = createDataTransfer();
    const dragHandle = rows[0].querySelector<HTMLElement>(".mobile-option-setting-drag-icon");
    if (!dragHandle) throw new Error("Missing drag handle");
    dispatchDragEvent(dragHandle, "dragstart", dataTransfer);
    dispatchDragEvent(rows[1], "drop", dataTransfer);
    expect(app.vault.getConfig("mobileToolbarCommands")).toEqual(["editor:toggle-bold", "editor:alpha", "global:gamma"]);
  });

  it("opens the mobile settings tab from the mobile-only configure-toolbar command", async () => {
    const originalMobile = Platform.isMobile;
    Object.defineProperty(Platform, "isMobile", { configurable: true, value: true });
    try {
      const app = new App(document.createElement("div"));
      const file = await app.vault.create("Mobile.md", "Alpha");
      const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
      if (!(leaf.view instanceof MarkdownView)) throw new Error("Expected markdown view");
      leaf.view.editor.focus();
      app.workspace.activeEditor = leaf.view;

      expect(app.commands.findCommand("editor:configure-toolbar")).toMatchObject({
        icon: "lucide-wrench",
        mobileOnly: true,
      });
      expect(app.commands.executeCommandById("editor:configure-toolbar")).toBe(true);

      expect(document.body.querySelector(".modal.mod-settings")).not.toBeNull();
      expect(document.body.querySelector('.vertical-tab-nav-item.is-active[data-setting-id="mobile"]')).not.toBeNull();
      expect(document.body.querySelector(".mobile-settings")).not.toBeNull();
    } finally {
      Object.defineProperty(Platform, "isMobile", { configurable: true, value: originalMobile });
    }
  });
});

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => {
      values.set(type, value);
    },
  } as unknown as DataTransfer;
}

function dispatchDragEvent(target: HTMLElement, type: string, dataTransfer: DataTransfer): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  target.dispatchEvent(event);
}
