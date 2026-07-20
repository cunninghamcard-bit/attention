import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import { fuzzyMatch, prepareFuzzyQuery, type FuzzyMatch } from "../core/fuzzy";
import { Platform } from "../platform/Platform";
import { renderResults } from "../search/SearchHelpers";
import { setIcon } from "../ui/Icon";
import { ConfirmationModal } from "../ui/Modal";
import { Notice } from "../ui/Notice";
import { Setting, SettingGroup } from "../ui/Setting";
import type { CommunityPluginRecord } from "../plugin/CommunityPluginRegistry";
import { CommunityPluginMarketplaceModal } from "./CommunityPluginMarketplaceModal";

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
    this.renderEnabledSettings();
  }

  hide(): void {
    this.containerEl.remove();
  }

  private renderEnabledSettings(): void {
    const root = new SettingGroup(this.containerEl);
    new Setting(root.itemsEl)
      .setName("Restricted mode")
      .setDesc("Restricted mode is off. Turn on to disable community plugins.")
      .addButton((button) =>
        button.setButtonText("Turn on and reload").onClick(async () => {
          await this.app.pluginInstaller.setCommunityPluginsEnabled(false);
          window.location.reload();
        }),
      );

    new Setting(root.itemsEl)
      .setName("Community plugins")
      .setDesc("Browse and install community plugins made by our amazing community.")
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

    const installed = this.installedRecords();
    const updates = installed.filter((record) => record.updateAvailable);
    new Setting(root.itemsEl)
      .setName("Current plugins")
      .setDesc(
        `You currently have ${installed.length} plugin${installed.length === 1 ? "" : "s"} installed. ${
          updates.length > 0
            ? `Found ${updates.length} plugin${updates.length === 1 ? "" : "s"} to update.`
            : ""
        }`,
      )
      .then((setting) => {
        if (updates.length > 0) {
          setting.addButton((button) =>
            button
              .setCta()
              .setButtonText("Update all")
              .onClick(async () => {
                await this.app.pluginInstaller.updateAll();
                this.display();
              }),
          );
        } else if (installed.length > 0) {
          setting.addButton((button) =>
            button
              .setCta()
              .setButtonText("Check for updates")
              .onClick(async () => {
                await this.app.pluginInstaller.checkForUpdates();
                this.display();
              }),
          );
        }
      });

    new Setting(root.itemsEl)
      .setName("Automatically check for plugin updates")
      .setDesc("Periodically check for plugin updates.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.app.pluginInstaller.autoCheckForUpdates)
          .onChange((enabled) => this.app.pluginInstaller.setAutomaticUpdateCheck(enabled)),
      );

    const installedGroup = new SettingGroup(this.containerEl)
      .setHeading("Installed plugins")
      .addClass("installed-plugins-container")
      .addExtraButton((button) =>
        button
          .setIcon("lucide-refresh-cw")
          .setTooltip("Reload plugins")
          .onClick(async () => {
            await this.app.pluginInstaller.loadManifests();
            new Notice("Reloaded third-party plugins.");
            this.display();
          }),
      );

    if (Platform.isDesktopApp) {
      installedGroup.addExtraButton((button) =>
        button
          .setIcon("lucide-folder-open")
          .setTooltip("Open plugins folder")
          .onClick(() => void this.openPluginsFolder()),
      );
    }
    if (installed.length > 0) {
      installedGroup.addSearch((search) =>
        search
          .setValue(this.query)
          .setPlaceholder("Search installed plugins...")
          .onChange((value) => {
            this.query = value;
            this.renderInstalledPluginRows(installedGroup);
          }),
      );
    }
    this.renderInstalledPluginRows(installedGroup);
  }

  private renderRestrictedModeDisclaimer(): void {
    const group = new SettingGroup(this.containerEl).addClass("community-plugins-disclaimer");
    group.listEl.append(
      paragraph(
        "Community plugins, like any other software you install, could potentially cause data integrity and security issues.",
      ),
      paragraph("Plugin security is important to us. Here's what we do:"),
    );
    this.addSecuritySetting(
      group,
      "lucide-inspect",
      "Initial code review",
      "Plugins in the official community directory undergo an initial code review by our team before they are listed.",
    );
    this.addSecuritySetting(
      group,
      "lucide-github",
      "Open source",
      "Most plugins are open source on GitHub, so you can inspect the code yourself.",
    );
    this.addSecuritySetting(
      group,
      "lucide-users",
      "Peer audit",
      "We have a large community of developers who watch out for each other.",
    );
    this.addSecuritySetting(
      group,
      "lucide-bug",
      "Report mechanism",
      "We follow up and remove faulty plugins upon user report.",
    );
    group.listEl.appendChild(
      paragraph(
        "Would you like to exit Restricted Mode to enable community plugins? We strongly recommend making backups of your data before doing so.",
      ),
    );

    const actionsEl = document.createElement("div");
    actionsEl.className = "community-modal-button-container";
    const enableEl = document.createElement("button");
    enableEl.className = "mod-cta";
    enableEl.textContent = "Turn on community plugins";
    enableEl.addEventListener("click", async () => {
      enableEl.disabled = true;
      try {
        await this.app.pluginInstaller.setCommunityPluginsEnabled(true);
        this.display();
      } finally {
        enableEl.disabled = false;
      }
    });
    actionsEl.appendChild(enableEl);
    this.containerEl.appendChild(actionsEl);

    const learnMoreEl = paragraph("");
    const linkEl = document.createElement("a");
    linkEl.href = "https://help.obsidian.md/plugin-security";
    linkEl.target = "_blank";
    linkEl.rel = "noopener";
    linkEl.textContent = "Learn more about plugin security";
    learnMoreEl.appendChild(linkEl);
    this.containerEl.appendChild(learnMoreEl);
  }

  private addSecuritySetting(
    group: SettingGroup,
    icon: string,
    name: string,
    description: string,
  ): void {
    const setting = new Setting(group.itemsEl).setName(name).setDesc(description);
    const iconEl = document.createElement("div");
    iconEl.className = "setting-icon";
    setIcon(iconEl, icon);
    setting.settingEl.prepend(iconEl);
  }

  private renderInstalledPluginRows(group: SettingGroup): void {
    group.itemsEl.replaceChildren();
    const query = this.query.trim();
    const preparedQuery = prepareFuzzyQuery(query);
    for (const record of this.installedRecords()) {
      const manifest = record.manifest;
      const nameMatch = query ? fuzzyMatch(preparedQuery, manifest.name) : null;
      const authorMatch =
        query && manifest.author ? fuzzyMatch(preparedQuery, manifest.author) : null;
      const descMatch =
        query && manifest.description ? fuzzyMatch(preparedQuery, manifest.description) : null;
      if (query && !nameMatch && !authorMatch && !descMatch) continue;
      this.renderInstalledPlugin(group, record, nameMatch, authorMatch, descMatch);
    }
  }

  private renderInstalledPlugin(
    group: SettingGroup,
    record: CommunityPluginRecord,
    nameMatch: FuzzyMatch | null,
    authorMatch: FuzzyMatch | null,
    descMatch: FuzzyMatch | null,
  ): void {
    const manifest = record.manifest;
    const entry = this.app.pluginMarketplace.getEntry(manifest.id);
    const description = document.createDocumentFragment();
    if (manifest.version) {
      const versionEl = document.createElement("div");
      versionEl.textContent = `Version: ${manifest.version}`;
      description.appendChild(versionEl);
    }
    if (manifest.author) {
      const authorEl = document.createElement("div");
      authorEl.append("By ");
      renderResults(authorEl, manifest.author, authorMatch);
      description.appendChild(authorEl);
    }
    if (manifest.description) {
      const descEl = document.createElement("div");
      renderResults(descEl, manifest.description, descMatch);
      description.appendChild(descEl);
    }

    const setting = new Setting(group.itemsEl).setDesc(description);
    setting.settingEl.classList.add("installed-community-plugin");
    setting.settingEl.dataset.pluginId = manifest.id;
    renderResults(setting.nameEl, manifest.name, nameMatch);

    if (record.updateAvailable) {
      setting.addButton((button) =>
        button
          .setCta()
          .setButtonText("Update")
          .setTooltip(`Update to version ${record.latestVersion ?? entry?.manifest.version ?? ""}`)
          .onClick(async () => {
            await this.app.pluginInstaller.update(manifest.id);
            this.display();
          }),
      );
    }

    let optionsEl: HTMLElement | null = null;
    setting.addExtraButton((button) => {
      optionsEl = button.extraSettingsEl;
      button
        .setIcon("lucide-settings")
        .setTooltip("Options")
        .onClick(() => this.app.setting.openTabById(manifest.id));
    });
    let hotkeysEl: HTMLElement | null = null;
    setting.addExtraButton((button) => {
      hotkeysEl = button.extraSettingsEl;
      button
        .setIcon("lucide-plus-circle")
        .setTooltip("Hotkeys")
        .onClick(() => {
          this.app.setting.getTabById("hotkeys")?.setQuery?.(manifest.id);
          this.app.setting.openTabById("hotkeys");
        });
    });
    const loaded = Boolean(this.app.plugins.getPlugin(manifest.id));
    if (optionsEl)
      optionsEl.style.display =
        loaded && Boolean(this.app.setting.getTabById(manifest.id)) ? "" : "none";
    if (hotkeysEl)
      hotkeysEl.style.display = loaded && this.hasPluginCommands(manifest.id) ? "" : "none";

    const fundingUrl =
      (manifest as typeof manifest & { fundingUrl?: string }).fundingUrl ?? entry?.fundingUrl;
    if (fundingUrl) {
      setting.addExtraButton((button) =>
        button
          .setIcon("lucide-heart")
          .setTooltip(`Donate to support ${manifest.name}`)
          .onClick(() => window.open(String(fundingUrl), "_blank", "noopener")),
      );
    }
    setting.addExtraButton((button) =>
      button
        .setIcon("lucide-trash-2")
        .setTooltip("Uninstall")
        .onClick(() => this.openUninstallModal(manifest.id)),
    );
    setting.addToggle((toggle) =>
      toggle.setValue(record.enabled).onChange(async (enabled) => {
        if (enabled) {
          const success = await this.app.pluginInstaller.enable(manifest.id, true);
          if (!success) toggle.setValue(false);
        } else await this.app.pluginInstaller.disable(manifest.id, true);
        this.display();
      }),
    );

    setting.infoEl.style.cursor = "pointer";
    setting.infoEl.addEventListener("click", () => this.openPluginInMarketplace(manifest.id));
  }

  private installedRecords(): CommunityPluginRecord[] {
    return this.app.communityPlugins
      .list()
      .filter((record) => record.installed)
      .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
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
      .setContent(
        "Are you sure you want to uninstall this plugin? This will delete the folder of the plugin.",
      )
      .addButton("mod-warning", "Uninstall", async () => {
        await this.app.pluginInstaller.uninstall(pluginId);
        modal.close();
        this.display();
      })
      .addCancelButton();
    modal.open();
  }

  private async openPluginsFolder(): Promise<void> {
    const path = this.app.pluginInstaller.getPluginFolder();
    if (!(await this.app.vault.exists(path))) await this.app.vault.createFolder(path);
    await this.app.openWithDefaultApp(path);
  }
}

function paragraph(text: string): HTMLParagraphElement {
  const el = document.createElement("p");
  el.textContent = text;
  return el;
}
