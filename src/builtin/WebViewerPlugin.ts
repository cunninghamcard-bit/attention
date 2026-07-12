import type { App } from "../app/App";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import { registerWebCliHandlers } from "../cli/commands/wordcountWebCli";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { Notice } from "../ui/Notice";
import { ConfirmationModal } from "../ui/Modal";
import { Menu } from "../ui/Menu";
import { Setting, SettingGroup } from "../ui/Setting";
import { ItemView } from "../views/ItemView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import type { WebViewerHistoryEntry } from "../webviewer/WebViewerService";
import type { SettingTab } from "../app/SettingRegistry";
import type { WebViewerAddressSuggestion } from "../webviewer/WebViewerAddressSuggest";
import { WebViewerElementAdapter } from "../webviewer/WebViewerElementAdapter";
import { AbstractInputSuggest } from "../ui/suggest/AbstractInputSuggest";
import { MarkdownPreviewRenderer } from "../markdown/MarkdownPreviewRenderer";
import { setIcon } from "../ui/Icon";
import type { ObsidianProtocolData } from "../app/protocol/UriRouter";

const WEBVIEWER_VIEW_TYPE = "webviewer";
const WEBVIEWER_HISTORY_VIEW_TYPE = "webviewer-history";

// Zoom is deliberately NOT view state: Chromium persists zoom per-origin in
// the persist: partition, and real Obsidian only nudges the live factor
// (getZoomFactor ± 0.1). Persisting one number per view and re-applying it
// stomps the per-site memory and makes pages open at the wrong scale.
interface WebViewerState extends Record<string, unknown> {
  url?: string;
  readerMode?: boolean;
}

export class WebViewerController {
  constructor(readonly app: App) {}

  onEnable(plugin: InternalPluginWrapper): void {
    plugin.addSettingTab(new WebViewerSettingTab(this.app, this));
    const handler = (data: ObsidianProtocolData) => {
      const url = data.url ?? "about:blank";
      void this.open(url);
    };
    this.app.workspace.registerObsidianProtocolHandler("web", handler);
    plugin.register(() => this.app.workspace.unregisterObsidianProtocolHandler("web", handler));
    const session = this.app.webViewer.getActiveSession();
    this.app.webViewer.bridge.createBrowserSession(session.partition, this.app.webViewer.options.enableAdblocking);
    this.app.workspace.trigger("webviewer-session-ready", session);
  }

  async open(url = "about:blank"): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: WEBVIEWER_VIEW_TYPE, state: { url }, active: true });
  }

  openHistory(): void {
    void this.app.workspace.ensureSideLeaf(WEBVIEWER_HISTORY_VIEW_TYPE, "left", { active: true, reveal: true });
  }

  activeView(): WebViewerView | null {
    if (this.app.workspace.activeLeaf?.view instanceof WebViewerView) return this.app.workspace.activeLeaf.view;
    for (const leaf of this.app.workspace.getLeavesOfType(WEBVIEWER_VIEW_TYPE)) {
      if (leaf.view instanceof WebViewerView) return leaf.view;
    }
    return null;
  }

  focusAddressBar(): void {
    this.activeView()?.focusAddressBar();
  }

  toggleReaderMode(): void {
    this.activeView()?.toggleReaderMode();
  }

  zoom(delta: number): void {
    if (delta > 0) this.activeView()?.zoomIn();
    else this.activeView()?.zoomOut();
  }

  resetZoom(): void {
    this.activeView()?.zoomReset();
  }

  search(): void {
    // ponytail: window.prompt until a shared prompt modal grows a text field;
    // semantics match real Obsidian — a web search in a new tab, not in-page find.
    const query = window.prompt("Search the web", "");
    if (query) void this.open(query);
  }

  async saveToVault(): Promise<void> {
    const view = this.activeView();
    if (!view) return;
    const saved = await this.app.webViewer.saveToVault(view.url, view.title, view.getReaderText());
    new Notice(`Saved ${saved.savedPath}`);
  }

  async saveImageToVault(url: string): Promise<void> {
    const saved = await this.app.webViewer.saveImageToVault(url);
    new Notice(`Saved ${saved.savedPath}`);
  }

  async saveSelectionToVault(url: string, title: string, selection: string): Promise<void> {
    const saved = await this.app.webViewer.saveToVault(url, `${title} selection`, selection);
    new Notice(`Saved ${saved.savedPath}`);
  }

  openLink(url: string, mode: "tab" | "split" | "browser" = "tab"): void {
    if (mode === "browser") {
      window.open(url, "_blank");
      return;
    }
    const leaf = this.app.workspace.getLeaf(mode);
    void leaf.setViewState({ type: WEBVIEWER_VIEW_TYPE, state: { url }, active: true });
  }

  clearData(kind: "history" | "cache" | "cookies" | "all"): void {
    this.app.webViewer.clearData(kind);
    new Notice(`Cleared Web viewer ${kind}`);
  }

  openClearDataModal(): void {
    new WebViewerClearDataModal(this.app, this).open();
  }
}

export class WebViewerView extends ItemView {
  icon = "lucide-globe-2";
  // Real webviewer views are navigable (getLeaf(false) replaces them in place).
  navigation = true;
  url = "about:blank";
  title = "Web viewer";
  readerMode = false;
  private readonly addressInputEl = document.createElement("input");
  private readonly reloadButtonEl = document.createElement("button");
  private readonly readerEl = document.createElement("div");
  private readonly readerSizerEl = document.createElement("div");
  private readonly errorEl = document.createElement("div");
  private readerActionEl: HTMLElement | null = null;
  private suggest: AddressBarSuggest | null = null;
  private adapter: WebViewerElementAdapter | null = null;
  private adapterUrl = "";
  private faviconUrl: string | null = null;
  private loading = false;
  private readerResult: { url: string; title: string; markdown: string } | null = null;
  /** Last reader render, awaitable in tests. */
  readerRender: Promise<void> = Promise.resolve();

  constructor(leaf: WorkspaceLeaf, readonly controller: WebViewerController) {
    super(leaf);
  }

  getViewType(): string {
    return WEBVIEWER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.title;
  }

  getState(): WebViewerState {
    return {
      url: this.url,
      readerMode: this.readerMode,
    };
  }

  async setState(state: unknown): Promise<void> {
    await super.setState(state);
    const next = state && typeof state === "object" ? state as WebViewerState : {};
    this.readerMode = Boolean(next.readerMode);
    // The leaf already recorded the previous view state for this setViewState
    // (openInternal does it for history !== false), so don't record again.
    this.navigateInternal(next.url ?? this.url, { record: false });
    this.applyMode();
  }

  async onOpen(): Promise<void> {
    // Faithful header layout: the address bar REPLACES the title inside
    // view-header-title-container; back/forward are the stock nav arrows
    // (navigation = true), reload is a dedicated header button before the
    // title container, reader mode is a right-side view action.
    this.headerEl.classList.add("view-header-always-show");
    const reloadContainerEl = document.createElement("div");
    reloadContainerEl.className = "view-header-reload-button";
    this.reloadButtonEl.type = "button";
    this.reloadButtonEl.className = "clickable-icon";
    // Faithful: the real reload button carries no tooltip or title.
    setIcon(this.reloadButtonEl, "lucide-rotate-cw");
    this.reloadButtonEl.addEventListener("click", () => {
      if (this.loading) this.adapter?.stop();
      else this.adapter?.reload();
    });
    reloadContainerEl.appendChild(this.reloadButtonEl);
    this.headerEl.insertBefore(reloadContainerEl, this.titleContainerEl);
    this.titleEl.remove();
    this.titleContainerEl.classList.add("webviewer-address-container");
    const addressEl = document.createElement("div");
    addressEl.className = "webviewer-address";
    this.addressInputEl.type = "text";
    this.addressInputEl.spellcheck = false;
    this.addressInputEl.addEventListener("keydown", (event) => {
      // The suggest popover consumes Enter at the keymap layer while open;
      // this fires only with the popover closed.
      if (event.key === "Enter") {
        event.preventDefault();
        this.navigate(this.addressInputEl.value);
        this.addressInputEl.blur();
      } else if (event.key === "Escape") {
        this.addressInputEl.value = this.url;
        this.addressInputEl.blur();
      }
    });
    addressEl.appendChild(this.addressInputEl);
    this.titleContainerEl.appendChild(addressEl);
    this.suggest = new AddressBarSuggest(this.app, this.addressInputEl);
    this.suggest.onSelect((suggestion) => {
      this.suggest?.close();
      this.addressInputEl.blur();
      this.navigate(suggestion.url);
    });
    this.readerActionEl = this.addAction("lucide-glasses", "Reader view", () => this.toggleReaderMode());

    // Content: the class lives on view-content ITSELF (real CSS:
    // .view-content.webviewer-content { padding: 0 }); children mount once
    // and toggle visibility — re-attaching a <webview> destroys the guest.
    this.contentEl.classList.add("webviewer-content");
    this.readerEl.className = "reader-mode-content markdown-preview-view";
    this.readerSizerEl.className = "markdown-preview-sizer";
    this.readerEl.appendChild(this.readerSizerEl);
    this.readerEl.hidden = true;
    this.errorEl.className = "error-notice";
    const errorTitleEl = document.createElement("h1");
    errorTitleEl.textContent = "Failed to load";
    const errorBodyEl = document.createElement("p");
    errorBodyEl.textContent = "The page could not be loaded. Check the address or your connection, then reload.";
    this.errorEl.append(errorTitleEl, errorBodyEl);
    this.errorEl.hidden = true;
    this.contentEl.append(this.readerEl, this.errorEl);
    this.contentEl.addEventListener("contextmenu", (event) => this.openContextMenu(event));
    this.ensureAdapter();
    this.applyMode();
  }

  async onClose(): Promise<void> {
    await super.onClose();
    this.suggest?.close();
    this.adapter?.destroy();
    this.adapter = null;
  }

  focusAddressBar(): void {
    this.addressInputEl.focus();
    this.addressInputEl.select();
  }

  navigate(input: string): void {
    this.navigateInternal(input, { record: true });
  }

  private navigateInternal(input: string, options: { record: boolean }): void {
    const url = this.app.webViewer.normalizeUrl(input);
    const adapter = this.ensureAdapter();
    if (url === this.url && this.adapterUrl === url) return;
    if (options.record) this.pushCurrentToHistory();
    this.url = url;
    this.title = titleFromUrl(url);
    this.faviconUrl = null;
    this.syncAddressInput();
    this.adapterUrl = url;
    adapter.navigate(url, true);
    this.exitReaderMode();
    this.refreshHeader();
  }

  /** Reader mode is per-page (real behavior): navigation returns to the web view. */
  private exitReaderMode(): void {
    if (!this.readerMode) return;
    this.readerMode = false;
    this.applyMode();
  }

  toggleReaderMode(): void {
    this.readerMode = !this.readerMode;
    this.applyMode();
    this.app.workspace.requestSaveLayout();
  }

  // Relative zoom against the LIVE factor, exactly like real Obsidian —
  // Chromium's per-origin zoom memory in the persist: partition does the rest.
  zoomIn(): void {
    const adapter = this.ensureAdapter();
    const factor = adapter.getZoomFactor();
    if (factor < 3) adapter.setZoom(Math.min(3, factor + 0.1));
  }

  zoomOut(): void {
    const adapter = this.ensureAdapter();
    const factor = adapter.getZoomFactor();
    if (factor > 0.5) adapter.setZoom(Math.max(0.5, factor - 0.1));
  }

  zoomReset(): void {
    this.ensureAdapter().setZoom(1);
  }

  getReaderText(): string {
    if (this.readerResult?.url === this.url) return this.readerResult.markdown;
    return `Reader snapshot for ${this.url}`;
  }

  /** Visibility-only mode switch — the webview element is never re-attached. */
  private applyMode(): void {
    const adapter = this.ensureAdapter();
    this.readerEl.hidden = !this.readerMode;
    adapter.element.style.display = this.readerMode ? "none" : "";
    this.readerActionEl?.classList.toggle("mod-webviewer", this.readerMode);
    if (this.readerMode) this.readerRender = this.renderReader();
  }

  /**
   * Real reader pipeline: inject readability into the guest, sanitize,
   * htmlToMarkdown, render with the markdown preview renderer. Cached per URL
   * so toggling reader on/off doesn't re-extract.
   */
  private async renderReader(): Promise<void> {
    const url = this.url;
    if (this.readerResult?.url !== url) {
      try {
        const result = await this.app.webViewer.reader.extractFromPage(this.ensureAdapter(), url);
        this.readerResult = { url, ...result };
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "Could not extract page content");
        this.readerMode = false;
        this.applyMode();
        return;
      }
    }
    if (!this.readerMode || this.url !== url) return;
    this.readerEl.classList.toggle("is-readable-line-width", Boolean(this.app.vault.getConfig("readableLineLength")));
    this.readerSizerEl.replaceChildren();
    const titleEl = document.createElement("h1");
    titleEl.textContent = this.readerResult.title;
    this.readerSizerEl.appendChild(titleEl);
    const bodyEl = document.createElement("div");
    this.readerSizerEl.appendChild(bodyEl);
    await MarkdownPreviewRenderer.renderMarkdown(this.app, this.readerResult.markdown, bodyEl, "", this);
  }

  private ensureAdapter(): WebViewerElementAdapter {
    if (this.adapter) return this.adapter;
    const session = this.app.webViewer.getActiveSession();
    this.adapter = new WebViewerElementAdapter({ partition: session.partition, allowPopups: true });
    // Mounted once, before the (hidden) reader/error layers. setState can run
    // before onOpen has appended those layers — appendChild keeps the same
    // final order either way (onOpen appends reader/error after the element).
    if (this.readerEl.parentElement === this.contentEl) this.contentEl.insertBefore(this.adapter.element, this.readerEl);
    else this.contentEl.appendChild(this.adapter.element);
    const commit = (payload: unknown) => this.handleCommittedNavigation(payload as { url?: string; isMainFrame?: boolean });
    this.adapter.webContents.on("did-navigate", commit);
    this.adapter.webContents.on("did-navigate-in-page", commit);
    this.adapter.webContents.on("did-redirect-navigation", commit);
    this.adapter.webContents.on("did-start-navigation", () => {
      this.setLoading(true);
      this.errorEl.hidden = true;
    });
    this.adapter.webContents.on("did-stop-loading", () => this.setLoading(false));
    this.adapter.webContents.on("did-fail-load", (payload) => {
      this.setLoading(false);
      const failure = payload as { errorCode?: number; isMainFrame?: boolean } | undefined;
      // -3 is ERR_ABORTED — fired for normal in-flight cancellations.
      if (failure?.errorCode !== -3 && failure?.isMainFrame !== false) this.errorEl.hidden = false;
    });
    this.adapter.webContents.on("page-title-updated", (payload) => {
      const title = payload && typeof payload === "object" && "title" in payload ? String((payload as { title?: unknown }).title) : titleFromUrl(this.url);
      this.title = title;
      this.refreshHeader();
    });
    this.adapter.webContents.on("page-favicon-updated", (payload) => {
      const favicons = payload && typeof payload === "object" && "favicons" in payload ? (payload as { favicons?: unknown }).favicons : null;
      if (Array.isArray(favicons) && favicons.length > 0) {
        const urls = favicons.filter((f): f is string => typeof f === "string");
        this.faviconUrl = urls.find((f) => f.includes("32")) ?? urls[0] ?? null;
        this.refreshHeader();
      }
    });
    return this.adapter;
  }

  /** Guest-committed navigation (link clicks, redirects) syncs the view. */
  private handleCommittedNavigation(payload: { url?: string; isMainFrame?: boolean }): void {
    const url = payload?.url;
    if (!url || payload.isMainFrame === false || url === this.url) return;
    this.pushCurrentToHistory();
    this.url = url;
    this.adapterUrl = url;
    this.title = titleFromUrl(url);
    this.faviconUrl = null;
    this.syncAddressInput();
    this.exitReaderMode();
    this.refreshHeader();
    this.app.webViewer.recordHistory(this.url, this.title);
  }

  /** Back/forward ride the leaf history like every navigable view. */
  private pushCurrentToHistory(): void {
    if (!this.url || this.url === "about:blank") return;
    this.leaf.recordHistory({
      title: this.title,
      icon: "lucide-globe-2",
      state: { type: WEBVIEWER_VIEW_TYPE, state: { url: this.url, readerMode: this.readerMode } },
      eState: null,
    });
  }

  private syncAddressInput(): void {
    if (document.activeElement !== this.addressInputEl) this.addressInputEl.value = this.url;
  }

  private setLoading(loading: boolean): void {
    this.loading = loading;
    this.contentEl.classList.toggle("is-loading", loading);
    setIcon(this.reloadButtonEl, loading ? "lucide-x" : "lucide-rotate-cw");
  }

  private refreshHeader(): void {
    this.updateHeader();
    this.leaf.updateHeader();
    this.syncTabIcon();
  }

  /** Real favicon in the tab header, lucide globe fallback. */
  private syncTabIcon(): void {
    if (!this.faviconUrl) return;
    const containerEl = document.createElement("div");
    containerEl.className = "webviewer-favicon-container";
    const img = document.createElement("img");
    img.addEventListener("error", () => {
      this.faviconUrl = null;
      setIcon(containerEl, "lucide-globe-2");
    });
    img.src = this.faviconUrl;
    containerEl.appendChild(img);
    this.leaf.tabHeaderInnerIconEl.replaceChildren(containerEl);
  }

  private openContextMenu(event: MouseEvent): void {
    event.preventDefault();
    const menu = new Menu();
    const target = event.target instanceof HTMLElement ? event.target : null;
    const linkEl = target?.closest<HTMLAnchorElement>("a[href]");
    const imageEl = target?.closest<HTMLImageElement>("img[src]");
    const linkUrl = linkEl?.href ? absolutizeUrl(linkEl.href, this.url) : null;
    const imageUrl = imageEl?.src ? absolutizeUrl(imageEl.src, this.url) : null;
    menu.addItem((item) => item
      .setTitle("Copy URL")
      .setIcon("lucide-copy")
      .onClick(() => void navigator.clipboard?.writeText(this.url)));
    if (linkUrl) {
      menu.addItem((item) => item
        .setTitle("Open link in Web viewer")
        .setIcon("lucide-globe")
        .onClick(() => this.controller.openLink(linkUrl, "tab")));
      menu.addItem((item) => item
        .setTitle("Open link in split")
        .setIcon("lucide-columns")
        .onClick(() => this.controller.openLink(linkUrl, "split")));
      menu.addItem((item) => item
        .setTitle("Open link in browser")
        .setIcon("lucide-external-link")
        .onClick(() => this.controller.openLink(linkUrl, "browser")));
      menu.addItem((item) => item
        .setTitle("Copy link URL")
        .setIcon("lucide-copy")
        .onClick(() => void navigator.clipboard?.writeText(linkUrl)));
    }
    if (imageUrl) {
      menu.addItem((item) => item
        .setTitle("Save image to vault")
        .setIcon("lucide-image-down")
        .onClick(() => void this.controller.saveImageToVault(imageUrl)));
      menu.addItem((item) => item
        .setTitle("Copy image URL")
        .setIcon("lucide-copy")
        .onClick(() => void navigator.clipboard?.writeText(imageUrl)));
    }
    // Real webviewer context menu: zoom section driven by the LIVE factor.
    const factor = this.adapter?.getZoomFactor() ?? 1;
    menu.addItem((item) => item
      .setTitle("Zoom in")
      .setIcon("lucide-zoom-in")
      .setDisabled(factor >= 3)
      .onClick(() => this.zoomIn()));
    menu.addItem((item) => item
      .setTitle("Reset zoom")
      .setIcon("lucide-rotate-cw")
      .setDisabled(factor === 1)
      .onClick(() => this.zoomReset()));
    menu.addItem((item) => item
      .setTitle("Zoom out")
      .setIcon("lucide-zoom-out")
      .setDisabled(factor <= 0.5)
      .onClick(() => this.zoomOut()));
    menu.addItem((item) => item
      .setTitle("Save page to vault")
      .setIcon("lucide-save")
      .onClick(() => void this.controller.saveToVault()));
    const selection = window.getSelection()?.toString().trim();
    if (selection) {
      menu.addItem((item) => item
        .setTitle("Save selection to vault")
        .setIcon("lucide-file-plus")
        .onClick(() => void this.controller.saveSelectionToVault(this.url, this.title, selection)));
    }
    menu.showAtMouseEvent(event);
  }
}

/** Address bar suggestions in the standard suggestion popover (real classes:
 * suggestion-item mod-complex webviewer-addressbar-suggestion). */
class AddressBarSuggest extends AbstractInputSuggest<WebViewerAddressSuggestion> {
  getSuggestions(input: string): WebViewerAddressSuggestion[] {
    return this.app.webViewer.getAddressSuggestions(input);
  }

  renderSuggestion(suggestion: WebViewerAddressSuggestion, el: HTMLElement): void {
    el.classList.add("mod-complex", "webviewer-addressbar-suggestion");
    const iconEl = document.createElement("div");
    iconEl.className = "suggestion-icon suggestion-flair-left";
    const icon = suggestion.type === "search" ? "lucide-search"
      : suggestion.type === "history" ? "lucide-history"
      : suggestion.type === "bookmark" ? "lucide-bookmark"
      : "lucide-globe-2";
    setIcon(iconEl, icon);
    const contentEl = document.createElement("div");
    contentEl.className = "suggestion-content";
    const titleEl = document.createElement("div");
    titleEl.className = "suggestion-title";
    titleEl.textContent = suggestion.title;
    const urlEl = document.createElement("div");
    urlEl.className = "suggestion-url";
    urlEl.textContent = suggestion.url;
    contentEl.append(titleEl, urlEl);
    el.append(iconEl, contentEl);
  }

  // Real Obsidian forces the popover to the address input's width.
  override open(): void {
    super.open();
    this.suggestEl.style.width = `${(this.textInputEl as HTMLElement).getBoundingClientRect().width}px`;
  }
}

class WebViewerHistoryView extends ItemView {
  icon = "lucide-history";

  constructor(leaf: WorkspaceLeaf, readonly controller: WebViewerController) {
    super(leaf);
  }

  getViewType(): string {
    return WEBVIEWER_HISTORY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Web viewer history";
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("webviewer-history-add", () => this.render()));
    this.registerEvent(this.app.workspace.on("webviewer-history-remove", () => this.render()));
    this.render();
  }

  private render(): void {
    this.updateHeader();
    this.contentEl.replaceChildren();
    const listEl = document.createElement("div");
    const entries = this.app.webViewer.listHistory();
    if (entries.length === 0) {
      listEl.textContent = "No web viewer history";
    }
    for (const entry of entries) this.renderEntry(listEl, entry);
    this.contentEl.appendChild(listEl);
  }

  private renderEntry(parent: HTMLElement, entry: WebViewerHistoryEntry): void {
    // Real CSS clips the row to a single line (.webviewer-history-view-item);
    // children stay inline so title and url share that line.
    const itemEl = document.createElement("div");
    itemEl.className = "webviewer-history-view-item";
    const faviconEl = document.createElement("div");
    faviconEl.className = "webviewer-favicon-container";
    setIcon(faviconEl, "lucide-globe-2");
    const textEl = document.createElement("span");
    textEl.textContent = entry.title;
    const urlEl = document.createElement("span");
    urlEl.style.color = "var(--text-muted)";
    urlEl.textContent = ` — ${entry.url}`;
    itemEl.append(faviconEl, textEl, urlEl);
    itemEl.addEventListener("click", () => void this.controller.open(entry.url));
    itemEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const menu = new Menu();
      menu.addItem((item) => item
        .setTitle("Copy URL")
        .setIcon("lucide-copy")
        .onClick(() => void navigator.clipboard?.writeText(entry.url)));
      menu.addItem((item) => item
        .setTitle("Remove from history")
        .setIcon("lucide-trash")
        .onClick(() => this.app.webViewer.removeHistoryEntry(entry.id)));
      menu.showAtMouseEvent(event);
    });
    parent.appendChild(itemEl);
  }
}

class WebViewerSettingTab implements SettingTab {
  readonly id = "webviewer";
  readonly name = "Web viewer";
  readonly icon = "lucide-globe";
  readonly section = "core-plugins" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");

  constructor(readonly app: App, readonly controller: WebViewerController) {
    this.navEl.className = "vertical-tab-nav-item tappable";
    const iconEl = document.createElement("div");
    iconEl.className = "vertical-tab-nav-item-icon";
    setIcon(iconEl, this.icon);
    const titleEl = document.createElement("div");
    titleEl.className = "vertical-tab-nav-item-title";
    titleEl.textContent = this.name;
    const chevronEl = document.createElement("div");
    chevronEl.className = "vertical-tab-nav-item-chevron";
    this.navEl.append(iconEl, titleEl, chevronEl);
    this.containerEl.className = "vertical-tab-content webviewer-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const options = this.app.webViewer.options;
    const group = new SettingGroup(this.containerEl).setHeading("Web viewer");
    new Setting(group.itemsEl)
      .setName("Open external URLs")
      .setDesc("Route web links through the built-in Web viewer when possible.")
      .addToggle((toggle) => toggle.setValue(options.openExternalURLs).onChange((value) => {
        this.app.webViewer.updateOptions({ openExternalURLs: value });
      }));
    new Setting(group.itemsEl)
      .setName("Enable ad blocking")
      .setDesc("Use the browser session adblock list model for Web viewer requests.")
      .addToggle((toggle) => toggle.setValue(options.enableAdblocking).onChange((value) => {
        this.app.webViewer.updateOptions({ enableAdblocking: value });
      }));
    new Setting(group.itemsEl)
      .setName("Search engine")
      .setDesc("Used when the address bar input is not a URL.")
      .addDropdown((dropdown) => dropdown
        .addOption("duckduckgo", "DuckDuckGo")
        .addOption("google", "Google")
        .setValue(options.searchEngine)
        .onChange((value) => {
          this.app.webViewer.updateOptions({ searchEngine: value === "google" ? "google" : "duckduckgo" });
        }));
    new Setting(group.itemsEl)
      .setName("Markdown save path")
      .setDesc("Folder prefix for pages saved to the vault.")
      .addText((text) => text.setValue(options.markdownPath).onChange((value) => {
        this.app.webViewer.updateOptions({ markdownPath: value });
      }));
    new Setting(group.itemsEl)
      .setName("Adblock lists")
      .setDesc("One list URL per comma, mirrored into the active browser session.")
      .addText((text) => text.setValue(this.app.webViewer.getActiveSession().adblockLists.join(", ")).onChange((value) => {
        this.app.webViewer.setAdblockLists(this.app.webViewer.getActiveSession().id, value.split(","));
      }));
    new Setting(group.itemsEl)
      .setName("Clear browsing data")
      .setDesc("Clear local Web viewer history, cache, cookies, or all data.")
      .addButton((button) => button.setButtonText("Open").onClick(() => this.controller.openClearDataModal()));
  }

  hide(): void {
    this.containerEl.remove();
  }
}

class WebViewerClearDataModal extends ConfirmationModal {
  constructor(app: App, readonly controller: WebViewerController) {
    super(app);
    this.setTitle("Clear Web viewer data");
  }

  onOpen(): void {
    this.contentEl.replaceChildren();
    const buttonEl = this.buttonContainerEl;
    buttonEl.replaceChildren();
    const descEl = document.createElement("p");
    descEl.textContent = "Choose which local Web viewer browsing data to clear for the active browser session.";
    this.contentEl.appendChild(descEl);
    buttonEl.append(
      this.button("History", () => this.clear("history")),
      this.button("Cache", () => this.clear("cache")),
      this.button("Cookies", () => this.clear("cookies")),
      this.button("All", () => this.clear("all")),
      this.button("Cancel", () => this.close()),
    );
  }

  private clear(kind: "history" | "cache" | "cookies" | "all"): void {
    this.controller.clearData(kind);
    this.close();
  }

  private button(text: string, callback: () => void): HTMLButtonElement {
    const buttonEl = document.createElement("button");
    buttonEl.textContent = text;
    if (text === "All") buttonEl.className = "mod-warning";
    buttonEl.addEventListener("click", callback);
    return buttonEl;
  }
}

export function createWebViewerPluginDefinition(): InternalPluginDefinition {
  let controller: WebViewerController | null = null;
  return {
    id: "webviewer",
    name: "Web viewer",
    description: "Desktop web viewer with session, history, reader mode, and save-to-vault integration.",
    defaultOn: false,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new WebViewerController(app);
      plugin.instance = controller;
      plugin.registerViewType(WEBVIEWER_VIEW_TYPE, (leaf) => new WebViewerView(leaf, controller as WebViewerController));
      plugin.registerViewType(WEBVIEWER_HISTORY_VIEW_TYPE, (leaf) => new WebViewerHistoryView(leaf, controller as WebViewerController));
      registerWebCliHandlers(plugin);
      plugin.registerGlobalCommand({
        id: "webviewer:open",
        name: "Open Web viewer",
        icon: "lucide-globe",
        callback: () => void controller?.open(),
      });
      plugin.registerGlobalCommand({
        id: "webviewer:open-history",
        name: "Open Web viewer history",
        icon: "lucide-history",
        callback: () => controller?.openHistory(),
      });
      plugin.registerGlobalCommand({
        id: "webviewer:toggle-reader-mode",
        name: "Toggle reader mode",
        icon: "lucide-book-open",
        callback: () => controller?.toggleReaderMode(),
      });
      plugin.registerGlobalCommand({
        id: "webviewer:focus-address-bar",
        name: "Focus address bar",
        icon: "lucide-search",
        callback: () => controller?.focusAddressBar(),
      });
      plugin.registerGlobalCommand({
        id: "webviewer:zoom-in",
        name: "Zoom in",
        icon: "lucide-zoom-in",
        callback: () => controller?.zoom(0.1),
      });
      plugin.registerGlobalCommand({
        id: "webviewer:zoom-out",
        name: "Zoom out",
        icon: "lucide-zoom-out",
        callback: () => controller?.zoom(-0.1),
      });
      plugin.registerGlobalCommand({
        id: "webviewer:zoom-reset",
        name: "Reset zoom",
        icon: "lucide-scan",
        callback: () => controller?.resetZoom(),
      });
      plugin.registerGlobalCommand({
        id: "webviewer:search",
        name: "Search the web",
        icon: "lucide-search",
        callback: () => controller?.search(),
      });
      plugin.registerGlobalCommand({
        id: "webviewer:save-to-vault",
        name: "Save page to vault",
        icon: "lucide-save",
        callback: () => void controller?.saveToVault(),
      });
      plugin.registerRibbonItem("Open Web viewer", "lucide-globe", () => void controller?.open());
    },
    onEnable(_app: App, plugin: InternalPluginWrapper) {
      controller?.onEnable(plugin);
    },
  };
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname || url;
  } catch {
    return url;
  }
}

function absolutizeUrl(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}
