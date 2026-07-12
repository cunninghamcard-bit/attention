import { beforeEach, describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import { MarkdownView } from "@web/views/MarkdownView";

describe("TagSuggest", () => {
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

  it("tabs through hierarchical tag suggestions in markdown editors", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const existing = await app.vault.create("Existing.md", "Body #project/beta");
    await app.metadataCache.computeFileMetadataAsync(existing);
    const source = await app.vault.create("Note.md", "Tag #proj");

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    view.selectRange("Tag #proj".length, "Tag #proj".length);
    view.editor.setCursor({ line: 0, ch: "Tag #proj".length });

    await app.workspace.editorSuggest.trigger(view.editor, view.editorViewHost.contentEl);
    expect(document.body.querySelector(".suggestion-highlight")?.textContent).toBe("proj");
    await app.workspace.editorSuggest.trigger(
      view.editor,
      view.editorViewHost.contentEl,
      new KeyboardEvent("keydown", { key: "Tab" }),
    );

    expect(view.editor.getValue()).toBe("Tag #project/");
  });

  it("enters full tag suggestions with a trailing space", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const existing = await app.vault.create("Existing.md", "Body #project/beta");
    await app.metadataCache.computeFileMetadataAsync(existing);
    const source = await app.vault.create("Note.md", "Tag #proj");

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    view.selectRange("Tag #proj".length, "Tag #proj".length);
    view.editor.setCursor({ line: 0, ch: "Tag #proj".length });

    await app.workspace.editorSuggest.trigger(view.editor, view.editorViewHost.contentEl);
    await app.workspace.editorSuggest.trigger(
      view.editor,
      view.editorViewHost.contentEl,
      new KeyboardEvent("keydown", { key: "Enter" }),
    );

    expect(view.editor.getValue()).toBe("Tag #project/beta ");
  });

  it("does not trigger when the next character is another hash", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const existing = await app.vault.create("Existing.md", "Body #project/beta");
    await app.metadataCache.computeFileMetadataAsync(existing);
    const source = await app.vault.create("Note.md", "Tag #proj#");

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    view.selectRange("Tag #proj".length, "Tag #proj".length);
    view.editor.setCursor({ line: 0, ch: "Tag #proj".length });

    await app.workspace.editorSuggest.trigger(view.editor, view.editorViewHost.contentEl);

    expect(document.body.querySelector(".suggestion-container")).toBeNull();
  });
});
