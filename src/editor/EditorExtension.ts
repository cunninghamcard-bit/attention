import type { Transaction } from "./EditorStateField";
import type { EditorViewHost } from "./EditorView";

export interface EditorExtensionContext {
  viewType: string;
  sourcePath?: string;
}

export interface EditorExtension {
  id?: string;
  source?: string;
  value: unknown;
}

export interface EditorViewUpdate {
  view: EditorViewHost;
  docChanged: boolean;
  selectionSet: boolean;
  transactions: readonly Transaction[];
  previousDoc: string;
  doc: string;
  origin?: string;
}

export interface EditorViewPluginValue {
  update?(update: EditorViewUpdate): void;
  destroy?(): void;
}

export interface EditorViewPluginSpec {
  type: "view-plugin";
  create(view: EditorViewHost): EditorViewPluginValue | (() => void) | void;
}

export interface EditorUpdateListenerSpec {
  type: "update-listener";
  update(update: EditorViewUpdate): void;
}

export interface EditorTransactionFilterSpec {
  type: "transaction-filter";
  filter(transaction: Transaction, view: EditorViewHost): Transaction | null | false | void;
}

export interface EditorDomClassSpec {
  type: "dom-class";
  className: string;
}

export function editorViewPlugin(create: EditorViewPluginSpec["create"]): EditorViewPluginSpec {
  return { type: "view-plugin", create };
}

export function editorUpdateListener(update: EditorUpdateListenerSpec["update"]): EditorUpdateListenerSpec {
  return { type: "update-listener", update };
}

export function editorTransactionFilter(filter: EditorTransactionFilterSpec["filter"]): EditorTransactionFilterSpec {
  return { type: "transaction-filter", filter };
}

export function editorDomClass(className: string): EditorDomClassSpec {
  return { type: "dom-class", className };
}

export class EditorExtensionRegistry {
  private extensions: Array<{ original: unknown; source: string }> = [];

  register(extension: EditorExtension | unknown, source = "core"): EditorExtension {
    const normalized = normalizeExtensions(extension, source);
    this.extensions.push({ original: extension, source });
    return normalized[0] ?? { source, value: undefined };
  }

  unregister(extension: EditorExtension | unknown): void {
    this.extensions = this.extensions.filter((item) => {
      if (item.original === extension) return false;
      return !normalizeExtensions(item.original, item.source).some((current) => current === extension || current.value === extension);
    });
  }

  getExtensions(_context?: EditorExtensionContext): readonly EditorExtension[] {
    return this.extensions.flatMap((item) => normalizeExtensions(item.original, item.source));
  }
}

export class EditorExtensionHost {
  readonly registry = new EditorExtensionRegistry();

  register(extension: EditorExtension | unknown, source = "core"): EditorExtension {
    return this.registry.register(extension, source);
  }

  unregister(extension: EditorExtension | unknown): void {
    this.registry.unregister(extension);
  }

  getActiveExtensions(context: EditorExtensionContext): readonly EditorExtension[] {
    return this.registry.getExtensions(context);
  }
}

function isEditorExtension(value: unknown): value is EditorExtension {
  return typeof value === "object"
    && value !== null
    && "value" in value
    && ("id" in value || "source" in value);
}

function normalizeExtensions(extension: unknown, source: string): EditorExtension[] {
  if (extension === null || extension === undefined || extension === false) return [];
  if (Array.isArray(extension)) return extension.flatMap((item) => normalizeExtensions(item, source));
  if (!isEditorExtension(extension)) return [{ source, value: extension }];
  const nested = normalizeExtensions(extension.value, extension.source ?? source);
  if (nested.length === 0) return [{ id: extension.id, source: extension.source ?? source, value: extension.value }];
  return nested.map((item) => ({
    ...item,
    id: item.id ?? extension.id,
    source: item.source ?? extension.source ?? source,
  }));
}

export function isEditorViewPluginSpec(value: unknown): value is EditorViewPluginSpec {
  return Boolean(value && typeof value === "object"
    && (value as { type?: unknown }).type === "view-plugin"
    && typeof (value as { create?: unknown }).create === "function");
}

export function isEditorUpdateListenerSpec(value: unknown): value is EditorUpdateListenerSpec {
  return Boolean(value && typeof value === "object"
    && (value as { type?: unknown }).type === "update-listener"
    && typeof (value as { update?: unknown }).update === "function");
}

export function isEditorTransactionFilterSpec(value: unknown): value is EditorTransactionFilterSpec {
  return Boolean(value && typeof value === "object"
    && (value as { type?: unknown }).type === "transaction-filter"
    && typeof (value as { filter?: unknown }).filter === "function");
}

export function isEditorDomClassSpec(value: unknown): value is EditorDomClassSpec {
  return Boolean(value && typeof value === "object"
    && (value as { type?: unknown }).type === "dom-class"
    && typeof (value as { className?: unknown }).className === "string");
}
