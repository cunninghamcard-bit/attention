/**
 * Input: ../../app/App, ../../app/theme/ThemeManager, ../../dom/dom, ../../markdown/MarkdownRenderer, ../../search/SearchHelpers, ../../ui/CommunityModal, ../../ui/Notice, ../../ui/Icon
 * Output: ThemeMarketplaceModal
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { App } from "../../app/App";
import type { ThemeDefinition } from "../../app/theme/ThemeManager";
import { createDiv } from "../../dom/dom";
import { MarkdownRenderer } from "../../markdown/MarkdownRenderer";
import { prepareSimpleSearch, renderResults, type SearchResult } from "../../search/SearchHelpers";
import {
  CommunityModal,
  withButtonLoading,
  withLoading,
  type CommunityModalItem,
  type CommunitySortOrder,
} from "../../ui/CommunityModal";
import { Notice } from "../../ui/Notice";
import { setIcon } from "../../ui/Icon";
import type { ThemeMarketplaceEntry } from "./ThemeMarketplace";

interface ThemeItem extends CommunityModalItem {
  entry: ThemeMarketplaceEntry;
  matches: SearchResult | null;
  nameEl: HTMLElement | null;
  authorEl: HTMLElement | null;
}

/** Browse, install and switch community themes — same shell as community plugins. */
export class ThemeMarketplaceModal extends CommunityModal<ThemeItem> {
  protected override sortOrderOptions: readonly CommunitySortOrder[] = [
    "download",
    "release",
    "alphabetical",
  ];
  protected override emptyResultsText = "No community themes found.";

  constructor(
    app: App,
    private readonly updateIds: ReadonlySet<string> | null = null,
  ) {
    super(app);
    this.setTitle(updateIds ? "Theme updates" : "Community themes");
    this.modalEl.addClass("mod-community-theme");
    this.search.setPlaceholder("Search community themes...");
    this.sortOrder = readSortOrder();
    if (updateIds) this.installedOnlyToggleSetting.settingEl.detach();
  }

  override onClose(): void {
    super.onClose();
    window.localStorage?.setItem("communityThemeSortOrder", this.sortOrder);
  }

  /**
   * A failed catalog fetch is not fatal here: locally installed themes still list,
   * and the failure surfaces as the retryable status strip Obsidian shows.
   */
  protected async loadItems(): Promise<Map<string, ThemeItem>> {
    let loaded = true;
    try {
      await this.app.themeMarketplace.loadCatalog();
    } catch (error) {
      console.error(error);
      loaded = false;
    }
    this.renderListStatus(loaded);

    const entries = new Map<string, ThemeMarketplaceEntry>();
    entries.set("", createDefaultEntry(this.app));
    for (const entry of this.app.themeMarketplace.search("")) entries.set(entry.manifest.id, entry);
    for (const theme of this.app.themes.listThemes()) {
      if (theme.id.startsWith("obsidian-default-")) continue;
      if (!entries.has(theme.id)) entries.set(theme.id, entryFromTheme(theme));
    }

    const items = new Map<string, ThemeItem>();
    for (const entry of entries.values()) {
      const id = entry.manifest.id;
      const el = createDiv("community-item tappable");
      el.dataset.themeId = id;
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.addEventListener("click", () => this.selectItem(id));
      el.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        this.selectItem(id);
      });
      items.set(id, {
        id,
        name: entry.manifest.name,
        downloads: entry.downloads ?? 0,
        updated: entry.updatedAt ? Date.parse(entry.updatedAt) || 0 : 0,
        el,
        init: false,
        entry,
        matches: null,
        nameEl: null,
        authorEl: null,
      });
    }
    return items;
  }

  private renderListStatus(loaded: boolean): void {
    this.listStatusEl.empty();
    this.listStatusEl.toggle(!loaded);
    if (loaded) return;
    this.listStatusEl.createDiv("community-modal-search-results-status-content", (statusEl) => {
      statusEl.createDiv({ text: "Failed to load community themes." });
      statusEl
        .createDiv({ cls: "community-modal-search-results-cta", text: "Retry" })
        .addEventListener("click", () => {
          void withLoading(this.emptyStateEl, async () => {
            this.items = await this.loadItems();
            this.update();
          });
        });
    });
  }

  protected updateItems(): ThemeItem[] {
    const query = this.search.getValue().trim().toLowerCase();
    const search = query ? prepareSimpleSearch(query) : null;
    const installedOnly = this.installedOnlyToggle.getValue();
    const visible: ThemeItem[] = [];
    for (const item of this.items.values()) {
      item.matches = null;
      if (this.updateIds && !this.updateIds.has(item.id)) continue;
      if (installedOnly && !this.isInstalled(item.id)) continue;
      if (!search) {
        visible.push(item);
        continue;
      }
      if (!item.id) continue;
      const manifest = item.entry.manifest;
      const match = search(`${manifest.name}${manifest.author ?? ""}`.toLowerCase());
      if (!match) continue;
      item.matches = match;
      visible.push(item);
    }
    this.sortItems(visible);
    // The default theme is not a catalog entry — it always leads the list.
    const defaultIndex = visible.findIndex((item) => !item.id);
    if (defaultIndex > 0) visible.unshift(...visible.splice(defaultIndex, 1));
    this.queueRender(visible, (item) => this.renderItem(item));
    this.searchSummaryEl.setText(`${visible.length} theme${visible.length === 1 ? "" : "s"}`);
    return visible;
  }

  private renderItem(item: ThemeItem): void {
    const manifest = item.entry.manifest;
    if (!item.init) {
      item.nameEl = item.el.createDiv("community-item-name");
      item.authorEl = item.el.createDiv("community-item-author");
      item.el.createDiv({
        cls: "community-item-downloads",
        text: item.downloads ? `${item.downloads.toLocaleString()} downloads` : "",
      });
      item.el.appendChild(createPreview(item.entry, manifest.name));
      item.init = true;
    }
    const nameEl = item.nameEl!;
    const authorEl = item.authorEl!;
    nameEl.empty();
    authorEl.empty();
    renderResults(nameEl, manifest.name, item.matches);
    if (this.isActive(item.id)) appendFlair(nameEl, "Currently active", true);
    else if (this.isInstalled(item.id)) appendFlair(nameEl, "Installed");
    if (manifest.author) {
      authorEl.setText("By ");
      renderResults(authorEl, manifest.author, item.matches, -manifest.name.length);
    }
    item.el.show();
  }

  protected showItem(item: ThemeItem): void {
    const entry = item.entry;
    const manifest = entry.manifest;
    const infoEl = this.detailsEl.createDiv("community-modal-info");
    const metaEl = infoEl.createDiv("community-modal-meta");

    const titleEl = metaEl.createEl("h2", {
      cls: "community-modal-info-name",
      text: manifest.name,
    });
    if (this.isActive(item.id)) appendFlair(titleEl, "Currently active", true);
    else if (this.isInstalled(item.id)) appendFlair(titleEl, "Installed", true);

    if (entry.downloads) {
      metaEl.createDiv("community-modal-info-downloads", (downloadsEl) => {
        downloadsEl.createSpan({}, (iconEl) => setIcon(iconEl, "lucide-download-cloud"));
        downloadsEl.createSpan({
          cls: "community-modal-info-downloads-text",
          text: entry.downloads!.toLocaleString(),
        });
      });
    }

    if (manifest.version) {
      const versionEl = metaEl.createDiv({
        cls: "community-modal-info-version",
        text: `Version ${manifest.version}`,
      });
      const installed = this.app.themeInstaller
        .listInstalled()
        .find((record) => record.id === manifest.id);
      if (installed?.version) versionEl.appendText(` · Installed ${installed.version}`);
    }

    if (manifest.author)
      metaEl.createDiv({ cls: "community-modal-info-author", text: `By ${manifest.author}` });

    if (entry.repository) {
      metaEl.createDiv(
        { cls: "community-modal-info-repo", text: "Repository: " },
        (repositoryEl) => {
          const url = repositoryUrl(entry.repository!);
          repositoryEl.createEl("a", {
            href: url,
            text: url,
            attr: { target: "_blank", rel: "noopener" },
          });
        },
      );
    }

    if (manifest.description)
      metaEl.createDiv({ cls: "community-modal-info-desc", text: manifest.description });

    this.renderActions(item, metaEl.createDiv("community-modal-button-container"));
    this.renderReadme(entry, infoEl.createDiv("community-modal-readme markdown-rendered"));
    this.scrollIntoView(item.id);
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
      readmeEl.setText("No README provided.");
      return;
    }
    readmeEl.setText("Loading README...");
    if (entry.detailsState === "loading") return;
    const rerender = (): void => {
      if (this.selectedItemId !== entry.manifest.id) return;
      readmeEl.empty();
      this.renderReadme(entry, readmeEl);
    };
    void this.app.themeMarketplace.loadDetails(entry.manifest.id).then(rerender, rerender);
  }

  private renderActions(item: ThemeItem, parentEl: HTMLElement): void {
    const id = item.id;
    const installed = this.isInstalled(id);
    const active = this.isActive(id);

    if (id && this.updateIds?.has(id))
      this.createActionButton(parentEl, "Update", "mod-cta", (buttonEl) =>
        withButtonLoading(buttonEl, () => this.updateTheme(item)),
      );

    if (active) {
      if (!id) this.createActionButton(parentEl, "Currently active", "", () => {}).disabled = true;
      else
        this.createActionButton(parentEl, "Stop using", "mod-cta", () => this.useTheme(item, ""));
    } else if (installed) {
      this.createActionButton(parentEl, "Use", "mod-cta", () => this.useTheme(item, id));
    } else {
      this.createActionButton(parentEl, "Install and use", "mod-cta", (buttonEl) =>
        withButtonLoading(buttonEl, () => this.installAndUse(item)),
      );
    }
    if (id && installed)
      this.createActionButton(parentEl, "Uninstall", "mod-destructive", (buttonEl) =>
        withButtonLoading(buttonEl, () => this.uninstall(item)),
      );
  }

  private createActionButton(
    parentEl: HTMLElement,
    text: string,
    cls: string,
    callback: (buttonEl: HTMLButtonElement) => unknown,
  ): HTMLButtonElement {
    const buttonEl = parentEl.createEl("button", cls ? { cls, text } : { text });
    buttonEl.addEventListener("click", () => void callback(buttonEl));
    return buttonEl;
  }

  private async installAndUse(item: ThemeItem): Promise<void> {
    const entry = item.entry;
    try {
      if (!this.isInstalled(item.id)) {
        const pkg = await this.app.themeMarketplace.downloadPackage(item.id);
        await this.app.themeInstaller.install(pkg);
      }
      this.app.themes.setTheme(item.id);
      new Notice(`Theme "${entry.manifest.name}" enabled`);
    } catch (error) {
      new Notice(`Theme install failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.refresh(item);
    }
  }

  private async updateTheme(item: ThemeItem): Promise<void> {
    try {
      await this.app.themeInstaller.update(item.id);
      new Notice(`Theme "${item.entry.manifest.name}" updated`);
    } catch (error) {
      new Notice(`Theme update failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.refresh(item);
    }
  }

  private async uninstall(item: ThemeItem): Promise<void> {
    try {
      await this.app.themeInstaller.uninstall(item.id);
      new Notice(`Theme "${item.id}" uninstalled`);
    } catch (error) {
      new Notice(
        `Theme uninstall failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.refresh(item);
    }
  }

  private useTheme(item: ThemeItem, id: string): void {
    this.app.themes.setTheme(id);
    this.refresh(item);
  }

  private refresh(item: ThemeItem): void {
    this.update();
    this.selectItem(item.id);
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
  parentEl.createSpan({ cls: `flair${pop ? " mod-pop" : ""}`, text });
}

function readSortOrder(): CommunitySortOrder {
  const value = window.localStorage?.getItem("communityThemeSortOrder");
  return value === "release" || value === "alphabetical" ? value : "download";
}
