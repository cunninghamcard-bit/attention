import {
  Compartment,
  EditorSelection as CodeMirrorSelection,
  EditorState,
  StateEffect as CodeMirrorStateEffect,
  type Extension,
} from "@codemirror/state";
import { EditorView as CodeMirrorEditorView, keymap, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

import type { Editor } from "./Editor";
import {
  isEditorDomClassSpec,
  isEditorTransactionFilterSpec,
  isEditorUpdateListenerSpec,
  isEditorViewPluginSpec,
  type EditorExtension,
  type EditorTransactionFilterSpec,
  type EditorUpdateListenerSpec,
  type EditorViewPluginValue,
  type EditorViewUpdate,
} from "./EditorExtension";
import {
  editorLivePreviewField,
  isStateFieldInit,
  type StateField,
  type Transaction,
} from "./EditorStateField";

export class EditorViewHost {
  readonly cm: CodeMirrorEditorView;
  readonly dom: HTMLElement;
  readonly scrollerEl: HTMLElement;
  readonly guttersEl: HTMLElement;
  readonly sizerEl: HTMLElement;
  readonly contentContainerEl: HTMLElement;
  readonly contentEl: HTMLElement;
  private readonly codeMirrorExtensions = new Compartment();
  private extensions: readonly EditorExtension[] = [];
  private stateFields = new Map<StateField<unknown>, unknown>();
  private viewPlugins: EditorViewPluginValue[] = [];
  private updateListeners: EditorUpdateListenerSpec[] = [];
  private transactionFilters: EditorTransactionFilterSpec[] = [];
  private domClasses: string[] = [];
  private readonly unregisterEditorChange: () => void;
  private readonly unregisterSelectionChange: () => void;
  private lastDoc: string;
  private lastSelection: string;
  private applyingEditorUpdate = false;
  private applyingCodeMirrorUpdate = false;

  constructor(
    readonly editor: Editor,
    parent: HTMLElement,
  ) {
    this.lastDoc = editor.getValue();
    this.lastSelection = this.getSelectionSignature();
    ensureRangeGeometry(parent.ownerDocument.defaultView ?? window);
    this.cm = new CodeMirrorEditorView({
      parent,
      state: EditorState.create({
        doc: editor.getValue(),
        extensions: this.createBaseCodeMirrorExtensions(),
      }),
    });
    this.dom = this.cm.dom;
    this.scrollerEl = this.cm.scrollDOM;
    this.contentEl = this.cm.contentDOM;
    this.contentEl.spellcheck = true;
    const structure = this.installObsidianContentStructure();
    this.guttersEl = structure.guttersEl;
    this.sizerEl = structure.sizerEl;
    this.contentContainerEl = structure.contentContainerEl;
    this.unregisterEditorChange = this.editor.onChange((_editor, origin) =>
      this.handleEditorUpdate(true, origin),
    );
    this.unregisterSelectionChange = this.editor.onSelectionChange(() =>
      this.handleEditorUpdate(false),
    );
  }

  setExtensions(extensions: readonly EditorExtension[]): void {
    this.destroyExecutableExtensions();
    this.extensions = extensions;
    this.stateFields = new Map();
    const codeMirrorExtensions: Extension[] = [];
    for (const extension of extensions) {
      const value = extension.value;
      if (isStateFieldInit(value)) {
        this.stateFields.set(value.field, value.value);
      } else if (isEditorViewPluginSpec(value)) {
        this.mountViewPlugin(value.create(this));
      } else if (isEditorUpdateListenerSpec(value)) {
        this.updateListeners.push(value);
      } else if (isEditorTransactionFilterSpec(value)) {
        this.transactionFilters.push(value);
      } else if (isEditorDomClassSpec(value)) {
        this.addDomClass(value.className);
      } else if (isCodeMirrorExtension(value)) {
        codeMirrorExtensions.push(value);
      }
    }
    this.cm.dispatch({ effects: this.codeMirrorExtensions.reconfigure(codeMirrorExtensions) });
    this.dom.dataset.extensionCount = String(
      extensions.filter((extension) => extension.source === "plugin").length,
    );
    this.dom.dataset.viewPluginCount = String(this.viewPlugins.length);
    this.dom.dataset.updateListenerCount = String(this.updateListeners.length);
    this.dom.dataset.livePreview = String(this.getStateField(editorLivePreviewField));
  }

  getExtensions(): readonly EditorExtension[] {
    return this.extensions;
  }

  renderDocument(): void {
    this.syncCodeMirrorFromEditor(true);
  }

  getStateField<T>(field: StateField<T>): T {
    return this.stateFields.has(field) ? (this.stateFields.get(field) as T) : field.create();
  }

  dispatch(transaction: Transaction): void {
    let current: Transaction | null = transaction;
    for (const filter of this.transactionFilters) {
      const result = filter.filter(current, this);
      if (result === false || result === null) {
        this.dom.dataset.lastTransactionEffects = "blocked";
        return;
      }
      if (result) current = result;
    }
    for (const effect of current.effects) {
      for (const [field, value] of [...this.stateFields])
        this.stateFields.set(field, field.update(value, effect));
    }
    this.dom.dataset.lastTransactionEffects = String(current.effects.length);
    this.dom.dataset.livePreview = String(this.getStateField(editorLivePreviewField));
    this.emitUpdate({
      view: this,
      docChanged: false,
      selectionSet: false,
      transactions: [current],
      previousDoc: this.lastDoc,
      doc: this.lastDoc,
    });
  }

  destroy(): void {
    this.unregisterEditorChange();
    this.unregisterSelectionChange();
    this.destroyExecutableExtensions();
    this.cm.destroy();
    this.dom.remove();
  }

  private createBaseCodeMirrorExtensions(): Extension[] {
    return [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      CodeMirrorEditorView.lineWrapping,
      CodeMirrorEditorView.updateListener.of((update) => this.handleCodeMirrorUpdate(update)),
      this.codeMirrorExtensions.of([]),
    ];
  }

  private installObsidianContentStructure(): {
    guttersEl: HTMLElement;
    sizerEl: HTMLElement;
    contentContainerEl: HTMLElement;
  } {
    const existingSizer = this.scrollerEl.querySelector<HTMLElement>(":scope > .cm-sizer");
    const sizerEl = existingSizer ?? document.createElement("div");
    sizerEl.classList.add("cm-sizer");

    const existingContentContainer = sizerEl.querySelector<HTMLElement>(
      ":scope > .cm-contentContainer",
    );
    const contentContainerEl = existingContentContainer ?? document.createElement("div");
    contentContainerEl.classList.add("cm-contentContainer");

    const existingGutters =
      contentContainerEl.querySelector<HTMLElement>(":scope > .cm-gutters") ??
      this.scrollerEl.querySelector<HTMLElement>(":scope > .cm-gutters");
    const guttersEl = existingGutters ?? document.createElement("div");
    guttersEl.classList.add("cm-gutters");
    guttersEl.setAttribute("aria-hidden", "true");

    if (!contentContainerEl.contains(guttersEl)) contentContainerEl.prepend(guttersEl);
    if (!contentContainerEl.contains(this.contentEl))
      contentContainerEl.appendChild(this.contentEl);
    if (!sizerEl.contains(contentContainerEl)) sizerEl.appendChild(contentContainerEl);
    if (!this.scrollerEl.contains(sizerEl)) this.scrollerEl.appendChild(sizerEl);

    return { guttersEl, sizerEl, contentContainerEl };
  }

  private handleEditorUpdate(docChanged: boolean, origin?: string): void {
    if (this.applyingCodeMirrorUpdate) return;
    const previousDoc = this.lastDoc;
    const previousSelection = this.lastSelection;
    this.lastDoc = this.editor.getValue();
    this.lastSelection = this.getSelectionSignature();
    this.syncCodeMirrorFromEditor(docChanged);
    this.emitUpdate({
      view: this,
      docChanged,
      selectionSet: !docChanged || previousSelection !== this.lastSelection,
      transactions: [],
      previousDoc,
      doc: this.lastDoc,
      origin,
    });
  }

  private handleCodeMirrorUpdate(update: ViewUpdate): void {
    if (this.applyingEditorUpdate) return;
    if (!update.docChanged && !update.selectionSet) return;
    const previousDoc = this.lastDoc;
    const previousSelection = this.lastSelection;
    this.applyingCodeMirrorUpdate = true;
    try {
      if (update.docChanged) {
        const next = update.state.doc.toString();
        if (this.editor.getValue() !== next) this.editor.setValue(next, "+input");
      }
      if (update.docChanged || update.selectionSet)
        this.syncEditorSelectionFromCodeMirror(update.state.selection);
    } finally {
      this.applyingCodeMirrorUpdate = false;
    }
    this.lastDoc = this.editor.getValue();
    this.lastSelection = this.getSelectionSignature();
    const docChanged = previousDoc !== this.lastDoc;
    const selectionSet = previousSelection !== this.lastSelection;
    if (!docChanged && !selectionSet) return;
    this.emitUpdate({
      view: this,
      docChanged,
      selectionSet,
      transactions: [],
      previousDoc,
      doc: this.lastDoc,
      origin: update.docChanged ? "+input" : undefined,
    });
  }

  private syncCodeMirrorFromEditor(docChanged: boolean): void {
    const currentDoc = this.cm.state.doc.toString();
    const nextDoc = this.editor.getValue();
    const selection = this.createCodeMirrorSelection();
    const selectionChanged =
      docChanged ||
      this.getCodeMirrorSelectionSignature(selection) !==
        this.getCodeMirrorSelectionSignature(this.cm.state.selection);
    if ((!docChanged || currentDoc === nextDoc) && !selectionChanged) return;
    this.applyingEditorUpdate = true;
    try {
      this.cm.dispatch({
        changes:
          docChanged && currentDoc !== nextDoc
            ? { from: 0, to: currentDoc.length, insert: nextDoc }
            : undefined,
        selection: selectionChanged ? selection : undefined,
      });
    } finally {
      this.applyingEditorUpdate = false;
    }
  }

  private createCodeMirrorSelection(): CodeMirrorSelection {
    const length = this.editor.getValue().length;
    const ranges = this.editor.listSelections().map((selection) => {
      const anchor = clamp(this.editor.posToOffset(selection.anchor), 0, length);
      const head = clamp(this.editor.posToOffset(selection.head), 0, length);
      return CodeMirrorSelection.range(anchor, head);
    });
    return CodeMirrorSelection.create(
      ranges.length > 0 ? ranges : [CodeMirrorSelection.cursor(0)],
      0,
    );
  }

  private syncEditorSelectionFromCodeMirror(selection: CodeMirrorSelection): void {
    const docLength = this.editor.getValue().length;
    const ranges = selection.ranges.map((range) => ({
      anchor: this.editor.offsetToPos(clamp(range.anchor, 0, docLength)),
      head: this.editor.offsetToPos(clamp(range.head, 0, docLength)),
    }));
    this.editor.setSelections(ranges, selection.mainIndex);
  }

  private getCodeMirrorSelectionSignature(selection: CodeMirrorSelection): string {
    return `${selection.mainIndex}|${selection.ranges.map((range) => `${range.anchor}:${range.head}`).join("|")}`;
  }

  private emitUpdate(update: EditorViewUpdate): void {
    for (const plugin of [...this.viewPlugins]) plugin.update?.(update);
    for (const listener of [...this.updateListeners]) listener.update(update);
  }

  private mountViewPlugin(value: EditorViewPluginValue | (() => void) | void): void {
    if (!value) return;
    this.viewPlugins.push(typeof value === "function" ? { destroy: value } : value);
  }

  private addDomClass(className: string): void {
    const classes = className.split(/\s+/).filter(Boolean);
    for (const item of classes) {
      this.dom.classList.add(item);
      this.domClasses.push(item);
    }
  }

  private destroyExecutableExtensions(): void {
    for (const plugin of this.viewPlugins.splice(0).reverse()) plugin.destroy?.();
    this.updateListeners = [];
    this.transactionFilters = [];
    this.cm.dispatch({ effects: this.codeMirrorExtensions.reconfigure([]) });
    for (const className of this.domClasses.splice(0)) this.dom.classList.remove(className);
  }

  private getSelectionSignature(): string {
    return this.editor
      .listSelections()
      .map(
        (selection) =>
          `${selection.anchor.line}:${selection.anchor.ch}:${selection.head.line}:${selection.head.ch}`,
      )
      .join("|");
  }
}

function isCodeMirrorExtension(value: unknown): value is Extension {
  return (
    Array.isArray(value) ||
    typeof value === "function" ||
    value instanceof CodeMirrorStateEffect ||
    Boolean(value && typeof value === "object" && "extension" in value)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function ensureRangeGeometry(win: Window): void {
  const globals = win as unknown as {
    Range?: { prototype: Range };
    DOMRect?: typeof DOMRect;
  };
  const rangePrototype = globals.Range?.prototype as
    | (Range & {
        getClientRects?: () => DOMRectList;
        getBoundingClientRect?: () => DOMRect;
      })
    | undefined;
  if (!rangePrototype) return;
  if (typeof rangePrototype.getClientRects !== "function") {
    rangePrototype.getClientRects = () =>
      ({
        length: 0,
        item: () => null,
        [Symbol.iterator]: function* (): IterableIterator<DOMRect> {},
      }) as unknown as DOMRectList;
  }
  if (typeof rangePrototype.getBoundingClientRect !== "function") {
    const Rect = globals.DOMRect ?? DOMRect;
    rangePrototype.getBoundingClientRect = () => new Rect(0, 0, 0, 0);
  }
}
