import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import { Setting, SettingGroup } from "../ui/Setting";
import { ConfirmationModal } from "../ui/Modal";
import { CommunityPluginMarketplaceModal } from "./CommunityPluginMarketplaceModal";
import { setIcon } from "../ui/Icon";

export class CommunityPluginsSettingTab implements SettingTab {
  readonly id = "community-plugins";
  readonly name = "Community plugins";
  readonly icon = "puzzle";
  readonly section = "community-plugins" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");
  private query = "";

  constructor(readonly app: App) {
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
    this.containerEl.className = "vertical-tab-content community-plugins-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    if (this.app.pluginSecurity.isRestrictedMode()) {
      this.renderRestrictedModeDisclaimer();
      return;
    }
    this.renderRestrictedModeToggle();
    this.renderBrowseCommunityPlugins();
    this.renderCurrentPlugins();
    this.renderInstalledPlugins();
  }

  hide(): void {
    this.containerEl.remove();
  }

  private renderRestrictedModeDisclaimer(): void {
    const disclaimerEl = document.createElement("div");
    disclaimerEl.className = "community-plugins-disclaimer";
    const titleEl = document.createElement("div");
    titleEl.className = "setting-item-name";
    titleEl.textContent = "Community plugins are currently restricted";
    const descEl = document.createElement("div");
    descEl.className = "setting-item-description";
    descEl.textContent =
      "Community plugins can run third-party code. Review plugins carefully before enabling them.";
    disclaimerEl.append(titleEl, descEl);

    const checklistEl = document.createElement("ul");
    checklistEl.className = "community-plugins-security-list";
    for (const text of [
      "Review the plugin code when possible.",
      "Prefer open-source plugins.",
      "Check community audit and reputation.",
      "Report suspicious behavior.",
    ]) {
      const itemEl = document.createElement("li");
      itemEl.textContent = text;
      checklistEl.appendChild(itemEl);
    }
    disclaimerEl.appendChild(checklistEl);
    this.containerEl.appendChild(disclaimerEl);

    new Setting(this.containerEl)
      .setName("Turn on community plugins")
      .setDesc("Exit restricted mode and allow installed community plugins to load.")
      .addButton((button) =>
        button
          .setCta()
          .setButtonText("Turn on community plugins")
          .onClick(() =>
            this.app.pluginInstaller.setCommunityPluginsEnabled(true).then(() => this.display()),
          ),
      );

    new Setting(this.containerEl)
      .setName("Learn more")
      .setDesc("Read about plugin security before turning on community plugins.")
      .addButton((button) =>
        button.setButtonText("Plugin security").onClick(() => {
          window.open("https://help.obsidian.md/plugin-security", "_blank");
        }),
      );
  }

  private renderRestrictedModeToggle(): void {
    const group = new SettingGroup(this.containerEl).setHeading("Restricted mode");
    group.groupEl.classList.add("community-plugins-restricted-mode", "is-enabled");
    new Setting(group.itemsEl)
      .setName("Restricted mode")
      .setDesc("Turn restricted mode on to disable all community plugins in this vault.")
      .addButton((button) =>
        button.setButtonText("Turn on restricted mode").onClick(async () => {
          await this.app.pluginInstaller.setCommunityPluginsEnabled(false);
          window.location.reload();
        }),
      );
  }

  private renderBrowseCommunityPlugins(): void {
    new Setting(this.containerEl)
      .setName("Browse community plugins")
      .setDesc("Search and install community plugins from the marketplace.")
      .addButton((button) =>
        button
          .setCta()
          .setButtonText("Browse")
          .onClick(() =>
            new CommunityPluginMarketplaceModal(this.app)
              .setCloseCallback(() => this.display())
              .open(),
          ),
      );
  }

  private renderCurrentPlugins(): void {
    const installed = this.app.communityPlugins.list().filter((record) => record.installed);
    const updates = installed.filter((record) => record.updateAvailable);
    const group = new SettingGroup(this.containerEl).setHeading("Current plugins");
    group.groupEl.classList.add("current-community-plugins");
    new Setting(group.itemsEl)
      .setName(`${installed.length} installed plugin${installed.length === 1 ? "" : "s"}`)
      .setDesc(
        updates.length > 0
          ? `${updates.length} update${updates.length === 1 ? "" : "s"} available.`
          : "All installed plugins are up to date.",
      )
      .addButton((button) =>
        button
          .setButtonText(updates.length > 0 ? "Update all plugins" : "Check for updates")
          .onClick(() => {
            const action =
              updates.length > 0
                ? this.app.pluginInstaller.updateAll()
                : this.app.pluginInstaller.checkForUpdates();
            return action.then(() => this.display());
          }),
      );
    new Setting(group.itemsEl)
      .setName("Automatic update check")
      .setDesc("Check installed community plugins for updates automatically.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.app.pluginInstaller.autoCheckForUpdates)
          .onChange((enabled) => this.app.pluginInstaller.setAutomaticUpdateCheck(enabled)),
      );
  }

  private renderInstalledPlugins(): void {
    const group = new SettingGroup(this.containerEl).setHeading("Installed plugins");
    group.groupEl.classList.add("installed-plugins-container");
    const searchEl = document.createElement("input");
    searchEl.className = "setting-group-search";
    searchEl.type = "text";
    searchEl.placeholder = "Search installed plugins...";
    searchEl.value = this.query;
    group.groupEl.insertBefore(searchEl, group.itemsEl);
    searchEl.addEventListener("input", () => {
      this.query = searchEl.value;
      this.display();
    });

    const tokens = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const records = this.app.communityPlugins
      .list()
      .filter((record) => record.installed)
      .filter((record) => {
        const manifest = record.manifest;
        const haystack =
          `${manifest.name} ${manifest.author ?? ""} ${manifest.description ?? ""} ${manifest.id}`.toLowerCase();
        return tokens.length === 0 || tokens.every((token) => haystack.includes(token));
      })
      .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

    if (records.length === 0) {
      new Setting(group.itemsEl)
        .setName("No community plugins installed")
        .setDesc("Installed community plugins will appear here.")
        .setDisabled(true);
      return;
    }

    for (const record of records) {
      const manifest = record.manifest;
      const entry = this.app.pluginMarketplace.getEntry(manifest.id);
      const setting = new Setting(group.itemsEl)
        .setName(manifest.name)
        .setDesc(
          pluginDescription([
            record.enabled ? "Enabled" : "Disabled",
            record.updateAvailable ? "Update available" : null,
            manifest.version,
            manifest.author,
            manifest.description,
            entry?.downloads === undefined ? null : `${entry.downloads.toLocaleString()} downloads`,
            entry?.updatedAt ? `Updated ${entry.updatedAt}` : null,
          ]),
        )
        .addToggle((toggle) =>
          toggle
            .setValue(record.enabled)
            .setDisabled(this.app.pluginSecurity.isRestrictedMode())
            .onChange((enabled) => {
              const previous = record.enabled;
              toggle.setDisabled(true);
              const action = enabled
                ? this.app.pluginInstaller.enable(manifest.id, true).then((success) => {
                    if (!success) toggle.setValue(false);
                  })
                : this.app.pluginInstaller.disable(manifest.id, true);
              void action.catch(() => toggle.setValue(previous)).finally(() => this.display());
            }),
        );
      setting.settingEl.classList.add("installed-community-plugin");
      setting.settingEl.dataset.pluginId = manifest.id;
      setting.settingEl.classList.toggle("is-enabled", record.enabled);
      setting.settingEl.classList.toggle("mod-update-available", Boolean(record.updateAvailable));
      setting.infoEl.classList.add("tappable");
      setting.infoEl.addEventListener("click", () => this.openPluginInMarketplace(manifest.id));
      const fundingUrl = (manifest as { fundingUrl?: string }).fundingUrl ?? entry?.fundingUrl;
      if (fundingUrl) {
        setting.addExtraButton((button) =>
          button
            .setIcon("lucide-heart")
            .setTooltip("Donate")
            .onClick(() => window.open(fundingUrl, "_blank")),
        );
      }
      if (record.updateAvailable) {
        setting.addButton((button) =>
          button
            .setCta()
            .setButtonText("Update")
            .onClick(() => this.app.pluginInstaller.update(manifest.id).then(() => this.display())),
        );
      }
      if (this.app.plugins.getPlugin(manifest.id) && this.app.setting.getTabById(manifest.id)) {
        setting.addExtraButton((button) =>
          button
            .setIcon("lucide-settings")
            .setTooltip("Options")
            .onClick(() => this.app.setting.openTabById(manifest.id)),
        );
      }
      if (this.app.plugins.getPlugin(manifest.id) && this.hasPluginCommands(manifest.id)) {
        setting.addExtraButton((button) =>
          button
            .setIcon("lucide-plus-circle")
            .setTooltip("Hotkeys")
            .onClick(() => {
              this.app.setting.getTabById("hotkeys")?.setQuery?.(manifest.id);
              this.app.setting.openTabById("hotkeys");
            }),
        );
      }
      setting.addExtraButton((button) =>
        button
          .setIcon("lucide-trash-2")
          .setTooltip("Uninstall")
          .onClick(() => this.openUninstallModal(manifest.id)),
      );
    }
  }

  private hasPluginCommands(pluginId: string): boolean {
    return this.app.commands.getCommands().some((command) => command.id.startsWith(`${pluginId}:`));
  }

  private openPluginInMarketplace(pluginId: string): void {
    new CommunityPluginMarketplaceModal(this.app)
      .setAutoOpen(pluginId)
      .setCloseCallback(() => this.display())
      .open();
  }

  private openUninstallModal(pluginId: string): void {
    const modal = new ConfirmationModal(this.app)
      .setTitle("Uninstall plugin")
      .setContent("Are you sure you want to uninstall this plugin?")
      .addButton("mod-warning", "Uninstall", async () => {
        await this.app.pluginInstaller.uninstall(pluginId);
        modal.close();
        this.display();
      })
      .addCancelButton();
    modal.open();
  }
}

function pluginDescription(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}
