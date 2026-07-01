import type { App } from "../app/App";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { Notice } from "../ui/Notice";
import { Modal } from "../ui/Modal";
import { Menu } from "../ui/Menu";
import { Setting, SettingGroup } from "../ui/Setting";
import { ItemView } from "../views/ItemView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import type { WebViewerHistoryEntry } from "../webviewer/WebViewerService";
import type { SettingTab } from "../app/SettingRegistry";
import type { WebViewerAddressSuggestion } from "../webviewer/WebViewerAddressSuggest";
import { WebViewerElementAdapter } from "../webviewer/WebViewerElementAdapter";
import { setIcon } from "../ui/Icon";
import type { ObsidianProtocolData } from "../protocol/UriRouter";

const WEBVIEWER_VIEW_TYPE = "webviewer";
const WEBVIEWER_HISTORY_VIEW_TYPE = "webviewer-history";

interface WebViewerState extends Record<string, unknown> {
  url?: string;
  readerMode?: boolean;
  zoom?: number;
  search?: string;
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
    this.activeView()?.setZoom((this.activeView()?.zoom ?? 1) + delta);
  }

  resetZoom(): void {
    this.activeView()?.setZoom(1);
  }

  search(): void {
    const query = window.prompt("Search in page", this.activeView()?.searchQuery ?? "");
    if (query != null) this.activeView()?.setSearch(query);
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
  icon = "lucide-globe";
  url = "about:blank";
  title = "Web viewer";
  readerMode = false;
  zoom = 1;
  searchQuery = "";
  private readonly rootEl = document.createElement("div");
  private readonly addressFormEl = document.createElement("form");
  private readonly addressInputEl = document.createElement("input");
  private readonly suggestionsEl = document.createElement("div");
  private readonly contentElInner = document.createElement("div");
  private adapter: WebViewerElementAdapter | null = null;
  private adapterUrl = "";
  private loading = false;

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
      zoom: this.zoom,
      search: this.searchQuery,
    };
  }

  async setState(state: unknown): Promise<void> {
    await super.setState(state);
    const next = state && typeof state === "object" ? state as WebViewerState : {};
    this.readerMode = Boolean(next.readerMode);
    this.zoom = typeof next.zoom === "number" ? next.zoom : 1;
    this.searchQuery = next.search ?? "";
    this.navigate(next.url ?? this.url);
  }

  async onOpen(): Promise<void> {
    this.containerEl.classList.add("mod-webviewer");
    this.rootEl.className = "webviewer-container";
    this.addressFormEl.className = "webviewer-address webviewer-address-container";
    this.addressInputEl.type = "text";
    this.addressInputEl.spellcheck = false;
    this.addressInputEl.placeholder = "Search or enter URL";
    this.addressInputEl.addEventListener("focus", () => this.renderAddressSuggestions());
    this.addressInputEl.addEventListener("input", () => this.renderAddressSuggestions());
    this.addressInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.addressInputEl.value = this.url;
        this.hideAddressSuggestions();
        this.addressInputEl.blur();
      }
    });
    this.suggestionsEl.className = "webviewer-addressbar-suggestion";
    this.addressFormEl.append(
      this.iconButton("Back", "lucide-arrow-left", () => this.adapter?.goBack()),
      this.iconButton("Forward", "lucide-arrow-right", () => this.adapter?.goForward()),
      this.iconButton("Reload", "lucide-rotate-cw", () => this.adapter?.reload()),
      this.addressInputEl,
      this.iconButton("Reader", "lucide-book-open", () => this.toggleReaderMode()),
    );
    this.addressFormEl.addEventListener("submit", (event) => {
      event.preventDefault();
      this.navigate(this.addressInputEl.value);
    });
    this.contentElInner.className = "webviewer-content";
    this.rootEl.append(this.addressFormEl, this.suggestionsEl, this.contentElInner);
    this.rootEl.addEventListener("contextmenu", (event) => this.openContextMenu(event));
    this.contentEl.appendChild(this.rootEl);
    this.renderContent();
  }

  async onClose(): Promise<void> {
    await super.onClose();
    this.adapter?.destroy();
    this.adapter = null;
  }

  focusAddressBar(): void {
    this.addressInputEl.focus();
    this.addressInputEl.select();
    this.renderAddressSuggestions();
  }

  navigate(input: string): void {
    this.url = this.app.webViewer.normalizeUrl(input);
    this.title = titleFromUrl(this.url);
    this.addressInputEl.value = this.url;
    this.hideAddressSuggestions();
    this.renderContent();
    this.updateHeader();
  }

  toggleReaderMode(): void {
    this.readerMode = !this.readerMode;
    this.renderContent();
    this.app.workspace.requestSaveLayout();
  }

  setZoom(zoom: number): void {
    this.zoom = Math.max(0.25, Math.min(3, zoom));
    this.renderContent();
    this.app.workspace.requestSaveLayout();
  }

  setSearch(query: string): void {
    this.searchQuery = query;
    this.renderContent();
  }

  getReaderText(): string {
    return `Reader snapshot for ${this.url}${this.searchQuery ? `\n\nSearch: ${this.searchQuery}` : ""}`;
  }

  private renderContent(): void {
    this.contentElInner.replaceChildren();
    this.contentElInner.style.setProperty("--webviewer-zoom", String(this.zoom));
    if (this.readerMode) {
      const readerEl = document.createElement("article");
      readerEl.className = "webviewer-reader";
      const titleEl = document.createElement("h1");
      titleEl.textContent = this.title;
      const sourceEl = document.createElement("p");
      sourceEl.textContent = this.url;
      const bodyEl = document.createElement("p");
      bodyEl.textContent = this.getReaderText();
      if (this.searchQuery) bodyEl.textContent += `\n\nMatches for "${this.searchQuery}" would be highlighted by the page search layer.`;
      readerEl.append(titleEl, sourceEl, bodyEl);
      this.contentElInner.appendChild(readerEl);
      return;
    }
    const adapter = this.ensureAdapter();
    adapter.setZoom(this.zoom);
    this.contentElInner.appendChild(adapter.element);
    if (this.adapterUrl !== this.url) {
      this.adapterUrl = this.url;
      adapter.navigate(this.url, true);
    }
  }

  private ensureAdapter(): WebViewerElementAdapter {
    if (this.adapter) return this.adapter;
    const session = this.app.webViewer.getActiveSession();
    this.adapter = new WebViewerElementAdapter({ partition: session.partition, allowPopups: true });
    this.adapter.webContents.on("did-start-navigation", () => {
      this.loading = true;
      this.containerEl.classList.add("is-loading");
    });
    this.adapter.webContents.on("did-stop-loading", () => {
      this.loading = false;
      this.containerEl.classList.remove("is-loading");
    });
    this.adapter.webContents.on("did-finish-load", () => {
      this.app.webViewer.recordHistory(this.url, this.title);
    });
    this.adapter.webContents.on("did-fail-load", () => {
      this.loading = false;
      this.containerEl.classList.add("mod-error");
    });
    this.adapter.webContents.on("page-title-updated", (payload) => {
      const title = payload && typeof payload === "object" && "title" in payload ? String((payload as { title?: unknown }).title) : titleFromUrl(this.url);
      this.title = title;
      this.updateHeader();
    });
    return this.adapter;
  }

  private renderAddressSuggestions(): void {
    const suggestions = this.app.webViewer.getAddressSuggestions(this.addressInputEl.value);
    this.suggestionsEl.replaceChildren();
    this.suggestionsEl.hidden = suggestions.length === 0;
    for (const suggestion of suggestions) this.renderSuggestion(suggestion);
  }

  private renderSuggestion(suggestion: WebViewerAddressSuggestion): void {
    const itemEl = document.createElement("div");
    itemEl.className = `webviewer-addressbar-suggestion-item mod-${suggestion.type}`;
    const titleEl = document.createElement("div");
    titleEl.className = "webviewer-addressbar-suggestion-title";
    titleEl.textContent = suggestion.title;
    const urlEl = document.createElement("div");
    urlEl.className = "webviewer-addressbar-suggestion-url";
    urlEl.textContent = suggestion.url;
    itemEl.append(titleEl, urlEl);
    itemEl.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.addressInputEl.blur();
      this.navigate(suggestion.url);
    });
    this.suggestionsEl.appendChild(itemEl);
  }

  private hideAddressSuggestions(): void {
    this.suggestionsEl.hidden = true;
    this.suggestionsEl.replaceChildren();
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

  private iconButton(title: string, icon: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clickable-icon";
    button.title = title;
    button.dataset.icon = icon;
    button.addEventListener("click", callback);
    return button;
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
    listEl.className = "webviewer-history";
    const entries = this.app.webViewer.listHistory();
    if (entries.length === 0) {
      listEl.textContent = "No web viewer history";
    }
    for (const entry of entries) this.renderEntry(listEl, entry);
    this.contentEl.appendChild(listEl);
  }

  private renderEntry(parent: HTMLElement, entry: WebViewerHistoryEntry): void {
    const itemEl = document.createElement("div");
    itemEl.className = "webviewer-history-view-item";
    const faviconEl = document.createElement("div");
    faviconEl.className = "webviewer-favicon-container";
    faviconEl.dataset.icon = "lucide-globe";
    const textEl = document.createElement("div");
    textEl.className = "webviewer-history-view-item-title";
    textEl.textContent = entry.title;
    const urlEl = document.createElement("div");
    urlEl.className = "webviewer-history-view-item-url";
    urlEl.textContent = entry.url;
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

class WebViewerClearDataModal extends Modal {
  constructor(app: App, readonly controller: WebViewerController) {
    super(app);
    this.setTitle("Clear Web viewer data");
  }

  onOpen(): void {
    this.contentEl.replaceChildren();
    const buttonEl = this.ensureButtonContainer();
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
        name: "Search in page",
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
