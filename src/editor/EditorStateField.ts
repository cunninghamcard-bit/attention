import type { App } from "../app/App";
import type { Editor } from "./Editor";
import type { EditorViewHost } from "./EditorView";
import type { TFile } from "../vault/TAbstractFile";
import type { HoverParent } from "../ui/Popover";
import { ViewPlugin } from "./ViewPlugin";

export class StateEffect<T = unknown> {
  constructor(readonly value: T) {}
}

export interface MarkdownFileInfo extends HoverParent {
  app: App;
  readonly file: TFile | null;
  editor?: Editor;
}

export interface StateFieldInit<T> {
  type: "state-field-init";
  field: StateField<T>;
  value: T;
}

export class StateField<T> {
  constructor(
    readonly create: () => T,
    readonly update: (value: T, effect: StateEffect) => T = (value) => value,
  ) {}

  init(value?: T | (() => T)): StateFieldInit<T> {
    return {
      type: "state-field-init",
      field: this,
      value: typeof value === "function" ? (value as () => T)() : value ?? this.create(),
    };
  }
}

export class Transaction {
  constructor(readonly effects: StateEffect[] = []) {}
}

export const editorEditorField = new StateField<EditorViewHost | null>(() => null);
export const editorInfoField = new StateField<MarkdownFileInfo | null>(() => null);
export const editorViewField = editorInfoField;
export const editorLivePreviewField = new StateField<boolean>(() => false);

export interface LivePreviewStateType {
  mousedown: boolean;
}

export const livePreviewState = ViewPlugin.fromClass(class LivePreviewState implements LivePreviewStateType {
  mousedown = false;

  update(): void {}
});

export function isStateFieldInit(value: unknown): value is StateFieldInit<unknown> {
  return typeof value === "object"
    && value !== null
    && (value as { type?: unknown }).type === "state-field-init"
    && (value as { field?: unknown }).field instanceof StateField;
}
