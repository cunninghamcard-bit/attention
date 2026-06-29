import { describe, expect, it } from "vitest";
import { App } from "../app/App";
import { Menu } from "../ui/Menu";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import type { TAbstractFile } from "../vault/TAbstractFile";
import { FileView } from "./FileView";

class BasicFileView extends FileView {
  unloadedFiles: string[] = [];

  getViewType(): string {
    return "basic-file-view-menu-test";
  }

  override async onUnloadFile(file: TAbstractFile): Promise<void> {
    this.unloadedFiles.push(file.path);
  }
}

describe("FileView menu parity", () => {
  it("bridges pane menus into the workspace file-menu extension point", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Menu.md", "menu");
    app.viewRegistry.registerView("basic-file-view-menu-test", (leaf) => new BasicFileView(leaf));
    const leaf = app.workspace.getLeaf();
    await leaf.setViewState({ type: "basic-file-view-menu-test", active: true });
    await (leaf.view as BasicFileView).loadFile(file);
    const calls: Array<{ file: TAbstractFile; source: string; leaf?: WorkspaceLeaf }> = [];
    app.workspace.on("file-menu", (_menu, menuFile, source, menuLeaf) => {
      calls.push({ file: menuFile, source, leaf: menuLeaf });
    });

    (leaf.view as BasicFileView).onPaneMenu(new Menu(), "more-options");

    expect(calls).toEqual([{ file, source: "more-options", leaf }]);
  });

  it("unloads and clears its current file when closed", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Close.md", "close");
    app.viewRegistry.registerView("basic-file-view-menu-test", (leaf) => new BasicFileView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "basic-file-view-menu-test", active: true });
    const view = leaf.view as BasicFileView;
    await view.loadFile(file);
    view.contentEl.createDiv("stale-content");

    await leaf.setViewState({ type: "empty", active: true });

    expect(view.unloadedFiles).toEqual(["Close.md"]);
    expect(view.file).toBeNull();
    expect(view.contentEl.children).toHaveLength(0);
  });
});
