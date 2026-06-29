import type { App } from "../app/App";
import type { Editor, EditorPosition } from "../editor/Editor";
import { computeBlockIdInsertion } from "../metadata/BlockCache";
import type { LinkFileSuggestion, LinkSuggestionReplacement } from "../metadata/LinkSuggestionManager";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import { EditorSuggest, type EditorSuggestContext, type EditorSuggestTriggerInfo } from "../suggest/EditorSuggest";
import type { TFile } from "../vault/TAbstractFile";
import { MarkdownView } from "../views/MarkdownView";

interface LinkSuggestContext extends EditorSuggestContext {
  sourcePath: string;
  lineSuffix: string;
}

interface LinkSuggestTriggerInfo extends EditorSuggestTriggerInfo {
  sourcePath: string;
  lineSuffix: string;
}

export class LinkSuggest extends EditorSuggest<LinkFileSuggestion> {
  constructor(app: App) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor): LinkSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    const prefix = line.slice(0, cursor.ch);
    const openIndex = prefix.lastIndexOf("[[");
    if (openIndex === -1) return null;
    if (prefix.slice(openIndex + 2).includes("]]")) return null;
    const query = prefix.slice(openIndex + 2);
    if (query.includes("\n")) return null;
    return {
      query,
      start: { line: cursor.line, ch: openIndex + 2 },
      end: cursor,
      sourcePath: this.app.workspace.activeEditor?.file?.path ?? "",
      lineSuffix: line.slice(cursor.ch),
    };
  }

  async getSuggestions(context: EditorSuggestContext): Promise<LinkFileSuggestion[]> {
    const linkContext = context as LinkSuggestContext;
    return this.app.linkSuggestions.getSuggestionsAsync(null, linkContext.query, linkContext.sourcePath);
  }

  renderSuggestion(value: LinkFileSuggestion, el: HTMLElement): void {
    el.classList.add("mod-complex", `mod-${value.type}`);
    const contentEl = document.createElement("div");
    contentEl.className = "suggestion-content";
    const titleEl = document.createElement("div");
    titleEl.className = "suggestion-title";
    titleEl.textContent = suggestionTitle(value);
    const noteEl = document.createElement("div");
    noteEl.className = "suggestion-note";
    noteEl.textContent = suggestionNote(value);
    contentEl.append(titleEl, noteEl);
    const auxEl = document.createElement("div");
    auxEl.className = "suggestion-aux";
    auxEl.textContent = value.type;
    el.append(contentEl, auxEl);
  }

  shouldAcceptKey(event: KeyboardEvent): boolean {
    return event.key === "Tab" || event.key === "#" || event.key === "^" || event.key === "|";
  }

  selectSuggestion(value: LinkFileSuggestion, event: MouseEvent | KeyboardEvent): void {
    const context = this.context as LinkSuggestContext | null;
    if (!context) return;
    void this.acceptSuggestion(value, context, event);
    this.close();
  }

  private async acceptSuggestion(value: LinkFileSuggestion, context: LinkSuggestContext, event: MouseEvent | KeyboardEvent): Promise<void> {
    const key = event instanceof KeyboardEvent ? event.key : "";
    const replacement = this.app.linkSuggestions.createLinkSuggestionReplacement(value, {
      query: context.query,
      tailText: context.lineSuffix,
      start: context.start.ch - 2,
      end: context.end.ch,
      sourcePath: context.sourcePath,
      key,
      mode: "markdown",
    });
    const activeEditor = this.app.workspace.activeEditor;
    const activeView = activeEditor instanceof MarkdownView ? activeEditor : this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView instanceof MarkdownView) {
      await this.applyToMarkdownView(activeView, value, context, replacement);
      return;
    }
    context.editor.replaceRange(replacement.replacement, { line: context.start.line, ch: replacement.start }, { line: context.end.line, ch: replacement.end });
  }

  private async applyToMarkdownView(view: MarkdownView, value: LinkFileSuggestion, context: LinkSuggestContext, replacement: LinkSuggestionReplacement): Promise<void> {
    const source = view.editor.getValue();
    const lineOffset = offsetAtLine(source, context.start.line);
    const replacementEdit = {
      start: lineOffset + replacement.start,
      end: lineOffset + replacement.end,
      text: replacement.replacement,
    };
    const edits = [replacementEdit];
    let selectionShift = 0;

    if (value.type === "block" && replacement.blockId) {
      if (value.file.path === context.sourcePath) {
        const insertion = computeBlockIdInsertion(value, replacement.blockId);
        const insertAt = findCurrentBlockInsertionOffset(source, value.content, insertion.blockStart, insertion.blockEnd);
        edits.push({ start: insertAt, end: insertAt, text: insertion.addition });
        if (insertAt <= lineOffset + replacement.selectionStart) selectionShift += insertion.addition.length;
        value.node.id = replacement.blockId;
      } else {
        await this.app.linkSuggestions.ensureBlockSuggestionId(value, replacement.blockId);
      }
    }

    view.applyTextEdits(
      edits,
      lineOffset + replacement.selectionStart + selectionShift,
      lineOffset + replacement.selectionEnd + selectionShift,
    );
  }
}

export function createLinkSuggestPluginDefinition(): InternalPluginDefinition {
  let suggest: LinkSuggest | null = null;
  return {
    id: "link-suggest",
    name: "Link suggestions",
    description: "Suggest files, aliases, headings, and blocks while typing wiki links.",
    hiddenFromList: true,
    defaultOn: true,
    init(app: App, plugin) {
      suggest = new LinkSuggest(app);
      plugin.instance = suggest;
    },
    onEnable(app: App) {
      if (suggest) app.workspace.editorSuggest.addSuggest(suggest);
    },
    onDisable(app: App) {
      if (suggest) app.workspace.editorSuggest.removeSuggest(suggest);
    },
  };
}

function suggestionTitle(value: LinkFileSuggestion): string {
  if (value.type === "file") return value.file.basename;
  if (value.type === "alias") return value.alias;
  if (value.type === "heading") return value.heading;
  if (value.type === "block") return value.display;
  return value.path;
}

function suggestionNote(value: LinkFileSuggestion): string {
  if (value.type === "file") return value.file.path;
  if (value.type === "alias") return formatPath(value.file, value.path);
  if (value.type === "heading") return `${formatPath(value.file, value.path ?? "")}${value.subpath}`;
  if (value.type === "block") return `${value.file.path}#^${value.node.id ?? ""}`;
  return value.path;
}

function formatPath(file: TFile | null, path: string): string {
  return file?.path ?? path;
}

function offsetAtLine(source: string, line: number): number {
  const lines = source.split(/\r?\n/);
  let offset = 0;
  for (let index = 0; index < Math.min(line, lines.length); index += 1) offset += lines[index].length + 1;
  return offset;
}

function findCurrentBlockInsertionOffset(source: string, cachedContent: string, blockStart: number, blockEnd: number): number {
  const blockText = cachedContent.slice(blockStart, blockEnd);
  if (!blockText) return blockEnd;
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let cursor = source.indexOf(blockText);
  while (cursor !== -1) {
    const distance = Math.abs(cursor - blockStart);
    if (distance < bestDistance) {
      bestIndex = cursor;
      bestDistance = distance;
    }
    cursor = source.indexOf(blockText, cursor + 1);
  }
  return bestIndex === -1 ? blockEnd : bestIndex + blockText.length;
}
