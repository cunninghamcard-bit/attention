import type { App } from "../App";
import type { Editor } from "../../editor/Editor";
import { TFile, type TAbstractFile } from "../../vault/TAbstractFile";
import type { View } from "../../views/View";
import { MarkdownView } from "../../views/MarkdownView";
import type { WorkspaceLeaf } from "../../workspace/WorkspaceLeaf";
import { Menu } from "../../ui/Menu";
import { readClipboardText, writeClipboardText } from "../../dom/Clipboard";

export type FileMenuSource = "file-explorer-context-menu" | "tab-header" | "more-options" | "graph-context-menu" | "link-context-menu" | "command";
export type LinkMenuSource = "markdown-link" | "backlink" | "graph" | "search-result";
export type MarkdownViewportMenuMode = "source" | "preview";
export type MarkdownViewportMenuSource = "gutter";

export interface EditorMenuLinkContext {
  type: "internal-link" | "external-link";
  linktext: string;
  sourcePath: string;
  start: { line: number; ch: number };
  end: { line: number; ch: number };
  href?: string;
}

export interface EditorMenuTagContext {
  text: string;
  start: { line: number; ch: number };
  end: { line: number; ch: number };
}

export interface EditorMenuFootrefContext {
  id: string;
  start: { line: number; ch: number };
  end: { line: number; ch: number };
  definitionStart: { line: number; ch: number };
  definitionEnd: { line: number; ch: number };
}

export interface EditorMenuExternalRefLinkContext {
  id: string;
  href: string;
  sourcePath: string;
}

export interface EditorMenuContext {
  link?: EditorMenuLinkContext | null;
  externalRefLink?: EditorMenuExternalRefLinkContext | null;
  tag?: EditorMenuTagContext | null;
  footref?: EditorMenuFootrefContext | null;
}

export class MenuManager {
  constructor(readonly app: App) {}

  createFileMenu(file: TAbstractFile, source: FileMenuSource = "command", leaf?: WorkspaceLeaf): Menu {
    const menu = new Menu();
    if (file instanceof TFile) {
      menu.addItem((item) => item.setTitle("Open").setIcon("lucide-file").onClick(() => {
        void this.app.workspace.getLeaf().openFile(file, { active: true });
      }));
      menu.addItem((item) => item.setTitle("Reveal in file explorer").setIcon("lucide-folder-open").onClick(async () => {
        const leaf = await this.app.workspace.ensureSideLeaf("file-explorer", "left", { reveal: true });
        const view = leaf.view as unknown as { revealFile?: (target: TFile) => void };
        view.revealFile?.(file);
      }));
    }
    this.app.workspace.trigger("file-menu", menu, file, source, leaf);
    return menu;
  }

  createFilesMenu(files: TAbstractFile[], source: FileMenuSource = "file-explorer-context-menu", leaf?: WorkspaceLeaf): Menu {
    const menu = new Menu();
    this.app.workspace.trigger("files-menu", menu, files, source, leaf);
    return menu;
  }

  createEditorMenu(editor: Editor, view: View, context: EditorMenuContext = {}): Menu {
    const menu = new Menu();
    const selection = editor.getSelection().trim();
    const selectionHasNewline = /\n/.test(selection);
    menu.addSections([
      "title",
      "correction",
      "spellcheck",
      "open",
      "selection-link",
      "selection",
      "selection.format",
      "selection.paragraph",
      "selection.paragraph.list",
      "selection.paragraph.heading",
      "selection.paragraph.block",
      "selection.insert.basic",
      "selection.insert.advanced",
      "insert",
      "clipboard",
      "info",
      "info.copy",
      "action",
      "view",
      "",
      "danger",
    ]);
    if (context.link) this.addEditorLinkContextItems(menu, editor, context.link);
    else if (context.externalRefLink) this.addEditorExternalRefLinkContextItems(menu, context.externalRefLink);
    else if (context.tag) this.addEditorTagContextItems(menu, editor, context.tag);
    else if (context.footref) this.addEditorFootrefContextItems(menu, editor, context.footref);
    menu.addItem((item) => item
      .setTitle("Insert link")
      .setIcon("lucide-link")
      .setSection("selection-link")
      .setDisabled(selectionHasNewline)
      .onClick(() => void insertWikilink(this.app, editor, view)));
    menu.addItem((item) => item
      .setTitle("Insert external link")
      .setIcon("lucide-external-link")
      .setSection("selection-link")
      .setDisabled(selectionHasNewline)
      .onClick(() => insertMarkdownLink(editor)));
    if (view instanceof MarkdownView) {
      this.addMarkdownParagraphItems(menu, view);
      this.addMarkdownInsertItems(menu, view);
    }
    menu.addItem((item) => item
      .setTitle("Cut")
      .setIcon("lucide-scissors")
      .setSection("clipboard")
      .setDisabled(!editor.somethingSelected())
      .onClick(() => void cutEditorSelection(editor)));
    menu.addItem((item) => item
      .setTitle("Copy")
      .setIcon("lucide-copy")
      .setSection("clipboard")
      .setDisabled(!editor.somethingSelected())
      .onClick(() => void copyEditorSelection(editor)));
    menu.addItem((item) => item
      .setTitle("Paste")
      .setIcon("lucide-clipboard")
      .setSection("clipboard")
      .onClick(() => void pasteIntoEditor(editor)));
    menu.addItem((item) => item
      .setTitle("Paste as plain text")
      .setIcon("lucide-clipboard")
      .setSection("clipboard")
      .onClick(() => void pasteIntoEditor(editor)));
    menu.addItem((item) => item
      .setTitle("Select all")
      .setSection("clipboard")
      .onClick(() => selectAllEditorText(editor)));
    this.app.workspace.trigger("editor-menu", menu, editor, view);
    return menu;
  }

  private addEditorLinkContextItems(menu: Menu, editor: Editor, context: EditorMenuLinkContext): void {
    menu.addItem((item) => item
      .setTitle("Edit link")
      .setIcon("lucide-text-cursor-input")
      .setSection("selection")
      .onClick(() => {
        editor.focus();
        editor.setSelection(context.start, context.end);
      }));

    if (context.type === "internal-link") {
      this.app.workspace.handleLinkContextMenu(menu, context.linktext, context.sourcePath);
      return;
    }

    const href = context.href ?? context.linktext;
    this.app.workspace.handleExternalLinkContextMenu(menu, href);
  }

  private addEditorExternalRefLinkContextItems(menu: Menu, context: EditorMenuExternalRefLinkContext): void {
    this.app.workspace.handleExternalLinkContextMenu(menu, context.href);
  }

  private addEditorTagContextItems(menu: Menu, editor: Editor, context: EditorMenuTagContext): void {
    menu.addItem((item) => item
      .setTitle("Edit tag")
      .setIcon("lucide-text-cursor-input")
      .setSection("selection")
      .onClick(() => {
        editor.focus();
        editor.setSelection(context.start, context.end);
      }));
  }

  private addEditorFootrefContextItems(menu: Menu, editor: Editor, context: EditorMenuFootrefContext): void {
    menu.addItem((item) => item
      .setTitle("Delete footref and note")
      .setIcon("lucide-file-signature")
      .setSection("action")
      .onClick(() => {
        editor.transaction({
          changes: [
            { from: context.start, to: context.end, text: "" },
            { from: context.definitionStart, to: context.definitionEnd, text: "" },
          ],
        }, "delete-footref");
      }));
  }

  private addMarkdownParagraphItems(menu: Menu, view: MarkdownView): void {
    menu.addItem((item) => item
      .setTitle("Bullet list")
      .setIcon("lucide-list")
      .setSection("selection.paragraph.list")
      .onClick(() => view.toggleBulletList()));
    menu.addItem((item) => item
      .setTitle("Numbered list")
      .setIcon("lucide-list-ordered")
      .setSection("selection.paragraph.list")
      .onClick(() => view.toggleNumberList()));
    menu.addItem((item) => item
      .setTitle("Checklist")
      .setIcon("lucide-check-square")
      .setSection("selection.paragraph.list")
      .onClick(() => view.toggleCheckList()));
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      menu.addItem((item) => item
        .setTitle(`Heading ${level}`)
        .setIcon(`lucide-heading-${level}`)
        .setSection("selection.paragraph.heading")
        .onClick(() => view.setHeading(level)));
    }
    menu.addItem((item) => item
      .setTitle("No heading")
      .setIcon("lucide-type")
      .setSection("selection.paragraph.heading")
      .onClick(() => view.setHeading(0)));
    menu.addItem((item) => item
      .setTitle("Blockquote")
      .setIcon("lucide-quote")
      .setSection("selection.paragraph.block")
      .onClick(() => view.toggleBlockquote()));
  }

  private addMarkdownInsertItems(menu: Menu, view: MarkdownView): void {
    menu.addItem((item) => item
      .setTitle("Insert footnote")
      .setIcon("lucide-file-signature")
      .setSection("selection.insert.basic")
      .onClick(() => view.insertFootnote()));
    menu.addItem((item) => item
      .setTitle("Insert table")
      .setIcon("lucide-table")
      .setSection("selection.insert.basic")
      .onClick(() => view.insertTable()));
    menu.addItem((item) => item
      .setTitle("Insert callout")
      .setIcon("lucide-quote")
      .setSection("selection.insert.basic")
      .onClick(() => view.insertCallout()));
    menu.addItem((item) => item
      .setTitle("Insert horizontal rule")
      .setIcon("lucide-minus")
      .setSection("selection.insert.basic")
      .onClick(() => view.insertHorizontalRule()));
    menu.addItem((item) => item
      .setTitle("Insert code block")
      .setIcon("lucide-code")
      .setSection("selection.insert.advanced")
      .onClick(() => view.insertCodeblock()));
    menu.addItem((item) => item
      .setTitle("Insert math block")
      .setIcon("lucide-sigma-square")
      .setSection("selection.insert.advanced")
      .onClick(() => view.insertMathBlock()));
  }

  createMarkdownViewportMenu(view: View, mode: MarkdownViewportMenuMode, source: MarkdownViewportMenuSource): Menu {
    const menu = new Menu();
    this.app.workspace.trigger("markdown-viewport-menu", menu, view, mode, source);
    return menu;
  }

  createLinkMenu(linktext: string, sourcePath: string, source: LinkMenuSource = "markdown-link"): Menu {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Open link").setIcon("lucide-link").onClick(() => {
      const file = this.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
      if (file) void this.app.workspace.getLeaf().openFile(file, { active: true });
    }));
    this.app.workspace.trigger("link-menu", menu, linktext, sourcePath, source);
    return menu;
  }
}

async function cutEditorSelection(editor: Editor): Promise<void> {
  const selection = editor.getSelection();
  if (!selection) return;
  await writeClipboardText(selection);
  editor.replaceSelection("", "cut");
}

async function copyEditorSelection(editor: Editor): Promise<void> {
  const selection = editor.getSelection();
  if (!selection) return;
  await writeClipboardText(selection);
}

async function pasteIntoEditor(editor: Editor): Promise<void> {
  const text = await readClipboardText();
  if (!text) return;
  editor.replaceSelection(text, "paste");
}

function selectAllEditorText(editor: Editor): void {
  editor.setSelection({ line: 0, ch: 0 }, editor.offsetToPos(editor.getValue().length));
}

async function insertWikilink(app: App, editor: Editor, view: View): Promise<void> {
  const selection = editor.getSelection();
  const start = editor.posToOffset(editor.getCursor("from"));
  editor.replaceSelection(`[[${selection}]]`, "insert-link");
  editor.setCursor(editor.offsetToPos(start + 2));
  if (selection) {
    editor.setCursor(editor.offsetToPos(start + 2 + selection.length));
    return;
  }
  const targetEl = getEditorSuggestTarget(view);
  if (targetEl) await app.workspace.editorSuggest.trigger(editor, targetEl, true);
}

function getEditorSuggestTarget(view: View): HTMLElement | null {
  if (view instanceof MarkdownView) return view.editorViewHost.contentEl;
  const candidate = (view as View & { editorViewHost?: { contentEl?: unknown } }).editorViewHost?.contentEl;
  if (candidate instanceof HTMLElement) return candidate;
  return view.containerEl instanceof HTMLElement ? view.containerEl : null;
}

function insertMarkdownLink(editor: Editor): void {
  const selection = editor.getSelection();
  const start = editor.posToOffset(editor.getCursor("from"));
  editor.replaceSelection(`[${selection}]()`, "insert-external-link");
  const cursorOffset = selection ? start + selection.length + 3 : start + 1;
  editor.setCursor(editor.offsetToPos(cursorOffset));
}
