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
import { editorLivePreviewField, isStateFieldInit, type StateField, type Transaction } from "./EditorStateField";

export class EditorViewHost {
  readonly dom: HTMLElement;
  readonly scrollerEl: HTMLElement;
  readonly guttersEl: HTMLElement;
  readonly sizerEl: HTMLElement;
  readonly contentContainerEl: HTMLElement;
  readonly contentEl: HTMLElement;
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

  constructor(readonly editor: Editor, parent: HTMLElement) {
    this.lastDoc = editor.getValue();
    this.lastSelection = this.getSelectionSignature();
    this.dom = document.createElement("div");
    this.dom.className = "cm-editor";
    this.scrollerEl = document.createElement("div");
    this.scrollerEl.className = "cm-scroller";
    this.guttersEl = document.createElement("div");
    this.guttersEl.className = "cm-gutters";
    this.sizerEl = document.createElement("div");
    this.sizerEl.className = "cm-sizer";
    this.contentContainerEl = document.createElement("div");
    this.contentContainerEl.className = "cm-contentContainer";
    this.contentEl = document.createElement("div");
    this.contentEl.className = "cm-content";
    this.contentEl.contentEditable = "true";
    this.contentEl.spellcheck = true;
    this.contentContainerEl.append(this.guttersEl, this.contentEl);
    this.sizerEl.appendChild(this.contentContainerEl);
    this.scrollerEl.appendChild(this.sizerEl);
    this.dom.appendChild(this.scrollerEl);
    parent.appendChild(this.dom);
    this.unregisterEditorChange = this.editor.onChange((_editor, origin) => this.handleEditorUpdate(true, origin));
    this.unregisterSelectionChange = this.editor.onSelectionChange(() => this.handleEditorUpdate(false));
  }

  setExtensions(extensions: readonly EditorExtension[]): void {
    this.destroyExecutableExtensions();
    this.extensions = extensions;
    this.stateFields = new Map();
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
      }
    }
    this.dom.dataset.extensionCount = String(extensions.filter((extension) => extension.source === "plugin").length);
    this.dom.dataset.viewPluginCount = String(this.viewPlugins.length);
    this.dom.dataset.updateListenerCount = String(this.updateListeners.length);
    this.dom.dataset.livePreview = String(this.getStateField(editorLivePreviewField));
  }

  getExtensions(): readonly EditorExtension[] {
    return this.extensions;
  }

  getStateField<T>(field: StateField<T>): T {
    return this.stateFields.has(field) ? this.stateFields.get(field) as T : field.create();
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
      for (const [field, value] of [...this.stateFields]) this.stateFields.set(field, field.update(value, effect));
    }
    this.dom.dataset.lastTransactionEffects = String(current.effects.length);
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
    this.dom.remove();
  }

  private handleEditorUpdate(docChanged: boolean, origin?: string): void {
    const previousDoc = this.lastDoc;
    const previousSelection = this.lastSelection;
    this.lastDoc = this.editor.getValue();
    this.lastSelection = this.getSelectionSignature();
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
    for (const className of this.domClasses.splice(0)) this.dom.classList.remove(className);
  }

  private getSelectionSignature(): string {
    return this.editor.listSelections()
      .map((selection) => `${selection.anchor.line}:${selection.anchor.ch}:${selection.head.line}:${selection.head.ch}`)
      .join("|");
  }
}
