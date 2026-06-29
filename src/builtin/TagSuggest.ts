import type { App } from "../app/App";
import type { Editor, EditorPosition } from "../editor/Editor";
import { completeTagSuggestionText, getTagSuggestions, renderTagSuggestion, type TagSuggestion } from "../metadata/TagSuggestion";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import { EditorSuggest, type EditorSuggestContext, type EditorSuggestTriggerInfo } from "../suggest/EditorSuggest";
import { MarkdownView } from "../views/MarkdownView";

const TAG_TRIGGER = /(^|\s)#[^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]*$/u;

export class TagSuggest extends EditorSuggest<TagSuggestion> {
  constructor(app: App) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    const prefix = line.slice(0, cursor.ch);
    if (!TAG_TRIGGER.test(prefix)) return null;
    if (line.slice(cursor.ch, cursor.ch + 1) === "#") return null;
    const hashIndex = prefix.lastIndexOf("#");
    return {
      start: { line: cursor.line, ch: hashIndex },
      end: cursor,
      query: prefix.slice(hashIndex + 1),
    };
  }

  getSuggestions(context: EditorSuggestContext): TagSuggestion[] {
    return getTagSuggestions(this.app.tagIndex.getTags(), context.query, false);
  }

  renderSuggestion(value: TagSuggestion, el: HTMLElement): void {
    renderTagSuggestion(el, value);
  }

  shouldAcceptKey(event: KeyboardEvent): boolean {
    return event.key === "Tab";
  }

  selectSuggestion(value: TagSuggestion, event: MouseEvent | KeyboardEvent): void {
    const context = this.context;
    if (!context) return;
    const text = event instanceof KeyboardEvent && event.key === "Tab"
      ? `#${completeTagSuggestionText(value)}`
      : `#${value.tag} `;
    const activeEditor = this.app.workspace.activeEditor;
    const activeView = activeEditor instanceof MarkdownView ? activeEditor : this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView instanceof MarkdownView) {
      const lineOffset = offsetAtLine(activeView.sourceTextAreaEl.value, context.start.line);
      const start = lineOffset + context.start.ch;
      activeView.applyTextEdits([{ start, end: lineOffset + context.end.ch, text }], start + text.length);
      this.close();
      return;
    }
    context.editor.replaceRange(text, context.start, context.end);
    this.close();
  }
}

export function createTagSuggestPluginDefinition(): InternalPluginDefinition {
  let suggest: TagSuggest | null = null;
  return {
    id: "tag-suggest",
    name: "Tag suggestions",
    description: "Suggest existing tags while typing tags in Markdown.",
    hiddenFromList: true,
    defaultOn: true,
    init(app: App, plugin) {
      suggest = new TagSuggest(app);
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

function offsetAtLine(source: string, line: number): number {
  const lines = source.split(/\r?\n/);
  let offset = 0;
  for (let index = 0; index < Math.min(line, lines.length); index += 1) offset += lines[index].length + 1;
  return offset;
}
