import type { App } from "../app/App";
import { ConfirmationModal, Modal } from "../ui/Modal";
import { Menu } from "../ui/Menu";
import { Notice } from "../ui/Notice";
import { registerActiveCloseable, unregisterActiveCloseable, type ActiveCloseable } from "../ui/ActiveCloseableRegistry";
import { MarkdownRenderer } from "../markdown/MarkdownRenderer";
import type { MarketplacePluginEntry } from "../plugin/PluginMarketplace";
import { URL_SCHEME } from "../protocol/scheme";

type SortMode = "download" | "update" | "release" | "alphabetical";

export class CommunityPluginMarketplaceModal extends Modal {
  private query = "";
  private sort: SortMode = "download";
  private installedOnly = false;
  private selectedId: string | null = null;
  private readonly sidebarEl = document.createElement("div");
  private readonly detailEl = document.createElement("div");
  private catalogLoading = false;
  private catalogError: string | null = null;
  private autoOpenRequested = false;
  private detailClosed = false;
  private selectedItemCloseable: ActiveCloseable | null = null;

  constructor(app: App) {
    super(app);
    this.setTitle("Community plugins");
    this.modalEl.classList.add("mod-community-modal", "mod-sidebar-layout", "mod-community-plugin");
    this.sort = readSortOrder();
  }

  onOpen(): void {
    this.render();
    void this.loadCatalogIfNeeded();
  }

  onClose(): void {
    this.unregisterSelectedItemCloseable();
    window.localStorage?.setItem("communityPluginSortOrder", this.sort);
  }

  override onEscapeKey(event: KeyboardEvent): void {
    if (this.selectedItemCloseable) {
      event.preventDefault();
      this.returnToGridView();
      return;
    }
    super.onEscapeKey(event);
  }

  setAutoOpen(pluginId: string): this {
    this.selectedId = pluginId;
    this.autoOpenRequested = true;
    this.detailClosed = false;
    return this;
  }

  render(): void {
    this.contentEl.replaceChildren();
    this.sidebarEl.className = "modal-sidebar";
    this.detailEl.className = "community-modal-details";
    this.contentEl.append(this.sidebarEl, this.detailEl);
    if (this.selectedId && !this.app.pluginMarketplace.getEntry(this.selectedId) && this.autoOpenRequested && !this.query) {
      this.query = this.selectedId.split("-").join(" ");
    }
    const entries = this.getEntries();
    let selectedEntry = this.selectedId ? this.app.pluginMarketplace.getEntry(this.selectedId) : null;
    if (this.selectedId && !selectedEntry) {
      this.selectedId = null;
      this.unregisterSelectedItemCloseable();
    }
    if (!this.selectedId && !this.autoOpenRequested && !this.detailClosed) {
      this.selectedId = entries[0]?.manifest.id ?? null;
      selectedEntry = entries[0] ?? null;
    }
    this.renderSidebar(entries);
    if (selectedEntry) {
      this.detailClosed = false;
      if (!this.detailEl.parentElement) this.contentEl.appendChild(this.detailEl);
      this.renderDetail(selectedEntry);
      this.registerSelectedItemCloseable();
    } else if (this.autoOpenRequested || this.detailClosed) {
      this.unregisterSelectedItemCloseable();
      this.detailEl.replaceChildren();
      this.detailEl.remove();
    } else {
      this.unregisterSelectedItemCloseable();
      this.renderDetail(null);
    }
  }

  private async loadCatalogIfNeeded(force = false): Promise<void> {
    if (!force && (this.app.pluginMarketplace.hasEntries() || this.app.pluginMarketplace.loadState === "loaded")) return;
    this.catalogLoading = true;
    this.catalogError = null;
    this.render();
    try {
      if (force) await this.app.pluginMarketplace.reloadObsidianReleases();
      else await this.app.pluginMarketplace.loadObsidianReleases();
    } catch (error) {
      this.catalogError = error instanceof Error ? error.message : String(error);
    } finally {
      this.catalogLoading = false;
      this.render();
    }
  }

  private getEntries(): MarketplacePluginEntry[] {
    const entries = this.app.pluginMarketplace.search({ query: this.query })
      .filter((entry) => !this.installedOnly || Boolean(this.app.communityPlugins.get(entry.manifest.id)?.installed));
    entries.sort((a, b) => {
      if (this.sort === "alphabetical") return a.manifest.name.localeCompare(b.manifest.name, undefined, { sensitivity: "base" });
      if (this.sort === "update") return timestamp(b.updatedAt) - timestamp(a.updatedAt);
      if (this.sort === "release") return timestamp(b.releasedAt ?? b.updatedAt) - timestamp(a.releasedAt ?? a.updatedAt);
      return (b.downloads ?? 0) - (a.downloads ?? 0);
    });
    return entries;
  }

  private renderSidebar(entries: MarketplacePluginEntry[]): void {
    this.sidebarEl.replaceChildren();
    const searchEl = document.createElement("input");
    searchEl.className = "community-plugin-search";
    searchEl.type = "search";
    searchEl.placeholder = "Search community plugins...";
    searchEl.value = this.query;
    searchEl.addEventListener("input", () => {
      this.query = searchEl.value;
      this.render();
    });

    const controlsEl = document.createElement("div");
    controlsEl.className = "community-modal-controls";
    const sortEl = document.createElement("button");
    sortEl.type = "button";
    sortEl.className = "clickable-icon community-plugin-sort";
    sortEl.dataset.icon = "lucide-sort-asc";
    sortEl.title = "Sort";
    sortEl.textContent = sortLabel(this.sort);
    sortEl.addEventListener("click", (event) => this.showSortMenu(event));

    const installedLabelEl = document.createElement("label");
    installedLabelEl.className = "community-plugin-installed-only";
    const installedInputEl = document.createElement("input");
    installedInputEl.type = "checkbox";
    installedInputEl.checked = this.installedOnly;
    installedInputEl.addEventListener("change", () => {
      this.installedOnly = installedInputEl.checked;
      this.render();
    });
    installedLabelEl.append(installedInputEl, " Installed only");

    controlsEl.append(searchEl, sortEl, installedLabelEl);
    const wrapperEl = document.createElement("div");
    wrapperEl.className = "community-modal-search-results-wrapper";
    const statusEl = document.createElement("div");
    statusEl.className = "community-modal-search-results-status";
    statusEl.textContent = this.catalogLoading ? "Loading community plugins..." : `${entries.length} plugin${entries.length === 1 ? "" : "s"}`;
    const listEl = document.createElement("div");
    listEl.className = "community-modal-search-results";
    if (this.catalogLoading) {
      const loadingEl = document.createElement("div");
      loadingEl.className = "community-modal-empty-state is-loading";
      loadingEl.textContent = "Loading community plugins...";
      listEl.appendChild(loadingEl);
    } else if (this.catalogError) {
      const errorEl = document.createElement("div");
      errorEl.className = "community-modal-empty-state mod-error";
      const messageEl = document.createElement("div");
      messageEl.textContent = `Failed to load community plugins: ${this.catalogError}`;
      const retryEl = document.createElement("button");
      retryEl.type = "button";
      retryEl.className = "mod-cta";
      retryEl.textContent = "Retry";
      retryEl.addEventListener("click", () => void this.loadCatalogIfNeeded(true));
      errorEl.append(messageEl, retryEl);
      listEl.appendChild(errorEl);
    } else {
      for (const entry of entries) this.renderListItem(entry, listEl);
    }
    if (!this.catalogLoading && !this.catalogError && entries.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "community-modal-empty-state";
      emptyEl.textContent = "No community plugins found.";
      listEl.appendChild(emptyEl);
    }
    wrapperEl.append(statusEl, listEl);

    this.sidebarEl.append(controlsEl, wrapperEl);
  }

  private renderListItem(entry: MarketplacePluginEntry, parentEl: HTMLElement): void {
    const manifest = entry.manifest;
    const record = this.app.communityPlugins.get(manifest.id);
    const itemEl = document.createElement("button");
    itemEl.type = "button";
    itemEl.className = "community-item tappable";
    itemEl.classList.toggle("is-selected", this.selectedId === manifest.id);
    itemEl.dataset.pluginId = manifest.id;
    const nameEl = document.createElement("div");
    nameEl.className = "community-item-name";
    nameEl.textContent = manifest.name;
    if (record?.installed) {
      const flairEl = document.createElement("span");
      flairEl.className = "flair mod-pop";
      flairEl.textContent = "Installed";
      nameEl.appendChild(flairEl);
    }
    if (record?.updateAvailable) {
      const badgeEl = document.createElement("span");
      badgeEl.className = "community-item-badge mod-update";
      badgeEl.textContent = "Update";
      nameEl.appendChild(badgeEl);
    }
    const authorEl = document.createElement("div");
    authorEl.className = "community-item-author";
    authorEl.textContent = manifest.author ?? "Unknown author";
    const descEl = document.createElement("div");
    descEl.className = "community-item-desc";
    descEl.textContent = manifest.description ?? "";
    const downloadsEl = document.createElement("div");
    downloadsEl.className = "community-item-downloads";
    const downloadsTextEl = document.createElement("span");
    downloadsTextEl.className = "community-item-downloads-text";
    downloadsTextEl.textContent = entry.downloads === undefined ? "" : `${entry.downloads.toLocaleString()} downloads`;
    downloadsEl.appendChild(downloadsTextEl);
    const updatedEl = document.createElement("div");
    updatedEl.className = "community-item-updated";
    updatedEl.textContent = entry.updatedAt ? `Updated ${entry.updatedAt}` : "";
    itemEl.append(nameEl, authorEl, downloadsEl, updatedEl, descEl);
    itemEl.addEventListener("click", () => {
      this.selectItem(manifest.id);
    });
    parentEl.appendChild(itemEl);
  }

  private selectItem(id: string | null): void {
    if (id === null) {
      this.returnToGridView();
      return;
    }
    this.selectedId = id;
    this.autoOpenRequested = false;
    this.detailClosed = false;
    this.render();
  }

  private returnToGridView(): void {
    this.unregisterSelectedItemCloseable();
    this.selectedId = null;
    this.autoOpenRequested = false;
    this.detailClosed = true;
    this.render();
  }

  private registerSelectedItemCloseable(): void {
    this.selectedItemCloseable ??= {
      close: () => this.returnToGridView(),
    };
    registerActiveCloseable(this.selectedItemCloseable);
  }

  private unregisterSelectedItemCloseable(): void {
    if (!this.selectedItemCloseable) return;
    unregisterActiveCloseable(this.selectedItemCloseable);
    this.selectedItemCloseable = null;
  }

  private renderDetail(entry: MarketplacePluginEntry | null): void {
    this.detailEl.replaceChildren();
    if (!entry) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "community-plugin-detail-empty";
      emptyEl.textContent = "Select a community plugin.";
      this.detailEl.appendChild(emptyEl);
      return;
    }

    const manifest = entry.manifest;
    const record = this.app.communityPlugins.get(manifest.id);
    const installed = Boolean(record?.installed);
    const enabled = Boolean(record?.enabled);
    const headerEl = document.createElement("div");
    headerEl.className = "community-modal-info";
    const titleEl = document.createElement("h2");
    titleEl.className = "community-modal-info-name";
    titleEl.textContent = manifest.name;
    if (installed) {
      const flairEl = document.createElement("span");
      flairEl.className = "flair mod-pop";
      flairEl.textContent = "Installed";
      titleEl.appendChild(flairEl);
    }
    const statsEl = document.createElement("div");
    statsEl.className = "community-modal-meta";
    statsEl.textContent = pluginDescription([
      entry.downloads === undefined ? null : `${entry.downloads.toLocaleString()} downloads`,
      `Latest ${manifest.version}`,
      installed ? `Current ${record?.manifest.version ?? manifest.version}` : null,
      manifest.author,
      entry.updatedAt ? `Updated ${entry.updatedAt}` : null,
      entry.repo,
    ]);
    headerEl.append(titleEl, statsEl);

    const descEl = document.createElement("p");
    descEl.className = "community-modal-info-desc";
    descEl.textContent = manifest.description ?? "";

    const actionsEl = document.createElement("div");
    actionsEl.className = "community-modal-button-container";
    this.renderActions(entry, actionsEl, installed, enabled, Boolean(record?.updateAvailable));

    const linksEl = document.createElement("div");
    linksEl.className = "community-modal-info-repo";
    if (manifest.authorUrl) linksEl.appendChild(this.createExternalButton("Author", manifest.authorUrl));
    if (entry.repository) linksEl.appendChild(this.createExternalButton("Repository", entry.repository));

    const readmeEl = document.createElement("div");
    readmeEl.className = "community-modal-readme markdown-rendered";
    this.renderReadme(entry, readmeEl);

    this.detailEl.append(headerEl, descEl, actionsEl, linksEl, readmeEl);
  }

  private renderReadme(entry: MarketplacePluginEntry, readmeEl: HTMLElement): void {
    if (entry.readme !== undefined) {
      void MarkdownRenderer.render(this.app, entry.readme || "No README provided.", readmeEl, "");
      return;
    }
    if (entry.readmeState === "loading") {
      readmeEl.textContent = "Loading README...";
      return;
    }
    if (entry.readmeState === "error") {
      readmeEl.textContent = entry.readmeError ? `Failed to load README: ${entry.readmeError}` : "Failed to load README.";
      return;
    }
    if (!entry.readmeUrl) {
      readmeEl.textContent = "No README provided.";
      return;
    }
    readmeEl.textContent = "Loading README...";
    void this.app.pluginMarketplace.loadReadme(entry.manifest.id)
      .then(() => {
        if (this.selectedId === entry.manifest.id) this.render();
      })
      .catch(() => {
        if (this.selectedId === entry.manifest.id) this.render();
      });
  }

  private renderActions(entry: MarketplacePluginEntry, parentEl: HTMLElement, installed: boolean, enabled: boolean, updateAvailable: boolean): void {
    if (!installed) {
      parentEl.appendChild(this.createActionButton("Install", () => void this.install(entry)));
    } else {
      if (updateAvailable) parentEl.appendChild(this.createActionButton("Update", () => void this.update(entry)));
      if (this.app.setting.getTabById(entry.manifest.id)) {
        parentEl.appendChild(this.createActionButton("Options", () => this.openPluginOptions(entry)));
      }
      if (this.hasPluginCommands(entry.manifest.id)) {
        parentEl.appendChild(this.createActionButton("Hotkeys", () => this.openPluginHotkeys(entry)));
      }
      parentEl.appendChild(this.createActionButton(enabled ? "Disable" : "Enable", () => void this.toggle(entry, !enabled), enabled ? "mod-destructive" : "mod-cta"));
      parentEl.appendChild(this.createActionButton("Uninstall", () => void this.uninstall(entry), "mod-destructive"));
    }
    parentEl.appendChild(this.createActionButton("Copy share link", () => void this.copyShareLink(entry), ""));
    if (entry.fundingUrl) {
      parentEl.appendChild(this.createActionButton("Donate", () => new CommunityPluginDonateModal(this.app, entry).open(), ""));
    }
  }

  private hasPluginCommands(pluginId: string): boolean {
    return this.app.commands.getCommands().some((command) => command.id.startsWith(`${pluginId}:`));
  }

  private openPluginOptions(entry: MarketplacePluginEntry): void {
    this.close();
    this.app.setting.open();
    this.app.setting.openTabById(entry.manifest.id);
  }

  private openPluginHotkeys(entry: MarketplacePluginEntry): void {
    this.app.setting.getTabById("hotkeys")?.setQuery?.(entry.manifest.id);
    this.close();
    this.app.setting.open();
    this.app.setting.openTabById("hotkeys");
  }

  private async install(entry: MarketplacePluginEntry): Promise<void> {
    const pkg = this.app.pluginMarketplace.createPackage(entry.manifest.id);
    if (!pkg) {
      new Notice(`Plugin package is not available: ${entry.manifest.id}`);
      return;
    }
    try {
      await this.app.pluginInstaller.install(pkg);
      new Notice(`Installed ${entry.manifest.name}`);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.render();
    }
  }

  private async update(entry: MarketplacePluginEntry): Promise<void> {
    try {
      await this.app.pluginInstaller.update(entry.manifest.id);
      new Notice(`Updated ${entry.manifest.name}`);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.render();
    }
  }

  private async toggle(entry: MarketplacePluginEntry, enabled: boolean): Promise<void> {
    try {
      if (enabled) await this.app.pluginInstaller.enable(entry.manifest.id, true);
      else await this.app.pluginInstaller.disable(entry.manifest.id, true);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.render();
    }
  }

  private async uninstall(entry: MarketplacePluginEntry): Promise<void> {
    await this.app.pluginInstaller.uninstall(entry.manifest.id);
    this.render();
  }

  private async copyShareLink(entry: MarketplacePluginEntry): Promise<void> {
    await navigator.clipboard?.writeText(`${URL_SCHEME}show-plugin?id=${encodeURIComponent(entry.manifest.id)}`);
    new Notice("Copied");
  }

  private createActionButton(text: string, callback: () => void, cls = "mod-cta"): HTMLButtonElement {
    const buttonEl = document.createElement("button");
    buttonEl.className = cls;
    buttonEl.textContent = text;
    buttonEl.addEventListener("click", callback);
    return buttonEl;
  }

  private createExternalButton(text: string, url: string): HTMLButtonElement {
    return this.createActionButton(text, () => window.open(url, "_blank"), "");
  }

  private showSortMenu(event: MouseEvent): void {
    new Menu()
      .addItem((item) => item.setTitle("Most downloaded").setChecked(this.sort === "download").onClick(() => this.setSort("download")))
      .addItem((item) => item.setTitle("Recently updated").setChecked(this.sort === "update").onClick(() => this.setSort("update")))
      .addItem((item) => item.setTitle("Recently released").setChecked(this.sort === "release").onClick(() => this.setSort("release")))
      .addItem((item) => item.setTitle("Alphabetical").setChecked(this.sort === "alphabetical").onClick(() => this.setSort("alphabetical")))
      .showAtMouseEvent(event);
  }

  private setSort(sort: SortMode): void {
    this.sort = sort;
    window.localStorage?.setItem("communityPluginSortOrder", sort);
    this.render();
  }
}

class CommunityPluginDonateModal extends ConfirmationModal {
  constructor(app: App, readonly entry: MarketplacePluginEntry) {
    super(app);
    this.setTitle(`Donate to ${entry.manifest.name}`);
  }

  onOpen(): void {
    this.contentEl.replaceChildren();
    this.buttonContainerEl.replaceChildren();

    this.contentEl.append(
      paragraph("If you enjoy this plugin, consider supporting the author."),
      paragraph("Community plugins are made by independent developers."),
      paragraph("Use the links below to donate or sponsor the project."),
      document.createElement("hr"),
    );
    this.renderFundingLinks();
    this.addButton("mod-cta", "Done", () => this.close());
  }

  private renderFundingLinks(): void {
    const fundingUrl = this.entry.fundingUrl as string | Record<string, string>;
    if (typeof fundingUrl === "string") {
      this.contentEl.appendChild(supportFundingParagraph(fundingUrl));
      return;
    }
    for (const [label, url] of Object.entries(fundingUrl)) {
      this.contentEl.appendChild(fundingParagraph(label, url));
    }
  }
}

function paragraph(text: string): HTMLParagraphElement {
  const el = document.createElement("p");
  el.textContent = text;
  return el;
}

function fundingParagraph(label: string, url: string): HTMLParagraphElement {
  const el = document.createElement("p");
  el.append(`${label}: `);
  el.appendChild(fundingLink(url));
  return el;
}

function supportFundingParagraph(url: string): HTMLParagraphElement {
  const el = document.createElement("p");
  el.append("Support this plugin ");
  el.appendChild(fundingLink(url));
  return el;
}

function fundingLink(url: string): HTMLAnchorElement {
  const linkEl = document.createElement("a");
  linkEl.className = "external-link";
  linkEl.href = url;
  linkEl.textContent = url;
  linkEl.target = "_blank";
  return linkEl;
}

function timestamp(value: string | undefined): number {
  return value ? Date.parse(value) || 0 : 0;
}

function pluginDescription(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function readSortOrder(): SortMode {
  const value = window.localStorage?.getItem("communityPluginSortOrder");
  return value === "update" || value === "release" || value === "alphabetical" ? value : "download";
}

function sortLabel(sort: SortMode): string {
  if (sort === "update") return "Recently updated";
  if (sort === "release") return "Recently released";
  if (sort === "alphabetical") return "Alphabetical";
  return "Most downloaded";
}
