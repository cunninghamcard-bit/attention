import type { App } from "../../app/App";
import type { ThemeDefinition } from "../../app/theme/ThemeManager";
import { fuzzyMatch, prepareFuzzyQuery, type FuzzyMatch } from "../../core/fuzzy";
import { MarkdownRenderer } from "../../markdown/MarkdownRenderer";
import { renderResults } from "../../search/SearchHelpers";
import { Menu } from "../../ui/Menu";
import { Modal } from "../../ui/Modal";
import { Notice } from "../../ui/Notice";
import { setIcon } from "../../ui/Icon";
import { Setting } from "../../ui/Setting";
import {
  registerActiveCloseable,
  unregisterActiveCloseable,
  type ActiveCloseable,
} from "../../ui/ActiveCloseableRegistry";
import type { ThemeMarketplaceEntry } from "./ThemeMarketplace";

type SortMode = "download" | "release" | "alphabetical";

/** Browse, install and switch community themes using the same shell as plugins. */
export class ThemeMarketplaceModal extends Modal {
  private query = "";
  private sort: SortMode = "download";
  private installedOnly = false;
  private selectedId: string | null = null;
  private catalogLoading = false;
  private catalogError: string | null = null;
  private readonly searchMatches = new Map<string, FuzzyMatch>();
  private selectedItemCloseable: ActiveCloseable | null = null;
  private readonly sidebarEl = document.createElement("div");
  private readonly detailEl = document.createElement("div");

  constructor(
    app: App,
    private readonly updateIds: ReadonlySet<string> | null = null,
  ) {
    super(app);
    this.setTitle(updateIds ? "Theme updates" : "Community themes");
    this.modalEl.classList.add("mod-community-modal", "mod-sidebar-layout", "mod-community-theme");
    this.sort = readSortOrder();
  }

  onOpen(): void {
    this.render();
    void this.loadCatalogIfNeeded();
  }

  onClose(): void {
    this.unregisterSelectedItemCloseable();
    window.localStorage?.setItem("communityThemeSortOrder", this.sort);
  }

  override onEscapeKey(event: KeyboardEvent): void {
    if (this.selectedItemCloseable) {
      event.preventDefault();
      this.returnToGridView();
      return;
    }
    super.onEscapeKey(event);
  }

  render(): void {
    this.sidebarEl.className = "modal-sidebar";
    this.detailEl.className = "community-modal-details";
    this.contentEl.replaceChildren(this.sidebarEl);

    const entries = this.getEntries();
    const selectedEntry = entries.find((entry) => entry.manifest.id === this.selectedId) ?? null;
    if (!selectedEntry && this.selectedId) {
      this.selectedId = null;
      this.unregisterSelectedItemCloseable();
    }
    this.renderSidebar(entries);
    const current = entries.find((entry) => entry.manifest.id === this.selectedId) ?? null;
    if (current) {
      if (!this.detailEl.parentElement) this.contentEl.appendChild(this.detailEl);
      this.renderDetail(current);
      this.registerSelectedItemCloseable();
    } else {
      this.unregisterSelectedItemCloseable();
      this.detailEl.remove();
    }
  }

  private async loadCatalogIfNeeded(force = false): Promise<void> {
    if (this.catalogLoading) return;
    this.catalogLoading = true;
    this.catalogError = null;
    this.render();
    try {
      await this.app.themeMarketplace.loadCatalog(force);
    } catch (error) {
      this.catalogError = error instanceof Error ? error.message : String(error);
    } finally {
      this.catalogLoading = false;
      this.render();
    }
  }

  private getEntries(): ThemeMarketplaceEntry[] {
    const entries = new Map<string, ThemeMarketplaceEntry>();
    entries.set("", createDefaultEntry(this.app));
    for (const entry of this.app.themeMarketplace.search("")) entries.set(entry.manifest.id, entry);
    for (const theme of this.app.themes.listThemes()) {
      if (theme.id.startsWith("obsidian-default-")) continue;
      if (!entries.has(theme.id)) entries.set(theme.id, entryFromTheme(theme));
    }

    const query = this.query.trim();
    const preparedQuery = prepareFuzzyQuery(query);
    this.searchMatches.clear();
    const filtered = [...entries.values()].filter((entry) => {
      if (this.updateIds && !this.updateIds.has(entry.manifest.id)) return false;
      if (this.installedOnly && !this.isInstalled(entry.manifest.id)) return false;
      if (!query) return true;
      if (!entry.manifest.id) return false;
      const match = fuzzyMatch(
        preparedQuery,
        `${entry.manifest.name}${entry.manifest.author ?? ""}`,
      );
      if (!match) return false;
      this.searchMatches.set(entry.manifest.id, match);
      return true;
    });

    const defaultEntry = filtered.find((entry) => !entry.manifest.id);
    const themes = filtered.filter((entry) => entry.manifest.id);
    if (this.sort === "alphabetical")
      themes.sort((left, right) =>
        left.manifest.name.localeCompare(right.manifest.name, undefined, {
          sensitivity: "base",
        }),
      );
    else if (this.sort === "release") themes.reverse();
    else themes.sort((left, right) => (right.downloads ?? 0) - (left.downloads ?? 0));
    return defaultEntry ? [defaultEntry, ...themes] : themes;
  }

  private renderSidebar(entries: ThemeMarketplaceEntry[]): void {
    this.sidebarEl.replaceChildren();
    const controlsEl = document.createElement("div");
    controlsEl.className = "community-modal-controls";
    new Setting(controlsEl)
      .addSearch((search) =>
        search
          .setValue(this.query)
          .setPlaceholder("Search community themes...")
          .onChange((value) => {
            this.query = value;
            this.render();
            const inputEl = this.sidebarEl.querySelector<HTMLInputElement>(
              ".search-input-container input",
            );
            inputEl?.focus();
            inputEl?.setSelectionRange(value.length, value.length);
          }),
      )
      .addButton((button) =>
        button
          .setIcon("lucide-sort-asc")
          .setTooltip("Sort")
          .setClass("clickable-icon")
          .onClick((event) => this.showSortMenu(event)),
      );
    new Setting(controlsEl).setName("Installed only").addToggle((toggle) =>
      toggle.setValue(this.installedOnly).onChange((value) => {
        this.installedOnly = value;
        this.render();
      }),
    );
    const summaryEl = document.createElement("div");
    summaryEl.className = "community-modal-search-summary u-muted";
    summaryEl.textContent = `${entries.length} theme${entries.length === 1 ? "" : "s"}`;

    const wrapperEl = document.createElement("div");
    wrapperEl.className = "community-modal-search-results-wrapper";
    const listEl = document.createElement("div");
    listEl.className = "community-modal-search-results";

    if (this.catalogLoading) {
      const loadingEl = document.createElement("div");
      loadingEl.className = "community-modal-empty-state is-loading";
      loadingEl.textContent = "Loading community themes...";
      listEl.appendChild(loadingEl);
    } else if (this.catalogError) {
      const errorEl = document.createElement("div");
      errorEl.className = "community-modal-empty-state mod-error";
      const messageEl = document.createElement("div");
      messageEl.textContent = `Failed to load community themes: ${this.catalogError}`;
      const retryEl = document.createElement("button");
      retryEl.type = "button";
      retryEl.className = "mod-cta";
      retryEl.textContent = "Retry";
      retryEl.addEventListener("click", () => void this.loadCatalogIfNeeded(true));
      errorEl.append(messageEl, retryEl);
      listEl.appendChild(errorEl);
    } else {
      for (const entry of entries) this.renderListItem(entry, listEl);
      if (entries.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "community-modal-empty-state";
        emptyEl.textContent = "No community themes found.";
        listEl.appendChild(emptyEl);
      }
    }
    wrapperEl.append(listEl);
    controlsEl.append(summaryEl);
    this.sidebarEl.append(controlsEl, wrapperEl);
  }

  private renderListItem(entry: ThemeMarketplaceEntry, parentEl: HTMLElement): void {
    const manifest = entry.manifest;
    const itemEl = document.createElement("div");
    itemEl.className = "community-item tappable";
    itemEl.classList.toggle("is-selected", this.selectedId === manifest.id);
    itemEl.dataset.themeId = manifest.id;
    itemEl.tabIndex = 0;
    itemEl.setAttribute("role", "button");

    const nameEl = document.createElement("div");
    nameEl.className = "community-item-name";
    const match = this.searchMatches.get(manifest.id) ?? null;
    renderResults(nameEl, manifest.name, match);
    if (this.isActive(manifest.id)) appendFlair(nameEl, "Currently active", true);
    else if (this.isInstalled(manifest.id)) appendFlair(nameEl, "Installed");

    const authorEl = document.createElement("div");
    authorEl.className = "community-item-author";
    if (manifest.author) {
      authorEl.append("By ");
      renderResults(authorEl, manifest.author, match, -manifest.name.length);
    }
    const downloadsEl = document.createElement("div");
    downloadsEl.className = "community-item-downloads";
    downloadsEl.textContent = entry.downloads
      ? `${entry.downloads.toLocaleString()} downloads`
      : "";
    itemEl.append(nameEl, authorEl, downloadsEl, createPreview(entry, manifest.name));
    const select = (): void => this.selectItem(entry);
    itemEl.addEventListener("click", select);
    itemEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
    parentEl.appendChild(itemEl);
  }

  private renderDetail(entry: ThemeMarketplaceEntry | null): void {
    this.detailEl.replaceChildren();
    if (!entry) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "community-modal-details-empty-state community-modal-empty-state";
      emptyEl.textContent = "Select a community theme.";
      this.detailEl.appendChild(emptyEl);
      return;
    }

    const navEl = document.createElement("div");
    navEl.className = "modal-setting-nav-bar";
    const backEl = document.createElement("div");
    backEl.className = "clickable-icon";
    setIcon(backEl, "lucide-chevron-left");
    backEl.addEventListener("click", () => this.returnToGridView());
    navEl.appendChild(backEl);

    const manifest = entry.manifest;
    const infoEl = document.createElement("div");
    infoEl.className = "community-modal-info";
    const metaEl = document.createElement("div");
    metaEl.className = "community-modal-meta";

    const titleEl = document.createElement("h2");
    titleEl.className = "community-modal-info-name";
    titleEl.textContent = manifest.name;
    if (this.isActive(manifest.id)) appendFlair(titleEl, "Currently active", true);
    else if (this.isInstalled(manifest.id)) appendFlair(titleEl, "Installed", true);
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
      versionEl.textContent = `Version ${manifest.version}`;
      const installed = this.app.themeInstaller
        .listInstalled()
        .find((record) => record.id === manifest.id);
      if (installed?.version) versionEl.append(` · Installed ${installed.version}`);
      metaEl.appendChild(versionEl);
    }

    if (manifest.author) {
      const authorEl = document.createElement("div");
      authorEl.className = "community-modal-info-author";
      authorEl.textContent = `By ${manifest.author}`;
      metaEl.appendChild(authorEl);
    }

    if (entry.repository) {
      const repositoryEl = document.createElement("div");
      repositoryEl.className = "community-modal-info-repo";
      repositoryEl.append("Repository: ");
      const linkEl = document.createElement("a");
      linkEl.href = repositoryUrl(entry.repository);
      linkEl.target = "_blank";
      linkEl.rel = "noopener";
      linkEl.textContent = repositoryUrl(entry.repository);
      repositoryEl.appendChild(linkEl);
      metaEl.appendChild(repositoryEl);
    }

    if (manifest.description) {
      const descEl = document.createElement("div");
      descEl.className = "community-modal-info-desc";
      descEl.textContent = manifest.description;
      metaEl.appendChild(descEl);
    }

    const actionsEl = document.createElement("div");
    actionsEl.className = "community-modal-button-container";
    this.renderActions(entry, actionsEl);
    metaEl.appendChild(actionsEl);

    const readmeEl = document.createElement("div");
    readmeEl.className = "community-modal-readme markdown-rendered";
    this.renderReadme(entry, readmeEl);

    infoEl.append(metaEl, readmeEl);
    this.detailEl.append(navEl, infoEl);
  }

  private renderReadme(entry: ThemeMarketplaceEntry, readmeEl: HTMLElement): void {
    if (entry.readme !== undefined) {
      void MarkdownRenderer.render(
        this.app,
        resolveReadmeImages(entry.readme || "No README provided.", entry.repository),
        readmeEl,
        "",
      ).then(() => fixReadmeMediaUrls(readmeEl, entry.repository));
      return;
    }
    if (!entry.manifest.id || !entry.repository) {
      readmeEl.textContent = "No README provided.";
      return;
    }
    readmeEl.textContent = "Loading README...";
    if (entry.detailsState === "loading") return;
    const rerender = (): void => {
      if (this.selectedId === entry.manifest.id && this.detailEl.parentElement) {
        this.renderDetail(entry);
      }
    };
    void this.app.themeMarketplace.loadDetails(entry.manifest.id).then(rerender, rerender);
  }

  private renderActions(entry: ThemeMarketplaceEntry, parentEl: HTMLElement): void {
    const id = entry.manifest.id;
    const installed = this.isInstalled(id);
    const active = this.isActive(id);

    if (id && this.updateIds?.has(id)) {
      parentEl.appendChild(this.createActionButton("Update", () => void this.updateTheme(entry)));
    }

    if (active) {
      if (!id)
        parentEl.appendChild(this.createActionButton("Currently active", () => {}, "", true));
      else parentEl.appendChild(this.createActionButton("Stop using", () => this.useTheme("")));
    } else if (installed) {
      parentEl.appendChild(this.createActionButton("Use", () => this.useTheme(id)));
    } else {
      parentEl.appendChild(
        this.createActionButton("Install and use", () => void this.installAndUse(entry)),
      );
    }
    if (id && installed)
      parentEl.appendChild(
        this.createActionButton("Uninstall", () => void this.uninstall(id), "mod-destructive"),
      );
  }

  private async installAndUse(entry: ThemeMarketplaceEntry): Promise<void> {
    try {
      if (!this.isInstalled(entry.manifest.id)) {
        const pkg = await this.app.themeMarketplace.downloadPackage(entry.manifest.id);
        await this.app.themeInstaller.install(pkg);
      }
      this.useTheme(entry.manifest.id);
      new Notice(`Theme "${entry.manifest.name}" enabled`);
    } catch (error) {
      new Notice(`Theme install failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.render();
    }
  }

  private async updateTheme(entry: ThemeMarketplaceEntry): Promise<void> {
    try {
      await this.app.themeInstaller.update(entry.manifest.id);
      new Notice(`Theme "${entry.manifest.name}" updated`);
    } catch (error) {
      new Notice(`Theme update failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.render();
    }
  }

  private async uninstall(id: string): Promise<void> {
    try {
      await this.app.themeInstaller.uninstall(id);
      new Notice(`Theme "${id}" uninstalled`);
    } catch (error) {
      new Notice(
        `Theme uninstall failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.render();
    }
  }

  private useTheme(id: string): void {
    this.app.themes.setTheme(id);
    this.render();
  }

  private isInstalled(id: string): boolean {
    if (!id) return true;
    return (
      this.app.themeInstaller.listInstalled().some((record) => record.id === id) ||
      this.app.themes.listThemes().some((theme) => theme.id === id)
    );
  }

  private isActive(id: string): boolean {
    return (this.app.vault.getConfig<string>("cssTheme") ?? "") === id;
  }

  private selectItem(entry: ThemeMarketplaceEntry): void {
    this.sidebarEl
      .querySelector<HTMLElement>(".community-item.is-selected")
      ?.classList.remove("is-selected");
    for (const item of this.sidebarEl.querySelectorAll<HTMLElement>(".community-item")) {
      if (item.dataset.themeId === entry.manifest.id) item.classList.add("is-selected");
    }
    this.selectedId = entry.manifest.id;
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
    this.selectedItemCloseable ??= { close: () => this.returnToGridView() };
    registerActiveCloseable(this.selectedItemCloseable);
  }

  private unregisterSelectedItemCloseable(): void {
    if (!this.selectedItemCloseable) return;
    unregisterActiveCloseable(this.selectedItemCloseable);
    this.selectedItemCloseable = null;
  }

  private createActionButton(
    text: string,
    callback: () => void,
    className = "mod-cta",
    disabled = false,
  ): HTMLButtonElement {
    const buttonEl = document.createElement("button");
    buttonEl.className = className;
    buttonEl.textContent = text;
    buttonEl.disabled = disabled;
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
    window.localStorage?.setItem("communityThemeSortOrder", sort);
    this.render();
  }
}

function resolveReadmeImages(markdown: string, repository?: string): string {
  if (!repository) return markdown;
  const base = `https://raw.githubusercontent.com/${repository}/HEAD/`;
  return markdown.replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (whole, prefix, target, suffix) => {
    const match = target.match(/^<?([^>\s]+)>?(.*)$/);
    if (!match || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(match[1])) return whole;
    // Obsidian's `ty`: raw.githubusercontent/<repo>/HEAD/<path> by string join,
    // NOT `new URL` — a root-relative `/cover.png` must keep the repo path, and
    // `new URL("/cover.png", base)` would resolve it against the host root (404).
    return `${prefix}${base}${match[1].replace(/^\/+/, "")}${match[2]}${suffix}`;
  });
}

function fixReadmeMediaUrls(root: HTMLElement, repository?: string): void {
  if (!repository) return;
  const base = `https://raw.githubusercontent.com/${repository}/HEAD/`;
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

function createDefaultEntry(app: App): ThemeMarketplaceEntry {
  return {
    manifest: {
      id: "",
      name: "Default",
      version: "",
      author: "Obsidian",
      modes: ["dark", "light"],
    },
    repository: "obsidianmd/obsidian-releases",
    screenshot: app.isDarkMode() ? "dark.png" : "light.png",
    readme:
      "A simple theme designed to feel intuitive across all platforms. Supports light and dark mode.",
    detailsState: "loaded",
  };
}

function entryFromTheme(theme: ThemeDefinition): ThemeMarketplaceEntry {
  return {
    manifest: {
      id: theme.id,
      name: theme.name,
      version: theme.version ?? "",
      author: theme.author,
      modes: ["light", "dark"],
    },
  };
}

function createPreview(
  entry: ThemeMarketplaceEntry,
  alt: string,
): HTMLImageElement | HTMLDivElement {
  const url = screenshotUrl(entry);
  if (!url) return createUnavailablePreview();
  const imageEl = document.createElement("img");
  imageEl.className = "community-item-screenshot";
  imageEl.alt = alt;
  imageEl.loading = "lazy";
  imageEl.src = url;
  imageEl.addEventListener("error", () => imageEl.replaceWith(createUnavailablePreview()));
  return imageEl;
}

function createUnavailablePreview(): HTMLDivElement {
  const previewEl = document.createElement("div");
  previewEl.className = "community-item-screenshot mod-unavailable";
  const placeholderEl = document.createElement("div");
  placeholderEl.className = "placeholder-icon";
  setIcon(placeholderEl, "lucide-camera-off");
  previewEl.appendChild(placeholderEl);
  return previewEl;
}

function screenshotUrl(entry: ThemeMarketplaceEntry): string | null {
  if (!entry.screenshot) return null;
  if (/^https?:\/\//i.test(entry.screenshot)) return entry.screenshot;
  if (!entry.repository) return null;
  const repository = entry.repository.replace(/\/$/, "");
  const screenshot = entry.screenshot.replace(/^\/+/, "");
  const githubRepository = repository.replace(/^https?:\/\/github\.com\//i, "");
  if (githubRepository !== repository || /^[\w.-]+\/[\w.-]+$/.test(repository)) {
    return `https://raw.githubusercontent.com/${githubRepository}/HEAD/${screenshot}`;
  }
  return `${repositoryUrl(repository)}/${screenshot}`;
}

function repositoryUrl(repository: string): string {
  return /^https?:\/\//i.test(repository)
    ? repository
    : `https://github.com/${repository.replace(/\/$/, "")}`;
}

function appendFlair(parentEl: HTMLElement, text: string, pop = false): void {
  const flairEl = document.createElement("span");
  flairEl.className = `flair${pop ? " mod-pop" : ""}`;
  flairEl.textContent = text;
  parentEl.appendChild(flairEl);
}

function readSortOrder(): SortMode {
  const value = window.localStorage?.getItem("communityThemeSortOrder");
  return value === "download" || value === "release" || value === "alphabetical"
    ? value
    : "download";
}
