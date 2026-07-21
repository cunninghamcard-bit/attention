import type { App } from "../app/App";
import { fuzzyMatch, prepareFuzzyQuery, type FuzzyMatch } from "../core/fuzzy";
import { ConfirmationModal, Modal } from "../ui/Modal";
import { Menu } from "../ui/Menu";
import { Notice } from "../ui/Notice";
import { setIcon } from "../ui/Icon";
import { Setting } from "../ui/Setting";
import { renderResults } from "../search/SearchHelpers";
import { Platform } from "../platform/Platform";
import { formatRelativeDate } from "./git/relativeDate";
import { compareVersions } from "../core/Version";
import {
  registerActiveCloseable,
  unregisterActiveCloseable,
  type ActiveCloseable,
} from "../ui/ActiveCloseableRegistry";
import { MarkdownRenderer } from "../markdown/MarkdownRenderer";
import type { MarketplacePluginEntry } from "../plugin/PluginMarketplace";
import { URL_SCHEME } from "@app/shared/scheme";

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
  private readonly searchMatches = new Map<string, FuzzyMatch>();
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
    return this;
  }

  render(): void {
    this.sidebarEl.className = "modal-sidebar";
    this.detailEl.className = "community-modal-details";
    if (this.sidebarEl.parentElement !== this.contentEl) this.contentEl.prepend(this.sidebarEl);
    if (this.selectedId && !this.app.pluginMarketplace.getEntry(this.selectedId) && !this.query) {
      this.query = this.selectedId.split("-").join(" ");
    }
    const entries = this.getEntries();
    const selectedEntry = this.selectedId
      ? this.app.pluginMarketplace.getEntry(this.selectedId)
      : null;
    if (this.selectedId && !selectedEntry) {
      this.selectedId = null;
      this.unregisterSelectedItemCloseable();
    }
    this.renderSidebar(entries);
    if (selectedEntry) {
      this.contentEl.appendChild(this.detailEl);
      this.renderDetail(selectedEntry);
      this.registerSelectedItemCloseable();
    } else {
      this.unregisterSelectedItemCloseable();
      this.detailEl.remove();
    }
  }

  private async loadCatalogIfNeeded(force = false): Promise<void> {
    if (
      !force &&
      (this.app.pluginMarketplace.hasEntries() || this.app.pluginMarketplace.loadState === "loaded")
    )
      return;
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
    const query = this.query.trim();
    const preparedQuery = prepareFuzzyQuery(query);
    this.searchMatches.clear();
    const entries = this.app.pluginMarketplace.search().filter((entry) => {
      if (this.installedOnly && !this.app.communityPlugins.get(entry.manifest.id)?.installed)
        return false;
      if (!query) return true;
      const manifest = entry.manifest;
      const match = fuzzyMatch(
        preparedQuery,
        `${manifest.name}${manifest.author ?? ""}${manifest.description ?? ""}`,
      );
      if (!match) return false;
      this.searchMatches.set(manifest.id, match);
      return true;
    });
    entries.sort((a, b) => {
      if (this.sort === "alphabetical")
        return a.manifest.name.localeCompare(b.manifest.name, undefined, { sensitivity: "base" });
      if (this.sort === "update") return timestamp(b.updatedAt) - timestamp(a.updatedAt);
      if (this.sort === "release")
        return timestamp(b.releasedAt ?? b.updatedAt) - timestamp(a.releasedAt ?? a.updatedAt);
      return (b.downloads ?? 0) - (a.downloads ?? 0);
    });
    return entries;
  }

  private renderSidebar(entries: MarketplacePluginEntry[]): void {
    if (this.sidebarEl.childElementCount === 0) {
      const controlsEl = document.createElement("div");
      controlsEl.className = "community-modal-controls";
      new Setting(controlsEl)
        .addSearch((search) =>
          search
            .setValue(this.query)
            .setPlaceholder("Search community plugins...")
            .onChange((value) => {
              this.query = value;
              this.renderSidebar(this.getEntries());
            }),
        )
        .addButton((button) =>
          button
            .setIcon("lucide-sort-asc")
            .setTooltip("Change sort order")
            .setClass("clickable-icon")
            .setClass("community-plugin-sort")
            .onClick((event) => this.showSortMenu(event)),
        );
      new Setting(controlsEl).setName("Show installed only").addToggle((toggle) =>
        toggle.setValue(this.installedOnly).onChange((value) => {
          this.installedOnly = value;
          this.renderSidebar(this.getEntries());
        }),
      );
      const summaryEl = document.createElement("div");
      summaryEl.className = "community-modal-search-summary u-muted";
      controlsEl.appendChild(summaryEl);

      const wrapperEl = document.createElement("div");
      wrapperEl.className = "community-modal-search-results-wrapper";
      const statusEl = document.createElement("div");
      statusEl.className = "community-modal-search-results-status";
      const listEl = document.createElement("div");
      listEl.className = "community-modal-search-results";
      wrapperEl.append(statusEl, listEl);
      this.sidebarEl.append(controlsEl, wrapperEl);
    }

    const summaryEl = this.sidebarEl.querySelector<HTMLElement>(".community-modal-search-summary")!;
    summaryEl.textContent = `Showing ${entries.length} plugin${entries.length === 1 ? "" : "s"}`;
    const listEl = this.sidebarEl.querySelector<HTMLElement>(".community-modal-search-results")!;
    listEl.replaceChildren();
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
      emptyEl.className = "community-item";
      emptyEl.textContent = "No results found.";
      listEl.appendChild(emptyEl);
    }
  }

  private renderListItem(entry: MarketplacePluginEntry, parentEl: HTMLElement): void {
    const manifest = entry.manifest;
    const record = this.app.communityPlugins.get(manifest.id);
    const itemEl = document.createElement("div");
    itemEl.className = "community-item tappable";
    itemEl.classList.toggle("is-selected", this.selectedId === manifest.id);
    itemEl.dataset.pluginId = manifest.id;
    itemEl.tabIndex = 0;
    itemEl.setAttribute("role", "button");
    const nameEl = document.createElement("div");
    nameEl.className = "community-item-name";
    const match = this.searchMatches.get(manifest.id) ?? null;
    renderResults(nameEl, manifest.name, match);
    if (record?.installed) appendFlair(nameEl, "Installed", true);
    const authorEl = document.createElement("div");
    authorEl.className = "community-item-author";
    if (manifest.author) {
      authorEl.append("By ");
      renderResults(authorEl, manifest.author, match, -manifest.name.length);
    }
    itemEl.append(nameEl, authorEl);
    if (entry.downloads) {
      const downloadsEl = document.createElement("div");
      downloadsEl.className = "community-item-downloads";
      const iconEl = document.createElement("span");
      setIcon(iconEl, "lucide-download-cloud");
      const downloadsTextEl = document.createElement("span");
      downloadsTextEl.className = "community-item-downloads-text";
      downloadsTextEl.textContent = entry.downloads.toLocaleString();
      downloadsEl.append(iconEl, downloadsTextEl);
      itemEl.appendChild(downloadsEl);
    }
    if (entry.updatedAt) {
      const updatedEl = document.createElement("div");
      updatedEl.className = "community-item-updated";
      updatedEl.textContent = `Updated ${formatRelativeDate(entry.updatedAt)}`;
      itemEl.appendChild(updatedEl);
    }
    if (manifest.description) {
      const descEl = document.createElement("div");
      descEl.className = "community-item-desc";
      renderResults(
        descEl,
        truncate(manifest.description, 200),
        match,
        -(manifest.name.length + (manifest.author?.length ?? 0)),
      );
      itemEl.appendChild(descEl);
    }
    const select = (): void => this.selectItem(manifest.id);
    itemEl.addEventListener("click", select);
    itemEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
    parentEl.appendChild(itemEl);
  }

  private selectItem(id: string | null): void {
    if (id === null) {
      this.returnToGridView();
      return;
    }
    const entry = this.app.pluginMarketplace.getEntry(id);
    if (!entry) return;
    this.sidebarEl
      .querySelector<HTMLElement>(".community-item.is-selected")
      ?.classList.remove("is-selected");
    for (const item of this.sidebarEl.querySelectorAll<HTMLElement>(".community-item")) {
      if (item.dataset.pluginId === id) item.classList.add("is-selected");
    }
    this.selectedId = id;
    if (!this.detailEl.parentElement) this.contentEl.appendChild(this.detailEl);
    this.renderDetail(entry);
    this.registerSelectedItemCloseable();
  }

  private returnToGridView(): void {
    this.unregisterSelectedItemCloseable();
    this.sidebarEl
      .querySelector<HTMLElement>(".community-item.is-selected")
      ?.classList.remove("is-selected");
    this.selectedId = null;
    this.detailEl.remove();
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

  private renderDetail(entry: MarketplacePluginEntry): void {
    this.detailEl.replaceChildren();
    const manifest = entry.manifest;
    const record = this.app.communityPlugins.get(manifest.id);
    const installed = Boolean(record?.installed);
    const enabled = Boolean(record?.enabled);
    const updateAvailable = Boolean(
      record?.updateAvailable ||
      (record?.manifest.version && compareVersions(manifest.version, record.manifest.version) > 0),
    );

    const navEl = document.createElement("div");
    navEl.className = "modal-setting-nav-bar";
    const backEl = document.createElement("div");
    backEl.className = "clickable-icon";
    backEl.setAttribute("aria-label", "Back");
    setIcon(backEl, "lucide-chevron-left");
    backEl.addEventListener("click", () => this.returnToGridView());
    navEl.appendChild(backEl);

    const infoEl = document.createElement("div");
    infoEl.className = "community-modal-info";
    const metaEl = document.createElement("div");
    metaEl.className = "community-modal-meta";
    const titleEl = document.createElement("div");
    titleEl.className = "community-modal-info-name";
    titleEl.textContent = manifest.name;
    if (installed) appendFlair(titleEl, "Installed", true);
    metaEl.appendChild(titleEl);

    if (entry.downloads) {
      const downloadsEl = document.createElement("div");
      downloadsEl.className = "community-modal-info-downloads";
      const iconEl = document.createElement("span");
      setIcon(iconEl, "lucide-download-cloud");
      const textEl = document.createElement("span");
      textEl.className = "community-modal-info-downloads-text";
      textEl.textContent = entry.downloads.toLocaleString();
      downloadsEl.append(iconEl, textEl);
      metaEl.appendChild(downloadsEl);
    }

    if (manifest.version) {
      const versionEl = document.createElement("div");
      versionEl.className = "community-modal-info-version";
      versionEl.textContent = `Version: ${manifest.version}`;
      if (installed && record?.manifest.version)
        versionEl.append(` (currently installed: ${record.manifest.version})`);
      metaEl.appendChild(versionEl);
    }

    if (manifest.author) {
      const authorEl = document.createElement("div");
      authorEl.className = "community-modal-info-author";
      authorEl.append("By ");
      if (manifest.authorUrl) {
        const linkEl = document.createElement("a");
        linkEl.href = manifest.authorUrl;
        linkEl.target = "_blank";
        linkEl.rel = "noopener";
        linkEl.textContent = manifest.author;
        authorEl.appendChild(linkEl);
      } else authorEl.append(manifest.author);
      metaEl.appendChild(authorEl);
    }

    const repository = repositoryUrl(entry);
    if (repository) {
      const repositoryEl = document.createElement("div");
      repositoryEl.className = "community-modal-info-repo";
      repositoryEl.append("Repository: ");
      const linkEl = document.createElement("a");
      linkEl.href = repository;
      linkEl.target = "_blank";
      linkEl.rel = "noopener";
      linkEl.textContent = repository;
      repositoryEl.appendChild(linkEl);
      metaEl.appendChild(repositoryEl);
    }

    if (entry.updatedAt && repository) {
      const updatedEl = document.createElement("div");
      updatedEl.className = "community-modal-info-repo";
      updatedEl.append("Last update: ");
      const linkEl = document.createElement("a");
      linkEl.href = `${repository}/releases/latest`;
      linkEl.target = "_blank";
      linkEl.rel = "noopener";
      linkEl.textContent = formatRelativeDate(entry.updatedAt);
      updatedEl.appendChild(linkEl);
      metaEl.appendChild(updatedEl);
    }

    if (manifest.description) {
      const descEl = document.createElement("div");
      descEl.className = "community-modal-info-desc";
      descEl.textContent = manifest.description;
      metaEl.appendChild(descEl);
    }

    if (!Platform.isDesktopApp && manifest.isDesktopOnly) {
      const unsupportedEl = document.createElement("div");
      unsupportedEl.className = "mod-warning";
      unsupportedEl.textContent = "This plugin does not support your device.";
      metaEl.appendChild(unsupportedEl);
    }

    const actionsEl = document.createElement("div");
    actionsEl.className = "community-modal-button-container";
    this.renderActions(entry, actionsEl, installed, enabled, updateAvailable);
    metaEl.appendChild(actionsEl);

    const readmeEl = document.createElement("div");
    readmeEl.className = "community-modal-readme markdown-rendered";
    this.renderReadme(entry, readmeEl);
    infoEl.append(metaEl, readmeEl);
    this.detailEl.append(navEl, infoEl);
  }

  private renderReadme(entry: MarketplacePluginEntry, readmeEl: HTMLElement): void {
    if (entry.readme !== undefined) {
      void MarkdownRenderer.render(
        this.app,
        resolveReadmeMedia(entry.readme || "This plugin did not provide a README file.", entry),
        readmeEl,
        "",
      ).then(() => fixReadmeMediaUrls(readmeEl, entry));
      return;
    }
    if (entry.readmeState === "loading") {
      readmeEl.textContent = "Loading README...";
      return;
    }
    if (entry.readmeState === "error") {
      readmeEl.textContent = entry.readmeError
        ? `Failed to load README: ${entry.readmeError}`
        : "Failed to load README.";
      return;
    }
    if (!entry.readmeUrl) {
      readmeEl.textContent = "This plugin did not provide a README file.";
      return;
    }
    readmeEl.textContent = "Loading README...";
    void this.app.pluginMarketplace
      .loadReadme(entry.manifest.id)
      .then(() => {
        if (this.selectedId === entry.manifest.id) this.render();
      })
      .catch(() => {
        if (this.selectedId === entry.manifest.id) this.render();
      });
  }

  private renderActions(
    entry: MarketplacePluginEntry,
    parentEl: HTMLElement,
    installed: boolean,
    enabled: boolean,
    updateAvailable: boolean,
  ): void {
    if (!installed) {
      parentEl.appendChild(this.createActionButton("Install", () => void this.install(entry)));
    } else {
      if (updateAvailable)
        parentEl.appendChild(this.createActionButton("Update", () => void this.update(entry)));
      if (this.app.setting.getTabById(entry.manifest.id)) {
        parentEl.appendChild(
          this.createActionButton("Options", () => this.openPluginOptions(entry)),
        );
      }
      if (this.hasPluginCommands(entry.manifest.id)) {
        parentEl.appendChild(
          this.createActionButton("Hotkeys", () => this.openPluginHotkeys(entry)),
        );
      }
      parentEl.appendChild(
        this.createActionButton(
          enabled ? "Disable" : "Enable",
          () => void this.toggle(entry, !enabled),
          enabled ? "mod-destructive" : "mod-cta",
        ),
      );
      parentEl.appendChild(
        this.createActionButton("Uninstall", () => void this.uninstall(entry), "mod-destructive"),
      );
    }
    parentEl.appendChild(
      this.createActionButton("Copy share link", () => void this.copyShareLink(entry), ""),
    );
    if (entry.fundingUrl) {
      parentEl.appendChild(
        this.createActionButton(
          "Donate",
          () => new CommunityPluginDonateModal(this.app, entry).open(),
          "",
        ),
      );
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
    if (!Platform.isDesktopApp && entry.manifest.isDesktopOnly) {
      new Notice("This plugin does not support your device.");
      return;
    }
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
    try {
      await this.app.pluginInstaller.uninstall(entry.manifest.id);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.render();
    }
  }

  private async copyShareLink(entry: MarketplacePluginEntry): Promise<void> {
    await navigator.clipboard?.writeText(
      `${URL_SCHEME}show-plugin?id=${encodeURIComponent(entry.manifest.id)}`,
    );
    new Notice("Copied");
  }

  private createActionButton(
    text: string,
    callback: () => void,
    cls = "mod-cta",
  ): HTMLButtonElement {
    const buttonEl = document.createElement("button");
    buttonEl.className = cls;
    buttonEl.textContent = text;
    buttonEl.addEventListener("click", callback);
    return buttonEl;
  }

  private showSortMenu(event: MouseEvent): void {
    new Menu()
      .addItem((item) =>
        item
          .setTitle("Most downloaded")
          .setChecked(this.sort === "download")
          .onClick(() => this.setSort("download")),
      )
      .addItem((item) =>
        item
          .setTitle("Recently updated")
          .setChecked(this.sort === "update")
          .onClick(() => this.setSort("update")),
      )
      .addItem((item) =>
        item
          .setTitle("Recently released")
          .setChecked(this.sort === "release")
          .onClick(() => this.setSort("release")),
      )
      .addItem((item) =>
        item
          .setTitle("Alphabetical")
          .setChecked(this.sort === "alphabetical")
          .onClick(() => this.setSort("alphabetical")),
      )
      .showAtMouseEvent(event);
  }

  private setSort(sort: SortMode): void {
    this.sort = sort;
    window.localStorage?.setItem("communityPluginSortOrder", sort);
    this.renderSidebar(this.getEntries());
  }
}

class CommunityPluginDonateModal extends ConfirmationModal {
  constructor(
    app: App,
    readonly entry: MarketplacePluginEntry,
  ) {
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
  linkEl.rel = "noopener";
  return linkEl;
}

function timestamp(value: string | undefined): number {
  return value ? Date.parse(value) || 0 : 0;
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function appendFlair(parentEl: HTMLElement, text: string, pop = false): void {
  const flairEl = document.createElement("span");
  flairEl.className = `flair${pop ? " mod-pop" : ""}`;
  flairEl.textContent = text;
  parentEl.appendChild(flairEl);
}

function repositorySlug(entry: MarketplacePluginEntry): string | null {
  if (entry.repo) return entry.repo.replace(/^\/+|\/+$/g, "");
  const match = entry.repository?.match(/^https?:\/\/github\.com\/([^/]+\/[^/#]+)(?:[\/#]|$)/i);
  return match?.[1]?.replace(/\.git$/i, "") ?? null;
}

function repositoryUrl(entry: MarketplacePluginEntry): string | null {
  if (entry.repository) return entry.repository.replace(/\/$/, "");
  const slug = repositorySlug(entry);
  return slug ? `https://github.com/${slug}` : null;
}

function resolveReadmeMedia(markdown: string, entry: MarketplacePluginEntry): string {
  const slug = repositorySlug(entry);
  if (!slug) return markdown;
  const base = `https://raw.githubusercontent.com/${slug}/HEAD/`;
  return markdown.replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (whole, prefix, target, suffix) => {
    const match = target.match(/^<?([^>\s]+)>?(.*)$/);
    if (!match || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(match[1])) return whole;
    return `${prefix}${base}${match[1].replace(/^\/+/, "")}${match[2]}${suffix}`;
  });
}

function fixReadmeMediaUrls(root: HTMLElement, entry: MarketplacePluginEntry): void {
  const slug = repositorySlug(entry);
  if (!slug) return;
  const base = `https://raw.githubusercontent.com/${slug}/HEAD/`;
  const blobUrl = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.*)$/;
  for (const media of root.querySelectorAll<HTMLImageElement | HTMLVideoElement>("img, video")) {
    const src = media.getAttribute("src");
    if (!src) continue;
    if (!src.includes(":")) {
      media.src = `${base}${src.replace(/^\/+/, "")}`;
      continue;
    }
    const match = src.match(blobUrl);
    if (match)
      media.src = `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}`;
  }
}

function readSortOrder(): SortMode {
  const value = window.localStorage?.getItem("communityPluginSortOrder");
  return value === "update" || value === "release" || value === "alphabetical" ? value : "download";
}
