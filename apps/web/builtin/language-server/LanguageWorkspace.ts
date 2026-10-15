/**
 * Input: @codemirror/lsp-client, @codemirror/state, @codemirror/view, ./LanguageUri
 * Output: LanguageWorkspaceHost, LanguageWorkspaceFile, LanguageWorkspace
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { LSPPlugin, Workspace, type LSPClient, type WorkspaceFile } from "@codemirror/lsp-client";
import { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { normalizeUri } from "./LanguageUri";

// The package declares this shape but does not export its name.
type WorkspaceFileUpdate = ReturnType<Workspace["syncFiles"]>[number];

/**
 * What the workspace needs from the app: read a document that has no editor,
 * and put a document in front of the user. Kept as an interface so the
 * workspace stays free of app imports and is testable on its own.
 */
export interface LanguageWorkspaceHost {
  loadDocument(uri: string): Promise<{ languageId: string; text: string } | null>;
  displayDocument(uri: string): Promise<EditorView | null>;
  /** Called whenever the number of documents the server holds open changes. */
  onOpenCountChange(count: number): void;
}

export class LanguageWorkspaceFile implements WorkspaceFile {
  /** Every editor showing this document — the same file can sit in two tabs. */
  readonly views: EditorView[] = [];

  constructor(
    readonly uri: string,
    readonly languageId: string,
    public version: number,
    public doc: Text,
  ) {}

  getView(main?: EditorView): EditorView | null {
    if (main && this.views.includes(main)) return main;
    return this.views[0] ?? null;
  }
}

/**
 * The client's view of which documents are open.
 *
 * The package's default workspace allows one editor per file. This app shows
 * the same file in several tabs, so the editors of a document are tracked here
 * and the server sees exactly one `didOpen` and one `didClose` per document.
 */
export class LanguageWorkspace extends Workspace {
  files: LanguageWorkspaceFile[] = [];
  private readonly versions = new Map<string, number>();

  constructor(
    client: LSPClient,
    private readonly host: LanguageWorkspaceHost,
  ) {
    super(client);
  }

  override getFile(uri: string): LanguageWorkspaceFile | null {
    const wanted = normalizeUri(uri);
    return this.files.find((file) => file.uri === wanted) ?? null;
  }

  private nextVersion(uri: string): number {
    const version = (this.versions.get(uri) ?? -1) + 1;
    this.versions.set(uri, version);
    return version;
  }

  syncFiles(): readonly WorkspaceFileUpdate[] {
    const updates: WorkspaceFileUpdate[] = [];
    for (const file of this.files) {
      const view = file.views[0];
      const plugin = view ? LSPPlugin.get(view) : null;
      if (!view || !plugin || plugin.unsyncedChanges.empty) continue;
      updates.push({ file, prevDoc: file.doc, changes: plugin.unsyncedChanges });
      file.doc = view.state.doc;
      file.version = this.nextVersion(file.uri);
      // Sibling editors of the same file follow the first one; their own
      // pending changes are the same edit arriving through the vault.
      for (const sibling of file.views) LSPPlugin.get(sibling)?.clear();
    }
    return updates;
  }

  openFile(uri: string, languageId: string, view: EditorView): void {
    const key = normalizeUri(uri);
    const existing = this.getFile(key);
    if (existing) {
      if (!existing.views.includes(view)) existing.views.push(view);
      return;
    }
    const file = new LanguageWorkspaceFile(key, languageId, this.nextVersion(key), view.state.doc);
    file.views.push(view);
    this.add(file);
  }

  closeFile(uri: string, view: EditorView): void {
    const file = this.getFile(uri);
    if (!file) return;
    const index = file.views.indexOf(view);
    if (index >= 0) file.views.splice(index, 1);
    this.removeIfUnused(file);
  }

  /** A document the client only wants to read: never `didOpen`ed. */
  override async requestFile(uri: string): Promise<WorkspaceFile | null> {
    const key = normalizeUri(uri);
    const open = this.getFile(key);
    if (open) return open;
    const loaded = await this.host.loadDocument(key);
    if (!loaded) return null;
    return new LanguageWorkspaceFile(
      key,
      loaded.languageId,
      0,
      Text.of(loaded.text.split(/\r\n?|\n/)),
    );
  }

  override displayFile(uri: string): Promise<EditorView | null> {
    return this.host.displayDocument(normalizeUri(uri));
  }

  private add(file: LanguageWorkspaceFile): void {
    this.files.push(file);
    this.client.didOpen(file);
    this.host.onOpenCountChange(this.files.length);
  }

  private removeIfUnused(file: LanguageWorkspaceFile): void {
    if (file.views.length > 0) return;
    const index = this.files.indexOf(file);
    if (index < 0) return;
    this.files.splice(index, 1);
    this.client.didClose(file.uri);
    this.host.onOpenCountChange(this.files.length);
  }
}
