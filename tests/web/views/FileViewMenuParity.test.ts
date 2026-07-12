import { describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { Menu } from "@web/ui/Menu";
import type { WorkspaceLeaf } from "@web/views/workspace/WorkspaceLeaf";
import { TFile, type TAbstractFile } from "@web/vault/TAbstractFile";
import { FileView } from "@web/views/FileView";

class BasicFileView extends FileView {
  unloadedFiles: string[] = [];
  failOnLoad = false;

  getViewType(): string {
    return "basic-file-view-menu-test";
  }

  override async onUnloadFile(file: TAbstractFile): Promise<void> {
    this.unloadedFiles.push(file.path);
  }

  override async onLoadFile(): Promise<void> {
    if (this.failOnLoad) throw new Error("load failed");
  }
}

describe("FileView menu parity", () => {
  it("bridges pane menus into the workspace file-menu extension point", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Menu.md", "menu");
    app.viewRegistry.registerView("basic-file-view-menu-test", (leaf) => new BasicFileView(leaf));
    const leaf = app.workspace.getLeaf();
    await leaf.setViewState({
      type: "basic-file-view-menu-test",
      state: { file: file.path },
      active: true,
    });
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

    await leaf.setViewState({
      type: "basic-file-view-menu-test",
      state: { file: file.path },
      active: true,
    });
    const view = leaf.view as BasicFileView;
    view.contentEl.createDiv("stale-content");

    await leaf.setViewState({ type: "empty", active: true });

    expect(view.unloadedFiles).toEqual(["Close.md"]);
    expect(view.file).toBeNull();
    expect(view.contentEl.children).toHaveLength(0);
  });

  it("responds when its current file is deleted", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Deleted.md", "deleted");
    app.viewRegistry.registerView("basic-file-view-menu-test", (leaf) => new BasicFileView(leaf));
    const leaf = app.workspace.getLeaf();
    const sibling = app.workspace.createNewTab();
    if (!sibling) throw new Error("Expected sibling tab");

    await leaf.setViewState({
      type: "basic-file-view-menu-test",
      state: { file: file.path },
      active: true,
    });
    await app.vault.delete(file, false);

    await vi.waitFor(() => expect(app.workspace.getLeafById(leaf.id)).toBeNull());
    expect(app.workspace.getLeafById(sibling.id)).toBe(sibling);
  });

  it("keeps allowNoFile views open when their current file is deleted", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Allow Empty.md", "deleted");
    app.viewRegistry.registerView("basic-file-view-menu-test", (leaf) => new BasicFileView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({
      type: "basic-file-view-menu-test",
      state: { file: file.path },
      active: true,
    });
    const view = leaf.view as BasicFileView;
    view.allowNoFile = true;
    await app.vault.delete(file, false);

    await vi.waitFor(() => expect(view.file).toBeNull());
    expect(leaf.view).toBe(view);
  });

  it("updates layout when its current file is renamed", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Rename.md", "rename");
    app.viewRegistry.registerView("basic-file-view-menu-test", (leaf) => new BasicFileView(leaf));
    const leaf = app.workspace.getLeaf();
    const layoutChange = vi.spyOn(app.workspace, "onLayoutChange");

    await leaf.setViewState({
      type: "basic-file-view-menu-test",
      state: { file: file.path },
      active: true,
    });
    layoutChange.mockClear();
    await app.vault.rename(file, "Renamed.md");

    expect(layoutChange).toHaveBeenCalled();
  });

  it("clears its file when onLoadFile fails", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Broken.md", "broken");
    const loadedFile = await app.vault.create("Loaded.md", "loaded");
    app.viewRegistry.registerView("basic-file-view-menu-test", (leaf) => new BasicFileView(leaf));
    const leaf = app.workspace.getLeaf();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await leaf.setViewState({
      type: "basic-file-view-menu-test",
      state: { file: loadedFile.path },
      active: true,
    });
    const view = leaf.view as BasicFileView;
    view.failOnLoad = true;

    await expect(view.loadFile(file)).resolves.toBe(true);

    expect(view.file).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.any(Error));
  });

  it("reloads same-path files when the TFile identity changes", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Same.md", "same");
    app.viewRegistry.registerView("basic-file-view-menu-test", (leaf) => new BasicFileView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({
      type: "basic-file-view-menu-test",
      state: { file: file.path },
      active: true,
    });
    const view = leaf.view as BasicFileView;
    const replacement = new TFile(app.vault, file.path, file.stat, file.parent);

    await expect(view.loadFile(replacement)).resolves.toBe(true);

    expect(view.unloadedFiles).toEqual(["Same.md"]);
    expect(view.file).toBe(replacement);
  });

  it("closes when its view state has no file and allowNoFile is false", async () => {
    const app = new App(document.createElement("div"));
    app.viewRegistry.registerView("basic-file-view-menu-test", (leaf) => new BasicFileView(leaf));
    const leaf = app.workspace.getLeaf();

    await leaf.setViewState({ type: "basic-file-view-menu-test", active: true });

    expect(leaf.view.getViewType()).toBe("empty");
  });
});
