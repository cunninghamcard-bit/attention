import type { App } from "./App";
import { MarkdownView } from "../views/MarkdownView";
import { EditableFileView } from "../views/EditableFileView";
import { EmptyView } from "../views/EmptyView";
import { TextFileView } from "../views/TextFileView";
import { getActiveDocument } from "../dom/ActiveDocument";
import { writeClipboardText } from "../dom/Clipboard";
import { Notice } from "../ui/Notice";
import { Menu } from "../ui/Menu";
import { MoveFileModal } from "../vault/MoveFileModal";
import type { TFile } from "../vault/TAbstractFile";
import { WorkspaceTabs } from "../workspace/WorkspaceTabs";
import { Platform } from "../platform/Platform";

export function registerAppCommands(app: App): void {
  app.commands.setEditorContextProvider(() => {
    const activeEditor = app.workspace.activeEditor;
    const view = activeEditor instanceof MarkdownView ? activeEditor : app.workspace.getActiveViewOfType(MarkdownView);
    return activeEditor?.editor && view ? { editor: activeEditor.editor, view } : null;
  });

  app.commands.addCommand({
    id: "app:toggle-left-sidebar",
    name: "Toggle left sidebar",
    icon: "lucide-panel-left",
    callback: () => {
      app.workspace.leftSplit.toggle("left");
    },
  });

  app.commands.addCommand({
    id: "app:toggle-right-sidebar",
    name: "Toggle right sidebar",
    icon: "lucide-panel-right",
    callback: () => {
      app.workspace.rightSplit.toggle("right");
    },
  });

  app.commands.addCommand({
    id: "app:show-release-notes",
    name: "Show release notes",
    icon: "lucide-scroll-text",
    callback: () => {
      void app.showReleaseNotes();
    },
  });

  app.commands.addCommand({
    id: "app:delete-file",
    name: "Delete current file",
    icon: "lucide-trash-2",
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!file) return false;
      if (!checking) void app.fileManager.promptForDeletion(file);
      return true;
    },
  });

  app.commands.addCommand({
    id: "app:toggle-ribbon",
    name: "Toggle ribbon",
    checkCallback: (checking) => {
      if (!Platform.isDesktop || !Platform.canDisplayRibbon) return false;
      if (!checking) app.vault.setConfig("showRibbon", app.vault.getConfig<boolean>("showRibbon") === false);
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:toggle-readable-line-length",
    name: "Toggle readable line length",
    icon: "lucide-ruler",
    callback: () => app.vault.setConfig("readableLineLength", !app.vault.getConfig("readableLineLength")),
  });

  app.commands.addCommand({
    id: "editor:toggle-line-numbers",
    name: "Toggle line numbers",
    icon: "lucide-list-ordered",
    callback: () => app.vault.setConfig("showLineNumber", !app.vault.getConfig("showLineNumber")),
  });

  app.commands.addCommand({
    id: "workspace:new-tab",
    name: "Open new tab",
    icon: "lucide-plus",
    hotkeys: [{ modifiers: ["Mod"], key: "T" }],
    checkCallback: (checking) => {
      const available = Boolean(app.workspace.getMostRecentLeaf()?.parent);
      if (!checking && available) app.workspace.createNewTab();
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:go-back",
    name: "Navigate back",
    icon: "lucide-arrow-left",
    checkCallback: (checking) => {
      const leaf = app.workspace.activeLeaf;
      const available = Boolean(leaf?.canGoBack());
      if (!checking && available) void leaf?.history.back();
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:go-forward",
    name: "Navigate forward",
    icon: "lucide-arrow-right",
    checkCallback: (checking) => {
      const leaf = app.workspace.activeLeaf;
      const available = Boolean(leaf?.canGoForward());
      if (!checking && available) void leaf?.history.forward();
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:close",
    name: "Close current tab",
    icon: "lucide-x",
    hotkeys: [{ modifiers: ["Mod"], key: "W" }],
    checkCallback: (checking) => {
      const available = Boolean(app.workspace.activeLeaf);
      if (!checking && available) app.workspace.closeActiveLeaf();
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:new-window",
    name: "Open new window",
    callback: () => {
      const leaf = app.workspace.openPopoutLeaf();
      app.workspace.setActiveLeaf(leaf, { focus: true });
    },
  });

  app.commands.addCommand({
    id: "workspace:open-in-new-window",
    name: "Open in new window",
    icon: "lucide-maximize",
    checkCallback: (checking) => {
      const available = app.workspace.canPopoutActiveLeaf();
      if (!checking && available) void app.workspace.openActiveLeafInNewWindow();
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:move-to-new-window",
    name: "Move to new window",
    icon: "lucide-maximize",
    checkCallback: (checking) => {
      const available = app.workspace.canPopoutActiveLeaf();
      if (!checking && available) app.workspace.moveActiveLeafToNewWindow();
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:toggle-pin",
    name: "Toggle pin",
    icon: "lucide-pin",
    checkCallback: (checking) => {
      const leaf = app.workspace.activeLeaf;
      const available = Boolean(leaf?.view && !(leaf.view instanceof EmptyView));
      if (!checking && available) leaf?.togglePinned();
      return available;
    },
  });

  for (const [direction, name] of [
    ["top", "Navigate tab above"],
    ["bottom", "Navigate tab below"],
    ["left", "Navigate tab left"],
    ["right", "Navigate tab right"],
  ] as const) {
    app.commands.addCommand({
      id: `editor:focus-${direction}`,
      name,
      checkCallback: (checking) => {
        const leaf = app.workspace.getAdjacentLeafInDirection(app.workspace.activeLeaf, direction);
        if (!leaf) return false;
        if (!checking) app.workspace.setActiveLeaf(leaf, { focus: true });
        return true;
      },
    });
  }

  app.commands.addCommand({
    id: "workspace:split-vertical",
    name: "Split right",
    icon: "lucide-separator-vertical",
    checkCallback: (checking) => {
      const leaf = app.workspace.activeLeaf;
      const available = Boolean(leaf?.canNavigate() && !app.workspace.isInSidebar(leaf));
      if (!checking && available && leaf) void app.workspace.duplicateLeaf(leaf, "vertical");
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:split-horizontal",
    name: "Split down",
    icon: "lucide-separator-horizontal",
    checkCallback: (checking) => {
      const leaf = app.workspace.activeLeaf;
      const available = Boolean(leaf?.canNavigate());
      if (!checking && available && leaf) void app.workspace.duplicateLeaf(leaf, "horizontal");
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:toggle-stacked-tabs",
    name: "Toggle stacked tabs",
    icon: "lucide-layers",
    checkCallback: (checking) => {
      const tabs = app.workspace.activeLeaf?.parent;
      const available = tabs instanceof WorkspaceTabs && tabs.getRoot() !== app.workspace.leftSplit && tabs.getRoot() !== app.workspace.rightSplit;
      if (!checking && available) tabs.setStacked(!tabs.isStacked);
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:edit-file-title",
    name: "Edit file title",
    icon: "lucide-edit-3",
    hotkeys: [{ modifiers: [], key: "F2" }],
    checkCallback: (checking) => {
      const view = getActiveEditableFileView(app);
      if (!view) return false;
      if (!checking) view.leaf.setEphemeralState({ rename: "all" });
      return true;
    },
  });

  app.commands.addCommand({
    id: "workspace:copy-path",
    name: "Copy path",
    icon: "lucide-copy",
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!file) return false;
      if (!checking) {
        void writeClipboardText(file.path);
        new Notice("Copied");
      }
      return true;
    },
  });

  app.commands.addCommand({
    id: "workspace:copy-full-path",
    name: "Copy absolute path",
    icon: "lucide-hard-drive",
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      const fullPath = file ? getActiveFileFullPath(app, file) : null;
      if (!fullPath || !Platform.isDesktopApp) return false;
      if (!checking) {
        void writeClipboardText(fullPath);
        new Notice("Copied");
      }
      return true;
    },
  });

  app.commands.addCommand({
    id: "workspace:copy-url",
    name: "Copy Obsidian URL",
    icon: "lucide-vault",
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!file) return false;
      if (!checking) void app.copyObsidianUrl(file);
      return true;
    },
  });

  app.commands.addCommand({
    id: "open-with-default-app:open",
    name: "Open in default app",
    icon: "lucide-arrow-up-right",
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!file) return false;
      if (!checking) void app.openWithDefaultApp(file.path);
      return true;
    },
  });

  app.commands.addCommand({
    id: "open-with-default-app:show",
    name: "Show in system explorer",
    icon: "lucide-files",
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!file) return false;
      if (!checking) void app.showInFolder(file.path);
      return true;
    },
  });

  app.commands.addCommand({
    id: "file-explorer:move-file",
    name: "Move file to...",
    icon: "lucide-folder-tree",
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!file) return false;
      if (!checking) new MoveFileModal(app, [file]).open();
      return true;
    },
  });

  app.commands.addCommand({
    id: "file-explorer:duplicate-file",
    name: "Make a copy",
    icon: "lucide-files",
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!file) return false;
      if (!checking) void duplicateActiveFile(app, file);
      return true;
    },
  });

  app.commands.addCommand({
    id: "workspace:close-window",
    name: "Close window",
    icon: "lucide-x",
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "W" }],
    checkCallback: (checking) => {
      const available = app.workspace.activeLeaf?.getRoot() === app.workspace.floatingSplit;
      if (!checking && available) app.workspace.closeActiveWindow();
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:next-tab",
    name: "Go to next tab",
    icon: "lucide-arrow-right",
    hotkeys: [
      { modifiers: ["Ctrl"], key: "Tab" },
      { modifiers: ["Mod", "Shift"], key: "]" },
    ],
    checkCallback: (checking) => {
      const available = Boolean(app.workspace.activeLeaf?.parent);
      if (!checking && available) app.workspace.selectNextTab();
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:previous-tab",
    name: "Go to previous tab",
    icon: "lucide-arrow-left",
    hotkeys: [
      { modifiers: ["Ctrl", "Shift"], key: "Tab" },
      { modifiers: ["Mod", "Shift"], key: "[" },
    ],
    checkCallback: (checking) => {
      const available = Boolean(app.workspace.activeLeaf?.parent);
      if (!checking && available) app.workspace.selectPreviousTab();
      return available;
    },
  });

  for (let index = 1; index <= 8; index += 1) {
    app.commands.addCommand({
      id: `workspace:goto-tab-${index}`,
      name: `Go to tab ${index}`,
      hotkeys: [{ modifiers: ["Mod"], key: String(index) }],
      checkCallback: (checking) => {
        const available = app.workspace.canSelectTab(index - 1);
        if (!checking && available) app.workspace.selectTab(index - 1);
        return available;
      },
    });
  }

  app.commands.addCommand({
    id: "workspace:goto-last-tab",
    name: "Go to last tab",
    hotkeys: [{ modifiers: ["Mod"], key: "9" }],
    checkCallback: (checking) => {
      const available = app.workspace.canSelectLastTab();
      if (!checking && available) app.workspace.selectLastTab();
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:close-others",
    name: "Close other tabs",
    icon: "lucide-x",
    checkCallback: (checking) => {
      const available = app.workspace.canCloseOtherLeaves();
      if (!checking && available) app.workspace.closeOtherLeaves();
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:close-tab-group",
    name: "Close tab group",
    icon: "lucide-x",
    checkCallback: (checking) => {
      const available = app.workspace.canCloseTabGroup();
      if (!checking && available) app.workspace.closeTabGroup();
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:close-others-tab-group",
    name: "Close others in tab group",
    icon: "lucide-x",
    checkCallback: (checking) => {
      const available = app.workspace.canCloseOthersInTabGroup();
      if (!checking && available) app.workspace.closeOthersInTabGroup();
      return available;
    },
  });

  app.commands.addCommand({
    id: "workspace:undo-close-pane",
    name: "Undo close tab",
    icon: "lucide-undo-2",
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "T" }],
    checkCallback: (checking) => {
      const available = app.workspace.hasUndoHistory();
      if (!checking && available) void app.workspace.undoClosePane();
      return available;
    },
  });

  app.commands.addCommand({
    id: "markdown:toggle-preview",
    name: "Toggle reading view",
    icon: "lucide-book-open",
    checkCallback: (checking) => {
      const view = app.workspace.activeLeaf?.view;
      if (!(view instanceof MarkdownView)) return false;
      if (!checking) view.toggleMode();
      return true;
    },
  });

  app.commands.addCommand({
    id: "markdown:show-source",
    name: "Show source mode",
    icon: "lucide-file-code",
    checkCallback: (checking) => {
      const view = app.workspace.activeLeaf?.view;
      if (!(view instanceof MarkdownView)) return false;
      if (!checking) view.setMode("source");
      return true;
    },
  });

  app.commands.addCommand({
    id: "markdown:show-preview",
    name: "Show reading view",
    icon: "lucide-book-open",
    checkCallback: (checking) => {
      const view = app.workspace.activeLeaf?.view;
      if (!(view instanceof MarkdownView)) return false;
      if (!checking) view.setMode("preview");
      return true;
    },
  });

  app.commands.addCommand({
    id: "markdown:save-current-file",
    name: "Save current file",
    icon: "lucide-save",
    checkCallback: (checking) => saveActiveTextFileView(app, checking),
  });

  app.commands.addCommand({
    id: "editor:save-file",
    name: "Save current file",
    hotkeys: [{ modifiers: ["Mod"], key: "S" }],
    checkCallback: (checking) => {
      return saveActiveTextFileView(app, checking);
    },
  });

  app.commands.addCommand({
    id: "editor:toggle-source",
    name: "Toggle source mode",
    icon: "lucide-code-2",
    checkCallback: (checking) => {
      const view = getActiveMarkdownView(app);
      if (!view || view.getMode() !== "source") return false;
      if (!checking) view.setSourceMode(view.getSourceMode() === "source" ? "live" : "source");
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:open-search",
    name: "Search current file",
    icon: "lucide-search",
    hotkeys: [{ modifiers: ["Mod"], key: "F" }],
    checkCallback: (checking) => openDocumentSearch(app, false, checking),
  });

  app.commands.addCommand({
    id: "editor:open-search-replace",
    name: "Search and replace current file",
    icon: "lucide-search",
    hotkeys: [getSearchReplaceHotkey()],
    checkCallback: (checking) => openDocumentSearch(app, true, checking),
  });

  app.commands.addCommand({
    id: "editor:focus",
    name: "Focus editor",
    checkCallback: (checking) => {
      const view = getActiveMarkdownView(app);
      if (!view) return false;
      if (!checking) view.editor.focus();
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:toggle-fold-properties",
    name: "Toggle fold properties",
    icon: "lucide-diff",
    checkCallback: (checking) => {
      const view = getActiveMarkdownView(app);
      if (!view || view.getMode() !== "source" || !view.canToggleFoldProperties()) return false;
      if (!checking) view.toggleFoldProperties();
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:toggle-fold",
    name: "Toggle fold",
    icon: "lucide-diff",
    allowProperties: true,
    editorCheckCallback: (checking, _editor, ctx) => {
      if (!canFoldMarkdown(app) || !(ctx instanceof MarkdownView) || ctx.getMode() !== "source" || !ctx.canToggleFoldAtCursor()) return false;
      if (!checking) ctx.toggleFoldAtCursor();
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:fold-all",
    name: "Fold all",
    icon: "lucide-minimize-2",
    allowPreview: true,
    allowProperties: true,
    editorCheckCallback: (checking, _editor, ctx) => {
      if (!canFoldMarkdown(app) || !(ctx instanceof MarkdownView)) return false;
      if (!checking) ctx.foldAll();
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:unfold-all",
    name: "Unfold all",
    icon: "lucide-maximize-2",
    allowPreview: true,
    allowProperties: true,
    editorCheckCallback: (checking, _editor, ctx) => {
      if (!canFoldMarkdown(app) || !(ctx instanceof MarkdownView)) return false;
      if (!checking) ctx.unfoldAll();
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:fold-less",
    name: "Fold less",
    icon: "lucide-unfold-vertical",
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.foldLess();
    },
  });

  app.commands.addCommand({
    id: "editor:fold-more",
    name: "Fold more",
    icon: "lucide-fold-vertical",
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.foldMore();
    },
  });

  app.commands.addCommand({
    id: "editor:insert-wikilink",
    name: "Insert internal link",
    icon: "bracket-glyph",
    showOnMobileToolbar: true,
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.insertWikilink(false);
    },
  });

  app.commands.addCommand({
    id: "editor:insert-embed",
    name: "Insert internal embed",
    icon: "lucide-sticky-note",
    showOnMobileToolbar: true,
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.insertWikilink(true);
    },
  });

  app.commands.addCommand({
    id: "editor:insert-link",
    name: "Insert Markdown link",
    icon: "lucide-link",
    hotkeys: [{ modifiers: ["Mod"], key: "K" }],
    showOnMobileToolbar: true,
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.insertMarkdownLink();
    },
  });

  app.commands.addCommand({
    id: "editor:insert-tag",
    name: "Insert tag",
    icon: "lucide-tag",
    showOnMobileToolbar: true,
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.insertTagAtCursor();
    },
  });

  app.commands.addCommand({
    id: "editor:set-heading",
    name: "Change heading",
    icon: "heading-glyph",
    showOnMobileToolbar: true,
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) showHeadingMenu(ctx);
    },
  });

  app.commands.addCommand({
    id: "editor:set-heading-0",
    name: "Remove heading",
    icon: "heading-glyph",
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.setHeading(0);
    },
  });

  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    app.commands.addCommand({
      id: `editor:set-heading-${level}`,
      name: `Toggle heading ${level}`,
      icon: "heading-glyph",
      editorCallback: (_editor, ctx) => {
        if (ctx instanceof MarkdownView) ctx.setHeading(level);
      },
    });
  }

  app.commands.addCommand({
    id: "editor:toggle-bold",
    name: "Toggle bold",
    icon: "lucide-bold",
    hotkeys: [{ modifiers: ["Mod"], key: "B" }],
    showOnMobileToolbar: true,
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.toggleMarkdownFormatting("bold");
    },
  });

  app.commands.addCommand({
    id: "editor:toggle-italics",
    name: "Toggle italics",
    icon: "lucide-italic",
    hotkeys: [{ modifiers: ["Mod"], key: "I" }],
    showOnMobileToolbar: true,
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.toggleMarkdownFormatting("italic");
    },
  });

  for (const command of [
    ["editor:toggle-strikethrough", "Toggle strikethrough", "lucide-strikethrough", "strikethrough"],
    ["editor:toggle-highlight", "Toggle highlight", "lucide-highlighter", "highlight"],
    ["editor:toggle-code", "Toggle code", "lucide-code-2", "code"],
    ["editor:toggle-inline-math", "Toggle inline math", "lucide-sigma", "math"],
  ] as const) {
    app.commands.addCommand({
      id: command[0],
      name: command[1],
      icon: command[2],
      showOnMobileToolbar: true,
      editorCallback: (_editor, ctx) => {
        if (ctx instanceof MarkdownView) ctx.toggleMarkdownFormatting(command[3]);
      },
    });
  }

  app.commands.addCommand({
    id: "editor:toggle-comments",
    name: "Toggle comments",
    icon: "lucide-percent",
    hotkeys: [{ modifiers: ["Mod"], key: "/" }],
    showOnMobileToolbar: true,
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.toggleComment();
    },
  });

  app.commands.addCommand({
    id: "editor:configure-toolbar",
    name: "Configure toolbar",
    icon: "lucide-wrench",
    mobileOnly: true,
    editorCallback: () => {
      app.setting.openTabById("mobile");
      app.setting.open("mobile");
    },
  });

  app.commands.addCommand({
    id: "editor:clear-formatting",
    name: "Clear formatting",
    icon: "lucide-eraser",
    editorCheckCallback: (checking, editor, ctx) => {
      if (!(ctx instanceof MarkdownView) || !editor.somethingSelected()) return false;
      if (!checking) ctx.clearMarkdownFormatting();
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:toggle-blockquote",
    name: "Toggle blockquote",
    icon: "lucide-quote",
    showOnMobileToolbar: true,
    editorCheckCallback: (checking, editor, ctx) => {
      if (!(ctx instanceof MarkdownView) || (editor as { inTableCell?: boolean }).inTableCell) return false;
      if (!checking) ctx.toggleBlockquote();
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:toggle-bullet-list",
    name: "Toggle bullet list",
    icon: "lucide-list",
    showOnMobileToolbar: true,
    editorCheckCallback: (checking, editor, ctx) => {
      if (!(ctx instanceof MarkdownView) || (editor as { inTableCell?: boolean }).inTableCell) return false;
      if (!checking) ctx.toggleBulletList();
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:toggle-numbered-list",
    name: "Toggle numbered list",
    icon: "lucide-list-ordered",
    showOnMobileToolbar: true,
    editorCheckCallback: (checking, editor, ctx) => {
      if (!(ctx instanceof MarkdownView) || (editor as { inTableCell?: boolean }).inTableCell) return false;
      if (!checking) ctx.toggleNumberList();
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:toggle-checklist-status",
    name: "Toggle checklist status",
    icon: "lucide-check-square",
    hotkeys: [{ modifiers: ["Mod"], key: "l" }],
    showOnMobileToolbar: true,
    editorCheckCallback: (checking, editor, ctx) => {
      if (!(ctx instanceof MarkdownView) || (editor as { inTableCell?: boolean }).inTableCell) return false;
      if (!checking) ctx.toggleCheckList();
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:cycle-list-checklist",
    name: "Cycle bullet/checklist",
    icon: "lucide-check-square",
    editorCheckCallback: (checking, editor, ctx) => {
      if (!(ctx instanceof MarkdownView) || (editor as { inTableCell?: boolean }).inTableCell) return false;
      if (!checking) ctx.toggleCheckList(true);
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:insert-callout",
    name: "Insert callout",
    icon: "lucide-quote",
    editorCheckCallback: (checking, editor, ctx) => {
      if (!(ctx instanceof MarkdownView) || (editor as { inTableCell?: boolean }).inTableCell) return false;
      if (!checking) ctx.insertCallout();
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:insert-codeblock",
    name: "Insert code block",
    icon: "lucide-code",
    editorCheckCallback: (checking, editor, ctx) => {
      if (!(ctx instanceof MarkdownView) || (editor as { inTableCell?: boolean }).inTableCell) return false;
      if (!checking) ctx.insertCodeblock();
      return true;
    },
  });

  app.commands.addCommand({
    id: "editor:insert-horizontal-rule",
    name: "Insert horizontal rule",
    icon: "lucide-minus",
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.insertHorizontalRule();
    },
  });

  app.commands.addCommand({
    id: "editor:insert-mathblock",
    name: "Insert math block",
    icon: "lucide-sigma-square",
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.insertMathBlock();
    },
  });

  app.commands.addCommand({
    id: "editor:insert-table",
    name: "Insert table",
    icon: "lucide-table",
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.insertTable();
    },
  });

  app.commands.addCommand({
    id: "editor:insert-footnote",
    name: "Insert footnote",
    icon: "lucide-file-signature",
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.insertFootnote();
    },
  });

  app.commands.addCommand({
    id: "editor:indent-list",
    name: "Indent list",
    icon: "lucide-indent",
    showOnMobileToolbar: true,
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.indentList();
    },
  });

  app.commands.addCommand({
    id: "editor:unindent-list",
    name: "Unindent list",
    icon: "lucide-outdent",
    showOnMobileToolbar: true,
    editorCallback: (_editor, ctx) => {
      if (ctx instanceof MarkdownView) ctx.unindentList();
    },
  });

  app.commands.addCommand({
    id: "editor:follow-link",
    name: "Follow link under cursor",
    icon: "lucide-link",
    hotkeys: [{ modifiers: ["Alt"], key: "Enter" }],
    checkCallback: (checking) => dispatchOpenLinkFromActiveElement(checking, false),
  });

  app.commands.addCommand({
    id: "editor:open-link-in-new-leaf",
    name: "Open link under cursor in new tab",
    icon: "lucide-link",
    hotkeys: [{ modifiers: ["Mod"], key: "Enter" }],
    checkCallback: (checking) => dispatchOpenLinkFromActiveElement(checking, "tab"),
  });

  app.commands.addCommand({
    id: "editor:open-link-in-new-window",
    name: "Open link under cursor in new window",
    icon: "lucide-link",
    hotkeys: [{ modifiers: ["Mod", "Alt", "Shift"], key: "Enter" }],
    checkCallback: (checking) => dispatchOpenLinkFromActiveElement(checking, "window"),
  });

  app.commands.addCommand({
    id: "editor:open-link-in-new-split",
    name: "Open link under cursor to the right",
    icon: "lucide-link",
    hotkeys: [{ modifiers: ["Mod", "Alt"], key: "Enter" }],
    checkCallback: (checking) => dispatchOpenLinkFromActiveElement(checking, "split"),
  });

  app.commands.addCommand({
    id: "app:open-settings",
    name: "Open settings",
    icon: "lucide-settings",
    hotkeys: [{ modifiers: ["Mod"], key: "," }],
    callback: () => app.setting.open(),
  });

  app.commands.addCommand({
    id: "app:open-developer-console",
    name: "Open developer console",
    icon: "lucide-bug",
    callback: () => void app.workspace.getLeaf("tab").setViewState({ type: "developer-console" }),
  });

  app.commands.addCommand({
    id: "app:open-chat",
    name: "Open chat",
    icon: "lucide-message-circle",
    callback: () => void app.workspace.getLeaf("tab").setViewState({ type: "chat", active: true }),
  });

  app.commands.addCommand({
    id: "file:new-note",
    name: "Create new note",
    icon: "lucide-file-plus",
    callback: async () => {
      const file = await app.fileManager.createNewMarkdownFile(null);
      await app.workspace.getLeaf("tab").openFile(file, { active: true, state: { mode: "source" } });
    },
  });
}

async function duplicateActiveFile(app: App, file: TFile): Promise<void> {
  const prefix = file.parentPath ? `${file.parentPath}/` : "";
  const path = app.vault.getAvailablePath(`${prefix}${file.basename}`, file.extension);
  const copied = await app.vault.copy(file, path);
  await app.workspace.getLeaf("tab").openFile(copied, { active: true, eState: { rename: "all" } });
}

function getActiveEditableFileView(app: App): EditableFileView | null {
  const activeLeafView = app.workspace.activeLeaf?.view;
  if (activeLeafView instanceof EditableFileView && activeLeafView.file) return activeLeafView;
  const activeEditor = app.workspace.activeEditor;
  if (activeEditor instanceof EditableFileView && activeEditor.file) return activeEditor;
  const markdownView = app.workspace.getActiveViewOfType(MarkdownView);
  return markdownView?.file ? markdownView : null;
}

function getActiveFileFullPath(app: App, file: TFile): string | null {
  return app.vault.adapter?.getFullPath?.(file.path) ?? null;
}

function saveActiveTextFileView(app: App, checking: boolean): boolean {
  const view = app.workspace.getActiveViewOfType(TextFileView);
  if (!view) return false;
  if (!checking) void view.save();
  return true;
}

function getActiveMarkdownView(app: App): MarkdownView | null {
  const activeEditor = app.workspace.activeEditor;
  if (activeEditor instanceof MarkdownView) return activeEditor;
  const activeView = app.workspace.activeLeaf?.view;
  if (activeView instanceof MarkdownView) return activeView;
  return app.workspace.getActiveViewOfType(MarkdownView);
}

function openDocumentSearch(app: App, replace: boolean, checking: boolean): boolean {
  const view = getActiveMarkdownView(app);
  if (!view || (replace && view.getMode() !== "source")) return false;
  if (!checking) view.showSearch(replace);
  return true;
}

function canFoldMarkdown(app: App): boolean {
  return Boolean(app.vault.getConfig("foldHeading") || app.vault.getConfig("foldIndent"));
}

function getSearchReplaceHotkey(): { modifiers: string[]; key: string } {
  return isMacRuntime()
    ? { modifiers: ["Mod", "Alt"], key: "F" }
    : { modifiers: ["Mod"], key: "H" };
}

function isMacRuntime(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(globalThis.navigator?.platform ?? "");
}

function dispatchOpenLinkFromActiveElement(checking: boolean, paneType: false | "tab" | "split" | "window"): boolean | void {
  const activeDocument = getActiveDocument();
  const activeElement = activeDocument.activeElement;
  if (checking || !activeElement || activeElement === activeDocument.body) return undefined;
  const CustomEventCtor = activeDocument.defaultView?.CustomEvent ?? CustomEvent;
  activeElement.dispatchEvent(new CustomEventCtor("open-link", {
    bubbles: true,
    cancelable: true,
    detail: { paneType },
  }));
}

function showHeadingMenu(view: MarkdownView): void {
  const menu = new Menu(view.containerEl.ownerDocument);
  menu.addItem((item) => item.setTitle("No heading").setIcon("lucide-type").onClick(() => view.setHeading(0)));
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    menu.addItem((item) => item.setTitle(`Heading ${level}`).setIcon(`lucide-heading-${level}`).onClick(() => view.setHeading(level)));
  }
  const rect = view.containerEl.getBoundingClientRect();
  menu.setParentElement(view.containerEl).showAtPosition({ x: rect.left + 24, y: rect.top + 24 });
}
