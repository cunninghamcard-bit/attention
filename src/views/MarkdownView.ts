import { TextFileView } from "./TextFileView";
import { MarkdownPreviewView } from "../markdown/MarkdownPreviewView";
import { MarkdownPreviewRenderer } from "../markdown/MarkdownPreviewRenderer";
import { toggleCheckboxAtLine } from "../markdown/MarkdownTaskList";
import { htmlToMarkdown } from "../markdown/HtmlToMarkdown";
import { preprocessHtmlDrop, type DetachedHtmlImage } from "../markdown/HtmlDropPreprocessor";
import type { FoldInfo } from "../markdown/FoldManager";
import { SimpleEditor, type Editor, type EditorPosition } from "../editor/Editor";
import { EditorViewHost } from "../editor/EditorView";
import { editorEditorField, editorInfoField, editorLivePreviewField } from "../editor/EditorStateField";
import { normalizeEditorExtensions, type EditorExtension } from "../editor/EditorExtension";
import {
  insertFrontmatterProperty,
  deleteFrontmatterProperties,
  mergeFrontmatterProperties,
  parseFrontmatter,
  renameFrontmatterProperty,
  reorderFrontmatterProperty,
  serializeFrontmatterProperties,
  setFrontmatterProperty,
  updateFrontmatter,
} from "./properties/Frontmatter";
import { PropertyTypeMismatchModal } from "./properties/PropertyTypeMismatchModal";
import type { PropertyDefinition, PropertyType, PropertyValue } from "./properties/PropertyTypes";
import { Menu } from "../ui/Menu";
import { Notice } from "../ui/Notice";
import { setIcon } from "../ui/Icon";
import type { HoverPopover } from "../ui/Popover";
import type { DragSource } from "../ui/drag/DragManager";
import type { EditorMenuContext, EditorMenuLinkContext } from "../app/menus/MenuManager";
import { TFile } from "../vault/TAbstractFile";
import { validateRenameName, type RenameValidationResult } from "../vault/FileNameValidation";
import { normalizeViewStatePayload, type ViewStateResult } from "./View";
import { Component } from "../core/Component";
import type { App } from "../app/App";
import type { LinkGraphEdge } from "../metadata/LinkGraph";
import { getAttachmentFilesFromDataTransfer, hasDataTransferAttachmentFiles, splitAttachmentFilename, type AttachmentImportFile } from "../app/AttachmentImport";
import type { Scope } from "../app/hotkeys/Scope";
import { Keymap } from "../app/hotkeys/Keymap";

export type MarkdownViewModeType = "source" | "preview";
export type MarkdownMode = MarkdownViewModeType;
export type MarkdownSourceMode = "source" | "live";

export interface MarkdownViewState extends Record<string, unknown> {
  file?: string;
  mode: MarkdownMode;
  source: boolean;
  backlinks?: boolean;
  backlinkOpts?: unknown;
}

export interface MarkdownSubView {
  getScroll(): number;
  applyScroll(scroll: number): void;
  get(): string;
  set(data: string, clear?: boolean): void;
  getSelection(): string;
}

interface MarkdownViewModeComponent extends MarkdownSubView {
  readonly type: MarkdownMode;
  getFoldInfo(): FoldInfo;
  applyFoldInfo(foldInfo: unknown): void;
  hide(): void;
  show(): void;
  onResize(): void;
  setEphemeralState(state: unknown): void;
  getEphemeralState(): unknown;
  beforeUnload(): void;
  destroy(): void;
}

interface DocumentSearchMatch {
  start: number;
  end: number;
}

export class MarkdownView extends TextFileView {
  static readonly VIEW_TYPE = "markdown";
  readonly editMode: MarkdownEditView;
  readonly previewMode: MarkdownReadingMode;
  readonly preview: MarkdownPreviewView;
  readonly modes: Record<MarkdownMode, MarkdownViewModeComponent>;
  readonly sourceMode: { cmEditor: Editor };
  currentMode: MarkdownViewModeComponent;
  showBacklinks = false;
  editor: Editor = new SimpleEditor();
  hoverPopover: HoverPopover | null = null;
  readonly initialScope: Scope | null;
  readonly editorContainerEl: HTMLElement;
  readonly inlineTitleEl: HTMLElement;
  readonly metadataContainerEl: HTMLElement;
  readonly backlinksEl: HTMLElement;
  readonly previewContainerEl: HTMLElement;
  readonly previewRendererEl: HTMLElement;
  readonly modeButtonEl: HTMLButtonElement;
  backlinks: EmbeddedBacklinks | null = null;
  readonly editorViewHost: EditorViewHost;
  private readonly documentSearchContainerEl: HTMLElement;
  private readonly documentSearchInputEl: HTMLInputElement;
  private readonly documentSearchCountEl: HTMLElement;
  private readonly documentReplaceInputEl: HTMLInputElement;
  private documentSearchMatches: DocumentSearchMatch[] = [];
  private documentSearchIndex = -1;
  private lastHoveredEditorLink: string | null = null;
  private metadataDisplayOrder: string[] | null = null;
  private metadataCollapsed = false;
  private metadataPropertyListEl: HTMLElement | null = null;
  private pendingEmptyProperty = false;
  private readonly sourceFoldLines = new Set<number>();
  private scroll: unknown = null;
  private baseEphemeralState: unknown = {};
  private lastSelectionStart = 0;
  private lastSelectionEnd = 0;
  private readonly selectedMetadataKeys = new Set<string>();

  constructor(...args: ConstructorParameters<typeof TextFileView>) {
    super(...args);
    this.initialScope = this.scope;
    this.preview = new MarkdownPreviewView(this);
    this.contentEl.classList.add("markdown-view", "show-properties");
    this.inlineTitleEl = document.createElement("div");
    this.inlineTitleEl.className = "inline-title";
    this.inlineTitleEl.contentEditable = "true";
    this.inlineTitleEl.spellcheck = this.getSpellcheckEnabled();
    this.inlineTitleEl.autocapitalize = "on";
    this.inlineTitleEl.tabIndex = -1;
    this.inlineTitleEl.addEventListener("focus", () => this.onInlineTitleFocus());
    this.inlineTitleEl.addEventListener("blur", () => void this.onInlineTitleBlur());
    this.inlineTitleEl.addEventListener("input", () => this.onTitleChange(this.inlineTitleEl));
    this.inlineTitleEl.addEventListener("paste", (event) => this.onTitlePaste(this.inlineTitleEl, event));
    this.inlineTitleEl.addEventListener("keydown", (event) => void this.onTitleKeydown(event));
    this.metadataContainerEl = document.createElement("div");
    this.metadataContainerEl.className = "metadata-container";
    this.metadataContainerEl.tabIndex = -1;
    this.metadataContainerEl.dataset.propertyCount = "0";
    this.metadataContainerEl.addEventListener("focusin", (event) => {
      if (![...this.metadataContainerEl.querySelectorAll(".metadata-property")].some((row) => row === event.target)) {
        this.clearMetadataSelection();
      }
    });
    this.metadataContainerEl.addEventListener("copy", (event) => this.handleMetadataCopy(event));
    this.metadataContainerEl.addEventListener("cut", (event) => this.handleMetadataCut(event));
    this.metadataContainerEl.addEventListener("paste", (event) => this.handleMetadataPaste(event));
    this.editorContainerEl = document.createElement("div");
    this.editorContainerEl.className = "markdown-source-view cm-s-obsidian mod-cm6";
    this.editorViewHost = new EditorViewHost(this.editor, this.editorContainerEl);
    const documentSearch = this.createDocumentSearch();
    this.documentSearchContainerEl = documentSearch.containerEl;
    this.documentSearchInputEl = documentSearch.searchInputEl;
    this.documentSearchCountEl = documentSearch.countEl;
    this.documentReplaceInputEl = documentSearch.replaceInputEl;
    // The container is mounted lazily in showSearch(): app.css forces
    // `.document-search-container { display: flex }`, which overrides the
    // `hidden` attribute, so presence in the DOM — not `hidden` — is what
    // gates visibility. Keeping it out until searched avoids a stray find bar
    // sitting at the bottom of every editor.
    this.register(this.editor.onChange((_editor, origin) => this.handleEditorDocumentChange(origin)));
    this.register(this.editor.onSelectionChange(() => this.handleEditorSelectionChange()));
    this.editorViewHost.scrollerEl.addEventListener("contextmenu", (event) => this.handleSourceViewportContextMenu(event));
    this.editorViewHost.contentEl.addEventListener("paste", (event) => void this.handleSourcePaste(event), { capture: true });
    this.editorViewHost.contentEl.addEventListener("dragover", (event) => this.handleSourceDragOver(event), { capture: true });
    this.editorViewHost.contentEl.addEventListener("drop", (event) => void this.handleSourceDrop(event), { capture: true });
    this.sourceMode = { cmEditor: this.editor };
    this.editorViewHost.contentEl.addEventListener("keydown", (event) => void this.handleEditorSuggest(event));
    this.editorViewHost.contentEl.addEventListener("keyup", (event) => void this.handleSourceKeyup(event));
    this.editorViewHost.contentEl.addEventListener("mouseup", () => this.handleSourceSelectionChange());
    this.editorViewHost.contentEl.addEventListener("click", (event) => this.handleSourceClick(event));
    this.editorViewHost.contentEl.addEventListener("mousedown", (event) => this.handleSourceClick(event));
    this.editorViewHost.contentEl.addEventListener("contextmenu", (event) => this.handleSourceContextMenu(event));
    this.editorViewHost.contentEl.addEventListener("mousemove", (event) => this.handleSourceHover(event));
    this.editorViewHost.contentEl.addEventListener("mouseleave", () => {
      this.lastHoveredEditorLink = null;
    });
    this.editorViewHost.contentEl.addEventListener("focus", () => this.syncActiveEditor());
    this.backlinksEl = document.createElement("div");
    this.backlinksEl.className = "embedded-backlinks";
    this.backlinksEl.hidden = true;
    this.previewContainerEl = document.createElement("div");
    this.previewContainerEl.className = "markdown-reading-view";
    this.previewRendererEl = document.createElement("div");
    this.previewRendererEl.className = "markdown-preview-view markdown-rendered";
    this.previewContainerEl.appendChild(this.previewRendererEl);
    this.contentEl.append(this.editorContainerEl, this.previewContainerEl);
    this.editMode = new MarkdownEditView(this);
    this.previewMode = new MarkdownReadingMode(this);
    this.modes = {
      source: this.editMode,
      preview: this.previewMode,
    };
    this.editMode.sourceMode = !Boolean(this.app.vault.getConfig("livePreview"));
    const defaultMode = this.app.vault.getConfig("defaultViewMode");
    this.currentMode = defaultMode === "preview" ? this.previewMode : this.editMode;
    for (const mode of Object.values(this.modes)) mode.hide();
    this.syncModeClasses();
    this.currentMode.show();

    this.modeButtonEl = document.createElement("button");
    this.modeButtonEl.className = "view-action clickable-icon markdown-toggle-view";
    this.modeButtonEl.type = "button";
    this.modeButtonEl.addEventListener("click", (event) => void this.onSwitchView(event));
    this.actionsEl.append(this.modeButtonEl);
    this.updateModeButton();
  }

  getViewType(): string {
    return MarkdownView.VIEW_TYPE;
  }

  replaceScope(scope?: Scope | null): void {
    this.scope = scope ?? this.initialScope;
  }

  getFile(): TFile | null {
    return this.file;
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "md";
  }

  getMode(): MarkdownViewModeType {
    return this.currentMode.type;
  }

  getHoverSource(): "editor" | "preview" {
    return this.currentMode === this.editMode ? "editor" : "preview";
  }

  undo(): void {
    this.editor.undo();
  }

  redo(): void {
    this.editor.redo();
  }

  saveFrontmatter(update: (frontmatter: Record<string, PropertyValue>) => void): Promise<void> {
    this.setViewData(updateFrontmatter(this.getViewData(), update), false);
    return this.save();
  }

  onConfigChanged(key: string): void {
    if (key === "spellcheck") this.inlineTitleEl.spellcheck = this.getSpellcheckEnabled();
  }

  getSourceMode(): MarkdownSourceMode {
    return this.editMode.getSourceMode();
  }

  toggleMode(): void {
    const viewState = this.leaf.getViewState();
    viewState.state = { ...(viewState.state ?? {}), mode: this.getMode() === "preview" ? "source" : "preview" };
    void this.leaf.setViewState(viewState, { focus: true });
  }

  async onSwitchView(event: MouseEvent): Promise<void> {
    event.preventDefault();
    const state = this.getState();
    state.mode = this.getMode() === "preview" ? "source" : "preview";
    let leaf = this.leaf;
    const viewState = { type: MarkdownView.VIEW_TYPE, state };
    if (Keymap.isModEvent(event)) {
      leaf = this.app.workspace.createLeafBySplit(this.leaf);
      await leaf.setViewState({ ...viewState, active: true, group: this.leaf }, { focus: true });
      return;
    }
    await leaf.setViewState(viewState, { focus: true });
  }

  getState(): MarkdownViewState {
    return {
      ...(this.file ? { file: this.file.path } : {}),
      mode: this.getMode(),
      source: this.editMode.sourceMode,
      backlinks: this.showBacklinks,
      ...(this.backlinks ? { backlinkOpts: this.backlinks.getState() } : {}),
    };
  }

  canToggleBacklinks(): boolean {
    return true;
  }

  toggleBacklinks(): void {
    this.showBacklinks = !this.showBacklinks;
    this.updateShowBacklinks();
    this.leaf.history.pushState();
    this.app.workspace.requestUpdateLayout();
  }

  override getViewData(): string {
    return this.currentMode?.get() ?? super.getViewData();
  }

  showSearch(replace = false): void {
    this.mountDocumentSearchContainer();
    this.documentSearchContainerEl.hidden = false;
    this.documentSearchContainerEl.classList.toggle("mod-replace-mode", replace);
    this.editorContainerEl.classList.add("is-searching");
    this.editorContainerEl.classList.toggle("is-replacing", replace);
    this.updateDocumentSearchMatches();
    this.documentSearchInputEl.focus();
    this.documentSearchInputEl.select();
  }

  async setMode(mode: MarkdownMode | MarkdownViewModeComponent, source?: boolean, options: { saveFold?: boolean } = {}): Promise<boolean> {
    const nextMode = typeof mode === "string" ? this.modes[mode] : mode;
    if (!nextMode) return false;
    const nextSourceMode = typeof source === "boolean" ? sourceToMode(source) : this.getSourceMode();
    const modeChanged = this.currentMode !== nextMode;
    const sourceChanged = this.getSourceMode() !== nextSourceMode;
    if (!modeChanged && !sourceChanged) return false;
    const foldInfo = this.currentMode.getFoldInfo();
    if (modeChanged && this.currentMode.type === "source") void this.save();
    if (modeChanged && options.saveFold !== false) {
      this.app.foldManager.save(this.file, foldInfo);
    }
    if (sourceChanged) {
      this.editMode.setSourceMode(nextSourceMode);
      this.updateOptions();
    }
    if (modeChanged) {
      this.activateMode(nextMode);
      this.currentMode.applyFoldInfo(foldInfo);
    }
    this.render();
    this.app.workspace.requestSaveLayout();
    return true;
  }

  setSourceMode(mode: MarkdownSourceMode): void {
    void this.setMode("source", mode === "source");
  }

  override onPaneMenu(menu: Menu, source?: string): void {
    super.onPaneMenu(menu, source);
    const mode = this.getMode();
    menu.addItem((item) => item
      .setSection("pane")
      .setTitle("Toggle reading view")
      .setIcon("lucide-book-open")
      .setChecked(mode === "preview")
      .onClick(() => {
        this.toggleMode();
      }));
    if (mode === "source") {
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle("Toggle source mode")
        .setIcon("lucide-code-2")
        .setChecked(this.getSourceMode() === "source")
        .onClick(() => {
          this.setSourceMode(this.getSourceMode() === "source" ? "live" : "source");
        }));
    }
  }

  private activateMode(mode: MarkdownViewModeComponent): void {
    const data = this.getViewData();
    if (this.currentMode !== mode) this.currentMode.hide();
    this.currentMode = mode;
    this.currentMode.show();
    this.currentMode.set(data, false);
    this.currentMode.onResize();
  }

  setViewData(data: string, clearDirty = false): void {
    super.setViewData(data, clearDirty);
    if (clearDirty) {
      this.scroll = null;
      this.sourceFoldLines.clear();
      for (const mode of Object.values(this.modes)) mode.set(data, true);
      const foldInfo = this.app.foldManager.get(this.file);
      this.currentMode.applyFoldInfo(foldInfo);
    } else {
      this.currentMode.set(data, false);
    }
    this.render();
  }

  override clear(): void {
    super.clear();
    this.scroll = null;
    this.metadataDisplayOrder = null;
    this.metadataCollapsed = false;
    this.sourceFoldLines.clear();
    this.pendingEmptyProperty = false;
    this.selectedMetadataKeys.clear();
    this.documentSearchMatches = [];
    this.documentSearchIndex = -1;
    for (const mode of Object.values(this.modes)) {
      mode.set("", true);
      mode.applyFoldInfo({ folds: [], lines: 1 });
    }
    this.render();
    this.updateDocumentSearchMatches();
  }

  getFoldInfo(): FoldInfo {
    return this.currentMode.getFoldInfo();
  }

  canToggleFoldProperties(): boolean {
    return getFrontmatterLineCount(this.getViewData()) > 0;
  }

  toggleFoldProperties(): boolean {
    if (!this.canToggleFoldProperties()) return false;
    this.metadataCollapsed = !this.metadataCollapsed;
    this.render();
    this.onMarkdownFold();
    return true;
  }

  canToggleFoldAtCursor(): boolean {
    return Boolean(getSourceFoldRangeAtLine(this.getViewData(), this.editor.getCursor().line));
  }

  toggleFoldAtCursor(): boolean {
    const range = getSourceFoldRangeAtLine(this.getViewData(), this.editor.getCursor().line);
    if (!range) return false;
    if (this.sourceFoldLines.has(range.from)) this.sourceFoldLines.delete(range.from);
    else this.sourceFoldLines.add(range.from);
    this.render();
    this.onMarkdownFold();
    return true;
  }

  foldAll(): boolean {
    if (this.getMode() === "preview") {
      this.previewMode.foldAll();
      this.onMarkdownFold();
      return true;
    }
    const ranges = getSourceFoldRanges(this.getViewData());
    if (ranges.length === 0 && !this.canToggleFoldProperties()) return false;
    for (const range of ranges) this.sourceFoldLines.add(range.from);
    if (this.canToggleFoldProperties()) this.metadataCollapsed = true;
    this.render();
    this.onMarkdownFold();
    return true;
  }

  unfoldAll(): boolean {
    if (this.getMode() === "preview") {
      this.previewMode.unfoldAll();
      this.onMarkdownFold();
      return true;
    }
    const hadFolds = this.sourceFoldLines.size > 0 || this.metadataCollapsed;
    this.sourceFoldLines.clear();
    this.metadataCollapsed = false;
    this.render();
    this.onMarkdownFold();
    return hadFolds;
  }

  foldMore(): boolean {
    const source = this.getViewData();
    const cursorLine = this.editor.getCursor().line;
    const ranges = getSourceFoldRanges(source);
    const target = ranges.find((range) => range.from <= cursorLine && range.to >= cursorLine && !this.sourceFoldLines.has(range.from))
      ?? ranges.find((range) => !this.sourceFoldLines.has(range.from));
    if (!target) return false;
    this.sourceFoldLines.add(target.from);
    this.render();
    this.onMarkdownFold();
    return true;
  }

  foldLess(): boolean {
    if (this.sourceFoldLines.size === 0) return false;
    const cursorLine = this.editor.getCursor().line;
    const ranges = getSourceFoldRanges(this.getViewData());
    const foldedRanges = ranges.filter((range) => this.sourceFoldLines.has(range.from));
    const target = [...foldedRanges]
      .sort((left, right) => (right.from - left.from) || (left.to - right.to))
      .find((range) => range.from <= cursorLine && range.to >= cursorLine)
      ?? foldedRanges[foldedRanges.length - 1];
    if (!target) return false;
    this.sourceFoldLines.delete(target.from);
    this.render();
    this.onMarkdownFold();
    return true;
  }

  getEditFoldInfo(): FoldInfo {
    const source = this.getViewData();
    const parsed = parseFrontmatter(source);
    const folds: Array<{ from: number; to: number }> = [];
    if (parsed.valid && Object.keys(parsed.values).length > 0 && this.metadataCollapsed) {
      folds.push({ from: 0, to: 0 });
    }
    for (const line of this.sourceFoldLines) {
      const range = getSourceFoldRangeAtLine(source, line);
      if (range) folds.push(range);
    }
    return { folds, lines: countLines(source) };
  }

  getPreviewFoldInfo(): FoldInfo {
    const source = this.getViewData();
    const parsed = parseFrontmatter(source);
    const folds: Array<{ from: number; to: number }> = [];
    if (parsed.valid && Object.keys(parsed.values).length > 0 && this.metadataContainerEl.classList.contains("is-collapsed")) {
      folds.push({ from: 0, to: getFrontmatterLineCount(source) });
    }
    return { folds, lines: countLines(source) };
  }

  applyFoldInfo(foldInfo: unknown): void {
    if (!foldInfo || typeof foldInfo !== "object" || !Array.isArray((foldInfo as { folds?: unknown }).folds)) return;
    this.sourceFoldLines.clear();
    const source = this.getViewData();
    const frontmatterLines = getFrontmatterLineCount(source);
    let metadataCollapsed = false;
    for (const fold of (foldInfo as { folds: Array<{ from?: unknown; to?: unknown }> }).folds) {
      const from = Number(fold.from);
      const to = Number(fold.to);
      if (!Number.isFinite(from)) continue;
      if (from === 0 && frontmatterLines > 0 && (!Number.isFinite(to) || to === 0 || to === frontmatterLines)) {
        metadataCollapsed = true;
        continue;
      }
      this.sourceFoldLines.add(from);
    }
    this.metadataCollapsed = metadataCollapsed;
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("property-change", (path: string) => {
      if (path === this.file?.path) this.renderProperties();
    }));
    this.registerEvent(this.app.metadataCache.on("changed", (file: TFile) => {
      if (file.path === this.file?.path) this.renderProperties();
    }));
    this.registerEvent(this.app.vault.on("config-changed", (key: string) => {
      if (key === "propertiesInDocument") this.render();
      if (key === "readableLineLength" || key === "showLineNumber") this.updateOptions();
      if (key === "spellcheck") this.onConfigChanged(key);
    }));
    this.updateOptions();
    this.syncActiveEditor();
    this.render();
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.inlineTitleEl.textContent = this.getDisplayText();
    await super.onLoadFile(file);
    this.updateBacklinks();
  }

  override async onUnloadFile(file: TFile): Promise<void> {
    this.onMarkdownFold();
    this.currentMode.beforeUnload();
    this.metadataContainerEl.replaceChildren();
    this.metadataContainerEl.dataset.propertyCount = "0";
    this.metadataContainerEl.classList.remove("mod-error");
    this.metadataContainerEl.classList.remove("mod-empty");
    this.metadataPropertyListEl = null;
    await super.onUnloadFile(file);
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    let changedModeState = false;
    let targetMode: MarkdownViewModeComponent | null = null;
    if (state && typeof state === "object" && "mode" in state) {
      const mode = (state as { mode?: unknown }).mode;
      if ((mode === "source" || mode === "preview") && this.currentMode !== this.modes[mode]) {
        targetMode = this.modes[mode];
        changedModeState = true;
      }
    }
    if (state && typeof state === "object" && "source" in state) {
      const source = (state as { source?: unknown }).source;
      if (typeof source === "boolean" && this.editMode.sourceMode !== source) {
        this.editMode.toggleSource();
        changedModeState = true;
      }
    }
    if (state && typeof state === "object" && "backlinks" in state) {
      const backlinks = (state as { backlinks?: unknown }).backlinks;
      if (typeof backlinks === "boolean") {
        this.showBacklinks = backlinks;
        this.updateShowBacklinks();
      }
    }
    if (state && typeof state === "object" && "backlinkOpts" in state) {
      const backlinkOpts = (state as { backlinkOpts?: unknown }).backlinkOpts;
      if (backlinkOpts && typeof backlinkOpts === "object" && this.backlinks) void this.backlinks.setState(backlinkOpts);
    }
    if (changedModeState && result) (result as { layout?: boolean }).layout = true;
    if (targetMode) await this.setMode(targetMode, undefined, { saveFold: false });
    await super.setState(state, result);
    this.currentMode.applyFoldInfo(this.app.foldManager.get(this.file));
    this.render();
    this.updateOptions();
    this.syncActiveEditor();
  }

  async onClose(): Promise<void> {
    await super.onClose();
    this.currentMode.beforeUnload();
    this.editMode.destroy();
    this.previewMode.destroy();
    this.editorViewHost.destroy();
    this.app.workspace.unsetActiveEditor(this);
  }

  override handleCopy(event: ClipboardEvent): void {
    this.handleMetadataCopy(event);
  }

  override handlePaste(event: ClipboardEvent): void {
    this.handleMetadataPaste(event);
  }

  override handleCut(event: ClipboardEvent): void {
    this.handleMetadataCut(event);
  }

  getSelection(): string {
    return this.currentMode.getSelection();
  }

  triggerClickableToken(
    token: { type: string; text?: string; linktext?: string; href?: string; id?: string },
    target?: boolean | string,
  ): void {
    if (token.type === "internal-link") {
      const linktext = token.text ?? token.linktext;
      if (linktext) setTimeout(() => void this.app.workspace.openLinkText(linktext, this.file?.path ?? "", target as never), 100);
      return;
    }
    if (token.type === "external-link" || token.type === "external-ref-link") {
      const href = this.getClickableTokenHref(token);
      if (!href) return;
      if (target === true) window.open(href, "tab");
      else if (target === false || target == null) window.open(href);
      else window.open(href, target);
      return;
    }
    if (token.type === "tag") {
      const text = token.text ?? token.linktext;
      if (!text) return;
      const tag = text.startsWith("#") ? text : `#${text}`;
      const plugin = this.app.internalPlugins.getEnabledPluginById<{ openGlobalSearch?: (query: string) => void }>("global-search");
      plugin?.openGlobalSearch?.(`tag:${tag}`);
    }
  }

  getClickableTokenHref(token: { type: string; text?: string; linktext?: string; href?: string; id?: string }): string | null {
    if (token.type === "external-link") return token.href ?? token.text ?? token.linktext ?? null;
    if (token.type === "external-ref-link") return this.getExternalRefLinkHref(token.text ?? token.id ?? "");
    return null;
  }

  insertText(text: string): void {
    this.replaceSelection(text);
  }

  insertWikilink(embed = false): void {
    const selection = this.editor.getSelection();
    const prefix = `${embed ? "!" : ""}[[`;
    const replacement = `${prefix}${selection}]]`;
    this.replaceEditorSelection(replacement, prefix.length + selection.length);
  }

  insertMarkdownLink(): void {
    const selection = this.editor.getSelection();
    const replacement = `[${selection}]()`;
    this.replaceEditorSelection(replacement, selection.length + 2);
  }

  insertTagAtCursor(): void {
    const source = this.editor.getValue();
    const start = this.editor.posToOffset(this.editor.getCursor("from"));
    this.syncSourceValue(source);
    this.applyTextEdits([{ start, end: start, text: "#" }], start + 1);
  }

  setHeading(level: 0 | 1 | 2 | 3 | 4 | 5 | 6): void {
    const source = this.editor.getValue();
    const lines = source.split("\n");
    const from = this.editor.getCursor("from");
    const to = this.editor.getCursor("to");
    const lastLine = to.ch === 0 && to.line > from.line ? to.line - 1 : to.line;
    const multipleLines = from.line !== to.line;
    let offset = 0;
    const lineStarts = lines.map((line) => {
      const start = offset;
      offset += line.length + 1;
      return start;
    });
    const edits: Array<{ start: number; end: number; text: string }> = [];
    for (let lineNo = from.line; lineNo <= lastLine; lineNo += 1) {
      const line = lines[lineNo] ?? "";
      if (multipleLines && line.trim() === "") continue;
      const match = line.match(/^([>\s]*)(#{1,6} )?(.*)/);
      const prefix = match?.[1] ?? "";
      const body = match?.[3] ?? line;
      const text = level === 0 ? `${prefix}${body}` : `${prefix}${"#".repeat(level)} ${body}`;
      const start = lineStarts[lineNo] ?? source.length;
      edits.push({ start, end: start + line.length, text });
    }
    this.syncSourceValue(source);
    this.applyTextEdits(edits, lineStarts[from.line] ?? 0);
  }

  toggleMarkdownFormatting(kind: "bold" | "italic" | "strikethrough" | "highlight" | "code" | "math"): void {
    const markers = {
      bold: ["**", "__"],
      italic: ["*", "_"],
      strikethrough: ["~~"],
      highlight: ["=="],
      code: ["`"],
      math: ["$"],
    }[kind];
    this.toggleWrappedSelection(markers[0], markers.slice(1));
  }

  toggleComment(): void {
    const source = this.editor.getValue();
    let start = this.editor.posToOffset(this.editor.getCursor("from"));
    let end = this.editor.posToOffset(this.editor.getCursor("to"));
    if (start === end) {
      const word = this.getWordRangeAt(source, start);
      if (word) {
        start = word.start;
        end = word.end;
      } else {
        this.syncSourceValue(source);
        this.applyTextEdits([{ start, end, text: "%%  %%" }], start + 3);
        return;
      }
    }
    const selection = source.slice(start, end);
    if (selection.startsWith("%% ") && selection.endsWith(" %%") && selection.length >= 6) {
      const text = selection.slice(3, -3);
      this.syncSourceValue(source);
      this.applyTextEdits([{ start, end, text }], start, start + text.length);
      return;
    }
    if (source.slice(start - 3, start) === "%% " && source.slice(end, end + 3) === " %%") {
      this.syncSourceValue(source);
      this.applyTextEdits([{ start: start - 3, end: end + 3, text: selection }], start - 3, end - 3);
      return;
    }
    const text = `%% ${selection} %%`;
    this.syncSourceValue(source);
    this.applyTextEdits([{ start, end, text }], start + 3, start + 3 + selection.length);
  }

  clearMarkdownFormatting(): void {
    const source = this.editor.getValue();
    const start = this.editor.posToOffset(this.editor.getCursor("from"));
    const end = this.editor.posToOffset(this.editor.getCursor("to"));
    if (start === end) return;
    const selection = source.slice(start, end);
    const cleared = selection
      .replace(/^([>\s]*)#{1,6} /gm, "$1")
      .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
      .replace(/__([\s\S]*?)__/g, "$1")
      .replace(/~~([\s\S]*?)~~/g, "$1")
      .replace(/==([\s\S]*?)==/g, "$1")
      .replace(/`([^`\n]*)`/g, "$1")
      .replace(/\$([^$\n]*)\$/g, "$1")
      .replace(/%%\s?([\s\S]*?)\s?%%/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/_([^_\n]+)_/g, "$1");
    this.syncSourceValue(source);
    this.applyTextEdits([{ start, end, text: cleared }], start, start + cleared.length);
  }

  toggleBlockquote(): void {
    const ctx = this.getSelectedLineContext();
    const rows = this.getSelectedRows(ctx, { includeEmpty: true }).map((row) => ({ ...row, quoteLength: this.getBlockquotePrefixLength(row.line) }));
    const shouldAdd = rows.some((row) => row.quoteLength === 0);
    const edits = rows
      .map((row) => {
        if (shouldAdd) return row.quoteLength === 0 ? { start: row.start, end: row.start, text: "> " } : null;
        return { start: row.start, end: row.start + row.quoteLength, text: "" };
      })
      .filter((edit): edit is { start: number; end: number; text: string } => edit !== null);
    this.syncSourceValue(ctx.source);
    this.applyTextEdits(edits, ctx.lineStarts[ctx.fromLine] ?? 0);
  }

  toggleBulletList(): void {
    const ctx = this.getSelectedLineContext();
    const rows = this.getSelectedRows(ctx).map((row) => ({ ...row, list: this.parseListPrefix(row.line) }));
    const shouldAdd = rows.some((row) => !row.list.bullet || row.list.ordered || row.list.check !== undefined);
    const edits = rows.map((row) => ({
      start: row.start,
      end: row.start + row.list.markerLength,
      text: `${row.list.prefix}${shouldAdd ? "- " : ""}`,
    }));
    this.syncSourceValue(ctx.source);
    this.applyTextEdits(edits, ctx.lineStarts[ctx.fromLine] ?? 0);
  }

  toggleNumberList(): void {
    const ctx = this.getSelectedLineContext();
    const rows = this.getSelectedRows(ctx).map((row) => ({ ...row, list: this.parseListPrefix(row.line) }));
    const shouldAdd = rows.some((row) => !row.list.ordered);
    const edits = rows.map((row) => ({
      start: row.start,
      end: row.start + row.list.markerLength,
      text: `${row.list.prefix}${shouldAdd ? "1. " : ""}`,
    }));
    this.syncSourceValue(ctx.source);
    this.applyTextEdits(edits, ctx.lineStarts[ctx.fromLine] ?? 0);
  }

  toggleCheckList(cycle = false): void {
    const ctx = this.getSelectedLineContext();
    const rows = this.getSelectedRows(ctx).map((row) => ({ ...row, list: this.parseListPrefix(row.line) }));
    let mode = 3;
    for (const row of rows) {
      if (mode > 2 && row.list.check === " ") mode = 2;
      if (mode > 1 && row.list.check === undefined) mode = 1;
      if (cycle && mode > 0 && !row.list.bullet) mode = 0;
    }
    const edits = rows.map((row) => {
      const listMarker = row.list.bullet || "- ";
      const base = `${row.list.prefix}${listMarker}`;
      let text = base;
      if (mode === 1 && row.list.check === undefined) text = `${base}[ ] `;
      else if (mode === 2) text = `${base}[x] `;
      else if (mode === 3) text = cycle ? base : `${base}[ ] `;
      return { start: row.start, end: row.start + row.list.markerLength, text };
    });
    this.syncSourceValue(ctx.source);
    this.applyTextEdits(edits, ctx.lineStarts[ctx.fromLine] ?? 0);
  }

  insertCallout(): void {
    const ctx = this.getSelectedLineContext();
    const from = this.editor.getCursor("from");
    const to = this.editor.getCursor("to");
    const hasSelection = from.line !== to.line || from.ch !== to.ch;
    const cursorOffset = this.editor.posToOffset(from);
    const lineBeforeCursor = ctx.lines[ctx.fromLine]?.slice(0, from.ch) ?? "";
    if (!hasSelection && lineBeforeCursor.trim() === "") {
      const text = "\n> [!NOTE] Title\n> Contents\n";
      const noteStart = cursorOffset + text.indexOf("NOTE");
      this.syncSourceValue(ctx.source);
      this.applyTextEdits([{ start: cursorOffset, end: this.editor.posToOffset(to), text }], noteStart, noteStart + 4);
      return;
    }
    const edits: Array<{ start: number; end: number; text: string }> = [];
    const needsBlankBefore = ctx.fromLine > 0 && (ctx.lines[ctx.fromLine - 1] ?? "").trim() !== "";
    const firstText = `${needsBlankBefore ? "\n" : ""}> [!NOTE]\n> `;
    const firstStart = ctx.lineStarts[ctx.fromLine] ?? 0;
    edits.push({ start: firstStart, end: firstStart, text: firstText });
    for (let lineNo = ctx.fromLine + 1; lineNo <= ctx.toLine; lineNo += 1) {
      const start = ctx.lineStarts[lineNo] ?? ctx.source.length;
      edits.push({ start, end: start, text: "> " });
    }
    if (ctx.toLine < ctx.lines.length - 1 && (ctx.lines[ctx.toLine + 1] ?? "").trim() !== "") {
      const nextStart = ctx.lineStarts[ctx.toLine + 1] ?? ctx.source.length;
      edits.push({ start: nextStart, end: nextStart, text: "\n" });
    }
    const noteStart = firstStart + firstText.indexOf("NOTE");
    this.syncSourceValue(ctx.source);
    this.applyTextEdits(edits, noteStart, noteStart + 4);
  }

  insertCodeblock(): void {
    this.insertBlock("```", "```");
  }

  insertMathBlock(): void {
    this.insertBlock("$$", "$$");
  }

  insertHorizontalRule(): void {
    const source = this.editor.getValue();
    const from = this.editor.getCursor("from");
    const start = this.editor.posToOffset(from);
    const end = this.editor.posToOffset(this.editor.getCursor("to"));
    const text = `${from.ch > 0 ? "\n\n" : "\n"}---\n`;
    this.syncSourceValue(source);
    this.applyTextEdits([{ start, end, text }], start + text.length);
  }

  insertFootnote(): void {
    const source = this.editor.getValue();
    const start = this.editor.posToOffset(this.editor.getCursor("from"));
    const id = this.getNextFootnoteId(source);
    const ref = `[^${id}]`;
    const trailingNewlines = source.match(/\n*$/)?.[0].length ?? 0;
    const separator = "\n".repeat(2 - Math.min(trailingNewlines, 2));
    this.syncSourceValue(source);
    this.applyTextEdits(
      [
        { start: source.length, end: source.length, text: `${separator}${ref}: \n` },
        { start, end: start, text: ref },
      ],
      start + ref.length,
    );
  }

  insertTable(): void {
    const source = this.editor.getValue();
    const cursor = this.editor.getCursor("from");
    const ctx = this.getSelectedLineContext(source);
    const line = ctx.lines[cursor.line] ?? "";
    let start = this.editor.posToOffset(cursor);
    let prefix = "\n";
    if (line.length > 0) {
      start = (ctx.lineStarts[cursor.line] ?? start) + line.length;
      prefix = "\n\n";
    }
    const text = `${prefix}| | |\n| --- | --- |\n| | |\n`;
    this.syncSourceValue(source);
    this.applyTextEdits([{ start, end: start, text }], start + prefix.length + 1);
  }

  indentList(): void {
    this.applyLineIndent("\t");
  }

  unindentList(): void {
    const ctx = this.getSelectedLineContext();
    const edits = this.getSelectedRows(ctx).flatMap((row) => {
      const removable = row.line.startsWith("\t") ? 1 : Math.min(row.line.match(/^ {1,4}/)?.[0].length ?? 0, 4);
      return removable > 0 ? [{ start: row.start, end: row.start + removable, text: "" }] : [];
    });
    this.syncSourceValue(ctx.source);
    this.applyTextEdits(edits, ctx.lineStarts[ctx.fromLine] ?? 0);
  }

  replaceSelection(text: string): void {
    const source = this.editor.getValue();
    const start = this.getSourceSelectionStart();
    const end = this.getSourceSelectionEnd();
    const next = `${source.slice(0, start)}${text}${source.slice(end)}`;
    super.setViewData(next);
    this.editor.setValue(next);
    const cursor = start + text.length;
    this.setSourceSelectionRange(cursor, cursor);
    this.triggerEditorContentChange();
    this.scheduleSave();
  }

  private replaceEditorSelection(text: string, relativeSelectionStart = text.length, relativeSelectionEnd = relativeSelectionStart): void {
    const source = this.editor.getValue();
    const start = this.editor.posToOffset(this.editor.getCursor("from"));
    const end = this.editor.posToOffset(this.editor.getCursor("to"));
    this.syncSourceValue(source);
    this.applyTextEdits([{ start, end, text }], start + relativeSelectionStart, start + relativeSelectionEnd);
  }

  private toggleWrappedSelection(marker: string, alternateMarkers: string[] = []): void {
    const source = this.editor.getValue();
    let start = this.editor.posToOffset(this.editor.getCursor("from"));
    let end = this.editor.posToOffset(this.editor.getCursor("to"));
    if (start === end) {
      const word = this.getWordRangeAt(source, start);
      if (word) {
        start = word.start;
        end = word.end;
      } else {
        const text = `${marker}${marker}`;
        this.syncSourceValue(source);
        this.applyTextEdits([{ start, end, text }], start + marker.length);
        return;
      }
    }
    const markers = [marker, ...alternateMarkers];
    const selection = source.slice(start, end);
    for (const candidate of markers) {
      if (selection.startsWith(candidate) && selection.endsWith(candidate) && selection.length >= candidate.length * 2) {
        const text = selection.slice(candidate.length, selection.length - candidate.length);
        this.syncSourceValue(source);
        this.applyTextEdits([{ start, end, text }], start, start + text.length);
        return;
      }
      if (source.slice(start - candidate.length, start) === candidate && source.slice(end, end + candidate.length) === candidate) {
        this.syncSourceValue(source);
        this.applyTextEdits([{ start: start - candidate.length, end: end + candidate.length, text: selection }], start - candidate.length, end - candidate.length);
        return;
      }
    }
    const leading = selection.match(/^\s*/)?.[0].length ?? 0;
    const trailing = selection.match(/\s*$/)?.[0].length ?? 0;
    const contentStart = start + leading;
    const contentEnd = Math.max(contentStart, end - trailing);
    const content = source.slice(contentStart, contentEnd);
    const text = `${marker}${content}${marker}`;
    this.syncSourceValue(source);
    this.applyTextEdits([{ start: contentStart, end: contentEnd, text }], contentStart + marker.length, contentStart + marker.length + content.length);
  }

  private getWordRangeAt(source: string, offset: number): { start: number; end: number } | null {
    const isWord = (char: string) => /[\p{L}\p{N}_-]/u.test(char);
    let start = offset;
    let end = offset;
    while (start > 0 && isWord(source[start - 1] ?? "")) start -= 1;
    while (end < source.length && isWord(source[end] ?? "")) end += 1;
    return start === end ? null : { start, end };
  }

  private getSelectedLineContext(source = this.editor.getValue()): {
    source: string;
    lines: string[];
    lineStarts: number[];
    fromLine: number;
    toLine: number;
    multipleLines: boolean;
  } {
    const lines = source.split("\n");
    let offset = 0;
    const lineStarts = lines.map((line) => {
      const start = offset;
      offset += line.length + 1;
      return start;
    });
    const from = this.editor.getCursor("from");
    const to = this.editor.getCursor("to");
    const maxLine = Math.max(0, lines.length - 1);
    const fromLine = Math.max(0, Math.min(from.line, maxLine));
    const toLine = Math.max(fromLine, Math.min(to.ch === 0 && to.line > from.line ? to.line - 1 : to.line, maxLine));
    return { source, lines, lineStarts, fromLine, toLine, multipleLines: from.line !== to.line };
  }

  private getSelectedRows(
    ctx: ReturnType<MarkdownView["getSelectedLineContext"]>,
    options: { includeEmpty?: boolean } = {},
  ): Array<{ lineNo: number; line: string; start: number }> {
    const rows: Array<{ lineNo: number; line: string; start: number }> = [];
    for (let lineNo = ctx.fromLine; lineNo <= ctx.toLine; lineNo += 1) {
      const line = ctx.lines[lineNo] ?? "";
      if (ctx.multipleLines && !options.includeEmpty && line.trim() === "") continue;
      rows.push({ lineNo, line, start: ctx.lineStarts[lineNo] ?? ctx.source.length });
    }
    return rows;
  }

  private parseListPrefix(line: string): { prefix: string; markerLength: number; bullet?: string; ordered?: string; check?: string } {
    const match = line.match(/^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/);
    return {
      prefix: match?.[1] ?? "",
      markerLength: match?.[0].length ?? 0,
      bullet: match?.[3],
      ordered: match?.[4],
      check: match?.[6],
    };
  }

  private getBlockquotePrefixLength(line: string): number {
    const match = line.match(/^\s{0,3}>(\s*)/);
    if (!match) return 0;
    return match[0].length - Math.max(0, match[1].length - 1);
  }

  private insertBlock(open: string, close: string): void {
    const ctx = this.getSelectedLineContext();
    const from = this.editor.posToOffset(this.editor.getCursor("from"));
    const to = this.editor.posToOffset(this.editor.getCursor("to"));
    const start = ctx.lineStarts[ctx.fromLine] ?? 0;
    const end = (ctx.lineStarts[ctx.toLine] ?? ctx.source.length) + (ctx.lines[ctx.toLine] ?? "").length;
    const shift = open.length + 1;
    this.syncSourceValue(ctx.source);
    this.applyTextEdits(
      [
        { start, end: start, text: `${open}\n` },
        { start: end, end, text: `\n${close}` },
      ],
      from + shift,
      to + shift,
    );
  }

  private applyLineIndent(text: string): void {
    const ctx = this.getSelectedLineContext();
    const edits = this.getSelectedRows(ctx).map((row) => ({ start: row.start, end: row.start, text }));
    this.syncSourceValue(ctx.source);
    this.applyTextEdits(edits, (ctx.lineStarts[ctx.fromLine] ?? 0) + text.length);
  }

  private getNextFootnoteId(source: string): number {
    let max = 0;
    for (const match of source.matchAll(/\[\^(\d+)\]/g)) max = Math.max(max, Number(match[1]));
    return max + 1;
  }

  applyTextEdits(edits: Array<{ start: number; end: number; text: string }>, selectionStart: number, selectionEnd = selectionStart): void {
    const source = this.editor.getValue();
    const sorted = [...edits]
      .filter((edit) => edit.start <= edit.end)
      .sort((a, b) => b.start - a.start);
    let next = source;
    for (const edit of sorted) {
      const start = Math.max(0, Math.min(next.length, edit.start));
      const end = Math.max(start, Math.min(next.length, edit.end));
      next = `${next.slice(0, start)}${edit.text}${next.slice(end)}`;
    }
    super.setViewData(next);
    this.editor.setValue(next);
    const from = Math.max(0, Math.min(next.length, selectionStart));
    const to = Math.max(from, Math.min(next.length, selectionEnd));
    this.setSourceSelectionRange(from, to);
    this.triggerEditorContentChange();
    this.scheduleSave();
  }

  onCheckboxClick(event: MouseEvent, checkbox: HTMLInputElement, line: number): void {
    const updated = toggleCheckboxAtLine(this.getViewData(), line);
    if (!updated) return;
    event.preventDefault();
    event.stopPropagation();
    (navigator as { vibrate?: (duration: number) => void }).vibrate?.(100);
    this.metadataDisplayOrder = null;
    this.setViewData(updated.text);
    this.editor.setValue(updated.text);
    this.syncSourceValue(updated.text);
    checkbox.checked = updated.checked;
    if (updated.checked) checkbox.setAttribute("checked", "");
    else checkbox.removeAttribute("checked");
    const li = checkbox.closest("li.task-list-item");
    if (li instanceof HTMLLIElement) {
      li.dataset.task = updated.marker;
      li.classList.toggle("is-checked", updated.checked);
    }
    this.triggerEditorContentChange();
    this.scheduleSave();
  }

  private triggerEditorContentChange(): void {
    this.app.workspace.trigger("editor-change", this.editor, this);
    if (this.file) this.app.workspace.onQuickPreview(this.file, this.getViewData());
    this.updateDocumentSearchMatches();
  }

  syncSourceValue(data: string): void {
    if (this.editor.getValue() !== data) this.editor.setValue(data);
    else this.editorViewHost.renderDocument();
  }

  private focusSourceEditor(): void {
    this.editor.focus();
    this.editorViewHost.contentEl.focus();
    this.syncActiveEditor();
  }

  private getSourceSelectionOffsets(): { start: number; end: number } {
    const anchorOffset = this.editor.posToOffset(this.editor.getCursor("anchor"));
    const headOffset = this.editor.posToOffset(this.editor.getCursor("head"));
    return {
      start: Math.min(anchorOffset, headOffset),
      end: Math.max(anchorOffset, headOffset),
    };
  }

  private getSourceSelectionStart(): number {
    return this.getSourceSelectionOffsets().start;
  }

  private getSourceSelectionEnd(): number {
    return this.getSourceSelectionOffsets().end;
  }

  private setSourceSelectionRange(start: number, end: number): void {
    const source = this.editor.getValue();
    const from = Math.max(0, Math.min(source.length, start));
    const to = Math.max(from, Math.min(source.length, end));
    this.editor.setSelection(offsetToPosition(source, from), offsetToPosition(source, to));
    this.emitEditorSelectionChange(from, to);
  }

  selectRange(start: number, end: number): void {
    void this.setMode("source");
    const source = this.editor.getValue();
    const from = Math.max(0, start);
    const to = Math.max(0, end);
    this.focusSourceEditor();
    this.setSourceSelectionRange(from, to);
    this.editor.setSelection(offsetToPosition(source, from), offsetToPosition(source, to));
    this.handleSourceSelectionChange();
  }

  private createDocumentSearch(): {
    containerEl: HTMLElement;
    searchInputEl: HTMLInputElement;
    countEl: HTMLElement;
    replaceInputEl: HTMLInputElement;
  } {
    const containerEl = document.createElement("div");
    containerEl.className = "document-search-container";
    containerEl.hidden = true;

    const searchEl = document.createElement("div");
    searchEl.className = "document-search";
    const searchInputEl = document.createElement("input");
    searchInputEl.className = "document-search-input";
    searchInputEl.type = "search";
    searchInputEl.autocomplete = "off";
    searchInputEl.spellcheck = false;
    searchInputEl.placeholder = "Search";
    const countEl = document.createElement("div");
    countEl.className = "document-search-count";
    const searchButtonsEl = document.createElement("div");
    searchButtonsEl.className = "document-search-buttons";
    const previousButtonEl = this.createDocumentSearchButton("Previous match", "lucide-arrow-up");
    previousButtonEl.addEventListener("click", () => this.selectDocumentSearchMatch(-1));
    const nextButtonEl = this.createDocumentSearchButton("Next match", "lucide-arrow-down");
    nextButtonEl.addEventListener("click", () => this.selectDocumentSearchMatch(1));
    const closeButtonEl = this.createDocumentSearchButton("Close search", "lucide-x");
    closeButtonEl.addEventListener("click", () => this.hideDocumentSearch());
    searchButtonsEl.append(previousButtonEl, nextButtonEl, closeButtonEl);
    searchEl.append(searchInputEl, countEl, searchButtonsEl);

    const replaceEl = document.createElement("div");
    replaceEl.className = "document-replace";
    const replaceInputEl = document.createElement("input");
    replaceInputEl.className = "document-replace-input";
    replaceInputEl.type = "text";
    replaceInputEl.autocomplete = "off";
    replaceInputEl.spellcheck = false;
    replaceInputEl.placeholder = "Replace";
    const replaceButtonsEl = document.createElement("div");
    replaceButtonsEl.className = "document-replace-buttons";
    const replaceButtonEl = this.createDocumentSearchButton("Replace current match");
    replaceButtonEl.textContent = "Replace";
    replaceButtonEl.addEventListener("click", () => this.replaceCurrentDocumentSearchMatch());
    const replaceAllButtonEl = this.createDocumentSearchButton("Replace all matches");
    replaceAllButtonEl.textContent = "Replace all";
    replaceAllButtonEl.addEventListener("click", () => this.replaceAllDocumentSearchMatches());
    replaceButtonsEl.append(replaceButtonEl, replaceAllButtonEl);
    replaceEl.append(replaceInputEl, replaceButtonsEl);

    searchInputEl.addEventListener("input", () => this.updateDocumentSearchMatches());
    searchInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.selectDocumentSearchMatch(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.hideDocumentSearch();
      }
    });
    replaceInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.metaKey || event.ctrlKey) this.replaceAllDocumentSearchMatches();
        else this.replaceCurrentDocumentSearchMatch();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.hideDocumentSearch();
      }
    });

    containerEl.append(searchEl, replaceEl);
    return { containerEl, searchInputEl, countEl, replaceInputEl };
  }

  private createDocumentSearchButton(ariaLabel: string, icon?: string): HTMLButtonElement {
    const buttonEl = document.createElement("button");
    buttonEl.className = "document-search-button clickable-icon";
    buttonEl.type = "button";
    buttonEl.setAttribute("aria-label", ariaLabel);
    if (icon) setIcon(buttonEl, icon);
    return buttonEl;
  }

  private mountDocumentSearchContainer(): void {
    if (this.documentSearchContainerEl.parentElement !== this.editorContainerEl) {
      this.editorContainerEl.appendChild(this.documentSearchContainerEl);
    }
  }

  private hideDocumentSearch(): void {
    this.documentSearchContainerEl.remove();
    this.editorContainerEl.classList.remove("is-searching", "is-replacing");
  }

  private updateDocumentSearchMatches(): void {
    const query = this.documentSearchInputEl.value;
    this.documentSearchMatches = findDocumentSearchMatches(this.getViewData(), query);
    if (this.documentSearchMatches.length === 0) {
      this.documentSearchIndex = -1;
    } else if (this.documentSearchIndex < 0 || this.documentSearchIndex >= this.documentSearchMatches.length) {
      this.documentSearchIndex = 0;
    }
    this.documentSearchInputEl.classList.toggle("mod-no-match", query.length > 0 && this.documentSearchMatches.length === 0);
    this.documentReplaceInputEl.classList.toggle("mod-no-match", query.length > 0 && this.documentSearchMatches.length === 0);
    this.updateDocumentSearchCount();
  }

  private updateDocumentSearchCount(): void {
    if (this.documentSearchMatches.length === 0) {
      this.documentSearchCountEl.textContent = this.documentSearchInputEl.value ? "0/0" : "";
      return;
    }
    this.documentSearchCountEl.textContent = `${this.documentSearchIndex + 1}/${this.documentSearchMatches.length}`;
  }

  private selectDocumentSearchMatch(delta: number): void {
    this.updateDocumentSearchMatches();
    if (this.documentSearchMatches.length === 0) return;
    this.documentSearchIndex = wrapIndex(this.documentSearchIndex + delta, this.documentSearchMatches.length);
    this.updateDocumentSearchCount();
    const match = this.documentSearchMatches[this.documentSearchIndex];
    void this.setMode("source").then(() => this.selectRange(match.start, match.end));
  }

  private replaceCurrentDocumentSearchMatch(): void {
    this.updateDocumentSearchMatches();
    if (this.documentSearchMatches.length === 0) return;
    const match = this.documentSearchMatches[Math.max(0, this.documentSearchIndex)];
    const replacement = this.documentReplaceInputEl.value;
    this.applyTextEdits([{ start: match.start, end: match.end, text: replacement }], match.start, match.start + replacement.length);
    const nextIndex = this.documentSearchMatches.findIndex((nextMatch) => nextMatch.start >= match.start);
    this.documentSearchIndex = nextIndex === -1 ? 0 : nextIndex;
    this.updateDocumentSearchMatches();
  }

  private replaceAllDocumentSearchMatches(): void {
    this.updateDocumentSearchMatches();
    if (this.documentSearchMatches.length === 0) return;
    const replacement = this.documentReplaceInputEl.value;
    const firstMatch = this.documentSearchMatches[0];
    this.applyTextEdits(
      this.documentSearchMatches.map((match) => ({ start: match.start, end: match.end, text: replacement })),
      firstMatch.start,
      firstMatch.start + replacement.length,
    );
    this.documentSearchIndex = 0;
    this.updateDocumentSearchMatches();
  }

  getEphemeralState(): unknown {
    const base = this.baseEphemeralState;
    const modeState = this.currentMode.getEphemeralState();
    const nextState = {
      ...(base && typeof base === "object" ? base : {}),
      ...(modeState && typeof modeState === "object" ? modeState : {}),
    };
    if (this.scroll != null) return { ...nextState, scroll: this.scroll };
    return nextState;
  }

  setEphemeralState(state: unknown): void {
    if (!state || typeof state !== "object") return;
    const viewState = { ...state as Record<string, unknown> } as {
      focus?: unknown;
      focusMetadata?: unknown;
      focusOnMobile?: unknown;
      cursor?: unknown;
      line?: unknown;
      match?: unknown;
      matchStart?: unknown;
      matchEnd?: unknown;
      propertyMatches?: unknown;
      rename?: unknown;
      scroll?: unknown;
      subpath?: unknown;
    };
    if (viewState.rename) {
      if (this.canFocusInlineTitleForRename()) this.selectInlineTitle(viewState.rename);
      else if (this.file) void this.app.fileManager.promptForFileRename(this.file);
      delete viewState.rename;
    }
    this.baseEphemeralState = viewState;
    if (typeof viewState.subpath === "string" && viewState.subpath.trim() && !("line" in viewState)) {
      const line = this.getSubpathLine(viewState.subpath);
      if (line !== null) viewState.line = line;
    }
    if (this.currentMode === this.editMode && "line" in viewState) {
      const line = Number(viewState.line);
      const start = Number(viewState.matchStart);
      const end = Number(viewState.matchEnd);
      if (Number.isFinite(line) && Number.isFinite(start) && Number.isFinite(end)) this.selectLineRange(line, start, end);
      else if (Number.isFinite(line)) this.focusLine(line);
    }
    if (this.currentMode === this.editMode && this.applyCursorEphemeralState(viewState.cursor)) {
      if (viewState.focus) this.focusSourceEditor();
    }
    this.currentMode.setEphemeralState(viewState);
    if (Object.prototype.hasOwnProperty.call(viewState, "scroll")) this.scroll = viewState.scroll;
  }

  override async receiveSyncState(source: MarkdownView): Promise<void> {
    const eState = normalizeViewStatePayload(source.getEphemeralState());
    if (source.file && source.file !== this.file) {
      await this.leaf.openFile(source.file, { eState });
      return;
    }
    this.setEphemeralState(eState);
  }

  render(): void {
    this.renderInlineTitle();
    this.updatePropertiesInDocument();
    this.renderProperties();
    const isSource = this.currentMode === this.editMode;
    const isPreview = this.currentMode === this.previewMode;
    this.editorContainerEl.style.display = isSource ? "" : "none";
    this.previewContainerEl.style.display = isPreview ? "" : "none";
    this.contentEl.classList.toggle("mod-source", isSource);
    this.contentEl.classList.toggle("mod-preview", isPreview);
    this.syncModeClasses();
    this.updateModeButton();
    this.updatePropertiesInDocument();
    this.updateLineNumbers();

    if (isSource) {
      this.editMode.show();
      return;
    }

    if (isPreview) this.previewMode.render();
  }

  private syncModeClasses(): void {
    const mode = this.getMode();
    const isPreview = this.currentMode === this.previewMode;
    const isLivePreview = this.currentMode === this.editMode && this.getSourceMode() === "live";
    this.containerEl.dataset.mode = mode;
    this.contentEl.dataset.mode = mode;
    this.containerEl.classList.toggle("is-read-mode", isPreview);
    this.editorContainerEl.classList.toggle("is-live-preview", isLivePreview);
    this.editorContainerEl.setAttribute("aria-hidden", String(isPreview));
    this.previewContainerEl.setAttribute("aria-hidden", String(!isPreview));
  }

  canShowProperties(): boolean {
    const propertiesInDocument = this.app.vault.getConfig<string>("propertiesInDocument") ?? "visible";
    return propertiesInDocument === "visible" && (this.currentMode !== this.editMode || this.getSourceMode() !== "source");
  }

  metadataHasFocus(): boolean {
    const active = this.metadataContainerEl.ownerDocument.activeElement;
    return active instanceof HTMLElement && this.metadataContainerEl.contains(active);
  }

  shiftFocusAfter(): void {
    if (this.currentMode === this.editMode) {
      this.focusSourceEditor();
      this.setSourceSelectionRange(0, 0);
      return;
    }
    this.previewMode.renderer.previewEl.tabIndex = -1;
    this.previewMode.renderer.previewEl.focus({ preventScroll: true });
  }

  shiftFocusBefore(): void {
    if (this.canShowProperties() && !this.metadataHasFocus()) {
      const target =
        [...this.metadataContainerEl.querySelectorAll<HTMLElement>(".metadata-property")].at(-1) ??
        this.metadataContainerEl.querySelector<HTMLElement>(".metadata-properties-heading");
      target?.focus({ preventScroll: true });
      return;
    }
    if (!this.inlineTitleEl.hidden && this.inlineTitleEl.isConnected) this.inlineTitleEl.focus({ preventScroll: true });
  }

  private applyCursorEphemeralState(cursor: unknown): boolean {
    const from = this.getEphemeralCursorPosition(cursor, "from") ?? this.getEphemeralCursorPosition(cursor, "anchor") ?? this.getEphemeralCursorPosition(cursor);
    if (!from) return false;
    const to = this.getEphemeralCursorPosition(cursor, "to") ?? this.getEphemeralCursorPosition(cursor, "head");
    if (to) this.editor.setSelection(from, to);
    else this.editor.setCursor(from);
    this.handleSourceSelectionChange();
    return true;
  }

  private getEphemeralCursorPosition(cursor: unknown, key?: string): { line: number; ch: number } | null {
    const value = key && cursor && typeof cursor === "object" ? (cursor as Record<string, unknown>)[key] : cursor;
    if (!value || typeof value !== "object") return null;
    const position = value as { line?: unknown; ch?: unknown };
    const line = Number(position.line);
    const ch = Number(position.ch);
    if (!Number.isFinite(line) || !Number.isFinite(ch)) return null;
    return { line, ch };
  }

  private updatePropertiesInDocument(): void {
    const propertiesInDocument = this.app.vault.getConfig<string>("propertiesInDocument") ?? "visible";
    const showProperties = this.canShowProperties();
    this.contentEl.classList.toggle("show-properties", showProperties);
    this.editorContainerEl.classList.toggle("show-properties", showProperties && this.currentMode === this.editMode);
    this.previewRendererEl.classList.toggle("show-properties", propertiesInDocument !== "hidden" && this.currentMode === this.previewMode);
    this.metadataContainerEl.classList.toggle("show-properties", showProperties);
  }

  updateOptions(): void {
    this.editorViewHost.setExtensions(this.getEditorExtensions());
    this.updateReadableLineLength();
    this.updateLineNumbers();
  }

  private updateReadableLineLength(): void {
    const readable = this.app.vault.getConfig<boolean>("readableLineLength") !== false;
    this.editorContainerEl.classList.toggle("is-readable-line-width", readable);
    this.previewRendererEl.classList.toggle("is-readable-line-width", readable);
  }

  private updateLineNumbers(): void {
    const show = this.app.vault.getConfig<boolean>("showLineNumber") === true;
    this.editorContainerEl.classList.toggle("show-line-numbers", show);
    this.editorViewHost.guttersEl.classList.toggle("cm-lineNumbers", show);
    if (!show) {
      this.editorViewHost.guttersEl.replaceChildren();
      return;
    }
    const lineCount = Math.max(1, this.editor.lineCount());
    const lines = Array.from({ length: lineCount }, (_, index) => {
      const lineEl = document.createElement("div");
      lineEl.className = "cm-gutterElement cm-lineNumber";
      lineEl.textContent = String(index + 1);
      return lineEl;
    });
    this.editorViewHost.guttersEl.replaceChildren(...lines);
  }

  private getEditorExtensions(): readonly EditorExtension[] {
    const livePreview = this.getSourceMode() === "live";
    return [
      { id: "editor-editor-field", source: "core", value: editorEditorField.init(() => this.editorViewHost) },
      { id: "editor-info-field", source: "core", value: editorInfoField.init(() => this) },
      { id: "editor-live-preview-field", source: "core", value: editorLivePreviewField.init(() => livePreview) },
      ...(livePreview ? [{ id: "live-preview-plugin", source: "core", value: { type: "live-preview-plugin" } }] : []),
      ...this.app.workspace.editorExtensions.flatMap((extension) => normalizeEditorExtensions(extension, "plugin")),
    ];
  }

  private renderProperties(): void {
    this.metadataContainerEl.replaceChildren();
    if (!this.canShowProperties() || !this.file || this.file.extension !== "md") {
      this.metadataContainerEl.hidden = true;
      return;
    }

    const parsed = parseFrontmatter(this.getViewData());
    const errorEl = this.createInvalidPropertiesError();
    errorEl.hidden = parsed.valid;
    this.metadataContainerEl.appendChild(errorEl);
    if (!parsed.valid) {
      this.metadataContainerEl.hidden = false;
      this.metadataContainerEl.classList.add("mod-error");
      this.metadataContainerEl.classList.toggle("is-collapsed", false);
      this.metadataContainerEl.dataset.propertyCount = "0";
      return;
    }

    const entries = this.orderMetadataEntries(Object.entries(parsed.values));
    this.metadataContainerEl.hidden = false;
    this.metadataContainerEl.classList.remove("mod-error");
    this.metadataContainerEl.classList.toggle("is-empty", entries.length === 0);
    this.metadataContainerEl.classList.toggle("is-collapsed", this.metadataCollapsed);
    this.metadataContainerEl.dataset.propertyCount = String(entries.length);

    const headerEl = document.createElement("div");
    headerEl.className = "metadata-properties-heading";
    headerEl.tabIndex = 0;
    headerEl.classList.toggle("is-collapsed", this.metadataCollapsed);
    const foldEl = document.createElement("span");
    foldEl.className = "collapse-indicator collapse-icon";
    setIcon(foldEl, "right-triangle");
    foldEl.classList.toggle("is-collapsed", this.metadataCollapsed);
    const titleEl = document.createElement("div");
    titleEl.className = "metadata-properties-title";
    titleEl.textContent = "Properties";
    headerEl.append(foldEl, titleEl);
    headerEl.addEventListener("click", (event) => {
      event.preventDefault();
      this.setMetadataCollapse(!this.metadataCollapsed);
    });
    headerEl.addEventListener("contextmenu", (event) => this.openPropertiesMenu(event));
    headerEl.addEventListener("mousedown", (event) => event.preventDefault());
    headerEl.addEventListener("keydown", (event) => this.handleMetadataHeadingKeydown(event));
    this.metadataContainerEl.appendChild(headerEl);

    const contentEl = document.createElement("div");
    contentEl.className = "metadata-content";
    contentEl.hidden = this.metadataCollapsed;
    const propertyListEl = document.createElement("div");
    propertyListEl.className = "metadata-properties";
    contentEl.appendChild(propertyListEl);
    this.metadataPropertyListEl = propertyListEl;
    this.metadataContainerEl.appendChild(contentEl);

    entries.forEach(([id, value], index) => {
      const definition = this.app.propertyRegistry.ensureDefinition(id, value);
      this.renderPropertyRow(definition, value, index);
    });

    if (this.pendingEmptyProperty) {
      this.renderPropertyRow({ id: "", name: "", type: "text", icon: this.app.propertyRegistry.getTypeInfo("text")?.icon }, null, entries.length);
    }

    const addButton = document.createElement("button");
    addButton.className = "metadata-add-button text-icon-button";
    addButton.tabIndex = 0;
    const addIconEl = document.createElement("span");
    addIconEl.className = "text-button-icon";
    setIcon(addIconEl, "lucide-plus");
    const addLabelEl = document.createElement("span");
    addLabelEl.className = "text-button-label";
    addLabelEl.textContent = "Add property";
    addButton.append(addIconEl, addLabelEl);
    addButton.addEventListener("click", () => void this.addPropertyFromView());
    addButton.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        void this.addPropertyFromView();
      } else if (event.key === "ArrowUp" || event.key === "k" || (event.key === "Tab" && event.shiftKey)) {
        event.preventDefault();
        this.focusPropertyAtIndex(-1);
      } else if (event.key === "ArrowDown" || event.key === "j" || event.key === "Tab") {
        event.preventDefault();
        this.focusAfterMetadata();
      }
    });
    contentEl.appendChild(addButton);
  }

  private renderInlineTitle(): void {
    if (this.inlineTitleEl.ownerDocument.activeElement === this.inlineTitleEl) return;
    this.inlineTitleEl.textContent = this.file?.basename ?? "";
  }

  private renderEmbeddedBacklinks(): void {
  }

  private updateShowBacklinks(): void {
    if (this.showBacklinks && !this.backlinks) {
      this.backlinksEl.hidden = false;
      this.backlinks = this.addChild(new EmbeddedBacklinks(this.app, this.backlinksEl));
      this.updateBacklinks();
    } else if (!this.showBacklinks && this.backlinks) {
      this.removeChild(this.backlinks);
      this.backlinksEl.replaceChildren();
      this.backlinksEl.hidden = true;
      this.backlinks = null;
    }
    if (this.currentMode === this.editMode) this.editMode.onResize();
  }

  private updateBacklinks(): void {
    if (!this.backlinks) return;
    this.backlinks.file = this.file;
    this.backlinks.update();
  }

  syncScroll(): void {
    const scroll = this.currentMode.getScroll();
    if (scroll != null) this.scroll = scroll;
    this.app.workspace.trigger("markdown-scroll", this);
    this.syncState();
  }

  private canFocusInlineTitleForRename(): boolean {
    if (this.inlineTitleEl.hidden || !this.inlineTitleEl.isConnected) return false;
    if (this.currentMode === this.editMode) return this.editorViewHost.scrollerEl.scrollTop < 0.5;
    return this.previewRendererEl.scrollTop < 0.5;
  }

  private selectInlineTitle(rename: unknown): void {
    const collapse = rename === "start" ? true : rename === "end" ? false : null;
    this.inlineTitleEl.focus({ preventScroll: true });
    const selection = this.inlineTitleEl.ownerDocument.getSelection();
    if (!selection) return;
    const range = this.inlineTitleEl.ownerDocument.createRange();
    range.selectNodeContents(this.inlineTitleEl);
    if (typeof collapse === "boolean") range.collapse(collapse);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private onInlineTitleFocus(): void {
    this.fileBeingRenamed = this.file;
    this.inlineTitleEl.spellcheck = this.getSpellcheckEnabled();
  }

  private getSpellcheckEnabled(): boolean {
    return this.app.vault.getConfig<boolean>("spellcheck") ?? true;
  }

  private async onInlineTitleBlur(): Promise<void> {
    const saved = await this.saveTitle(this.inlineTitleEl);
    if (!saved && this.file) this.inlineTitleEl.textContent = this.file.basename;
    this.clearInlineTitleError();
    this.fileBeingRenamed = null;
  }

  private onTitleChange(titleEl: HTMLElement): void {
    normalizeInlineTitleElement(titleEl);
    const title = getInlineTitleText(titleEl).trim();
    const validation = this.validateInlineTitle(title, false);
    if (validation.error || validation.warning) this.showInlineTitleMessage(validation.error || validation.warning, Boolean(validation.error));
    else this.clearInlineTitleError();
  }

  private onTitlePaste(titleEl: HTMLElement, event: ClipboardEvent): void {
    event.preventDefault();
    const text = normalizeInlineTitleText(event.clipboardData?.getData("text/plain") ?? "");
    titleEl.textContent = text;
    this.placeCaretAtEnd(titleEl);
    this.onTitleChange(titleEl);
  }

  private async onTitleKeydown(event: KeyboardEvent): Promise<void> {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.fileBeingRenamed = null;
      this.inlineTitleEl.textContent = this.file?.basename ?? "";
      this.clearInlineTitleError();
      this.inlineTitleEl.blur();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      if (await this.saveTitle(this.inlineTitleEl)) this.inlineTitleEl.blur();
    }
  }

  private async saveTitle(titleEl: HTMLElement): Promise<boolean> {
    const file = this.file;
    if (!file || file !== this.fileBeingRenamed) return true;
    const title = getInlineTitleText(titleEl).trim();
    const validation = this.validateInlineTitle(title, true);
    if (validation.error) {
      this.showInlineTitleMessage(validation.error, true);
      return false;
    }
    const newPath = getRenamedMarkdownPath(file, title);
    if (newPath === file.path) return true;
    try {
      const renamed = await this.app.fileManager.renameAbstractFile(file, newPath) as TFile;
      this.file = renamed;
      titleEl.textContent = renamed.basename;
      this.clearInlineTitleError();
      return true;
    } catch (error) {
      console.error(error);
      this.showInlineTitleMessage(error instanceof Error ? error.message : String(error), true);
      return false;
    }
  }

  private validateInlineTitle(title: string, requireNonEmpty: boolean): RenameValidationResult {
    if (!this.file) return { name: title.trim(), error: "", warning: "" };
    return validateRenameName(this.app.vault, this.file, title, requireNonEmpty);
  }

  private showInlineTitleMessage(message: string, isError: boolean): void {
    this.inlineTitleEl.classList.toggle("mod-error", isError);
    this.inlineTitleEl.classList.toggle("mod-warning", !isError);
    if (isError) this.inlineTitleEl.setAttribute("aria-invalid", "true");
    else this.inlineTitleEl.removeAttribute("aria-invalid");
    this.inlineTitleEl.title = message;
  }

  private clearInlineTitleError(): void {
    this.inlineTitleEl.classList.remove("mod-error");
    this.inlineTitleEl.classList.remove("mod-warning");
    this.inlineTitleEl.removeAttribute("aria-invalid");
    this.inlineTitleEl.title = "";
  }

  private placeCaretAtEnd(element: HTMLElement): void {
    const selection = element.ownerDocument.getSelection();
    if (!selection) return;
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private renderPropertyRow(property: PropertyDefinition, value: PropertyValue, index: number): void {
    let forceExpected = false;

    const rowEl = document.createElement("div");
    rowEl.className = "metadata-property";
    rowEl.tabIndex = 0;
    rowEl.dataset.propertyKey = property.id;
    rowEl.classList.toggle("is-selected", this.selectedMetadataKeys.has(property.id));
    rowEl.addEventListener("keydown", (event) => this.handleMetadataRowKeydown(event, property.id));
    const keyEl = document.createElement("div");
    keyEl.className = "metadata-property-key";
    const iconEl = document.createElement("span");
    iconEl.className = "metadata-property-icon";
    iconEl.setAttribute("aria-disabled", String(!property.id));
    iconEl.addEventListener("mousedown", (event) => event.preventDefault());
    iconEl.draggable = Boolean(property.id);
    iconEl.addEventListener("dragstart", (event) => {
      if (!property.id || !event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/x-obsidian-property-key", property.id);
      rowEl.classList.add("is-being-dragged");
    });
    iconEl.addEventListener("dragend", () => rowEl.classList.remove("is-being-dragged"));
    const keyInputEl = document.createElement("input");
    keyInputEl.className = "metadata-property-key-input";
    keyInputEl.type = "text";
    keyInputEl.value = property.name;
    keyInputEl.autocapitalize = "none";
    keyInputEl.enterKeyHint = "next";
    keyInputEl.title = property.name;
    keyEl.append(iconEl, keyInputEl);

    const valueEl = document.createElement("div");
    valueEl.className = "metadata-property-value";

    const warningEl = document.createElement("button");
    warningEl.className = "clickable-icon metadata-property-warning-icon";
    warningEl.type = "button";
    setIcon(warningEl, "lucide-alert-triangle");
    warningEl.addEventListener("click", () => {
      const typeInfo = this.app.propertyRegistry.getPropertyTypeInfo(property.id, value);
      new PropertyTypeMismatchModal(this.app, {
        expectedType: typeInfo.expected.name,
        inferredType: typeInfo.inferred.name,
        onUpdate: () => {
          forceExpected = true;
          renderValue();
          valueEl.querySelector<HTMLElement>("input, textarea, select, button, [tabindex]")?.focus();
        },
      }).open();
    });

    const renderValue = () => {
      const typeInfo = this.app.propertyRegistry.getPropertyTypeInfo(property.id, value);
      const expectedType = typeInfo.expected.type;
      const inferredType = typeInfo.inferred.type;
      const hasTypeMismatch = expectedType !== inferredType;
      const renderType: PropertyType = hasTypeMismatch && !forceExpected ? inferredType : expectedType;
      const renderInfo = this.app.propertyRegistry.getTypeInfo(renderType);
      const renderProperty: PropertyDefinition =
        renderType === property.type ? property : { ...property, type: renderType, icon: renderInfo?.icon ?? property.icon };
      valueEl.replaceChildren();
      valueEl.dataset.propertyType = renderType;
      setIcon(iconEl, typeInfo.expected.icon);
      warningEl.title = `Type mismatch: expected ${typeInfo.expected.name}`;
      warningEl.setAttribute("aria-label", warningEl.title);
      warningEl.hidden = !hasTypeMismatch || forceExpected;
      rowEl.classList.toggle("has-type-mismatch", hasTypeMismatch && !forceExpected);

      const widget = this.app.propertyRegistry.getTypeWidget(renderType);
      if (widget) {
        widget.render(valueEl, {
          property: renderProperty,
          value,
          app: this.app,
          sourcePath: this.file?.path ?? "",
          writeFile: (file, update) => this.updateLinkedFileFromProperty(file, update),
          onChange: (next) => {
            if (!property.id) return;
            this.updateLocalProperty(property.id, this.app.propertyRegistry.normalizeValue(renderType, next));
          },
          onDelete: () => this.removeLocalProperty(property.id),
        });
      } else {
        valueEl.textContent = Array.isArray(value) ? value.join(", ") : String(value ?? "");
      }
    };
    renderValue();

    let keySuggestMenu: Menu | null = null;
    const clearKeyError = () => {
      keyInputEl.classList.remove("mod-error");
      keyInputEl.removeAttribute("aria-invalid");
      keyInputEl.title = property.name;
    };
    const showKeyError = (message: string) => {
      keyInputEl.classList.add("mod-error");
      keyInputEl.setAttribute("aria-invalid", "true");
      keyInputEl.title = message;
    };
    const hideKeySuggestions = () => {
      keySuggestMenu?.hide();
      keySuggestMenu = null;
    };
    const focusValue = () => this.focusPropertyValue(property.id);
    const handleUpdateKey = (nextKey: string, showEmptyError = true): boolean => {
      const trimmed = nextKey.trim();
      if (!trimmed) {
        if (showEmptyError) showKeyError("Property name cannot be empty");
        return false;
      }

      const parsed = parseFrontmatter(this.getViewData());
      const duplicate = Object.keys(parsed.values)
        .some((key) => key.toLowerCase() === trimmed.toLowerCase() && key.toLowerCase() !== property.id.toLowerCase());
      if (duplicate) {
        showKeyError("Property name already exists");
        rowEl.classList.add("is-selected");
        return false;
      }

      clearKeyError();
      iconEl.setAttribute("aria-disabled", "false");
      if (trimmed !== property.id) {
        if (property.id) this.renameLocalProperty(property.id, trimmed);
        else this.insertLocalProperty(trimmed, null);
        this.focusPropertyValue(trimmed);
      }
      return true;
    };
    const showKeySuggestions = () => {
      hideKeySuggestions();
      const query = keyInputEl.value.trim().toLowerCase();
      const parsed = parseFrontmatter(this.getViewData());
      const presentKeys = new Set(Object.keys(parsed.values).map((key) => key.toLowerCase()));
      const names = Object.values(this.app.metadataTypeManager.getAllProperties())
        .map((info) => info.name)
        .filter((name, index, list) => list.findIndex((item) => item.toLowerCase() === name.toLowerCase()) === index)
        .filter((name) => name.toLowerCase() !== property.id.toLowerCase())
        .filter((name) => !presentKeys.has(name.toLowerCase()))
        .filter((name) => !query || name.toLowerCase().includes(query))
        .slice(0, 8);
      if (names.length === 0) return;

      const rect = keyInputEl.getBoundingClientRect();
      const menu = new Menu();
      menu.dom.addEventListener("mousedown", (event) => event.preventDefault());
      for (const name of names) {
        menu.addItem((item) => item
          .setTitle(name)
          .setIcon(this.app.propertyRegistry.getPropertyTypeInfo(name, null).expected.icon)
          .onClick(() => {
            keyInputEl.value = name;
            if (handleUpdateKey(name)) this.focusPropertyValue(name);
          }));
      }
      keySuggestMenu = menu;
      menu.showAtPosition({ x: rect.left, y: rect.bottom });
    };

    const openPropertyMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const menu = new Menu();
      const currentType = this.app.propertyRegistry.getPropertyTypeInfo(property.id, value).expected.type;
      const isReserved = isReservedMetadataProperty(property.id);
      menu.addItem((menuItem) => {
        menuItem.setTitle("Property type").setIcon("lucide-info");
        const submenu = menuItem.setSubmenu();
        for (const typeId of METADATA_TYPE_MENU_ORDER) {
          if (!isMetadataTypeMenuItemAllowed(typeId, property.id)) continue;
          const type = this.app.metadataTypeManager.getTypeInfo(typeId);
          if (!type) continue;
          submenu.addItem((typeItem) => typeItem
            .setTitle(type.name)
            .setIcon(type.icon)
            .setSection("action.changeType")
            .setDisabled(isReserved)
            .setChecked(type.type === currentType)
            .onClick(() => {
              this.app.metadataTypeManager.setType(property.id, type.type);
              forceExpected = false;
              renderValue();
              if (value != null && !this.app.metadataTypeManager.validateValue(type.type, value)) {
                new PropertyTypeMismatchModal(this.app, {
                  expectedType: type.name,
                  inferredType: this.app.propertyRegistry.getPropertyTypeInfo(property.id, value).inferred.name,
                  onUpdate: () => {
                    forceExpected = true;
                    renderValue();
                    valueEl.querySelector<HTMLElement>("input, textarea, select, button, [tabindex]")?.focus();
                  },
                }).open();
              }
            }));
        }
      });
      menu.addSeparator();
      menu.addItem((menuItem) => menuItem
        .setTitle("Remove")
        .setIcon("lucide-trash-2")
        .setWarning(true)
        .setSection("danger")
        .onClick(() => this.removeLocalProperty(property.id)));
      menu.setParentElement(rowEl).showAtMouseEvent(event);
    };
    iconEl.addEventListener("click", (event) => {
      if (iconEl.getAttribute("aria-disabled") === "true") return;
      if (this.handleMetadataItemSelection(event, property.id)) return;
      openPropertyMenu(event);
    });
    iconEl.addEventListener("contextmenu", (event) => {
      this.focusMetadataRow(property.id);
      openPropertyMenu(event);
    });
    rowEl.addEventListener("contextmenu", (event) => {
      if (event.target === keyInputEl) return;
      this.focusMetadataRow(property.id);
      openPropertyMenu(event);
    });
    keyInputEl.addEventListener("blur", () => {
      hideKeySuggestions();
      const trimmed = keyInputEl.value.trim();
      if (trimmed || property.id) {
        if (!handleUpdateKey(trimmed, false)) keyInputEl.value = property.name;
      } else {
        this.discardPendingProperty();
      }
    });
    keyInputEl.addEventListener("keydown", (event) => {
      if (event.isComposing || event.defaultPrevented) return;
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        hideKeySuggestions();
        if (handleUpdateKey(keyInputEl.value.trim())) focusValue();
      } else if (event.key === "Escape") {
        event.preventDefault();
        hideKeySuggestions();
        keyInputEl.value = property.name;
        clearKeyError();
        if (property.id) keyInputEl.blur();
        else this.discardPendingProperty();
      }
    });
    keyInputEl.addEventListener("input", () => {
      clearKeyError();
      iconEl.setAttribute("aria-disabled", String(!(property.id || keyInputEl.value.trim())));
      showKeySuggestions();
    });
    keyInputEl.addEventListener("focus", () => showKeySuggestions());

    const deleteButton = document.createElement("button");
    deleteButton.className = "metadata-property-delete";
    setIcon(deleteButton, "lucide-x");
    deleteButton.title = "Delete property";
    deleteButton.addEventListener("click", () => this.removeLocalProperty(property.id));
    rowEl.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes("text/x-obsidian-property-key")) return;
      event.preventDefault();
      rowEl.classList.add("is-being-dragged-over");
    });
    rowEl.addEventListener("dragleave", () => rowEl.classList.remove("is-being-dragged-over"));
    rowEl.addEventListener("drop", (event) => {
      const draggedKey = event.dataTransfer?.getData("text/x-obsidian-property-key");
      if (!draggedKey || draggedKey === property.id) return;
      event.preventDefault();
      rowEl.classList.remove("is-being-dragged-over");
      this.reorderLocalProperty(draggedKey, index);
    });
    rowEl.append(keyEl, valueEl, warningEl, deleteButton);
    (this.metadataPropertyListEl ?? this.metadataContainerEl).appendChild(rowEl);
  }

  private setMetadataCollapse(collapsed: boolean, save = true): void {
    if (this.metadataCollapsed === collapsed) return;
    this.metadataCollapsed = collapsed;
    this.renderProperties();
    this.metadataContainerEl.querySelector<HTMLElement>(".metadata-properties-heading")?.focus();
    if (save) this.onMarkdownFold();
  }

  onFoldChange(): void {
    this.onMarkdownFold();
  }

  private onMarkdownFold(): void {
    this.app.foldManager.save(this.file, this.getFoldInfo());
    this.app.workspace.trigger("markdown-fold", this);
  }

  private createInvalidPropertiesError(): HTMLElement {
    const errorEl = document.createElement("div");
    errorEl.className = "metadata-error-container";
    const titleEl = document.createElement("div");
    titleEl.className = "metadata-error-title";
    titleEl.textContent = "Invalid properties";
    const showSourceEl = document.createElement("button");
    showSourceEl.className = "text-icon-button metadata-show-source-button";
    showSourceEl.type = "button";
    const labelEl = document.createElement("span");
    labelEl.className = "text-button-label";
    labelEl.textContent = "Show source";
    showSourceEl.appendChild(labelEl);
    showSourceEl.addEventListener("click", () => {
      this.setMode("source");
      this.focusSourceEditor();
      this.setSourceSelectionRange(0, 0);
    });
    errorEl.append(titleEl, showSourceEl);
    return errorEl;
  }

  private handleMetadataHeadingKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.setMetadataCollapse(true);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      this.setMetadataCollapse(false);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.focusBeforeMetadata();
    } else if (event.key === "ArrowDown" || event.key === "j") {
      event.preventDefault();
      if (this.metadataCollapsed) {
        this.focusAfterMetadata();
      } else {
        this.focusPropertyAtIndex(0);
      }
    }
  }

  private openPropertiesMenu(event: MouseEvent): void {
    event.preventDefault();
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle("Add property")
      .setSection("action-primary")
      .onClick(() => void this.addPropertyFromView()));
    menu.addItem((item) => {
      item.setTitle("Sort").setIcon("lucide-sort-asc").setSection("action.sort");
      const submenu = item.setSubmenu();
      submenu.addItem((sortItem) => sortItem
        .setTitle("Sort properties A to Z")
        .setSection("action.sort")
        .onClick(() => this.sortLocalProperties()));
      submenu.addItem((sortItem) => sortItem
        .setTitle("Sort properties Z to A")
        .setSection("action.sort")
        .onClick(() => this.sortLocalProperties(true)));
    });
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle("Clear properties")
      .setSection("danger")
      .setIcon("lucide-trash-2")
      .setWarning(true)
      .onClick(() => this.clearLocalProperties()));
    this.app.workspace.trigger("markdown-properties-menu", menu, this.file);
    menu.showAtMouseEvent(event);
  }

  private handleMetadataRowKeydown(event: KeyboardEvent, propertyId: string): void {
    if (event.isComposing || event.defaultPrevented || event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.focusPropertyValue(propertyId);
    } else if (event.key === "A") {
      event.preventDefault();
      this.focusPropertyValue(propertyId, "end");
    } else if (event.key === "i") {
      event.preventDefault();
      this.focusPropertyValue(propertyId, "start");
    } else if (event.key === "ArrowLeft" || event.key === "h") {
      event.preventDefault();
      this.focusPropertyKey(propertyId);
    } else if (event.key === "ArrowRight" || event.key === "l") {
      event.preventDefault();
      this.focusPropertyValue(propertyId);
    } else if (event.key === "ArrowUp" || event.key === "k" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      this.focusAdjacentProperty(propertyId, -1);
    } else if (event.key === "ArrowDown" || event.key === "j" || event.key === "Tab") {
      event.preventDefault();
      this.focusAdjacentProperty(propertyId, 1);
    } else if (event.key === "o") {
      event.preventDefault();
      void this.addPropertyFromView();
    } else if (event.key === "Delete" || (event.key === "Backspace" && event.metaKey)) {
      event.preventDefault();
      this.removeLocalProperty(propertyId);
    }
  }

  private handleMetadataItemSelection(event: MouseEvent, propertyId: string): boolean {
    const focusedKey = this.getFocusedMetadataKey();
    this.focusMetadataRow(propertyId);
    if (event.altKey && !event.shiftKey) {
      this.selectMetadataProperty(propertyId, !this.selectedMetadataKeys.has(propertyId));
      return true;
    }

    if (event.shiftKey) {
      if (focusedKey) {
        const keys = this.getRenderedMetadataKeys();
        const range = [keys.indexOf(focusedKey), keys.indexOf(propertyId)].sort((left, right) => left - right);
        const shouldSelect = !(this.selectedMetadataKeys.has(focusedKey) && this.selectedMetadataKeys.has(propertyId));
        for (const key of keys.slice(range[0], range[1] + 1)) this.selectMetadataProperty(key, shouldSelect);
      } else {
        this.selectMetadataProperty(propertyId, true);
      }
      return true;
    }

    this.clearMetadataSelection();
    return false;
  }

  private async addPropertyFromView(): Promise<void> {
    if (!this.file) return;
    if (!parseFrontmatter(this.getViewData()).valid) {
      new Notice("Invalid properties");
      return;
    }
    this.pendingEmptyProperty = true;
    this.renderProperties();
    this.focusPropertyKey("");
  }

  private updateLocalProperty(propertyId: string, value: PropertyValue): void {
    if (!this.file) return;
    const next = setFrontmatterProperty(this.getViewData(), propertyId, value);
    this.selectedMetadataKeys.delete(propertyId);
    this.metadataDisplayOrder = null;
    this.setViewData(next);
    this.editor.setValue(next);
    this.syncSourceValue(next);
    this.app.workspace.trigger("property-change", this.file.path, propertyId, value);
    this.triggerEditorContentChange();
    this.scheduleSave();
    this.renderProperties();
  }

  private insertLocalProperty(propertyId: string, value: PropertyValue): void {
    if (!this.file) return;
    const next = insertFrontmatterProperty(this.getViewData(), propertyId, value);
    this.pendingEmptyProperty = false;
    this.metadataDisplayOrder = null;
    this.selectedMetadataKeys.clear();
    this.setViewData(next);
    this.editor.setValue(next);
    this.syncSourceValue(next);
    this.app.workspace.trigger("property-change", this.file.path, propertyId, value);
    this.triggerEditorContentChange();
    this.scheduleSave();
    this.renderProperties();
  }

  private removeLocalProperty(propertyId: string): void {
    if (!propertyId) {
      this.discardPendingProperty();
      return;
    }
    this.updateLocalProperty(propertyId, null);
  }

  private discardPendingProperty(): void {
    this.pendingEmptyProperty = false;
    this.renderProperties();
  }

  private renameLocalProperty(oldId: string, newId: string): void {
    if (!this.file) return;
    const next = renameFrontmatterProperty(this.getViewData(), oldId, newId);
    if (next === this.getViewData()) return;
    const parsed = parseFrontmatter(next);
    this.metadataDisplayOrder = null;
    this.selectedMetadataKeys.delete(oldId);
    this.setViewData(next);
    this.editor.setValue(next);
    this.syncSourceValue(next);
    this.app.workspace.trigger("property-change", this.file.path, oldId, null);
    this.app.workspace.trigger("property-change", this.file.path, newId, parsed.values[newId] ?? null);
    this.triggerEditorContentChange();
    this.scheduleSave();
    this.renderProperties();
  }

  private reorderLocalProperty(propertyId: string, targetIndex: number): void {
    if (!this.file) return;
    const next = reorderFrontmatterProperty(this.getViewData(), propertyId, targetIndex);
    if (next === this.getViewData()) return;
    this.metadataDisplayOrder = null;
    this.setViewData(next);
    this.editor.setValue(next);
    this.syncSourceValue(next);
    this.app.workspace.trigger("property-reorder", this.file.path, propertyId, targetIndex);
    this.triggerEditorContentChange();
    this.scheduleSave();
    this.renderProperties();
    this.focusPropertyKey(propertyId);
  }

  private sortLocalProperties(descending = false): void {
    if (!this.file) return;
    const collator = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true });
    this.metadataDisplayOrder = Object.keys(parseFrontmatter(this.getViewData()).values)
      .sort((left, right) => (descending ? -collator.compare(left, right) : collator.compare(left, right)));
    this.app.workspace.trigger("property-sort", this.file.path, descending);
    this.renderProperties();
  }

  private clearLocalProperties(): void {
    if (!this.file) return;
    const next = parseFrontmatter(this.getViewData()).body.replace(/^\r?\n/, "");
    if (next === this.getViewData()) return;
    this.metadataDisplayOrder = null;
    this.setViewData(next);
    this.editor.setValue(next);
    this.syncSourceValue(next);
    this.pendingEmptyProperty = false;
    this.selectedMetadataKeys.clear();
    this.app.workspace.trigger("properties-clear", this.file.path);
    this.triggerEditorContentChange();
    this.scheduleSave();
    this.renderProperties();
  }

  private focusPropertyValue(propertyId: string, position: "both" | "start" | "end" = "both"): void {
    const rowEl = [...this.metadataContainerEl.querySelectorAll<HTMLElement>(".metadata-property")]
      .find((row) => row.dataset.propertyKey?.toLowerCase() === propertyId.toLowerCase());
    const target = rowEl?.querySelector<HTMLElement>(".metadata-property-value input, .metadata-property-value textarea, .metadata-property-value select, .metadata-property-value button, .metadata-property-value [tabindex]");
    target?.focus();
    if ((position === "start" || position === "end") && target instanceof HTMLInputElement) {
      const offset = position === "start" ? 0 : target.value.length;
      target.setSelectionRange(offset, offset);
    }
  }

  private focusPropertyKey(propertyId: string): void {
    const rowEl = [...this.metadataContainerEl.querySelectorAll<HTMLElement>(".metadata-property")]
      .find((row) => (row.dataset.propertyKey ?? "").toLowerCase() === propertyId.toLowerCase());
    rowEl?.querySelector<HTMLInputElement>(".metadata-property-key-input")?.focus();
  }

  private focusPropertyAtIndex(index: number): void {
    const rows = [...this.metadataContainerEl.querySelectorAll<HTMLElement>(".metadata-property")];
    const target = rows.at(index);
    if (target) target.focus();
    else this.metadataContainerEl.querySelector<HTMLElement>(".metadata-add-button")?.focus();
  }

  private focusAfterMetadata(): void {
    this.shiftFocusAfter();
  }

  private focusBeforeMetadata(): void {
    this.shiftFocusBefore();
  }

  private focusAdjacentProperty(propertyId: string, direction: -1 | 1): void {
    const rows = [...this.metadataContainerEl.querySelectorAll<HTMLElement>(".metadata-property")];
    const index = rows.findIndex((row) => row.dataset.propertyKey?.toLowerCase() === propertyId.toLowerCase());
    const target = rows[index + direction];
    if (target) target.focus();
    else if (direction < 0) this.metadataContainerEl.querySelector<HTMLElement>(".metadata-properties-heading")?.focus();
    else {
      const addButton = this.metadataContainerEl.querySelector<HTMLElement>(".metadata-add-button");
      if (addButton) addButton.focus();
      else this.focusAfterMetadata();
    }
  }

  private orderMetadataEntries(entries: Array<[string, PropertyValue]>): Array<[string, PropertyValue]> {
    if (!this.metadataDisplayOrder) return entries;
    const order = new Map(this.metadataDisplayOrder.map((key, index) => [key.toLowerCase(), index]));
    return [...entries].sort(([left], [right]) => {
      const leftIndex = order.get(left.toLowerCase());
      const rightIndex = order.get(right.toLowerCase());
      if (leftIndex == null && rightIndex == null) return 0;
      if (leftIndex == null) return 1;
      if (rightIndex == null) return -1;
      return leftIndex - rightIndex;
    });
  }

  private focusMetadataRow(propertyId: string): void {
    const row = this.getMetadataRow(propertyId);
    row?.focus();
  }

  private getFocusedMetadataKey(): string | null {
    const active = this.metadataContainerEl.ownerDocument.activeElement;
    const row = active instanceof HTMLElement ? active.closest<HTMLElement>(".metadata-property") : null;
    return row?.dataset.propertyKey ?? null;
  }

  private getRenderedMetadataKeys(): string[] {
    return [...this.metadataContainerEl.querySelectorAll<HTMLElement>(".metadata-property")]
      .map((row) => row.dataset.propertyKey ?? "")
      .filter(Boolean);
  }

  private getMetadataRow(propertyId: string): HTMLElement | null {
    return [...this.metadataContainerEl.querySelectorAll<HTMLElement>(".metadata-property")]
      .find((row) => row.dataset.propertyKey?.toLowerCase() === propertyId.toLowerCase()) ?? null;
  }

  private selectMetadataProperty(propertyId: string, selected: boolean): void {
    if (!propertyId) return;
    if (selected) this.selectedMetadataKeys.add(propertyId);
    else this.selectedMetadataKeys.delete(propertyId);
    this.getMetadataRow(propertyId)?.classList.toggle("is-selected", selected);
  }

  private clearMetadataSelection(): void {
    for (const key of this.selectedMetadataKeys) this.getMetadataRow(key)?.classList.remove("is-selected");
    this.selectedMetadataKeys.clear();
  }

  private getSelectedMetadataProperties(): Record<string, PropertyValue> {
    const parsed = parseFrontmatter(this.getViewData());
    const selectedKeys = this.selectedMetadataKeys.size > 0 ? [...this.selectedMetadataKeys] : [this.getFocusedMetadataKey()].filter((key): key is string => Boolean(key));
    const values: Record<string, PropertyValue> = {};
    for (const [key, value] of Object.entries(parsed.values)) {
      if (selectedKeys.some((selected) => selected.toLowerCase() === key.toLowerCase())) values[key] = value;
    }
    return values;
  }

  private hasMetadataPropertyFocused(event?: Event): boolean {
    const active = this.metadataContainerEl.ownerDocument.activeElement;
    if (active instanceof HTMLElement && this.metadataContainerEl.contains(active) && active.closest(".metadata-property")) return true;
    const target = event?.target;
    return target instanceof HTMLElement && this.metadataContainerEl.contains(target) && Boolean(target.closest(".metadata-property"));
  }

  private handleMetadataCopy(event: ClipboardEvent): void {
    if (!this.hasMetadataPropertyFocused(event)) return;
    const properties = this.getSelectedMetadataProperties();
    if (Object.keys(properties).length === 0) return;
    event.preventDefault();
    event.clipboardData?.setData("Text", serializeFrontmatterProperties(properties));
    event.clipboardData?.setData("obsidian/properties", JSON.stringify(properties));
  }

  private handleMetadataCut(event: ClipboardEvent): void {
    if (!this.hasMetadataPropertyFocused(event)) return;
    const properties = this.getSelectedMetadataProperties();
    if (Object.keys(properties).length === 0) return;
    event.preventDefault();
    event.clipboardData?.setData("Text", serializeFrontmatterProperties(properties));
    event.clipboardData?.setData("obsidian/properties", JSON.stringify(properties));
    this.removeLocalProperties(Object.keys(properties));
    this.clearMetadataSelection();
  }

  private handleMetadataPaste(event: ClipboardEvent): boolean {
    const raw = event.clipboardData?.getData("obsidian/properties");
    if (!raw || !this.file) return false;
    let properties: Record<string, PropertyValue> | null = null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) properties = parsed as Record<string, PropertyValue>;
    } catch (error) {
      console.error(error);
    }
    if (!properties) return false;
    event.preventDefault();
    this.insertMetadataProperties(properties);
    return true;
  }

  private insertMetadataProperties(properties: Record<string, PropertyValue>): void {
    if (!this.file) return;
    const next = mergeFrontmatterProperties(this.getViewData(), properties);
    this.metadataDisplayOrder = null;
    this.setViewData(next);
    this.editor.setValue(next);
    this.syncSourceValue(next);
    this.app.workspace.trigger("properties-paste", this.file.path, properties);
    this.triggerEditorContentChange();
    this.scheduleSave();
    this.renderProperties();
  }

  private removeLocalProperties(propertyIds: readonly string[]): void {
    if (!this.file || propertyIds.length === 0) return;
    const next = deleteFrontmatterProperties(this.getViewData(), propertyIds);
    this.metadataDisplayOrder = null;
    for (const id of propertyIds) this.selectedMetadataKeys.delete(id);
    this.setViewData(next);
    this.editor.setValue(next);
    this.syncSourceValue(next);
    this.app.workspace.trigger("properties-delete", this.file.path, propertyIds);
    this.triggerEditorContentChange();
    this.scheduleSave();
    this.renderProperties();
  }

  private async updateLinkedFileFromProperty(file: TFile, update: (source: string) => string): Promise<void> {
    if (file.path !== this.file?.path) {
      await this.app.vault.process(file, update);
      return;
    }

    const next = update(this.getViewData());
    this.setViewData(next);
    this.editor.setValue(next);
    this.syncSourceValue(next);
    this.triggerEditorContentChange();
    this.scheduleSave();
    this.renderProperties();
  }

  private syncActiveEditor(): void {
    if (this.app.workspace.activeLeaf === this.leaf) {
      this.app.workspace.activeEditor = this;
    }
  }

  private handleEditorDocumentChange(_origin?: string): void {
    const data = this.editor.getValue();
    this.editorViewHost.renderDocument();
    if (data === super.getViewData()) return;
    this.metadataDisplayOrder = null;
    super.setViewData(data);
    const cursorOffset = this.editor.posToOffset(this.editor.getCursor());
    this.setSourceSelectionRange(cursorOffset, cursorOffset);
    this.triggerEditorContentChange();
    this.scheduleSave();
  }

  private handleEditorSelectionChange(): void {
    if (this.editor.listSelections().length !== 1) return;
    const { start, end } = this.getSourceSelectionOffsets();
    this.emitEditorSelectionChange(start, end);
  }

  private handleSourceInput(): void {
    const data = this.editor.getValue();
    this.metadataDisplayOrder = null;
    super.setViewData(data);
    this.triggerEditorContentChange();
    this.handleSourceSelectionChange();
    this.scheduleSave();
    void this.app.workspace.editorSuggest.trigger(this.editor, this.editorViewHost.contentEl);
  }

  private async handleSourceKeyup(event: KeyboardEvent): Promise<void> {
    await this.handleEditorSuggest(event);
    this.handleSourceSelectionChange();
  }

  private async handleEditorSuggest(event: KeyboardEvent): Promise<void> {
    await this.app.workspace.editorSuggest.trigger(this.editor, this.editorViewHost.contentEl, event);
    if (super.getViewData() !== this.editor.getValue()) {
      super.setViewData(this.editor.getValue());
      this.scheduleSave();
    }
  }

  private handleSourceSelectionChange(): void {
    const { start, end } = this.getSourceSelectionOffsets();
    this.emitEditorSelectionChange(start, end);
  }

  private emitEditorSelectionChange(start: number, end: number): void {
    if (start === this.lastSelectionStart && end === this.lastSelectionEnd) return;
    this.lastSelectionStart = start;
    this.lastSelectionEnd = end;
    this.app.workspace.trigger("editor-selection-change", this.editor, this);
  }

  private syncSourceSelectionToEditor(): void {
    if (this.editor.listSelections().length > 1) return;
    const source = this.editor.getValue();
    const { start, end } = this.getSourceSelectionOffsets();
    this.editor.setSelection(offsetToPosition(source, start), offsetToPosition(source, end));
  }

  private handleSourceContextMenu(event: MouseEvent): void {
    if (this.getMode() !== "source") return;
    event.preventDefault();
    this.syncActiveEditor();
    this.app.menus.createEditorMenu(this.editor, this, this.getEditorMenuContext(event)).showAtMouseEvent(event);
  }

  private handleSourceClick(event: MouseEvent): void {
    if (this.getMode() !== "source") return;
    if (!(event.type === "click" && event.button === 0) && !(event.type === "mousedown" && event.button === 1)) return;
    const token = this.findHoveredSourceToken(event);
    if (!token || token.type === "footref") return;
    this.triggerClickableToken(token, Keymap.isModEvent(event));
    event.preventDefault();
  }

  private async handleSourcePaste(event: ClipboardEvent): Promise<void> {
    if (this.getMode() !== "source") return;
    this.syncActiveEditor();
    this.app.workspace.trigger("editor-paste", event, this.editor, this);
    if (event.defaultPrevented) return;
    if (this.handleMetadataPaste(event)) return;

    const markdown = this.getExternalDataTransferMarkdown(event.clipboardData);
    const clipboardText = getClipboardText(event);
    const urlPayload = markdown ?? clipboardText;
    this.syncSourceSelectionToEditor();
    if (urlPayload && this.tryPasteUrl(event, urlPayload)) return;

    if (markdown !== null) {
      event.preventDefault();
      this.replaceSelection(markdown);
      this.focusSourceEditor();
      return;
    }

    if (!hasDataTransferAttachmentFiles(event.clipboardData)) {
      this.pasteClipboardText(event, clipboardText);
      return;
    }

    await this.pasteClipboardFiles(event);
  }

  private handleSourceDragOver(event: DragEvent): void {
    if (this.getMode() !== "source") return;

    const source = this.getActiveDragSource();
    if (!source) {
      setAllowedDropEffect(event, event.ctrlKey ? "link" : "copy");
      return;
    }

    if (isOpenInLeafDrop(event)) return;

    if (canInsertDragSourceMarkdown(source)) {
      setAllowedDropEffect(event, "link");
    }
  }

  private async handleSourceDrop(event: DragEvent): Promise<void> {
    if (this.getMode() !== "source") return;
    this.syncActiveEditor();

    const source = this.getActiveDragSource();
    if (source) {
      if (isOpenInLeafDrop(event)) {
        event.preventDefault();
        super.handleDrop(event, source, false);
        return;
      }

      const markdown = this.getDragSourceMarkdown(source).join("\n");
      if (!markdown) return;

      this.setDropInsertionPoint(event);
      this.replaceSelection(markdown);
      this.focusSourceEditor();
      event.preventDefault();
      return;
    }

    if (event.defaultPrevented) return;
    this.app.workspace.trigger("editor-drop", event, this.editor, this);
    if (event.defaultPrevented) return;
    let markdown: string | null = null;
    if (!event.shiftKey) markdown = this.getExternalDataTransferMarkdown(event.dataTransfer);
    if (markdown !== null || hasDataTransferAttachmentFiles(event.dataTransfer)) event.preventDefault();
    if (markdown === null) markdown = await this.handleExternalDropIntoEditor(event);
    if (markdown === null) return;

    this.setDropInsertionPoint(event);
    this.replaceSelection(markdown);
    this.focusSourceEditor();
  }

  private setDropInsertionPoint(event: DragEvent): void {
    const position = this.editor.posAtCoords?.({ x: event.clientX, y: event.clientY })
      ?? this.getEditorPositionAtCoords(event.clientX, event.clientY);
    if (!position) return;
    const cursor = this.clampEditorPosition(position);
    this.editor.setCursor(cursor);
    const offset = this.editor.posToOffset(cursor);
    this.setSourceSelectionRange(offset, offset);
  }

  private getEditorPositionAtCoords(clientX: number, clientY: number): EditorPosition | null {
    const rect = this.editorViewHost.contentEl.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;

    const style = getComputedStyle(this.editorViewHost.contentEl);
    const fontSize = parseCssPixels(style.fontSize, 16);
    const lineHeight = parseCssPixels(style.lineHeight, fontSize * 1.4);
    const charWidth = measureEditorCharacterWidth(this.editorViewHost.contentEl, style, fontSize);
    const left = rect.left + parseCssPixels(style.paddingLeft, 0) + parseCssPixels(style.borderLeftWidth, 0);
    const top = rect.top + parseCssPixels(style.paddingTop, 0) + parseCssPixels(style.borderTopWidth, 0);
    const line = Math.floor((clientY - top + this.editorViewHost.scrollerEl.scrollTop) / lineHeight);
    const ch = Math.floor((clientX - left + this.editorViewHost.scrollerEl.scrollLeft) / charWidth);
    return { line, ch };
  }

  private clampEditorPosition(position: EditorPosition): EditorPosition {
    const line = Math.max(0, Math.min(position.line, this.editor.lastLine()));
    const ch = Math.max(0, Math.min(position.ch, this.editor.getLine(line).length));
    return { line, ch };
  }

  private getActiveDragSource(): DragSource | null {
    const dragManager = this.app.dragManager as unknown as {
      getSource?: () => DragSource | null;
      draggable?: DragSource | null;
      source?: DragSource | null;
    };
    return dragManager.getSource?.() ?? dragManager.draggable ?? dragManager.source ?? null;
  }

  private getDragSourceMarkdown(source: DragSource): string[] {
    const value = source as unknown as Record<string, unknown>;
    const sourcePath = this.file?.path ?? "";
    const markdownLink = (file: TFile, subpath?: string, alias?: string) => {
      const link = this.app.fileManager.generateMarkdownLink(file, sourcePath, subpath, alias);
      return isEmbeddableFile(file) ? `!${link}` : link;
    };

    if (source.type === "file") {
      const file = value.file;
      return file instanceof TFile ? [markdownLink(file)] : [];
    }

    if (source.type === "files") {
      const files = Array.isArray(value.files) ? value.files : [];
      return files.flatMap((file) => (file instanceof TFile ? [markdownLink(file)] : []));
    }

    if (source.type === "link") {
      const linktext = typeof value.linktext === "string" ? value.linktext : "";
      const file = value.file;
      if (file instanceof TFile) return [markdownLink(file, getLinktextSubpath(linktext))];
      return linktext ? [linktext] : [];
    }

    if (source.type === "heading") {
      const file = value.file;
      const heading = getRecord(value.heading)?.heading;
      if (!(file instanceof TFile) || typeof heading !== "string") return [];
      return [markdownLink(file, `#${getHeadingSubpath(heading)}`)];
    }

    if (source.type === "bookmarks") {
      const items = Array.isArray(value.items) ? value.items : [];
      return items.flatMap((entry) => {
        const item = getRecord(getRecord(entry)?.item);
        if (item?.type !== "file" || typeof item.path !== "string") return [];
        const file = this.app.vault.getAbstractFileByPath(item.path);
        if (!(file instanceof TFile)) return [];
        const subpath = typeof item.subpath === "string" ? item.subpath : undefined;
        const title = typeof item.title === "string" ? item.title : undefined;
        return [markdownLink(file, subpath, title)];
      });
    }

    return [];
  }

  private getExternalDataTransferMarkdown(dataTransfer: DataTransfer | null): string | null {
    if (!dataTransfer) return null;

    const html = getDataTransferData(dataTransfer, "text/html");
    if (html && html.includes("<!-- obsidian -->") && getDataTransferData(dataTransfer, "text/plain")) return null;

    const markdown = getDataTransferData(dataTransfer, "text/markdown");
    if (markdown) return markdown;

    if (html && getDataTransferFileCount(dataTransfer) > 0 && /^<img [^>]+>$/.test(html.trim())) return null;
    if (html) {
      if (!this.app.vault.getConfig("autoConvertHtml")) return null;
      const sourcePath = this.file?.path ?? "";
      const preprocessed = preprocessHtmlDrop(html, {
        resourcePathPrefix: "file:///",
        resolveMediaLinktext: (fileUrl) => {
          const file = this.app.vault.resolveFileUrl(fileUrl);
          return file ? this.app.metadataCache.fileToLinktext(file, sourcePath, true) : null;
        },
      });
      if (preprocessed.detachedImages.length) void this.saveDetachedHtmlImages(preprocessed.detachedImages);
      return htmlToMarkdown(preprocessed.html);
    }

    const uri = getDataTransferData(dataTransfer, "text/uri-list");
    if (!uri) return null;

    const plain = getDataTransferData(dataTransfer, "text/plain");
    return getUriListMarkdown(dataTransfer, uri, plain);
  }

  private async handleExternalDropIntoEditor(event: DragEvent): Promise<string | null> {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return null;

    const files = getAttachmentFilesFromDataTransfer(dataTransfer);
    if (!files.length) return null;

    if (isExternalFileLinkDrop(event)) {
      const links = files.flatMap((file) => {
        const markdown = this.getExternalFileLinkMarkdown(file);
        return markdown ? [markdown] : [];
      });
      return links.length ? links.join("\n") : null;
    }

    event.preventDefault();
    await this.insertExternalFiles(files);
    return null;
  }

  private async pasteClipboardFiles(event: ClipboardEvent): Promise<boolean> {
    if (!event.clipboardData) return false;
    const files = getAttachmentFilesFromDataTransfer(event.clipboardData);
    if (!files.length) return false;
    event.preventDefault();
    await this.insertExternalFiles(files);
    return true;
  }

  private getExternalFileLinkMarkdown(file: AttachmentImportFile): string | null {
    const vaultFile = this.app.resolveAttachmentFile(file);
    if (vaultFile) {
      const link = this.app.fileManager.generateMarkdownLink(vaultFile, this.file?.path ?? "");
      return isEmbeddableFile(vaultFile) ? `!${link}` : link;
    }

    if (!file.filepath) return null;
    const url = file.filepath.startsWith("/") ? `file://${file.filepath}` : `file:///${file.filepath}`;
    const title = getAttachmentDisplayName(file);
    const link = `[${title}](${url})`;
    return isImageLikePath(file.filepath || file.name) ? `!${link}` : link;
  }

  private async insertExternalFiles(files: AttachmentImportFile[]): Promise<void> {
    const imported = await this.app.importAttachments(files, null, this.file);
    const inserted = imported.map((file) => `!${this.app.fileManager.generateMarkdownLink(file, this.file?.path ?? "")}`);
    if (!inserted.length) return;
    this.replaceSelection(inserted.join("\n\n"));
    this.focusSourceEditor();
  }

  private async saveDetachedHtmlImages(images: DetachedHtmlImage[]): Promise<void> {
    for (const image of images) {
      const file = await this.saveAttachmentData("Pasted image", image.extension, image.data);
      this.insertAttachmentEmbed(file, true);
    }
  }

  private async saveAttachmentData(name: string, extension: string, data: ArrayBuffer): Promise<TFile> {
    return this.app.saveAttachment(name, extension, data, this.file);
  }

  private insertAttachmentEmbed(file: TFile, appendSpacing = false): void {
    const embed = `!${this.app.fileManager.generateMarkdownLink(file, this.file?.path ?? "")}${appendSpacing ? "\n\n" : ""}`;
    this.replaceSelection(embed);
    this.focusSourceEditor();
  }

  private tryPasteUrl(event: ClipboardEvent, payload: string): boolean {
    const source = this.editor.getValue();
    const ranges = this.editor.listSelections().map((selection) => {
      const anchor = this.editor.posToOffset(selection.anchor);
      const head = this.editor.posToOffset(selection.head);
      const start = Math.min(anchor, head);
      const end = Math.max(anchor, head);
      return { start, end, empty: start === end };
    });
    if (!ranges.length || !ranges.some((range) => !range.empty)) return false;
    if (!ranges.every((range) => range.empty || !source.slice(range.start, range.end).includes("\n"))) return false;

    let urls: string[];
    if (!payload.includes("\n") && isPasteUrl(payload)) {
      urls = ranges.map(() => payload);
    } else {
      const lines = payload.split("\n");
      if (lines.length !== ranges.length || !lines.every(isPasteUrl)) return false;
      urls = lines;
    }

    const edits = ranges.map((range, index) => {
      const url = urls[index] ?? "";
      return {
        start: range.start,
        end: range.end,
        text: range.empty ? url : `[${source.slice(range.start, range.end)}](${url})`,
      };
    });
    const primaryEdit = edits[edits.length - 1];
    if (!primaryEdit) return false;
    const cursor = primaryEdit.start + primaryEdit.text.length + edits.reduce((delta, edit) => {
      if (edit.start >= primaryEdit.start) return delta;
      return delta + edit.text.length - (edit.end - edit.start);
    }, 0);

    event.preventDefault();
    this.applyTextEdits(edits, cursor);
    return true;
  }

  private pasteClipboardText(event: ClipboardEvent, text = getClipboardText(event)): boolean {
    if (!text) return false;
    event.preventDefault();
    this.replaceSelection(text);
    return true;
  }

  private handleSourceViewportContextMenu(event: MouseEvent): void {
    if (event.defaultPrevented || this.getMode() !== "source") return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target && this.editorViewHost.contentEl.contains(target)) return;
    event.preventDefault();
    this.app.menus.createMarkdownViewportMenu(this, "source", "gutter").showAtMouseEvent(event);
  }

  private handleSourceHover(event: MouseEvent): void {
    if (this.getMode() !== "source") return;
    const hit = this.findHoveredSourceLink(event);
    if (!hit) {
      this.lastHoveredEditorLink = null;
      return;
    }
    const key = `${hit.line}:${hit.start}:${hit.linktext}`;
    if (this.lastHoveredEditorLink === key) return;
    this.lastHoveredEditorLink = key;
    this.app.workspace.trigger("hover-link", {
      event,
      source: "editor",
      hoverParent: this,
      targetEl: this.editorViewHost.contentEl,
      linktext: hit.linktext,
      sourcePath: this.file?.path ?? "",
      state: { line: hit.line, start: hit.start, end: hit.end },
    });
  }

  private findHoveredSourceLink(event: MouseEvent): SourceLinkHit | null {
    const hit = this.findHoveredSourceToken(event);
    return hit?.type === "internal-link" || hit?.type === "external-link" ? hit : null;
  }

  private getEditorMenuContext(event: MouseEvent): EditorMenuContext {
    const hit = this.findHoveredSourceToken(event);
    if (!hit) return {};
    if (hit.type === "tag") {
      return {
        tag: {
          text: hit.text,
          start: { line: hit.line, ch: hit.start + 1 },
          end: { line: hit.line, ch: hit.end },
        },
      };
    }
    if (hit.type === "footref") {
      const footnote = this.getFootnoteDefinition(hit.id);
      if (!footnote) return {};
      return {
        footref: {
          id: hit.id,
          start: { line: hit.line, ch: hit.start },
          end: { line: hit.line, ch: hit.end },
          definitionStart: offsetToPosition(this.editor.getValue(), footnote.position.start.offset - 1),
          definitionEnd: offsetToPosition(this.editor.getValue(), footnote.position.end.offset),
        },
      };
    }
    if (hit.type === "external-ref-link") {
      const href = this.getExternalRefLinkHref(hit.id);
      if (!href) return {};
      return {
        externalRefLink: {
          id: hit.id,
          href,
          sourcePath: this.file?.path ?? "",
        },
      };
    }
    return {
      link: this.toEditorMenuLinkContext(hit),
    };
  }

  private getFootnoteDefinition(id: string): { position: { start: { offset: number }; end: { offset: number } } } | null {
    return this.app.metadataCache.getFileCache(this.file)?.footnotes?.find((footnote) => footnote.id === id) ?? null;
  }

  private getExternalRefLinkHref(id: string): string | null {
    const reference = this.app.metadataCache.getFileCache(this.file)?.referenceLinks?.find((link) => link.id === id);
    if (!reference || !isExternalUrl(reference.link)) return null;
    return reference.link;
  }

  private toEditorMenuLinkContext(hit: SourceLinkHit): EditorMenuLinkContext {
    return {
      type: hit.type,
      linktext: hit.linktext,
      sourcePath: this.file?.path ?? "",
      start: { line: hit.line, ch: hit.start },
      end: { line: hit.line, ch: hit.end },
      ...(hit.href ? { href: hit.href } : {}),
    };
  }

  private findHoveredSourceToken(event: MouseEvent): SourceTokenHit | null {
    const rect = this.editorViewHost.contentEl.getBoundingClientRect();
    const style = getComputedStyle(this.editorViewHost.contentEl);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 20;
    const fontSize = parseFloat(style.fontSize) || 14;
    const charWidth = fontSize * 0.58;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const x = event.clientX - rect.left + this.editorViewHost.scrollerEl.scrollLeft - paddingLeft;
    const y = event.clientY - rect.top + this.editorViewHost.scrollerEl.scrollTop - paddingTop;
    const line = Math.max(0, Math.floor(y / lineHeight));
    const ch = Math.max(0, Math.floor(x / charWidth));
    const textLine = this.editor.getValue().split(/\r?\n/)[line];
    if (!textLine) return null;
    return findLinkAt(textLine, ch, line) ?? findExternalRefLinkAt(textLine, ch, line) ?? findTagAt(textLine, ch, line) ?? findFootrefAt(textLine, ch, line);
  }

  private updateModeButton(): void {
    this.updateButtons();
  }

  updateButtons(): void {
    const isPreview = this.getMode() === "preview";
    const icon = isPreview ? "lucide-edit-3" : "lucide-book-open";
    const label = isPreview ? "Switch to edit view" : "Switch to reading view";
    setIcon(this.modeButtonEl, icon);
    this.modeButtonEl.title = label;
    this.modeButtonEl.setAttribute("aria-label", label);
  }

  private focusLine(line: number): void {
    const source = this.editor.getValue();
    const lines = source.split(/\r?\n/);
    const clamped = Math.max(0, Math.min(line, lines.length - 1));
    let offset = 0;
    for (let index = 0; index < clamped; index += 1) offset += lines[index].length + 1;
    this.setMode("source");
    this.focusSourceEditor();
    this.setSourceSelectionRange(offset, offset);
    this.handleSourceSelectionChange();
    const lineHeight = parseFloat(getComputedStyle(this.editorViewHost.contentEl).lineHeight) || 20;
    this.editorViewHost.scrollerEl.scrollTop = Math.max(0, clamped * lineHeight - this.editorViewHost.scrollerEl.clientHeight / 3);
  }

  private selectLineRange(line: number, start: number, end: number): void {
    const source = this.editor.getValue();
    const lines = source.split(/\r?\n/);
    const clampedLine = Math.max(0, Math.min(line, lines.length - 1));
    let offset = 0;
    for (let index = 0; index < clampedLine; index += 1) offset += lines[index].length + 1;
    const lineText = lines[clampedLine] ?? "";
    const from = offset + Math.max(0, Math.min(start, lineText.length));
    const to = offset + Math.max(0, Math.min(end, lineText.length));
    this.setMode("source");
    this.focusSourceEditor();
    this.setSourceSelectionRange(from, to);
    this.editor.setCursor(offsetToPosition(source, to));
    this.handleSourceSelectionChange();
    const lineHeight = parseFloat(getComputedStyle(this.editorViewHost.contentEl).lineHeight) || 20;
    this.editorViewHost.scrollerEl.scrollTop = Math.max(0, clampedLine * lineHeight - this.editorViewHost.scrollerEl.clientHeight / 3);
  }

  private getSubpathLine(subpath: string): number | null {
    const target = normalizeSubpath(subpath);
    const cache = this.file ? this.app.metadataCache.getFileCache(this.file) : null;
    for (const heading of cache?.headings ?? []) {
      if (normalizeSubpath(heading.heading) === target) return heading.position?.line ?? 0;
    }

    const lines = this.editor.getValue().split(/\r?\n/);
    const index = lines.findIndex((line) => {
      const match = /^(#{1,6})\s+(.+)$/.exec(line);
      return match ? normalizeSubpath(match[2]) === target : false;
    });
    return index === -1 ? null : index;
  }

  private focusSubpath(subpath: string): void {
    const line = this.getSubpathLine(subpath);
    if (line !== null) this.focusLine(line);
  }
}

type BacklinkSortOrder = "alphabetical" | "reverse-alphabetical";

interface EmbeddedBacklinksState {
  collapseAll: boolean;
  extraContext: boolean;
  sortOrder: BacklinkSortOrder;
  showSearch: boolean;
  searchQuery: string;
  backlinkCollapsed: boolean;
  unlinkedCollapsed: boolean;
}

class EmbeddedBacklinks extends Component {
  file: TFile | null = null;
  collapseAll = false;
  extraContext = false;
  sortOrder: BacklinkSortOrder = "alphabetical";
  isShowingSearch = false;
  searchQuery: string | null = null;
  backlinkFile: TFile | null = null;
  backlinkCollapsed = false;
  unlinkedFile: TFile | null = null;
  unlinkedCollapsed = true;
  private readonly paneEl: HTMLElement;
  private readonly navHeaderEl: HTMLElement;
  private readonly collapseAllButtonEl: HTMLButtonElement;
  private readonly extraContextButtonEl: HTMLButtonElement;
  private readonly searchButtonEl: HTMLButtonElement;
  private readonly sortSelectEl: HTMLSelectElement;
  private readonly searchContainerEl: HTMLElement;
  private readonly searchInputEl: HTMLInputElement;
  private readonly backlinkHeaderEl: HTMLElement;
  private readonly backlinkCountEl: HTMLElement;
  private readonly backlinkResultsEl: HTMLElement;
  private readonly unlinkedHeaderEl: HTMLElement;
  private readonly unlinkedCountEl: HTMLElement;
  private readonly unlinkedResultsEl: HTMLElement;
  private searchTimer: ReturnType<typeof window.setTimeout> | null = null;
  private updateVersion = 0;

  constructor(readonly app: App, readonly containerEl: HTMLElement) {
    super();
    this.paneEl = document.createElement("div");
    this.paneEl.className = "backlink-pane";
    this.containerEl.appendChild(this.paneEl);

    this.navHeaderEl = document.createElement("div");
    this.navHeaderEl.className = "backlink-pane-nav-header";
    this.paneEl.appendChild(this.navHeaderEl);

    this.collapseAllButtonEl = this.createButton("lucide-list", "Collapse all", () => this.onToggleCollapseClick());
    this.extraContextButtonEl = this.createButton("lucide-move-vertical", "Show more context", () => this.onToggleMoreContextClick());
    this.sortSelectEl = document.createElement("select");
    this.sortSelectEl.className = "backlink-pane-sort";
    this.sortSelectEl.append(new Option("A to Z", "alphabetical"), new Option("Z to A", "reverse-alphabetical"));
    this.sortSelectEl.addEventListener("change", () => this.setSortOrder(this.sortSelectEl.value as BacklinkSortOrder));
    this.searchButtonEl = this.createButton("lucide-search", "Search backlinks", () => this.onToggleShowSearch());
    this.navHeaderEl.append(this.collapseAllButtonEl, this.extraContextButtonEl, this.sortSelectEl, this.searchButtonEl);

    this.searchContainerEl = document.createElement("div");
    this.searchContainerEl.className = "backlink-pane-search";
    this.searchInputEl = document.createElement("input");
    this.searchInputEl.type = "search";
    this.searchInputEl.placeholder = "Search backlinks...";
    this.searchInputEl.addEventListener("input", () => this.debouncedUpdateSearch());
    this.searchContainerEl.appendChild(this.searchInputEl);
    this.searchContainerEl.hidden = true;
    this.paneEl.appendChild(this.searchContainerEl);

    const linked = this.createSection("Linked mentions", () => this.toggleBacklinkCollapsed());
    this.backlinkHeaderEl = linked.headerEl;
    this.backlinkCountEl = linked.countEl;
    this.backlinkResultsEl = linked.resultsEl;

    const unlinked = this.createSection("Unlinked mentions", () => this.toggleUnlinkedCollapsed());
    this.unlinkedHeaderEl = unlinked.headerEl;
    this.unlinkedCountEl = unlinked.countEl;
    this.unlinkedResultsEl = unlinked.resultsEl;

    this.setUnlinkedCollapsed(true, false);
  }

  override onload(): void {
    this.registerEvent(this.app.metadataCache.on("changed", () => this.update()));
    this.registerEvent(this.app.metadataCache.on("deleted", () => this.update()));
    this.registerEvent(this.app.vault.on("modify", () => this.update()));
  }

  override onunload(): void {
    if (this.searchTimer) window.clearTimeout(this.searchTimer);
    this.containerEl.replaceChildren();
  }

  getState(): EmbeddedBacklinksState {
    return {
      collapseAll: this.collapseAll,
      extraContext: this.extraContext,
      sortOrder: this.sortOrder,
      showSearch: this.isShowingSearch,
      searchQuery: this.searchInputEl.value,
      backlinkCollapsed: this.backlinkCollapsed,
      unlinkedCollapsed: this.unlinkedCollapsed,
    };
  }

  async setState(state: unknown): Promise<void> {
    if (!state || typeof state !== "object") return;
    const value = state as Partial<EmbeddedBacklinksState>;
    if (typeof value.collapseAll === "boolean") this.setCollapseAll(value.collapseAll);
    if (typeof value.extraContext === "boolean") this.setExtraContext(value.extraContext);
    if (typeof value.showSearch === "boolean") this.setShowSearch(value.showSearch);
    if (value.sortOrder === "alphabetical" || value.sortOrder === "reverse-alphabetical") this.setSortOrder(value.sortOrder);
    if (typeof value.backlinkCollapsed === "boolean") this.setBacklinkCollapsed(value.backlinkCollapsed, false);
    if (typeof value.unlinkedCollapsed === "boolean") this.setUnlinkedCollapsed(value.unlinkedCollapsed, false);
    if (typeof value.searchQuery === "string") {
      this.searchInputEl.value = value.searchQuery;
      this.updateSearch();
    }
  }

  update(): void {
    const file = this.file;
    this.renderLinked(file);
    void this.renderUnlinked(file, ++this.updateVersion);
    this.updateSectionHeader(this.backlinkHeaderEl, this.backlinkCollapsed);
    this.updateSectionHeader(this.unlinkedHeaderEl, this.unlinkedCollapsed);
  }

  private onToggleCollapseClick(): void {
    this.setCollapseAll(!this.collapseAll);
  }

  private setCollapseAll(collapseAll: boolean): void {
    this.collapseAll = collapseAll;
    this.collapseAllButtonEl.classList.toggle("is-active", collapseAll);
    this.setBacklinkCollapsed(collapseAll);
    this.setUnlinkedCollapsed(collapseAll);
    this.app.workspace.requestSaveLayout();
  }

  private onToggleMoreContextClick(): void {
    this.setExtraContext(!this.extraContext);
  }

  private setExtraContext(extraContext: boolean): void {
    this.extraContext = extraContext;
    this.extraContextButtonEl.classList.toggle("is-active", extraContext);
    this.update();
    this.app.workspace.requestSaveLayout();
  }

  private onToggleShowSearch(): void {
    this.setShowSearch(!this.isShowingSearch);
  }

  private setShowSearch(showSearch: boolean): void {
    this.isShowingSearch = showSearch;
    this.searchContainerEl.hidden = !showSearch;
    this.searchButtonEl.classList.toggle("is-active", showSearch);
    if (!showSearch && this.searchInputEl.value) {
      this.searchInputEl.value = "";
      this.updateSearch();
    }
    this.app.workspace.requestSaveLayout();
  }

  private setSortOrder(sortOrder: BacklinkSortOrder): void {
    this.sortOrder = sortOrder;
    this.sortSelectEl.value = sortOrder;
    this.update();
    this.app.workspace.requestSaveLayout();
  }

  private debouncedUpdateSearch(): void {
    if (this.searchTimer) window.clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => {
      this.searchTimer = null;
      this.updateSearch();
    }, 300);
  }

  private updateSearch(): void {
    const query = this.searchInputEl.value.trim();
    if (!query && !this.searchQuery) return;
    if (query && this.searchQuery === query) return;
    this.searchQuery = query || null;
    this.backlinkFile = null;
    this.unlinkedFile = null;
    this.update();
  }

  private toggleBacklinkCollapsed(): void {
    this.setBacklinkCollapsed(!this.backlinkCollapsed);
  }

  private setBacklinkCollapsed(collapsed: boolean, save = true): void {
    this.backlinkCollapsed = collapsed;
    this.backlinkResultsEl.hidden = collapsed;
    this.updateSectionHeader(this.backlinkHeaderEl, collapsed);
    if (save) this.app.workspace.requestSaveLayout();
  }

  private toggleUnlinkedCollapsed(): void {
    this.setUnlinkedCollapsed(!this.unlinkedCollapsed);
  }

  private setUnlinkedCollapsed(collapsed: boolean, save = true): void {
    this.unlinkedCollapsed = collapsed;
    this.unlinkedResultsEl.hidden = collapsed;
    this.updateSectionHeader(this.unlinkedHeaderEl, collapsed);
    if (save) this.app.workspace.requestSaveLayout();
  }

  private renderLinked(file: TFile | null): void {
    this.backlinkResultsEl.replaceChildren();
    if (!file) {
      this.backlinkCountEl.textContent = "";
      this.renderEmpty(this.backlinkResultsEl, "No active file");
      return;
    }
    const links = this.filterAndSort(this.app.linkGraph.getBacklinks(file.path));
    this.backlinkCountEl.textContent = links.length ? String(links.length) : "";
    if (links.length === 0) {
      this.renderEmpty(this.backlinkResultsEl, "No linked mentions");
      return;
    }
    for (const edge of links) this.renderBacklink(edge, this.backlinkResultsEl);
    this.backlinkFile = file;
  }

  private async renderUnlinked(file: TFile | null, version: number): Promise<void> {
    this.unlinkedResultsEl.replaceChildren();
    if (!file) {
      this.unlinkedCountEl.textContent = "";
      this.renderEmpty(this.unlinkedResultsEl, "No active file");
      return;
    }
    if (this.unlinkedCollapsed) {
      this.unlinkedCountEl.textContent = "";
      this.renderEmpty(this.unlinkedResultsEl, "Unlinked mentions are collapsed");
      return;
    }
    const mentions = await this.findUnlinkedMentions(file);
    if (version !== this.updateVersion) return;
    const filtered = this.filterAndSort(mentions);
    this.unlinkedCountEl.textContent = filtered.length ? String(filtered.length) : "";
    if (filtered.length === 0) {
      this.renderEmpty(this.unlinkedResultsEl, "No unlinked mentions");
      return;
    }
    for (const edge of filtered) this.renderBacklink(edge, this.unlinkedResultsEl);
    this.unlinkedFile = file;
  }

  private async findUnlinkedMentions(file: TFile): Promise<LinkGraphEdge[]> {
    const term = file.basename.trim();
    if (!term) return [];
    const result: LinkGraphEdge[] = [];
    const existingSources = new Set(this.app.linkGraph.getBacklinks(file.path).map((edge) => edge.from));
    for (const candidate of this.app.vault.getMarkdownFiles()) {
      if (candidate.path === file.path) continue;
      const text = await this.app.vault.read(candidate);
      const index = text.toLowerCase().indexOf(term.toLowerCase());
      if (index === -1 || existingSources.has(candidate.path)) continue;
      const lineStart = text.lastIndexOf("\n", index) + 1;
      const lineEnd = text.indexOf("\n", index);
      const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      const line = text.slice(0, index).split(/\r?\n/).length - 1;
      result.push({
        from: candidate.path,
        to: file.path,
        original: term,
        resolved: false,
        position: { line, start: index - lineStart, end: index - lineStart + term.length, text: lineText },
      });
    }
    return result;
  }

  private filterAndSort(edges: LinkGraphEdge[]): LinkGraphEdge[] {
    const query = this.searchQuery?.toLowerCase();
    const filtered = query
      ? edges.filter((edge) => `${edge.from} ${edge.original} ${edge.position?.text ?? ""}`.toLowerCase().includes(query))
      : edges;
    return filtered.sort((left, right) => {
      const order = left.from.localeCompare(right.from);
      return this.sortOrder === "alphabetical" ? order : -order;
    });
  }

  private renderBacklink(edge: LinkGraphEdge, parentEl: HTMLElement): void {
    const fileEl = document.createElement("div");
    fileEl.className = "search-result-file backlink-result";
    const titleEl = document.createElement("div");
    titleEl.className = "search-result-file-title tappable";
    titleEl.textContent = edge.from;
    titleEl.addEventListener("click", () => this.openBacklink(edge));
    fileEl.appendChild(titleEl);
    if (this.extraContext || edge.position) {
      const matchEl = document.createElement("div");
      matchEl.className = "search-result-file-match tappable";
      matchEl.textContent = edge.position?.text ?? edge.original;
      matchEl.addEventListener("click", () => this.openBacklink(edge));
      fileEl.appendChild(matchEl);
    }
    parentEl.appendChild(fileEl);
  }

  private openBacklink(edge: LinkGraphEdge): void {
    const file = this.app.vault.getFileByPath(edge.from);
    if (!file) return;
    void this.app.workspace.openFile(file, {
      active: true,
      eState: edge.position ? { line: edge.position.line, matchStart: edge.position.start, matchEnd: edge.position.end } : undefined,
    });
  }

  private createButton(icon: string, title: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clickable-icon";
    setIcon(button, icon);
    button.title = title;
    button.addEventListener("click", callback);
    return button;
  }

  private createSection(title: string, onClick: () => void): { headerEl: HTMLElement; countEl: HTMLElement; resultsEl: HTMLElement } {
    const sectionEl = document.createElement("div");
    sectionEl.className = "backlink-pane-section";
    const headerEl = document.createElement("div");
    headerEl.className = "tree-item-self is-clickable";
    headerEl.addEventListener("click", onClick);
    const iconEl = document.createElement("span");
    iconEl.className = "tree-item-icon collapse-icon";
    setIcon(iconEl, "right-triangle");
    const labelEl = document.createElement("span");
    labelEl.className = "tree-item-inner";
    labelEl.textContent = title;
    const flairOuterEl = document.createElement("span");
    flairOuterEl.className = "tree-item-flair-outer";
    const countEl = document.createElement("span");
    countEl.className = "tree-item-flair";
    flairOuterEl.appendChild(countEl);
    headerEl.append(iconEl, labelEl, flairOuterEl);
    const resultsEl = document.createElement("div");
    resultsEl.className = "search-result-container";
    sectionEl.append(headerEl, resultsEl);
    this.paneEl.appendChild(sectionEl);
    return { headerEl, countEl, resultsEl };
  }

  private updateSectionHeader(headerEl: HTMLElement, collapsed: boolean): void {
    headerEl.classList.toggle("is-collapsed", collapsed);
    headerEl.title = collapsed ? "Expand" : "Collapse";
  }

  private renderEmpty(parentEl: HTMLElement, text: string): void {
    const emptyEl = document.createElement("div");
    emptyEl.className = "search-empty-state";
    emptyEl.textContent = text;
    parentEl.appendChild(emptyEl);
  }
}

export class MarkdownEditView implements MarkdownViewModeComponent {
  readonly type = "source";
  sourceMode = false;
  hoverPopover: HoverPopover | null = null;

  constructor(readonly owner: MarkdownView) {}

  get app(): MarkdownView["app"] {
    return this.owner.app;
  }

  get file(): MarkdownView["file"] {
    return this.owner.file;
  }

  getSourceMode(): MarkdownSourceMode {
    return this.sourceMode ? "source" : "live";
  }

  setSourceMode(mode: MarkdownSourceMode): void {
    this.sourceMode = mode === "source";
  }

  toggleSource(): void {
    this.sourceMode = !this.sourceMode;
  }

  get(): string {
    return this.owner.editor.getValue();
  }

  clear(): void {
    this.set("", true);
  }

  set(data: string, _clear = false): void {
    this.owner.editor.setValue(data);
    this.owner.syncSourceValue(data);
  }

  getSelection(): string {
    return this.owner.editor.getSelection();
  }

  getFoldInfo(): FoldInfo {
    return this.owner.getEditFoldInfo();
  }

  applyFoldInfo(foldInfo: unknown): void {
    this.owner.applyFoldInfo(foldInfo);
  }

  hide(): void {
    this.owner.editorContainerEl.style.display = "none";
  }

  show(): void {
    this.owner.editorContainerEl.style.display = "";
    const sizerEl = this.owner.editorViewHost.sizerEl;
    sizerEl.prepend(this.owner.metadataContainerEl);
    sizerEl.prepend(this.owner.inlineTitleEl);
    this.owner.editorViewHost.renderDocument();
    sizerEl.appendChild(this.owner.backlinksEl);
  }

  onResize(): void {}

  setEphemeralState(_state: unknown): void {}

  getEphemeralState(): unknown {
    return {
      line: this.owner.editor.getCursor().line,
    };
  }

  getScroll(): number {
    return this.owner.editorViewHost.scrollerEl.scrollTop;
  }

  applyScroll(scroll: number): void {
    this.owner.editorViewHost.scrollerEl.scrollTop = scroll;
  }

  beforeUnload(): void {}

  destroy(): void {}
}

class MarkdownReadingMode implements MarkdownViewModeComponent {
  readonly type = "preview";
  readonly renderer: MarkdownPreviewRenderer;

  constructor(readonly owner: MarkdownView) {
    this.renderer = new MarkdownPreviewRenderer(owner.app, owner.previewRendererEl, owner.file?.path ?? "", owner);
    this.renderer.addHeader();
    this.renderer.addFooter();
    owner.registerEvent(owner.app.workspace.on("post-processor-change", () => this.renderer.rerender(true)));
  }

  get(): string {
    return this.owner.editor.getValue();
  }

  set(data: string, clear = false): void {
    this.owner.editor.setValue(data);
    this.renderer.setSourcePath(this.owner.file?.path ?? "");
    if (clear) this.renderer.clear();
    this.renderer.set(data);
  }

  getSelection(): string {
    return this.owner.previewRendererEl.ownerDocument.getSelection()?.toString() ?? "";
  }

  getFoldInfo(): FoldInfo {
    return this.renderer.getFoldInfo();
  }

  applyFoldInfo(foldInfo: unknown): void {
    this.owner.applyFoldInfo(foldInfo);
    this.renderer.applyFoldInfo(foldInfo);
  }

  hide(): void {
    this.owner.previewRendererEl.onscroll = null;
    this.owner.previewContainerEl.style.display = "none";
  }

  show(): void {
    this.owner.previewContainerEl.style.display = "";
    this.renderer.header?.el.append(this.owner.inlineTitleEl, this.owner.metadataContainerEl);
    this.renderer.footer?.el.appendChild(this.owner.backlinksEl);
    this.owner.previewRendererEl.onscroll = () => this.owner.syncScroll();
  }

  onResize(): void {}

  setEphemeralState(state: unknown): void {
    if (!state || typeof state !== "object") return;
    const viewState = state as {
      focus?: unknown;
      focusMetadata?: unknown;
      line?: unknown;
      match?: unknown;
      propertyMatches?: unknown;
      scroll?: unknown;
    };
    if (viewState.focusMetadata) {
      (
        this.owner.metadataContainerEl.querySelector<HTMLElement>(".metadata-property") ??
        this.owner.metadataContainerEl.querySelector<HTMLElement>(".metadata-properties-heading")
      )?.focus();
    } else if (viewState.focus) {
      this.renderer.previewEl.tabIndex = -1;
      this.renderer.previewEl.focus({ preventScroll: true });
    }
    if (Object.prototype.hasOwnProperty.call(viewState, "scroll")) this.renderer.applyScrollDelayed(viewState.scroll);
    const syncScroll = () => this.owner.syncScroll();
    const line = Number(viewState.line);
    if (Number.isFinite(line) && line >= 0) this.renderer.applyScrollDelayed(line, { highlight: true }, syncScroll);
    if (Array.isArray(viewState.propertyMatches)) {
      const first = viewState.propertyMatches[0] as { key?: unknown } | undefined;
      if (typeof first?.key === "string") {
        this.owner.metadataContainerEl.querySelector<HTMLElement>(`[data-property-key="${first.key}"]`)?.focus();
      }
    } else if (viewState.match && typeof viewState.match === "object") {
      const match = viewState.match as { content?: unknown; matches?: unknown };
      const firstMatch = Array.isArray(match.matches) ? match.matches[0] : null;
      if (typeof match.content === "string" && Array.isArray(firstMatch) && typeof firstMatch[0] === "number") {
        this.renderer.applyScrollDelayed(lineFromOffset(match.content, firstMatch[0]), { center: true, highlight: true }, syncScroll);
      }
    }
  }

  getEphemeralState(): unknown {
    return {};
  }

  getScroll(): number {
    return this.owner.previewRendererEl.scrollTop;
  }

  applyScroll(scroll: number): void {
    this.owner.previewRendererEl.scrollTop = scroll;
  }

  beforeUnload(): void {}

  destroy(): void {
    this.owner.preview.clear();
    this.renderer.clear();
  }

  async render(): Promise<void> {
    this.renderer.setSourcePath(this.owner.file?.path ?? "");
    this.renderer.set(this.get());
    await this.renderer.whenIdle();
  }

  foldAll(): void {
    this.renderer.foldAll();
  }

  unfoldAll(): void {
    this.renderer.unfoldAll();
  }
}

interface SourceFoldRange {
  from: number;
  to: number;
}

function getSourceFoldRangeAtLine(source: string, line: number): SourceFoldRange | null {
  return getSourceFoldRanges(source).find((range) => range.from === line) ?? null;
}

function getSourceFoldRanges(source: string): SourceFoldRange[] {
  const lines = source.split(/\r?\n/);
  const ranges: SourceFoldRange[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const level = getHeadingLevelFromLine(lines[index]);
    if (level === 0) continue;
    let end = lines.length - 1;
    for (let next = index + 1; next < lines.length; next += 1) {
      const nextLevel = getHeadingLevelFromLine(lines[next]);
      if (nextLevel > 0 && nextLevel <= level) {
        end = next - 1;
        break;
      }
    }
    if (end > index) ranges.push({ from: index, to: end });
  }
  return ranges;
}

function getHeadingLevelFromLine(line: string): number {
  const match = line.match(/^(#{1,6})\s+\S/);
  return match ? match[1].length : 0;
}

function renderEmbeddedBacklinkSection(parentEl: HTMLElement, title: string, backlinks: string[], emptyText: string): void {
  const sectionEl = document.createElement("div");
  sectionEl.className = "backlink-pane-section";
  const titleEl = document.createElement("div");
  titleEl.className = "tree-item-self backlink-pane-section-header";
  titleEl.textContent = `${title}${backlinks.length ? ` ${backlinks.length}` : ""}`;
  const childrenEl = document.createElement("div");
  childrenEl.className = "search-results-children backlink-pane-results";
  sectionEl.append(titleEl, childrenEl);
  if (backlinks.length === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "search-empty-state";
    emptyEl.textContent = emptyText;
    childrenEl.appendChild(emptyEl);
  } else {
    for (const backlink of backlinks.sort((left, right) => left.localeCompare(right))) {
      const fileEl = document.createElement("div");
      fileEl.className = "search-result-file backlink-result";
      const titleItemEl = document.createElement("div");
      titleItemEl.className = "search-result-file-title tappable";
      titleItemEl.textContent = backlink;
      fileEl.appendChild(titleItemEl);
      childrenEl.appendChild(fileEl);
    }
  }
  parentEl.appendChild(sectionEl);
}

function getInlineTitleText(element: HTMLElement): string {
  return normalizeInlineTitleText(element.textContent ?? "");
}

function normalizeInlineTitleElement(element: HTMLElement): void {
  const normalized = getInlineTitleText(element);
  if ((element.textContent ?? "") !== normalized) element.textContent = normalized;
}

function normalizeInlineTitleText(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ").trim();
}

function getRenamedMarkdownPath(file: TFile, basename: string): string {
  const filename = file.extension ? `${basename}.${file.extension}` : basename;
  return file.parentPath ? `${file.parentPath}/${filename}` : filename;
}

function lineFromOffset(content: string, offset: number): number {
  let line = 0;
  let index = 0;
  while (index < offset) {
    index = content.indexOf("\n", index);
    if (index === -1 || index >= offset) break;
    index += 1;
    line += 1;
  }
  return line;
}

function offsetToPosition(value: string, offset: number): { line: number; ch: number } {
  const before = value.slice(0, Math.max(0, Math.min(value.length, offset))).split(/\r?\n/);
  return { line: before.length - 1, ch: before[before.length - 1]?.length ?? 0 };
}

const HEADING_SUBPATH_DISALLOWED = /([:#|^\\\r\n]|%%|\[\[|\]\])/g;
const IMAGE_EXTENSIONS = new Set(["bmp", "png", "jpg", "jpeg", "gif", "svg", "webp", "avif"]);
const EMBEDDABLE_EXTENSIONS = new Set([
  "bmp",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "avif",
  "mp3",
  "wav",
  "m4a",
  "3gp",
  "flac",
  "ogg",
  "oga",
  "opus",
  "mp4",
  "webm",
  "ogv",
  "mov",
  "mkv",
  "pdf",
  "base",
  "canvas",
]);

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getLinktextSubpath(linktext: string): string | undefined {
  const withoutAlias = linktext.slice(0, linktext.indexOf("|") === -1 ? linktext.length : linktext.indexOf("|"));
  const hashIndex = withoutAlias.indexOf("#");
  const blockIndex = withoutAlias.indexOf("^");
  const indexes = [hashIndex, blockIndex].filter((index) => index !== -1);
  const index = indexes.length ? Math.min(...indexes) : -1;
  if (index === -1) return undefined;
  return withoutAlias.slice(index) || undefined;
}

function getHeadingSubpath(heading: string): string {
  return heading.replace(HEADING_SUBPATH_DISALLOWED, " ").replace(/\s+/g, " ").trim();
}

function isEmbeddableFile(file: TFile): boolean {
  return EMBEDDABLE_EXTENSIONS.has(file.extension.toLowerCase());
}

function canInsertDragSourceMarkdown(source: DragSource): boolean {
  if (source.type === "file" || source.type === "files" || source.type === "link" || source.type === "heading") return true;
  if (source.type !== "bookmarks") return false;
  const value = source as unknown as Record<string, unknown>;
  const items = Array.isArray(value.items) ? value.items : [];
  return items.some((entry) => getRecord(getRecord(entry)?.item)?.type === "file");
}

function isOpenInLeafDrop(event: DragEvent): boolean {
  const platform = globalThis.navigator?.platform ?? "";
  return /Mac|iPhone|iPad|iPod/.test(platform) ? event.shiftKey : event.altKey;
}

function isExternalFileLinkDrop(event: DragEvent): boolean {
  const platform = globalThis.navigator?.platform ?? "";
  return /Mac|iPhone|iPad|iPod/.test(platform) ? event.altKey : event.ctrlKey;
}

function setAllowedDropEffect(event: DragEvent, effect: DataTransfer["dropEffect"]): void {
  if (!event.dataTransfer || !isDropEffectAllowed(event.dataTransfer.effectAllowed, effect)) return;
  event.dataTransfer.dropEffect = effect;
}

function isDropEffectAllowed(effectAllowed: DataTransfer["effectAllowed"], effect: DataTransfer["dropEffect"]): boolean {
  if (effect === "none") return false;
  if (effectAllowed === "all") return true;
  if (effectAllowed === "uninitialized" || effectAllowed === "none") return false;
  if (effectAllowed === effect) return true;
  if (effectAllowed === "copyLink") return effect === "copy" || effect === "link";
  if (effectAllowed === "copyMove") return effect === "copy" || effect === "move";
  if (effectAllowed === "linkMove") return effect === "link" || effect === "move";
  return false;
}

function getDataTransferData(dataTransfer: DataTransfer, format: string): string {
  try {
    return dataTransfer.getData(format);
  } catch {
    return "";
  }
}

function getDataTransferFileCount(dataTransfer: DataTransfer): number {
  return dataTransfer.files?.length ?? 0;
}

function parseCssPixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function measureEditorCharacterWidth(element: HTMLElement, style: CSSStyleDeclaration, fallbackFontSize: number): number {
  const probe = document.createElement("span");
  probe.textContent = "mmmmmmmmmm";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  probe.style.fontFamily = style.fontFamily;
  probe.style.fontSize = style.fontSize;
  probe.style.fontWeight = style.fontWeight;
  probe.style.fontStyle = style.fontStyle;
  probe.style.letterSpacing = style.letterSpacing;
  element.ownerDocument.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width / 10;
  probe.remove();
  return width > 0 ? width : Math.max(1, fallbackFontSize * 0.6);
}

function getUriListMarkdown(dataTransfer: DataTransfer, uri: string, plain: string): string | null {
  if (!plain) {
    const file = getFirstDataTransferFile(dataTransfer);
    if (file && (file.extension === "webloc" || file.extension === "url")) return file.basename;
    return uri;
  }

  const lowerUri = uri.toLowerCase();
  const lowerPlain = plain.toLowerCase();
  if (lowerPlain === lowerUri || decodeURIComponent(lowerUri) === lowerPlain) return null;

  const text = `[${plain}](${uri})`;
  return isImageLikePath(uri) ? `!${text}` : text;
}

function getFirstDataTransferFile(dataTransfer: DataTransfer): { basename: string; extension: string } | null {
  const file = getAttachmentFilesFromDataTransfer(dataTransfer, "drop", false)[0];
  return file ? { basename: file.name, extension: file.extension } : null;
}

function getAttachmentDisplayName(file: AttachmentImportFile): string {
  if (file.extension === "md") return file.name;
  return file.extension ? `${file.name}.${file.extension}` : file.name;
}

function isImageLikePath(path: string): boolean {
  const withoutFragment = path.split("#", 1)[0]?.split("?", 1)[0] ?? path;
  const extension = splitAttachmentFilename(withoutFragment.slice(withoutFragment.lastIndexOf("/") + 1)).extension;
  return IMAGE_EXTENSIONS.has(extension.toLowerCase());
}

function getClipboardText(event: ClipboardEvent): string {
  const data = event.clipboardData;
  if (!data) return "";
  return data.getData("text/plain") || data.getData("text/uri-list");
}

function isPasteUrl(value: string): boolean {
  if (value.includes(" ")) return false;
  try {
    const url = new URL(value);
    return !!url.protocol && !!url.href;
  } catch {
    return false;
  }
}

function sourceToMode(source: boolean): MarkdownSourceMode {
  return source ? "source" : "live";
}

function normalizeSubpath(value: string): string {
  return value
    .replace(/^#+/, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

interface SourceLinkHit {
  type: "internal-link" | "external-link";
  linktext: string;
  line: number;
  start: number;
  end: number;
  href?: string;
}

interface SourceTagHit {
  type: "tag";
  text: string;
  line: number;
  start: number;
  end: number;
}

interface SourceFootrefHit {
  type: "footref";
  id: string;
  line: number;
  start: number;
  end: number;
}

interface SourceExternalRefLinkHit {
  type: "external-ref-link";
  id: string;
  line: number;
  start: number;
  end: number;
}

type SourceTokenHit = SourceLinkHit | SourceTagHit | SourceFootrefHit | SourceExternalRefLinkHit;

function findLinkAt(textLine: string, ch: number, line: number): SourceLinkHit | null {
  for (const match of textLine.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (ch >= start && ch <= end) {
      return { type: "internal-link", linktext: match[1], line, start, end };
    }
  }
  for (const match of textLine.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const href = match[2];
    if (ch >= start && ch <= end) {
      return isExternalUrl(href)
        ? { type: "external-link", linktext: href, href, line, start, end }
        : { type: "internal-link", linktext: href, line, start, end };
    }
  }
  return null;
}

function findTagAt(textLine: string, ch: number, line: number): SourceTagHit | null {
  for (const match of textLine.matchAll(/(^|[^\p{L}\p{N}_/-])#([\p{L}\p{N}_/-]+)/gu)) {
    const prefix = match[1] ?? "";
    const start = (match.index ?? 0) + prefix.length;
    const tag = match[2] ?? "";
    const end = start + 1 + tag.length;
    if (ch >= start && ch <= end) return { type: "tag", text: tag, line, start, end };
  }
  return null;
}

function findExternalRefLinkAt(textLine: string, ch: number, line: number): SourceExternalRefLinkHit | null {
  for (const match of textLine.matchAll(/!?\[[^\]]*\]\[([^\]\s]+)\]/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const id = match[1] ?? "";
    const refStart = end - id.length - 2;
    if (id && ch >= refStart && ch <= end) return { type: "external-ref-link", id, line, start: refStart, end };
  }
  return null;
}

function findFootrefAt(textLine: string, ch: number, line: number): SourceFootrefHit | null {
  for (const match of textLine.matchAll(/\[\^([^\]\s]+)\](?!:)/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (ch >= start && ch <= end) return { type: "footref", id: match[1], line, start, end };
  }
  return null;
}

function isExternalUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function isReservedMetadataProperty(id: string): boolean {
  return ["aliases", "cssclasses", "tags"].includes(id.toLowerCase());
}

const METADATA_TYPE_MENU_ORDER: PropertyType[] = [
  "aliases",
  "checkbox",
  "date",
  "datetime",
  "file",
  "folder",
  "multitext",
  "property",
  "number",
  "tags",
  "text",
];

function isMetadataTypeMenuItemAllowed(type: PropertyType, propertyId: string): boolean {
  const id = propertyId.toLowerCase();
  if (type === "unknown") return false;
  if (type === "aliases") return id === "aliases";
  if (type === "tags") return id === "tags";
  if (type === "file" || type === "folder" || type === "property") return false;
  return true;
}

function findDocumentSearchMatches(source: string, query: string): DocumentSearchMatch[] {
  if (query.length === 0) return [];
  const matches: DocumentSearchMatch[] = [];
  const haystack = source.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  let start = 0;
  while (start <= haystack.length) {
    const index = haystack.indexOf(needle, start);
    if (index === -1) break;
    matches.push({ start: index, end: index + query.length });
    start = index + Math.max(needle.length, 1);
  }
  return matches;
}

function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

function countLines(source: string): number {
  return source.length === 0 ? 1 : source.split(/\r?\n/).length;
}

function getFrontmatterLineCount(source: string): number {
  const match = source.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n)?/);
  if (!match) return 0;
  return match[0].replace(/\r?\n$/, "").split(/\r?\n/).length;
}
