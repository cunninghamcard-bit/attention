import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { SimpleEditor } from "../../editor/Editor";
import { Menu, MenuItem } from "../../ui/Menu";
import type { TAbstractFile } from "../../vault/TAbstractFile";
import type { View } from "../../views/View";
import { MarkdownView } from "../../views/MarkdownView";

describe("MenuManager editor menu", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
  });

  it("adds executable cut, copy, paste, and select-all defaults before plugin contributions", async () => {
    const app = new App(document.createElement("div"));
    const editor = new SimpleEditor();
    const clipboard = createClipboard();
    editor.setValue("Alpha beta");
    editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 });
    app.workspace.on("editor-menu", (menu) => {
      (menu as Menu).addItem((item) => item.setTitle("Plugin action"));
    });

    const menu = app.menus.createEditorMenu(editor, {} as View);
    const items = menu.items.filter((item): item is MenuItem => item instanceof MenuItem);

    expect(items.map((item) => item.titleEl.textContent)).toEqual([
      "Insert link",
      "Insert external link",
      "Cut",
      "Copy",
      "Paste",
      "Paste as plain text",
      "Select all",
      "Plugin action",
    ]);
    expect(findMenuItem(items, "Cut").disabled).toBe(false);
    expect(findMenuItem(items, "Copy").disabled).toBe(false);

    clickMenuItem(findMenuItem(items, "Copy"));
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("Alpha"));
    expect(editor.getValue()).toBe("Alpha beta");

    clickMenuItem(findMenuItem(items, "Cut"));
    await vi.waitFor(() => expect(editor.getValue()).toBe(" beta"));
    expect(clipboard.writeText).toHaveBeenLastCalledWith("Alpha");

    clipboard.text = "Inserted";
    editor.setCursor(0, 0);
    clickMenuItem(findMenuItem(items, "Paste"));
    await vi.waitFor(() => expect(editor.getValue()).toBe("Inserted beta"));

    clipboard.text = " plain";
    clickMenuItem(findMenuItem(items, "Paste as plain text"));
    await vi.waitFor(() => expect(editor.getValue()).toBe("Inserted plain beta"));

    clickMenuItem(findMenuItem(items, "Select all"));
    expect(editor.getSelection()).toBe("Inserted plain beta");
  });

  it("disables selection-dependent editor menu items when nothing is selected", () => {
    const app = new App(document.createElement("div"));
    const editor = new SimpleEditor();
    editor.setValue("Alpha beta");
    editor.setCursor(0, 0);

    const menu = app.menus.createEditorMenu(editor, {} as View);
    const items = menu.items.filter((item): item is MenuItem => item instanceof MenuItem);

    expect(findMenuItem(items, "Cut").disabled).toBe(true);
    expect(findMenuItem(items, "Copy").disabled).toBe(true);
    expect(findMenuItem(items, "Paste").disabled).toBe(false);
    expect(findMenuItem(items, "Paste as plain text").disabled).toBe(false);
    expect(findMenuItem(items, "Select all").disabled).toBe(false);
    expect(findMenuItem(items, "Insert link").disabled).toBe(false);
    expect(findMenuItem(items, "Insert external link").disabled).toBe(false);
  });

  it("wraps single-line selections with internal and external link defaults", async () => {
    const app = new App(document.createElement("div"));
    const view = { containerEl: document.createElement("div") } as unknown as View;
    const wikiEditor = new SimpleEditor();
    wikiEditor.setValue("Alpha beta");
    wikiEditor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 });

    clickMenuItem(findMenuItem(
      app.menus.createEditorMenu(wikiEditor, view).items.filter((item): item is MenuItem => item instanceof MenuItem),
      "Insert link",
    ));

    expect(wikiEditor.getValue()).toBe("[[Alpha]] beta");
    expect(wikiEditor.getCursor()).toEqual({ line: 0, ch: "[[Alpha".length });

    const externalEditor = new SimpleEditor();
    externalEditor.setValue("Alpha beta");
    externalEditor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 });

    clickMenuItem(findMenuItem(
      app.menus.createEditorMenu(externalEditor, view).items.filter((item): item is MenuItem => item instanceof MenuItem),
      "Insert external link",
    ));

    expect(externalEditor.getValue()).toBe("[Alpha]() beta");
    expect(externalEditor.getCursor()).toEqual({ line: 0, ch: "[Alpha](".length });

    const emptyExternalEditor = new SimpleEditor();
    emptyExternalEditor.setValue("Alpha");
    emptyExternalEditor.setCursor(0, 0);

    clickMenuItem(findMenuItem(
      app.menus.createEditorMenu(emptyExternalEditor, view).items.filter((item): item is MenuItem => item instanceof MenuItem),
      "Insert external link",
    ));

    expect(emptyExternalEditor.getValue()).toBe("[]()Alpha");
    expect(emptyExternalEditor.getCursor()).toEqual({ line: 0, ch: 1 });

    const emptyWikiEditor = new SimpleEditor();
    emptyWikiEditor.setValue("Alpha");
    emptyWikiEditor.setCursor(0, 0);
    const trigger = vi.spyOn(app.workspace.editorSuggest, "trigger");

    clickMenuItem(findMenuItem(
      app.menus.createEditorMenu(emptyWikiEditor, view).items.filter((item): item is MenuItem => item instanceof MenuItem),
      "Insert link",
    ));

    await vi.waitFor(() => expect(trigger).toHaveBeenCalled());
    expect(emptyWikiEditor.getValue()).toBe("[[]]Alpha");
    expect(emptyWikiEditor.getCursor()).toEqual({ line: 0, ch: 2 });
  });

  it("disables selection link defaults for multiline selections", () => {
    const app = new App(document.createElement("div"));
    const editor = new SimpleEditor();
    editor.setValue("Alpha\nbeta");
    editor.setSelection({ line: 0, ch: 0 }, { line: 1, ch: 4 });

    const menu = app.menus.createEditorMenu(editor, {} as View);
    const items = menu.items.filter((item): item is MenuItem => item instanceof MenuItem);

    expect(findMenuItem(items, "Insert link").disabled).toBe(true);
    expect(findMenuItem(items, "Insert external link").disabled).toBe(true);
  });

  it("adds Obsidian markdown insert defaults only for markdown editor menus", async () => {
    const app = new App(document.createElement("div"));
    const file = await app.vault.create("Menu.md", "Intro\nAlpha\nBeta");
    const leaf = await app.workspace.openFile(file, { active: true, state: { mode: "source" } });
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) throw new Error("Expected markdown view");

    view.editor.setSelection({ line: 1, ch: 0 }, { line: 2, ch: 4 });
    let items = app.menus.createEditorMenu(view.editor, view).items.filter((item): item is MenuItem => item instanceof MenuItem);

    expect(findMenuItem(items, "Bullet list").section).toBe("selection.paragraph.list");
    expect(findMenuItem(items, "Numbered list").section).toBe("selection.paragraph.list");
    expect(findMenuItem(items, "Checklist").section).toBe("selection.paragraph.list");
    expect(findMenuItem(items, "Heading 1").section).toBe("selection.paragraph.heading");
    expect(findMenuItem(items, "Heading 6").section).toBe("selection.paragraph.heading");
    expect(findMenuItem(items, "No heading").section).toBe("selection.paragraph.heading");
    expect(findMenuItem(items, "Blockquote").section).toBe("selection.paragraph.block");
    expect(findMenuItem(items, "Insert footnote").section).toBe("selection.insert.basic");
    expect(findMenuItem(items, "Insert table").section).toBe("selection.insert.basic");
    expect(findMenuItem(items, "Insert callout").section).toBe("selection.insert.basic");
    expect(findMenuItem(items, "Insert horizontal rule").section).toBe("selection.insert.basic");
    expect(findMenuItem(items, "Insert code block").section).toBe("selection.insert.advanced");
    expect(findMenuItem(items, "Insert math block").section).toBe("selection.insert.advanced");

    clickMenuItem(findMenuItem(items, "Bullet list"));
    expect(view.getViewData()).toBe("Intro\n- Alpha\n- Beta");

    view.setViewData("Title");
    view.editor.setCursor(0, 0);
    items = app.menus.createEditorMenu(view.editor, view).items.filter((item): item is MenuItem => item instanceof MenuItem);

    clickMenuItem(findMenuItem(items, "Heading 2"));
    expect(view.getViewData()).toBe("## Title");

    items = app.menus.createEditorMenu(view.editor, view).items.filter((item): item is MenuItem => item instanceof MenuItem);

    clickMenuItem(findMenuItem(items, "No heading"));
    expect(view.getViewData()).toBe("Title");

    view.setViewData("Quote");
    view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 });
    items = app.menus.createEditorMenu(view.editor, view).items.filter((item): item is MenuItem => item instanceof MenuItem);

    clickMenuItem(findMenuItem(items, "Blockquote"));
    expect(view.getViewData()).toBe("> Quote");

    view.setViewData("Intro\nAlpha\nBeta");
    view.editor.setSelection({ line: 1, ch: 0 }, { line: 2, ch: 4 });
    items = app.menus.createEditorMenu(view.editor, view).items.filter((item): item is MenuItem => item instanceof MenuItem);

    clickMenuItem(findMenuItem(items, "Insert callout"));
    expect(view.getViewData()).toBe("Intro\n\n> [!NOTE]\n> Alpha\n> Beta");

    view.setViewData("Footnote");
    view.editor.setCursor(0, 8);
    items = app.menus.createEditorMenu(view.editor, view).items.filter((item): item is MenuItem => item instanceof MenuItem);

    clickMenuItem(findMenuItem(items, "Insert footnote"));
    expect(view.getViewData()).toBe("Footnote[^1]\n\n[^1]: \n");

    view.setViewData("Cell");
    view.editor.setCursor(0, 4);
    items = app.menus.createEditorMenu(view.editor, view).items.filter((item): item is MenuItem => item instanceof MenuItem);

    clickMenuItem(findMenuItem(items, "Insert table"));
    expect(view.getViewData()).toBe("Cell\n\n| | |\n| --- | --- |\n| | |\n");

    view.setViewData("Alpha");
    view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 });
    items = app.menus.createEditorMenu(view.editor, view).items.filter((item): item is MenuItem => item instanceof MenuItem);

    clickMenuItem(findMenuItem(items, "Insert code block"));
    expect(view.getViewData()).toBe("```\nAlpha\n```");

    view.setViewData("Beta");
    view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 4 });
    items = app.menus.createEditorMenu(view.editor, view).items.filter((item): item is MenuItem => item instanceof MenuItem);

    clickMenuItem(findMenuItem(items, "Insert math block"));
    expect(view.getViewData()).toBe("$$\nBeta\n$$");

    view.setViewData("Tail");
    view.editor.setCursor(0, 4);
    items = app.menus.createEditorMenu(view.editor, view).items.filter((item): item is MenuItem => item instanceof MenuItem);

    clickMenuItem(findMenuItem(items, "Insert horizontal rule"));
    expect(view.getViewData()).toBe("Tail\n\n---\n");
  });

  it("adds editor link context actions and delegates resolved internal links through file-menu", async () => {
    const app = new App(document.createElement("div"));
    await app.vault.create("Target.md", "target");
    const editor = new SimpleEditor();
    editor.setValue("See [[Target]]");
    const fileMenuEvents: unknown[] = [];
    app.workspace.on("file-menu", (menu, file, source) => {
      fileMenuEvents.push({ menu, file, source });
      (menu as Menu).addItem((item) => item.setTitle("Plugin file action"));
    });

    const menu = app.menus.createEditorMenu(editor, {} as View, {
      link: {
        type: "internal-link",
        linktext: "Target",
        sourcePath: "Source.md",
        start: { line: 0, ch: 4 },
        end: { line: 0, ch: 14 },
      },
    });
    const items = menu.items.filter((item): item is MenuItem => item instanceof MenuItem);

    expect(findMenuItem(items, "Open in new tab").section).toBe("open");
    expect(findMenuItem(items, "Open to the right").section).toBe("open");
    expect(findMenuItem(items, "Rename").section).toBe("action");
    expect(findMenuItem(items, "Edit link").section).toBe("selection");
    expect(findMenuItem(items, "Plugin file action")).not.toBeNull();
    expect(fileMenuEvents).toHaveLength(1);
    expect(fileMenuEvents[0]).toMatchObject({
      source: "link-context-menu",
    });

    clickMenuItem(findMenuItem(items, "Edit link"));

    expect(editor.getSelection()).toBe("[[Target]]");
  });

  it("returns link context handling status and forwards an explicit source leaf", async () => {
    const app = new App(document.createElement("div"));
    const target = await app.vault.create("Target.md", "target");
    const leaf = app.workspace.getLeaf();
    const seenLeaves: unknown[] = [];
    app.workspace.on("file-menu", (_menu, _file, _source, menuLeaf) => {
      seenLeaves.push(menuLeaf);
    });

    expect(app.workspace.handleLinkContextMenu(new Menu(), "", "Source.md", leaf)).toBe(false);
    expect(app.workspace.handleLinkContextMenu(new Menu(), "Target", "Source.md", leaf)).toBe(true);
    expect(app.workspace.handleLinkContextMenu(new Menu(), "Missing", "Source.md", leaf)).toBe(true);

    expect(app.metadataCache.getFirstLinkpathDest("Target", "Source.md")).toBe(target);
    expect(seenLeaves).toEqual([leaf]);
  });

  it("fires file-menu for folders and files-menu for multi-file contexts", async () => {
    const app = new App(document.createElement("div"));
    const note = await app.vault.create("Folder/Note.md", "");
    const folder = app.vault.getFolderByPath("Folder");
    if (!folder) throw new Error("missing folder");
    const fileEvents: Array<{ file: TAbstractFile; source: string }> = [];
    const filesEvents: Array<{ files: TAbstractFile[]; source: string }> = [];
    app.workspace.on("file-menu", (menu, file, source) => {
      fileEvents.push({ file: file as TAbstractFile, source: source as string });
      (menu as Menu).addItem((item) => item.setTitle("Plugin file/folder action"));
    });
    app.workspace.on("files-menu", (menu, files, source) => {
      filesEvents.push({ files: files as TAbstractFile[], source: source as string });
      (menu as Menu).addItem((item) => item.setTitle("Plugin multi-file action"));
    });

    const folderMenu = app.menus.createFileMenu(folder, "file-explorer-context-menu");
    const filesMenu = app.menus.createFilesMenu([folder, note], "file-explorer-context-menu");

    expect(folderMenu.items.filter((item): item is MenuItem => item instanceof MenuItem).map((item) => item.titleEl.textContent)).toEqual([
      "Move folder to...",
      "Copy path",
      "Open terminal here",
      "Plugin file/folder action",
    ]);
    expect(filesMenu.items.filter((item): item is MenuItem => item instanceof MenuItem).map((item) => item.titleEl.textContent)).toEqual([
      "Move items to...",
      "Plugin multi-file action",
    ]);
    expect(fileEvents).toEqual([{ file: folder, source: "file-explorer-context-menu" }]);
    expect(filesEvents).toEqual([{ files: [folder, note], source: "file-explorer-context-menu" }]);
  });

  it("adds a create-file action for unresolved internal link context menus", () => {
    const app = new App(document.createElement("div"));
    const editor = new SimpleEditor();

    const menu = app.menus.createEditorMenu(editor, {} as View, {
      link: {
        type: "internal-link",
        linktext: "Missing",
        sourcePath: "Source.md",
        start: { line: 0, ch: 0 },
        end: { line: 0, ch: 11 },
      },
    });
    const items = menu.items.filter((item): item is MenuItem => item instanceof MenuItem);

    expect(findMenuItem(items, "Create file").section).toBe("open");
  });

  it("adds external link context actions and triggers url-menu listeners", () => {
    const app = new App(document.createElement("div"));
    const editor = new SimpleEditor();
    editor.setValue("[Web](https://example.com)");
    const clipboard = createClipboard();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const linkMenu = vi.fn();
    const urlMenu = vi.fn((menu: unknown) => {
      (menu as Menu).addItem((item) => item.setTitle("Plugin URL action"));
    });
    app.workspace.on("link-menu", linkMenu);
    app.workspace.on("url-menu", urlMenu);

    const menu = app.menus.createEditorMenu(editor, {} as View, {
      link: {
        type: "external-link",
        linktext: "https://example.com",
        href: "https://example.com",
        sourcePath: "Source.md",
        start: { line: 0, ch: 0 },
        end: { line: 0, ch: "[Web](https://example.com)".length },
      },
    });
    const items = menu.items.filter((item): item is MenuItem => item instanceof MenuItem);

    expect(findMenuItem(items, "Plugin URL action")).not.toBeNull();
    clickMenuItem(findMenuItem(items, "Open link"));
    clickMenuItem(findMenuItem(items, "Copy URL"));

    expect(open).toHaveBeenCalledWith("https://example.com", "_blank");
    expect(clipboard.writeText).toHaveBeenCalledWith("https://example.com");
    expect(urlMenu).toHaveBeenCalled();
    expect(linkMenu).not.toHaveBeenCalled();
  });

  it("adds external reference link actions without edit-link selection", () => {
    const app = new App(document.createElement("div"));
    const editor = new SimpleEditor();
    editor.setValue("[Docs][docs]\n\n[docs]: https://example.com");
    const urlMenu = vi.fn();
    app.workspace.on("url-menu", urlMenu);

    const menu = app.menus.createEditorMenu(editor, {} as View, {
      externalRefLink: {
        id: "docs",
        href: "https://example.com",
        sourcePath: "Source.md",
      },
    });
    const items = menu.items.filter((item): item is MenuItem => item instanceof MenuItem);

    expect(items.some((item) => item.titleEl.textContent === "Edit link")).toBe(false);
    expect(findMenuItem(items, "Open link").section).toBe("open");
    expect(findMenuItem(items, "Copy URL").section).toBe("info");
    expect(urlMenu).toHaveBeenCalled();
  });

  it("adds editor tag context actions that select the tag body without the hash", () => {
    const app = new App(document.createElement("div"));
    const editor = new SimpleEditor();
    editor.setValue("Task #project/today");

    const menu = app.menus.createEditorMenu(editor, {} as View, {
      tag: {
        text: "project/today",
        start: { line: 0, ch: "Task #".length },
        end: { line: 0, ch: "Task #project/today".length },
      },
    });
    const items = menu.items.filter((item): item is MenuItem => item instanceof MenuItem);

    expect(findMenuItem(items, "Edit tag").section).toBe("selection");

    clickMenuItem(findMenuItem(items, "Edit tag"));

    expect(editor.getSelection()).toBe("project/today");
  });

  it("adds editor footref context actions that delete the reference and note definition", () => {
    const app = new App(document.createElement("div"));
    const editor = new SimpleEditor();
    editor.setValue("Text [^one]\n\n[^one]: Footnote\nNext");

    const menu = app.menus.createEditorMenu(editor, {} as View, {
      footref: {
        id: "one",
        start: { line: 0, ch: 5 },
        end: { line: 0, ch: 11 },
        definitionStart: { line: 1, ch: 0 },
        definitionEnd: { line: 2, ch: "[^one]: Footnote".length },
      },
    });
    const items = menu.items.filter((item): item is MenuItem => item instanceof MenuItem);

    expect(findMenuItem(items, "Delete footref and note").section).toBe("action");

    clickMenuItem(findMenuItem(items, "Delete footref and note"));

    expect(editor.getValue()).toBe("Text \n\nNext");
  });
});

function createClipboard(): { text: string; readText: ReturnType<typeof vi.fn>; writeText: ReturnType<typeof vi.fn> } {
  const clipboard = {
    text: "",
    readText: vi.fn(async () => clipboard.text),
    writeText: vi.fn(async (text: string) => {
      clipboard.text = text;
    }),
  };
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });
  return clipboard;
}

function findMenuItem(items: MenuItem[], title: string): MenuItem {
  const item = items.find((candidate) => candidate.titleEl.textContent === title);
  if (!item) throw new Error(`Missing menu item: ${title}`);
  return item;
}

function clickMenuItem(item: MenuItem): void {
  item.handleEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}
