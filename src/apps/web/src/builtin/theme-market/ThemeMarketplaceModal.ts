import type { App } from "../../app/App";
import { Modal } from "../../ui/Modal";
import { Notice } from "../../ui/Notice";
import type { ThemeMarketplaceEntry } from "./ThemeMarketplace";

/** Browse the community theme catalog, install into the vault and enable. */
export class ThemeMarketplaceModal extends Modal {
  private query = "";
  private loading = false;
  private error: string | null = null;
  private busyId: string | null = null;
  private readonly listEl = document.createElement("div");

  constructor(app: App) {
    super(app);
    this.setTitle("Community themes");
    this.modalEl.classList.add("mod-community-modal", "mod-community-theme");
  }

  onOpen(): void {
    this.contentEl.replaceChildren();
    const searchEl = document.createElement("input");
    searchEl.type = "search";
    searchEl.placeholder = "Search community themes...";
    searchEl.className = "theme-market-search";
    searchEl.addEventListener("input", () => {
      this.query = searchEl.value;
      this.renderList();
    });
    this.listEl.className = "theme-market-list";
    this.contentEl.append(searchEl, this.listEl);
    searchEl.focus();
    void this.loadCatalog();
  }

  private async loadCatalog(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderList();
    try {
      await this.app.themeMarketplace.loadCatalog();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
      this.renderList();
    }
  }

  private renderList(): void {
    this.listEl.replaceChildren();
    if (this.loading) {
      this.renderMessage("Loading community themes…");
      return;
    }
    if (this.error) {
      this.renderMessage(`Could not load the theme catalog: ${this.error}`);
      return;
    }
    const entries = this.app.themeMarketplace.search(this.query).slice(0, 100);
    if (entries.length === 0) {
      this.renderMessage("No themes match the search.");
      return;
    }
    for (const entry of entries) this.renderEntry(entry);
  }

  private renderEntry(entry: ThemeMarketplaceEntry): void {
    const doc = this.listEl.ownerDocument;
    const itemEl = doc.createElement("div");
    itemEl.className = "theme-market-item";
    const infoEl = doc.createElement("div");
    infoEl.className = "theme-market-item-info";
    const nameEl = doc.createElement("div");
    nameEl.className = "theme-market-item-name";
    nameEl.textContent = entry.manifest.name;
    const metaEl = doc.createElement("div");
    metaEl.className = "theme-market-item-meta";
    metaEl.textContent = [entry.manifest.author, entry.manifest.modes.join(" · ")]
      .filter(Boolean)
      .join(" — ");
    infoEl.append(nameEl, metaEl);
    const buttonEl = doc.createElement("button");
    buttonEl.className = "mod-cta";
    const installed = this.app.themeInstaller
      .listInstalled()
      .some((record) => record.id === entry.manifest.id);
    const active = this.app.themes.getActiveTheme()?.id === entry.manifest.id;
    buttonEl.textContent = active ? "In use" : installed ? "Use" : "Install and use";
    buttonEl.disabled = active || this.busyId !== null;
    buttonEl.addEventListener("click", () => void this.installAndUse(entry, buttonEl));
    itemEl.append(infoEl, buttonEl);
    this.listEl.appendChild(itemEl);
  }

  private async installAndUse(
    entry: ThemeMarketplaceEntry,
    buttonEl: HTMLButtonElement,
  ): Promise<void> {
    this.busyId = entry.manifest.id;
    buttonEl.disabled = true;
    buttonEl.textContent = "Installing…";
    try {
      const installed = this.app.themeInstaller
        .listInstalled()
        .some((record) => record.id === entry.manifest.id);
      if (!installed) {
        const pkg = await this.app.themeMarketplace.downloadPackage(entry.manifest.id);
        await this.app.themeInstaller.install(pkg);
      }
      this.app.themeInstaller.enable(entry.manifest.id);
      new Notice(`Theme "${entry.manifest.name}" enabled`);
    } catch (error) {
      new Notice(`Theme install failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busyId = null;
      this.renderList();
    }
  }

  private renderMessage(text: string): void {
    const messageEl = this.listEl.ownerDocument.createElement("div");
    messageEl.className = "theme-market-message";
    messageEl.textContent = text;
    this.listEl.appendChild(messageEl);
  }
}
