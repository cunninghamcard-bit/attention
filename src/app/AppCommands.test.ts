import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { MarkdownView } from "../views/MarkdownView";
import { WorkspaceTabs } from "../workspace/WorkspaceTabs";

describe("AppCommands Obsidian file operation commands", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("copies the active file path through workspace:copy-path", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Note.md", "Hello");
    await app.workspace.openFile(file, { active: true });

    expect(app.commands.findCommand("workspace:copy-path")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("workspace:copy-path")).toBe(true);

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Note.md");
    });

    expect(app.commands.findCommand("workspace:copy-full-path")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("workspace:copy-full-path")).toBe(true);

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("memory://Note.md");
    });
  });

  it("routes active file URL and OS commands through the App facades", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Note.md", "Hello");
    await app.workspace.openFile(file, { active: true });
    const copyUrl = vi.spyOn(app, "copyObsidianUrl").mockResolvedValue(undefined);
    const openDefault = vi.spyOn(app, "openWithDefaultApp").mockResolvedValue(undefined);
    const showInFolder = vi.spyOn(app, "showInFolder").mockResolvedValue(undefined);

    expect(app.commands.executeCommandById("workspace:copy-url")).toBe(true);
    expect(app.commands.executeCommandById("open-with-default-app:open")).toBe(true);
    expect(app.commands.executeCommandById("open-with-default-app:show")).toBe(true);

    expect(copyUrl).toHaveBeenCalledWith(file);
    expect(openDefault).toHaveBeenCalledWith("Note.md");
    expect(showInFolder).toHaveBeenCalledWith("Note.md");
  });

  it("prompts deletion for the active file through the Obsidian delete command", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Delete.md", "Hello");
    await app.workspace.openFile(file, { active: true });
    const promptForDeletion = vi.spyOn(app.fileManager, "promptForDeletion").mockResolvedValue(true);
    const command = app.commands.findCommand("app:delete-file");

    expect(command?.icon).toBe("lucide-trash-2");
    expect(command?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("app:delete-file")).toBe(true);

    expect(promptForDeletion).toHaveBeenCalledWith(file);
  });

  it("toggles the ribbon visibility through the Obsidian app command", () => {
    const app = new App(document.createElement("div"));
    const command = app.commands.findCommand("app:toggle-ribbon");

    expect(command?.checkCallback?.(true)).toBe(true);
    expect(document.body.classList.contains("show-ribbon")).toBe(true);

    expect(app.commands.executeCommandById("app:toggle-ribbon")).toBe(true);
    expect(app.vault.getConfig("showRibbon")).toBe(false);
    expect(document.body.classList.contains("show-ribbon")).toBe(false);

    expect(app.commands.executeCommandById("app:toggle-ribbon")).toBe(true);
    expect(app.vault.getConfig("showRibbon")).toBe(true);
    expect(document.body.classList.contains("show-ribbon")).toBe(true);
  });

  it("toggles Obsidian editor display settings through app commands", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Display.md", "one\ntwo");
    const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) throw new Error("Expected markdown view");

    expect(view.editorContainerEl.classList.contains("is-readable-line-width")).toBe(true);
    expect(view.previewRendererEl.classList.contains("is-readable-line-width")).toBe(true);
    expect(view.editorViewHost.guttersEl.children).toHaveLength(0);

    expect(app.commands.findCommand("editor:toggle-readable-line-length")?.icon).toBe("lucide-ruler");
    expect(app.commands.executeCommandById("editor:toggle-readable-line-length")).toBe(true);
    expect(app.vault.getConfig("readableLineLength")).toBe(false);
    expect(view.editorContainerEl.classList.contains("is-readable-line-width")).toBe(false);
    expect(view.previewRendererEl.classList.contains("is-readable-line-width")).toBe(false);

    expect(app.commands.findCommand("editor:toggle-line-numbers")?.icon).toBe("lucide-list-ordered");
    expect(app.commands.executeCommandById("editor:toggle-line-numbers")).toBe(true);
    expect(app.vault.getConfig("showLineNumber")).toBe(true);
    expect(view.editorViewHost.guttersEl.classList.contains("cm-lineNumbers")).toBe(true);
    expect([...view.editorViewHost.guttersEl.children].map((child) => child.textContent)).toEqual(["1", "2"]);
  });

  it("duplicates the active file into a new tab and selects the copied file", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Note.md", "Hello");
    await app.workspace.openFile(file, { active: true });

    expect(app.commands.findCommand("file-explorer:duplicate-file")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("file-explorer:duplicate-file")).toBe(true);

    await vi.waitFor(() => {
      expect(app.vault.getFileByPath("Note 1.md")).not.toBeNull();
      expect(app.workspace.getActiveFile()?.path).toBe("Note 1.md");
    });
    const copied = app.vault.getFileByPath("Note 1.md");
    if (!copied) throw new Error("missing copied file");
    await expect(app.vault.read(copied)).resolves.toBe("Hello");
  });

  it("starts active file title editing through the Obsidian F2 command", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Note.md", "Hello");
    const leaf = await app.workspace.openFile(file, { active: true });
    const setEphemeralState = vi.spyOn(leaf, "setEphemeralState");
    const command = app.commands.findCommand("workspace:edit-file-title");

    expect(command?.hotkeys).toEqual([{ modifiers: [], key: "F2" }]);
    expect(command?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("workspace:edit-file-title")).toBe(true);

    expect(setEphemeralState).toHaveBeenCalledWith({ rename: "all" });
  });

  it("toggles the active leaf pinned state through the Obsidian command", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Pinned.md", "Hello");
    const leaf = await app.workspace.openFile(file, { active: true });
    const command = app.commands.findCommand("workspace:toggle-pin");

    expect(command?.icon).toBe("lucide-pin");
    expect(command?.checkCallback?.(true)).toBe(true);
    expect(leaf.pinned).toBe(false);

    expect(app.commands.executeCommandById("workspace:toggle-pin")).toBe(true);
    expect(leaf.pinned).toBe(true);

    expect(app.commands.findCommand("workspace:toggle-pin")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("workspace:toggle-pin")).toBe(true);
    expect(leaf.pinned).toBe(false);
  });

  it("saves the active text file through the Obsidian editor save command", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Save.md", "old");
    const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) throw new Error("Expected markdown view");
    const command = app.commands.findCommand("editor:save-file");

    view.setViewData("new");

    expect(command?.hotkeys).toEqual([{ modifiers: ["Mod"], key: "S" }]);
    expect(command?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("editor:save-file")).toBe(true);

    await vi.waitFor(async () => {
      expect(await app.vault.read(file)).toBe("new");
    });

    view.setViewData("legacy");

    expect(app.commands.findCommand("markdown:save-current-file")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("markdown:save-current-file")).toBe(true);

    await vi.waitFor(async () => {
      expect(await app.vault.read(file)).toBe("legacy");
    });
  });

  it("routes Obsidian editor utility commands to the active markdown view", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Editor.md", "find me");
    const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) throw new Error("Expected markdown view");
    const showSearch = vi.spyOn(view, "showSearch");
    const focus = vi.spyOn(view.editor, "focus");
    const initialSourceMode = view.getSourceMode();

    expect(app.commands.findCommand("editor:toggle-source")?.icon).toBe("lucide-code-2");
    expect(app.commands.findCommand("editor:toggle-source")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("editor:toggle-source")).toBe(true);
    await vi.waitFor(() => {
      expect(view.getSourceMode()).toBe(initialSourceMode === "source" ? "live" : "source");
    });

    expect(app.commands.findCommand("editor:open-search")?.hotkeys).toEqual([{ modifiers: ["Mod"], key: "F" }]);
    expect(app.commands.findCommand("editor:open-search")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("editor:open-search")).toBe(true);
    expect(showSearch).toHaveBeenCalledWith(false);

    expect(app.commands.findCommand("editor:open-search-replace")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("editor:open-search-replace")).toBe(true);
    expect(showSearch).toHaveBeenCalledWith(true);

    expect(app.commands.findCommand("editor:focus")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("editor:focus")).toBe(true);
    expect(focus).toHaveBeenCalled();
  });

  it("routes Obsidian fold commands through the active markdown view", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Fold.md", "---\naliases: [fold]\n---\n# One\nBody\n## Two\nNested\n# Three\nTail");
    const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) throw new Error("Expected markdown view");

    expect(app.commands.findCommand("editor:toggle-fold-properties")?.icon).toBe("lucide-diff");
    expect(app.commands.findCommand("editor:toggle-fold-properties")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("editor:toggle-fold-properties")).toBe(true);
    expect(view.getFoldInfo().folds.some((fold) => fold.from === 0)).toBe(true);

    view.editor.setCursor(3, 0);

    expect(app.commands.findCommand("editor:toggle-fold")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("editor:toggle-fold")).toBe(true);
    expect(view.getFoldInfo().folds.some((fold) => fold.from === 3 && fold.to >= 6)).toBe(true);

    expect(app.commands.findCommand("editor:fold-all")?.icon).toBe("lucide-minimize-2");
    expect(app.commands.findCommand("editor:fold-all")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("editor:fold-all")).toBe(true);
    expect(view.getFoldInfo().folds.some((fold) => fold.from === 5)).toBe(true);

    expect(app.commands.executeCommandById("editor:unfold-all")).toBe(true);
    expect(view.getFoldInfo().folds).toHaveLength(0);

    expect(app.commands.executeCommandById("editor:fold-more")).toBe(true);
    expect(view.getFoldInfo().folds.length).toBeGreaterThan(0);

    expect(app.commands.executeCommandById("editor:fold-less")).toBe(true);
    expect(view.getFoldInfo().folds).toHaveLength(0);
  });

  it("routes Obsidian editor insert commands through markdown selection edits", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Insert.md", "Alpha");
    const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) throw new Error("Expected markdown view");

    view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 });

    expect(app.commands.findCommand("editor:insert-link")?.hotkeys).toEqual([{ modifiers: ["Mod"], key: "K" }]);
    expect(app.commands.executeCommandById("editor:insert-link")).toBe(true);
    expect(view.getViewData()).toBe("[Alpha]()");

    view.setViewData("Note");
    view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 4 });

    expect(app.commands.findCommand("editor:insert-wikilink")?.icon).toBe("bracket-glyph");
    expect(app.commands.executeCommandById("editor:insert-wikilink")).toBe(true);
    expect(view.getViewData()).toBe("[[Note]]");

    view.setViewData("Embed");
    view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 });

    expect(app.commands.findCommand("editor:insert-embed")?.icon).toBe("lucide-sticky-note");
    expect(app.commands.executeCommandById("editor:insert-embed")).toBe(true);
    expect(view.getViewData()).toBe("![[Embed]]");

    view.setViewData("tag");
    view.editor.setCursor(0, 0);

    expect(app.commands.findCommand("editor:insert-tag")?.icon).toBe("lucide-tag");
    expect(app.commands.executeCommandById("editor:insert-tag")).toBe(true);
    expect(view.getViewData()).toBe("#tag");
    expect(view.editor.getCursor()).toEqual({ line: 0, ch: 1 });
  });

  it("routes Obsidian editor formatting commands through markdown edits", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Format.md", "Title\nAlpha\nBeta");
    const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) throw new Error("Expected markdown view");

    view.editor.setCursor(0, 0);
    expect(app.commands.findCommand("editor:set-heading-2")?.icon).toBe("heading-glyph");
    expect(app.commands.executeCommandById("editor:set-heading-2")).toBe(true);
    expect(view.getViewData()).toBe("## Title\nAlpha\nBeta");

    expect(app.commands.executeCommandById("editor:set-heading-0")).toBe(true);
    expect(view.getViewData()).toBe("Title\nAlpha\nBeta");

    expect(app.commands.findCommand("editor:set-heading")?.showOnMobileToolbar).toBe(true);
    expect(app.commands.executeCommandById("editor:set-heading")).toBe(true);
    const headingTitles = [...document.body.querySelectorAll(".menu-item-title")].map((el) => el.textContent);
    expect(headingTitles).toContain("No heading");
    expect(headingTitles).toContain("Heading 6");
    const headingThree = [...document.body.querySelectorAll(".menu-item")].find((el) => el.textContent === "Heading 3");
    if (!(headingThree instanceof HTMLElement)) throw new Error("Missing heading menu item");
    headingThree.click();
    expect(view.getViewData()).toBe("### Title\nAlpha\nBeta");

    expect(app.commands.executeCommandById("editor:set-heading-0")).toBe(true);
    expect(view.getViewData()).toBe("Title\nAlpha\nBeta");

    view.editor.setSelection({ line: 1, ch: 0 }, { line: 1, ch: 5 });
    expect(app.commands.findCommand("editor:toggle-bold")?.hotkeys).toEqual([{ modifiers: ["Mod"], key: "B" }]);
    expect(app.commands.executeCommandById("editor:toggle-bold")).toBe(true);
    expect(view.getViewData()).toBe("Title\n**Alpha**\nBeta");

    expect(app.commands.executeCommandById("editor:toggle-bold")).toBe(true);
    expect(view.getViewData()).toBe("Title\nAlpha\nBeta");

    view.editor.setSelection({ line: 2, ch: 0 }, { line: 2, ch: 4 });
    expect(app.commands.findCommand("editor:toggle-italics")?.hotkeys).toEqual([{ modifiers: ["Mod"], key: "I" }]);
    expect(app.commands.executeCommandById("editor:toggle-italics")).toBe(true);
    expect(view.getViewData()).toBe("Title\nAlpha\n*Beta*");

    expect(app.commands.executeCommandById("editor:toggle-code")).toBe(true);
    expect(view.getViewData()).toBe("Title\nAlpha\n*`Beta`*");

    view.setViewData("**Bold** ==Mark== `Code` %% Note %%");
    view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 36 });
    expect(app.commands.findCommand("editor:clear-formatting")?.icon).toBe("lucide-eraser");
    expect(app.commands.findCommand("editor:clear-formatting")?.editorCheckCallback?.(true, view.editor, view)).toBe(true);
    expect(app.commands.executeCommandById("editor:clear-formatting")).toBe(true);
    expect(view.getViewData()).toBe("Bold Mark Code Note");

    view.setViewData("Comment");
    view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 7 });
    expect(app.commands.findCommand("editor:toggle-comments")?.hotkeys).toEqual([{ modifiers: ["Mod"], key: "/" }]);
    expect(app.commands.executeCommandById("editor:toggle-comments")).toBe(true);
    expect(view.getViewData()).toBe("%% Comment %%");

    const mobileToolbarIds = app.commands.getEditorCommands().filter((command) => command.showOnMobileToolbar).map((command) => command.id);
    expect(mobileToolbarIds).toEqual(expect.arrayContaining([
      "editor:insert-wikilink",
      "editor:insert-embed",
      "editor:insert-tag",
      "editor:set-heading",
      "editor:toggle-bold",
      "editor:toggle-italics",
      "editor:toggle-strikethrough",
      "editor:toggle-highlight",
      "editor:toggle-code",
      "editor:toggle-blockquote",
      "editor:toggle-comments",
      "editor:insert-link",
      "editor:toggle-bullet-list",
      "editor:toggle-numbered-list",
      "editor:toggle-checklist-status",
      "editor:indent-list",
      "editor:unindent-list",
    ]));
  });

  it("routes Obsidian line-level editor commands through markdown edits", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Lines.md", "Alpha\nBeta");
    const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) throw new Error("Expected markdown view");

    view.editor.setSelection({ line: 0, ch: 0 }, { line: 1, ch: 4 });
    expect(app.commands.findCommand("editor:toggle-blockquote")?.icon).toBe("lucide-quote");
    expect(app.commands.executeCommandById("editor:toggle-blockquote")).toBe(true);
    expect(view.getViewData()).toBe("> Alpha\n> Beta");

    view.editor.setSelection({ line: 0, ch: 0 }, { line: 1, ch: 6 });
    expect(app.commands.executeCommandById("editor:toggle-blockquote")).toBe(true);
    expect(view.getViewData()).toBe("Alpha\nBeta");

    view.setViewData("Alpha\n1. Beta\n- [ ] Task");
    view.editor.setSelection({ line: 0, ch: 0 }, { line: 2, ch: 10 });
    expect(app.commands.findCommand("editor:toggle-bullet-list")?.icon).toBe("lucide-list");
    expect(app.commands.executeCommandById("editor:toggle-bullet-list")).toBe(true);
    expect(view.getViewData()).toBe("- Alpha\n- Beta\n- Task");

    view.setViewData("- Alpha\n- Beta");
    view.editor.setSelection({ line: 0, ch: 0 }, { line: 1, ch: 6 });
    expect(app.commands.findCommand("editor:toggle-numbered-list")?.icon).toBe("lucide-list-ordered");
    expect(app.commands.executeCommandById("editor:toggle-numbered-list")).toBe(true);
    expect(view.getViewData()).toBe("1. Alpha\n1. Beta");

    view.editor.setSelection({ line: 0, ch: 0 }, { line: 1, ch: 7 });
    expect(app.commands.executeCommandById("editor:toggle-numbered-list")).toBe(true);
    expect(view.getViewData()).toBe("Alpha\nBeta");

    view.setViewData("Task");
    view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 4 });
    expect(app.commands.findCommand("editor:toggle-checklist-status")?.hotkeys).toEqual([{ modifiers: ["Mod"], key: "l" }]);
    expect(app.commands.executeCommandById("editor:toggle-checklist-status")).toBe(true);
    expect(view.getViewData()).toBe("- [ ] Task");

    view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 10 });
    expect(app.commands.executeCommandById("editor:toggle-checklist-status")).toBe(true);
    expect(view.getViewData()).toBe("- [x] Task");

    view.setViewData("- Task");
    view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 6 });
    expect(app.commands.findCommand("editor:cycle-list-checklist")?.icon).toBe("lucide-check-square");
    expect(app.commands.executeCommandById("editor:cycle-list-checklist")).toBe(true);
    expect(view.getViewData()).toBe("- [ ] Task");
  });

  it("routes Obsidian insert block commands through markdown edits", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Blocks.md", "Intro\nAlpha\nBeta\nTail");
    const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) throw new Error("Expected markdown view");

    view.editor.setSelection({ line: 1, ch: 0 }, { line: 2, ch: 4 });
    expect(app.commands.findCommand("editor:insert-callout")?.icon).toBe("lucide-quote");
    expect(app.commands.executeCommandById("editor:insert-callout")).toBe(true);
    expect(view.getViewData()).toBe("Intro\n\n> [!NOTE]\n> Alpha\n> Beta\n\nTail");

    view.setViewData("Alpha");
    view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 });
    expect(app.commands.findCommand("editor:insert-codeblock")?.icon).toBe("lucide-code");
    expect(app.commands.executeCommandById("editor:insert-codeblock")).toBe(true);
    expect(view.getViewData()).toBe("```\nAlpha\n```");

    view.setViewData("Beta");
    view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 4 });
    expect(app.commands.findCommand("editor:insert-mathblock")?.icon).toBe("lucide-sigma-square");
    expect(app.commands.executeCommandById("editor:insert-mathblock")).toBe(true);
    expect(view.getViewData()).toBe("$$\nBeta\n$$");

    view.setViewData("Cell");
    view.editor.setCursor(0, 4);
    expect(app.commands.findCommand("editor:insert-table")?.icon).toBe("lucide-table");
    expect(app.commands.executeCommandById("editor:insert-table")).toBe(true);
    expect(view.getViewData()).toBe("Cell\n\n| | |\n| --- | --- |\n| | |\n");

    view.setViewData("Alpha");
    view.editor.setCursor(0, 5);
    expect(app.commands.findCommand("editor:insert-horizontal-rule")?.icon).toBe("lucide-minus");
    expect(app.commands.executeCommandById("editor:insert-horizontal-rule")).toBe(true);
    expect(view.getViewData()).toBe("Alpha\n\n---\n");

    view.setViewData("Alpha\n\n[^1]: old\n");
    view.editor.setCursor(0, 5);
    expect(app.commands.findCommand("editor:insert-footnote")?.icon).toBe("lucide-file-signature");
    expect(app.commands.executeCommandById("editor:insert-footnote")).toBe(true);
    expect(view.getViewData()).toBe("Alpha[^2]\n\n[^1]: old\n\n[^2]: \n");
  });

  it("routes Obsidian list indent commands through markdown edits", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Indent.md", "- One\n- Two");
    const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) throw new Error("Expected markdown view");

    view.editor.setSelection({ line: 0, ch: 0 }, { line: 1, ch: 5 });
    expect(app.commands.findCommand("editor:indent-list")?.icon).toBe("lucide-indent");
    expect(app.commands.executeCommandById("editor:indent-list")).toBe(true);
    expect(view.getViewData()).toBe("\t- One\n\t- Two");

    view.editor.setSelection({ line: 0, ch: 0 }, { line: 1, ch: 6 });
    expect(app.commands.findCommand("editor:unindent-list")?.icon).toBe("lucide-outdent");
    expect(app.commands.executeCommandById("editor:unindent-list")).toBe(true);
    expect(view.getViewData()).toBe("- One\n- Two");
  });

  it("duplicates the active leaf through Obsidian split commands", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Split.md", "Hello");
    const source = await app.workspace.openFile(file, { active: true });

    expect(app.commands.findCommand("workspace:split-vertical")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.findCommand("workspace:split-horizontal")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("workspace:split-vertical")).toBe(true);

    await vi.waitFor(() => {
      expect(app.workspace.activeLeaf).not.toBe(source);
      expect(app.workspace.activeLeaf?.getViewState().state).toMatchObject({ file: "Split.md" });
    });
    const verticalDuplicate = app.workspace.activeLeaf;
    expect(verticalDuplicate?.getRoot()).toBe(app.workspace.rootSplit);

    const secondApp = new App(document.createElement("div"));
    const secondFile = await secondApp.vault.create("Split.md", "Hello");
    const horizontalSource = await secondApp.workspace.openFile(secondFile, { active: true });

    expect(secondApp.commands.findCommand("workspace:split-horizontal")?.checkCallback?.(true)).toBe(true);
    expect(secondApp.commands.executeCommandById("workspace:split-horizontal")).toBe(true);

    await vi.waitFor(() => {
      expect(secondApp.workspace.activeLeaf).not.toBe(horizontalSource);
      expect(secondApp.workspace.activeLeaf?.getViewState().state).toMatchObject({ file: "Split.md" });
    });
    expect(secondApp.workspace.activeLeaf?.getRoot()).toBe(secondApp.workspace.rootSplit);
  });

  it("toggles stacked tabs only for main workspace tab groups", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Stack.md", "Hello");
    const leaf = await app.workspace.openFile(file, { active: true });
    const tabs = leaf.parent;
    if (!(tabs instanceof WorkspaceTabs)) throw new Error("Expected active file in tabs");

    expect(app.commands.findCommand("workspace:toggle-stacked-tabs")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("workspace:toggle-stacked-tabs")).toBe(true);
    expect(tabs.isStacked).toBe(true);
    expect(app.commands.executeCommandById("workspace:toggle-stacked-tabs")).toBe(true);
    expect(tabs.isStacked).toBe(false);

    await app.workspace.ensureSideLeaf("file-explorer", "left", { active: true, reveal: true });

    expect(app.commands.findCommand("workspace:split-vertical")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("workspace:toggle-stacked-tabs")?.checkCallback?.(true)).toBe(false);
  });

  it("focuses adjacent leaves through Obsidian directional focus commands", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Focus.md", "Hello");
    const source = await app.workspace.openFile(file, { active: true });
    const right = await app.workspace.duplicateLeaf(source, "vertical");
    setRect(source.containerEl, { x: 0, y: 0, width: 100, height: 100 });
    setRect(right.containerEl, { x: 140, y: 0, width: 100, height: 100 });

    app.workspace.setActiveLeaf(source);
    expect(app.commands.findCommand("editor:focus-right")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("editor:focus-right")).toBe(true);
    expect(app.workspace.activeLeaf).toBe(right);

    app.workspace.setActiveLeaf(right);
    expect(app.commands.executeCommandById("editor:focus-left")).toBe(true);
    expect(app.workspace.activeLeaf).toBe(source);

    app.workspace.setActiveLeaf(source);
    expect(app.commands.findCommand("editor:focus-top")?.checkCallback?.(true)).toBe(false);

    const verticalApp = new App(document.createElement("div"));
    const verticalFile = await verticalApp.vault.create("Focus.md", "Hello");
    const top = await verticalApp.workspace.openFile(verticalFile, { active: true });
    const bottom = await verticalApp.workspace.duplicateLeaf(top, "horizontal");
    setRect(top.containerEl, { x: 0, y: 0, width: 100, height: 100 });
    setRect(bottom.containerEl, { x: 0, y: 140, width: 100, height: 100 });

    verticalApp.workspace.setActiveLeaf(top);
    expect(verticalApp.commands.findCommand("editor:focus-bottom")?.checkCallback?.(true)).toBe(true);
    expect(verticalApp.commands.executeCommandById("editor:focus-bottom")).toBe(true);
    expect(verticalApp.workspace.activeLeaf).toBe(bottom);

    verticalApp.workspace.setActiveLeaf(bottom);
    expect(verticalApp.commands.executeCommandById("editor:focus-top")).toBe(true);
    expect(verticalApp.workspace.activeLeaf).toBe(top);
  });

  it("opens the move modal for the active file", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Note.md", "Hello");
    await app.workspace.openFile(file, { active: true });

    expect(app.commands.findCommand("file-explorer:move-file")?.checkCallback?.(true)).toBe(true);
    expect(app.commands.executeCommandById("file-explorer:move-file")).toBe(true);

    expect(document.body.textContent).toContain("No folders found");
    expect(document.body.textContent).toContain("Move");
  });

  it("hides active-file commands when no file view is active", () => {
    const app = new App(document.createElement("div"));

    expect(app.commands.findCommand("workspace:toggle-pin")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("workspace:edit-file-title")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("app:delete-file")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("editor:save-file")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("markdown:save-current-file")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("editor:toggle-source")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("editor:open-search")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("editor:open-search-replace")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("editor:focus")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("editor:toggle-fold-properties")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("editor:toggle-fold")?.checkCallback?.(true)).toBeNull();
    expect(app.commands.findCommand("workspace:copy-path")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("workspace:copy-full-path")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("workspace:copy-url")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("open-with-default-app:open")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("open-with-default-app:show")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("file-explorer:move-file")?.checkCallback?.(true)).toBe(false);
    expect(app.commands.findCommand("file-explorer:duplicate-file")?.checkCallback?.(true)).toBe(false);
  });
});

function setRect(el: HTMLElement, rect: { x: number; y: number; width: number; height: number }): void {
  const domRect = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => ({}),
  } as DOMRect;
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => domRect,
  });
}
