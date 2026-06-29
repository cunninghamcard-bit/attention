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

    expect(app.workspace.getRecentFiles()[0]).toBe(file);
  });
});
