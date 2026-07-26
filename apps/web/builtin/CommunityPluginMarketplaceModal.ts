/**
 * Input: ../app/App, ../dom/dom, ../ui/CommunityModal, ../ui/Modal, ../ui/Notice, ../ui/Icon, ../search/SearchHelpers, ../platform/Platform, ./git/relativeDate
 * Output: CommunityPluginMarketplaceModal
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { App } from "../app/App";
import { createDiv } from "../dom/dom";
import { ConfirmationModal } from "../ui/Modal";
import { Notice } from "../ui/Notice";
import { setIcon } from "../ui/Icon";
import {
  CommunityModal,
  withButtonLoading,
  type CommunityModalItem,
  type CommunitySortOrder,
} from "../ui/CommunityModal";
import { prepareSimpleSearch, renderResults, type SearchResult } from "../search/SearchHelpers";
import { Platform } from "../platform/Platform";
import { formatRelativeDate } from "./git/relativeDate";
import { compareVersions } from "../core/Version";
import { MarkdownRenderer } from "../markdown/MarkdownRenderer";
import type { MarketplacePluginEntry } from "../plugin/PluginMarketplace";
import { URL_SCHEME } from "@app/shared/scheme";

interface PluginItem extends CommunityModalItem {
  entry: MarketplacePluginEntry;
  matches: SearchResult | null;
  nameEl: HTMLElement | null;
  authorEl: HTMLElement | null;
  descEl: HTMLElement | null;
}

export class CommunityPluginMarketplaceModal extends CommunityModal<PluginItem> {
  protected override sortOrderOptions: readonly CommunitySortOrder[] = [
    "download",
    "update",
    "release",
    "alphabetical",
  ];

  constructor(app: App) {
    super(app);
    this.setTitle("Community plugins");
    this.modalEl.addClass("mod-community-plugin");
    this.search.setPlaceholder("Search community plugins...");
    this.sortOrder = readSortOrder();
  }

  override onClose(): void {
    super.onClose();
    window.localStorage?.setItem("communityPluginSortOrder", this.sortOrder);
  }

  setAutoOpen(pluginId: string): this {
    this.selectedItemId = pluginId;
    return this;
  }

  protected async loadItems(): Promise<Map<string, PluginItem>> {
    const marketplace = this.app.pluginMarketplace;
    if (!marketplace.hasEntries() && marketplace.loadState !== "loaded")
      await marketplace.loadObsidianReleases();
    const items = new Map<string, PluginItem>();
    for (const entry of marketplace.search()) {
      const id = entry.manifest.id;
      const el = createDiv("community-item tappable");
      el.dataset.pluginId = id;
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
        updated: timestamp(entry.updatedAt),
        el,
        init: false,
        entry,
        matches: null,
        nameEl: null,
        authorEl: null,
        descEl: null,
      });
    }
    if (this.selectedItemId && !items.has(this.selectedItemId) && !this.search.getValue())
      this.search.setValue(this.selectedItemId.split("-").join(" "));
    return items;
  }

  protected updateItems(): PluginItem[] {
    const query = this.search.getValue().trim().toLowerCase();
    const search = query ? prepareSimpleSearch(query) : null;
    const installedOnly = this.installedOnlyToggle.getValue();
    const visible: PluginItem[] = [];
    for (const item of this.items.values()) {
      item.matches = null;
      if (installedOnly && !this.app.communityPlugins.get(item.id)?.installed) continue;
      if (!search) {
        visible.push(item);
        continue;
      }
      const manifest = item.entry.manifest;
      const match = search(
        `${manifest.name}${manifest.author ?? ""}${manifest.description ?? ""}`.toLowerCase(),
      );
      if (!match) continue;
      item.matches = match;
      visible.push(item);
    }
    this.sortItems(visible);
    this.queueRender(visible, (item) => this.renderItem(item));
    this.searchSummaryEl.setText(
      `Showing ${visible.length} plugin${visible.length === 1 ? "" : "s"}`,
    );
    return visible;
  }

  /** Build the row once, then only refresh the parts search highlighting touches. */
  private renderItem(item: PluginItem): void {
    const manifest = item.entry.manifest;
    const author = manifest.author ?? "";
    const description = manifest.description ?? "";
    if (!item.init) {
      item.nameEl = item.el.createDiv("community-item-name");
      item.authorEl = item.el.createDiv("community-item-author");
      if (item.downloads) {
        item.el.createDiv("community-item-downloads", (downloadsEl) => {
          downloadsEl.createSpan({}, (iconEl) => setIcon(iconEl, "lucide-download-cloud"));
          downloadsEl.createSpan({
            cls: "community-item-downloads-text",
            text: item.downloads.toLocaleString(),
          });
        });
      }
      if (item.updated)
        item.el.createDiv({
          cls: "community-item-updated",
          text: `Updated ${formatRelativeDate(item.entry.updatedAt!)}`,
        });
      item.descEl = item.el.createDiv("community-item-desc");
      item.init = true;
    }
    const nameEl = item.nameEl!;
    const authorEl = item.authorEl!;
    const descEl = item.descEl!;
    nameEl.empty();
    authorEl.empty();
    descEl.empty();
    renderResults(nameEl, manifest.name, item.matches);
    if (this.app.communityPlugins.get(item.id)?.installed) appendFlair(nameEl, "Installed", true);
    if (author) {
      authorEl.setText("By ");
      renderResults(authorEl, author, item.matches, -manifest.name.length);
    }
    if (description)
      renderResults(
        descEl,
        truncate(description, 200),
        item.matches,
        -(manifest.name.length + author.length),
      );
    item.el.show();
  }

  protected showItem(item: PluginItem): void {
    const entry = item.entry;
    const manifest = entry.manifest;
    const record = this.app.communityPlugins.get(manifest.id);
    const installed = Boolean(record?.installed);
    const enabled = Boolean(record?.enabled);
    const updateAvailable = Boolean(
      record?.updateAvailable ||
      (record?.manifest.version && compareVersions(manifest.version, record.manifest.version) > 0),
    );

    const infoEl = this.detailsEl.createDiv("community-modal-info");
    const metaEl = infoEl.createDiv("community-modal-meta");
    const titleEl = metaEl.createDiv({ cls: "community-modal-info-name", text: manifest.name });
    if (installed) appendFlair(titleEl, "Installed", true);

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
        text: `Version: ${manifest.version}`,
      });
      if (installed && record?.manifest.version)
        versionEl.appendText(` (currently installed: ${record.manifest.version})`);
    }

    if (manifest.author) {
      const authorEl = metaEl.createDiv({ cls: "community-modal-info-author", text: "By " });
      if (manifest.authorUrl)
        authorEl.createEl("a", {
          href: manifest.authorUrl,
          text: manifest.author,
          attr: { target: "_blank", rel: "noopener" },
        });
      else authorEl.appendText(manifest.author);
    }

    const repository = repositoryUrl(entry);
    if (repository) {
      metaEl.createDiv({ cls: "community-modal-info-repo", text: "Repository: " }, (repositoryEl) =>
        repositoryEl.createEl("a", {
          href: repository,
          text: repository,
          attr: { target: "_blank", rel: "noopener" },
        }),
      );
      if (entry.updatedAt) {
        metaEl.createDiv({ cls: "community-modal-info-repo", text: "Last update: " }, (updatedEl) =>
          updatedEl.createEl("a", {
            href: `${repository}/releases/latest`,
            text: formatRelativeDate(entry.updatedAt!),
            attr: { target: "_blank", rel: "noopener", "aria-label": "View the latest update" },
          }),
        );
      }
    }

    if (manifest.description)
      metaEl.createDiv({ cls: "community-modal-info-desc", text: manifest.description });

    if (!Platform.isDesktopApp && manifest.isDesktopOnly)
      metaEl.createDiv({ cls: "mod-warning", text: "This plugin does not support your device." });

    const actionsEl = metaEl.createDiv("community-modal-button-container");
    this.renderActions(item, actionsEl, installed, enabled, updateAvailable);
    this.renderReadme(entry, infoEl.createDiv("community-modal-readme markdown-rendered"));
    this.scrollIntoView(manifest.id);
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
    if (entry.readmeState === "error") {
      readmeEl.setText(
        entry.readmeError
          ? `Failed to load README: ${entry.readmeError}`
          : "Failed to load README.",
      );
      return;
    }
    if (!entry.readmeUrl) {
      readmeEl.setText("This plugin did not provide a README file.");
      return;
    }
    readmeEl.setText("Loading README...");
    if (entry.readmeState === "loading") return;
    const rerender = (): void => {
      if (this.selectedItemId !== entry.manifest.id) return;
      readmeEl.empty();
      this.renderReadme(entry, readmeEl);
    };
    void this.app.pluginMarketplace.loadReadme(entry.manifest.id).then(rerender, rerender);
  }

  private renderActions(
    item: PluginItem,
    parentEl: HTMLElement,
    installed: boolean,
    enabled: boolean,
    updateAvailable: boolean,
  ): void {
    const entry = item.entry;
    if (!installed) {
      this.createActionButton(parentEl, "Install", "mod-cta", (buttonEl) =>
        withButtonLoading(buttonEl, () => this.install(item)),
      );
    } else {
      if (updateAvailable)
        this.createActionButton(parentEl, "Update", "mod-cta", (buttonEl) =>
          withButtonLoading(buttonEl, () => this.update_(item)),
        );
      if (this.app.setting.getTabById(entry.manifest.id))
        this.createActionButton(parentEl, "Options", "", () => this.openPluginOptions(entry));
      if (this.hasPluginCommands(entry.manifest.id))
        this.createActionButton(parentEl, "Hotkeys", "", () => this.openPluginHotkeys(entry));
      this.createActionButton(
        parentEl,
        enabled ? "Disable" : "Enable",
        enabled ? "mod-destructive" : "mod-cta",
        (buttonEl) => withButtonLoading(buttonEl, () => this.toggle(item, !enabled)),
      );
      this.createActionButton(parentEl, "Uninstall", "mod-destructive", (buttonEl) =>
        withButtonLoading(buttonEl, () => this.uninstall(item)),
      );
    }
    this.createActionButton(parentEl, "Copy share link", "", () => void this.copyShareLink(entry));
    if (entry.fundingUrl)
      this.createActionButton(parentEl, "Donate", "", () =>
        new CommunityPluginDonateModal(this.app, entry).open(),
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

  private async install(item: PluginItem): Promise<void> {
    const entry = item.entry;
    if (!Platform.isDesktopApp && entry.manifest.isDesktopOnly) {
      new Notice("This plugin does not support your device.");
      return;
    }
    // The catalog only knows the version its stats file happens to list (sometimes
    // nothing, i.e. "0.0.0"). Obsidian resolves the release off the repo manifest and
    // versions.json against this app version before it builds the download URLs.
    let version: string | null;
    try {
      version = await this.app.pluginMarketplace.resolveLatestCompatibleVersion(entry.manifest.id);
    } catch (error) {
      console.error(error);
      new Notice("Failed to load the plugin manifest.");
      return;
    }
    if (!version) {
      new Notice("No appropriate version found.");
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
      this.refresh(item);
    }
  }

  /** `update` is the base class' list refresh; this one installs the newer release. */
  private async update_(item: PluginItem): Promise<void> {
    try {
      await this.app.pluginInstaller.update(item.id);
      new Notice(`Updated ${item.entry.manifest.name}`);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.refresh(item);
    }
  }

  private async toggle(item: PluginItem, enabled: boolean): Promise<void> {
    try {
      if (enabled) await this.app.pluginInstaller.enable(item.id, true);
      else await this.app.pluginInstaller.disable(item.id, true);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.refresh(item);
    }
  }

  private async uninstall(item: PluginItem): Promise<void> {
    try {
      await this.app.pluginInstaller.uninstall(item.id);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.refresh(item);
    }
  }

  private refresh(item: PluginItem): void {
    this.update();
    this.selectItem(item.id);
  }

  private async copyShareLink(entry: MarketplacePluginEntry): Promise<void> {
    await navigator.clipboard?.writeText(
      `${URL_SCHEME}show-plugin?id=${encodeURIComponent(entry.manifest.id)}`,
    );
    new Notice("Copied to your clipboard");
  }
}

class CommunityPluginDonateModal extends ConfirmationModal {
  constructor(
    app: App,
    readonly entry: MarketplacePluginEntry,
  ) {
    super(app);
    this.setTitle(`Donate to support ${entry.manifest.name}`);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.buttonContainerEl.empty();

    this.contentEl.append(
      paragraph(
        "Plugin developers are community volunteers who make amazing things out of passion. If you find this plugin useful, please consider funding its development.",
      ),
      paragraph(
        "100% of your contribution will go to the plugin developer; Obsidian does not take a cut. The funding platform they choose might charge a fee.",
      ),
      paragraph("Thanks for your generous support!"),
      document.createElement("hr"),
    );
    this.renderFundingLinks();
    this.addButton("mod-cta", "Done", () => this.close());
  }

  private renderFundingLinks(): void {
    const fundingUrl = this.entry.fundingUrl as string | Record<string, string>;
    if (typeof fundingUrl === "string") {
      this.contentEl.appendChild(fundingParagraph("Support this plugin:", fundingUrl));
      return;
    }
    for (const [label, url] of Object.entries(fundingUrl)) {
      this.contentEl.appendChild(fundingParagraph(`${label}:`, url));
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
  el.append(`${label} `);
  el.createEl("a", {
    cls: "external-link",
    href: url,
    text: url,
    attr: { target: "_blank", rel: "noopener" },
  });
  return el;
}

function timestamp(value: string | undefined): number {
  return value ? Date.parse(value) || 0 : 0;
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function appendFlair(parentEl: HTMLElement, text: string, pop = false): void {
  parentEl.createSpan({ cls: `flair${pop ? " mod-pop" : ""}`, text });
}

function repositorySlug(entry: MarketplacePluginEntry): string | null {
  if (entry.repo) return entry.repo.replace(/^\/+|\/+$/g, "");
  const match = entry.repository?.match(/^https?:\/\/github\.com\/([^/]+\/[^/#]+)(?:[/#]|$)/i);
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

function readSortOrder(): CommunitySortOrder {
  const value = window.localStorage?.getItem("communityPluginSortOrder");
  return value === "update" || value === "release" || value === "alphabetical" ? value : "download";
}
