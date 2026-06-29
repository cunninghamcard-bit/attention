import { describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { MarkdownView } from "../views/MarkdownView";

describe("Workspace Obsidian API aliases", () => {
  it("exposes getActiveLeafOfViewType as Obsidian's active view alias", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Workspace Alias.md", "alias");

    await app.workspace.openFile(file, { active: true });

    expect(app.workspace.getActiveLeafOfViewType(MarkdownView)).toBe(app.workspace.getActiveViewOfType(MarkdownView));
  });

  it("exposes addRecentFile as a workspace-level recent file tracker wrapper", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Workspace Recent.md", "recent");

    vi.spyOn(app.workspace, "isLayoutReady").mockReturnValue(true);
    app.workspace.addRecentFile(file);

    expect(app.workspace.getRecentFiles()[0]).toBe(file.path);
  });

  it("collects recent file entries by path without requiring a TFile instance", () => {
    const app = new App(document.createElement("div"));

    vi.spyOn(app.workspace, "isLayoutReady").mockReturnValue(true);
    app.workspace.recentFileTracker.addRecentFile({ path: "Duck.md" });

    expect(app.workspace.getRecentFiles()[0]).toBe("Duck.md");
  });

  it("returns recent file paths even when the vault no longer has the file", () => {
    const app = new App(document.createElement("div"));

    app.workspace.recentFilePaths = ["Missing.md", "Board.canvas", "Image.png", "Sound.mp3"];

    expect(app.workspace.getRecentFiles()).toEqual(["Missing.md", "Board.canvas"]);
    expect(app.workspace.getLastOpenFiles()).toEqual(["Missing.md", "Board.canvas", "Image.png", "Sound.mp3"]);
  });

  it("exposes isAttached as Obsidian's workspace item membership check", async () => {
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();

    expect(app.workspace.isAttached(leaf)).toBe(true);

    await leaf.detach();

    expect(app.workspace.isAttached(leaf)).toBe(false);
    expect(app.workspace.isAttached(null)).toBe(false);
  });

  it("does not persist layout merely because active leaf changes", async () => {
    const app = new App(document.createElement("div"));
    const first = app.workspace.getLeaf();
    const second = app.workspace.createNewTab();
    if (!second) throw new Error("Expected a second tab leaf");
    app.workspace.markLayoutReady();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    app.workspace.requestSaveLayout.cancel();
    const saveLayout = vi.spyOn(app.workspace, "requestSaveLayout");

    app.workspace.setActiveLeaf(first);
    app.workspace.setActiveLeaf(second);

    expect(saveLayout).not.toHaveBeenCalled();
  });
});
