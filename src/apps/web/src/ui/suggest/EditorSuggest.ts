import type { App } from "../../app/App";
import type { Editor, EditorPosition } from "../../editor/Editor";
import { TFile } from "../../vault/TAbstractFile";
import { PopoverSuggest } from "./AbstractInputSuggest";
import type { Instruction } from "./SuggestModal";

export interface EditorSuggestTriggerInfo {
  start: EditorPosition;
  end: EditorPosition;
  query: string;
}

export interface EditorSuggestContext extends EditorSuggestTriggerInfo {
  editor: Editor;
  file: TFile | null;
}

export abstract class EditorSuggest<T> extends PopoverSuggest<T> {
  context: EditorSuggestContext | null = null;
  limit = 100;
  readonly instructionsEl: HTMLElement;
  private fallbackAnchorEl: HTMLElement | null = null;

  constructor(app: App) {
    super(app);
    this.instructionsEl = this.suggestEl.ownerDocument.createElement("div");
    this.instructionsEl.className = "prompt-instructions";
    this.suggestEl.addEventListener("mousedown", (event) => event.preventDefault());
  }

  abstract onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    file: TFile | null,
  ): EditorSuggestTriggerInfo | null;
  abstract getSuggestions(context: EditorSuggestContext): T[] | null | Promise<T[] | null>;

  shouldAcceptKey?(event: KeyboardEvent): boolean;

  setInstructions(instructions: Instruction[]): void {
    this.instructionsEl.replaceChildren();
    if (instructions.length === 0) {
      this.instructionsEl.remove();
      return;
    }

    for (const instruction of instructions) {
      const doc = this.suggestEl.ownerDocument;
      const instructionEl = doc.createElement("div");
      instructionEl.className = "prompt-instruction";
      const commandEl = doc.createElement("span");
      commandEl.className = "prompt-instruction-command";
      commandEl.textContent = instruction.command;
      const purposeEl = doc.createElement("span");
      purposeEl.textContent = instruction.purpose;
      instructionEl.append(commandEl, purposeEl);
      this.instructionsEl.appendChild(instructionEl);
    }

    this.suggestEl.appendChild(this.instructionsEl);
  }

  async trigger(
    editor: Editor,
    file?: unknown,
    force = false,
    fallbackAnchorEl: HTMLElement | null = null,
  ): Promise<boolean> {
    this.fallbackAnchorEl = fallbackAnchorEl;
    const cursor = getEditorCursor(editor, "from");
    const end = getEditorCursor(editor, "to");
    if (!samePosition(cursor, end)) {
      this.context = null;
      return false;
    }

    const sourceFile = toEditorSuggestFile(file);
    const context = this.onTrigger(cursor, editor, sourceFile);
    if (!context) {
      this.context = null;
      return false;
    }

    this.context = { ...context, editor, file: sourceFile };
    if (!force && !this.isOpen) return true;

    const suggestionResult = this.getSuggestions(this.context);
    if (!suggestionResult) return true;

    const hasDomAnchor = this.fallbackAnchorEl !== null;
    const values = isPromiseLike(suggestionResult) ? await suggestionResult : suggestionResult;
    if (isPromiseLike(suggestionResult) && !hasDomAnchor && !editorHasFocus(editor)) {
      this.close();
      return true;
    }
    if (values) this.showSuggestions(values);
    return true;
  }

  showSuggestions(values: T[]): void {
    if (values.length === 0) {
      this.close();
      return;
    }

    const limitedValues = this.limit > 0 ? values.slice(0, this.limit) : values;
    this.suggestions.setSuggestions(limitedValues);
    this.updatePosition();
  }

  updatePosition(): void {
    const context = this.context;
    if (!context) return;

    const rect = getEditorSuggestRect(
      context.editor,
      context.start,
      context.end,
      this.fallbackAnchorEl,
    );
    if (!rect) return;

    this.open(getEditorOwnerDocument(context.editor, this.fallbackAnchorEl));
    this.reposition(rect, getLineDirection(context.editor, context.start.line));
  }

  override close(): void {
    this.context = null;
    this.fallbackAnchorEl = null;
    super.close();
  }
}

export class EditorSuggestManager {
  private suggests: EditorSuggest<unknown>[] = [];
  private activeSuggest: EditorSuggest<unknown> | null = null;

  addSuggest(suggest: EditorSuggest<unknown>): void {
    this.suggests.push(suggest);
  }

  removeSuggest(suggest: EditorSuggest<unknown>): void {
    if (this.activeSuggest === suggest) this.close();
    else suggest.close();
    this.suggests = this.suggests.filter((candidate) => candidate !== suggest);
  }

  async trigger(
    editor: Editor,
    source: HTMLElement | unknown,
    eventOrForce?: KeyboardEvent | boolean,
  ): Promise<void> {
    const event = isKeyboardEvent(eventOrForce) ? eventOrForce : undefined;
    const force = eventOrForce === true || !event;
    const anchorEl = isHTMLElement(source) ? source : null;
    const file = anchorEl ? undefined : source;

    if (this.activeSuggest && event?.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    if (this.activeSuggest && event?.key === "ArrowDown") {
      this.activeSuggest.suggestions.moveSelectedItem(1, event);
      event.preventDefault();
      return;
    }
    if (this.activeSuggest && event?.key === "ArrowUp") {
      this.activeSuggest.suggestions.moveSelectedItem(-1, event);
      event.preventDefault();
      return;
    }
    if (this.activeSuggest && event?.key === "Enter") {
      this.useActiveSuggestion(event);
      return;
    }
    if (this.activeSuggest && event && this.activeSuggest.shouldAcceptKey?.(event)) {
      this.useActiveSuggestion(event);
      return;
    }

    for (const suggest of this.suggests) {
      const handled = await suggest.trigger(editor, file, force, anchorEl);
      if (!handled) continue;
      if (this.activeSuggest && this.activeSuggest !== suggest) this.activeSuggest.close();
      this.activeSuggest = suggest.isOpen ? suggest : null;
      return;
    }

    this.close();
  }

  isShowingSuggestion(): boolean {
    return this.activeSuggest?.isOpen === true;
  }

  reposition(): void {
    this.activeSuggest?.updatePosition();
  }

  close(): void {
    const activeSuggest = this.activeSuggest;
    this.activeSuggest = null;
    activeSuggest?.close();
  }

  private useActiveSuggestion(event: KeyboardEvent): void {
    const activeSuggest = this.activeSuggest;
    if (!activeSuggest) return;
    const used = activeSuggest.suggestions.useSelectedItem(event);
    if (used) activeSuggest.close();
    event.preventDefault();
  }
}

function isKeyboardEvent(value: unknown): value is KeyboardEvent {
  if (!value || typeof value !== "object") return false;
  if (typeof KeyboardEvent !== "undefined" && value instanceof KeyboardEvent) return true;
  return "key" in value;
}

function isHTMLElement(value: unknown): value is HTMLElement {
  return typeof HTMLElement !== "undefined" && value instanceof HTMLElement;
}

function toEditorSuggestFile(value: unknown): TFile | null {
  return value && typeof value === "object" ? (value as TFile) : null;
}

function isPromiseLike<T>(value: T[] | null | Promise<T[] | null>): value is Promise<T[] | null> {
  return !!value && typeof (value as Promise<T[] | null>).then === "function";
}

function getEditorCursor(editor: Editor, mode: "from" | "to"): EditorPosition {
  const getCursor = editor.getCursor as (mode?: "from" | "to") => EditorPosition;
  return getCursor.call(editor, mode);
}

function samePosition(left: EditorPosition, right: EditorPosition): boolean {
  return left.line === right.line && left.ch === right.ch;
}

function editorHasFocus(editor: Editor): boolean {
  const candidate = editor as {
    hasFocus?: () => boolean;
    cm?: { hasFocus?: boolean | (() => boolean) };
  };
  if (typeof candidate.hasFocus === "function") return candidate.hasFocus();
  if (typeof candidate.cm?.hasFocus === "function") return candidate.cm.hasFocus();
  if (typeof candidate.cm?.hasFocus === "boolean") return candidate.cm.hasFocus;
  return true;
}

function getEditorSuggestRect(
  editor: Editor,
  start: EditorPosition,
  end: EditorPosition,
  fallbackAnchorEl: HTMLElement | null,
): Pick<DOMRect, "left" | "right" | "top" | "bottom"> | null {
  const coordsAtPos = editor.coordsAtPos?.bind(editor);
  const startRect = coordsAtPos?.(start);
  const endRect = coordsAtPos?.(end);
  if (startRect && endRect) {
    return {
      top: startRect.top,
      left: Math.min(startRect.left, endRect.left),
      right: Math.max(startRect.right, endRect.right),
      bottom: endRect.bottom,
    };
  }

  const containerEl = (editor as { containerEl?: HTMLElement }).containerEl;
  return (containerEl ?? fallbackAnchorEl)?.getBoundingClientRect() ?? null;
}

function getEditorOwnerDocument(editor: Editor, fallbackAnchorEl: HTMLElement | null): Document {
  const containerEl = (editor as { containerEl?: HTMLElement }).containerEl;
  return (containerEl ?? fallbackAnchorEl)?.ownerDocument ?? document;
}

function getLineDirection(editor: Editor, line: number): "auto" | "ltr" | "rtl" {
  const text = editor.getLine(line).trimStart();
  if (!text) return "auto";
  const first = text[0];
  if (!first) return "auto";
  return /[\u0590-\u08ff]/u.test(first) ? "rtl" : "ltr";
}
