import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";
import { TextFileView } from "./TextFileView";
import type { TFile } from "../vault/TAbstractFile";

/**
 * Source-code files the workspace opens as first-class tabs. Keep this list in
 * sync with what @codemirror/language-data can actually highlight; unknown
 * extensions still fall back to plain text rendering inside the view.
 */
export const CODE_EXTENSIONS = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "go", "py", "rs", "java", "kt", "swift", "rb", "php", "lua",
  "c", "h", "cc", "cpp", "hpp", "cs",
  "sh", "bash", "zsh", "fish",
  "json", "jsonc", "yaml", "yml", "toml", "xml",
  "css", "scss", "less", "html", "vue", "svelte",
  "sql", "graphql", "proto", "dockerfile", "txt", "log", "csv", "ini", "conf",
];

// Map lezer highlight tags onto the theme's --code-* palette so code files
// pick up accent/theme changes exactly like markdown code blocks do.
const themeHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], color: "var(--code-keyword)" },
  { tag: [tags.string, tags.special(tags.string), tags.character, tags.docString], color: "var(--code-string)" },
  { tag: [tags.comment, tags.blockComment, tags.lineComment], color: "var(--code-comment)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.literal], color: "var(--code-value)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName], color: "var(--code-function)" },
  { tag: [tags.propertyName, tags.attributeName, tags.definition(tags.variableName)], color: "var(--code-property)" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName, tags.standard(tags.tagName), tags.constant(tags.variableName)], color: "var(--code-tag)" },
  { tag: [tags.operator, tags.compareOperator, tags.arithmeticOperator, tags.logicOperator, tags.updateOperator, tags.definitionOperator], color: "var(--code-operator)" },
  { tag: [tags.punctuation, tags.separator, tags.bracket, tags.paren, tags.brace, tags.squareBracket], color: "var(--code-punctuation)" },
  { tag: [tags.meta, tags.processingInstruction, tags.annotation], color: "var(--code-important)" },
  { tag: tags.invalid, color: "var(--text-error)" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
]);

export class CodeFileView extends TextFileView {
  static readonly VIEW_TYPE = "code";
  private cm: EditorView | null = null;
  private readonly languageCompartment = new Compartment();
  private applyingViewData = false;

  getViewType(): string { return CodeFileView.VIEW_TYPE; }
  getDisplayText(): string { return this.file?.name ?? "Code"; }
  getIcon(): string { return "lucide-file-code"; }

  async onOpen(): Promise<void> {
    await super.onOpen();
    this.contentEl.classList.add("code-file-view");
    this.cm = new EditorView({
      parent: this.contentEl,
      state: EditorState.create({ doc: this.source, extensions: this.baseExtensions() }),
    });
  }

  override async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    await this.applyLanguage(file.name);
  }

  override setViewData(data: string, clearDirty = false): void {
    super.setViewData(data, clearDirty);
    if (!this.cm || this.applyingViewData) return;
    if (this.cm.state.doc.toString() === data) return;
    this.applyingViewData = true;
    try {
      this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: data } });
    } finally {
      this.applyingViewData = false;
    }
  }

  override clear(): void {
    super.clear();
    if (this.cm && this.cm.state.doc.length > 0) {
      this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: "" } });
    }
  }

  async onClose(): Promise<void> {
    await super.onClose();
    this.cm?.destroy();
    this.cm = null;
  }

  private baseExtensions(): Extension[] {
    return [
      lineNumbers(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      syntaxHighlighting(themeHighlightStyle),
      this.languageCompartment.of([]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || this.applyingViewData) return;
        this.applyingViewData = true;
        try {
          this.source = update.state.doc.toString();
        } finally {
          this.applyingViewData = false;
        }
        this.requestSave();
      }),
    ];
  }

  private async applyLanguage(filename: string): Promise<void> {
    if (!this.cm) return;
    const description = LanguageDescription.matchFilename(languages, filename);
    const support = description ? await description.load() : null;
    if (!this.cm) return;
    this.cm.dispatch({ effects: this.languageCompartment.reconfigure(support ?? []) });
  }
}
