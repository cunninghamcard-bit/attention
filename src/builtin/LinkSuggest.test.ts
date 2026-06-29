import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../app/App";
import { MarkdownView } from "../views/MarkdownView";

describe("LinkSuggest", () => {
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

  it("accepts file suggestions into markdown editors using Obsidian replacement rules", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create("Daily/Today.md", "Link [[Tar");
    await app.vault.create("Notes/Target.md", "# Heading\n\nParagraph");
    app.vault.setConfig("newLinkFormat", "relative");

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    view.editorViewHost.contentEl.focus();
    view.selectRange("Link [[Tar".length, "Link [[Tar".length);
    view.editor.setCursor({ line: 0, ch: "Link [[Tar".length });

    await app.workspace.editorSuggest.trigger(view.editor, view.editorViewHost.contentEl);
    await app.workspace.editorSuggest.trigger(view.editor, view.editorViewHost.contentEl, new KeyboardEvent("keydown", { key: "Enter" }));

    expect(view.editor.getValue()).toBe("Link [[../Notes/Target|Target]]");
  });

  it("uses markdown links only in markdown context when the setting is enabled", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const source = await app.vault.create("Daily/Today.md", "Link [[Alias");
    const target = await app.vault.create("Notes/Target.md", "---\naliases:\n  - Alias\n---\nBody");
    await app.metadataCache.computeFileMetadataAsync(target);
    app.vault.setConfig("newLinkFormat", "relative");
    app.vault.setConfig("useMarkdownLinks", true);

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(source, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    view.selectRange("Link [[Alias".length, "Link [[Alias".length);
    view.editor.setCursor({ line: 0, ch: "Link [[Alias".length });

    await app.workspace.editorSuggest.trigger(view.editor, view.editorViewHost.contentEl);
    await app.workspace.editorSuggest.trigger(view.editor, view.editorViewHost.contentEl, new KeyboardEvent("keydown", { key: "Enter" }));

    expect(view.editor.getValue()).toBe("Link [Alias](../Notes/Target.md)");
  });

  it("writes missing same-file block ids in the same editor edit", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const file = await app.vault.create("Note.md", "Paragraph block\n\nLink [[Note#^Para");
    await app.metadataCache.computeFileMetadataAsync(file);

    const leaf = app.workspace.getLeaf();
    await leaf.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view as MarkdownView;
    const cursor = "Paragraph block\n\nLink [[Note#^Para".length;
    view.selectRange(cursor, cursor);
    view.editor.setCursor({ line: 2, ch: "Link [[Note#^Para".length });

    await app.workspace.editorSuggest.trigger(view.editor, view.editorViewHost.contentEl);
    await app.workspace.editorSuggest.trigger(view.editor, view.editorViewHost.contentEl, new KeyboardEvent("keydown", { key: "Enter" }));

    expect(view.editor.getValue()).toMatch(/^Paragraph block \^[a-f0-9]{6}\n\nLink \[\[Note#\^[a-f0-9]{6}\]\]$/);
  });
});
