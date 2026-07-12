import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import { Setting, SettingGroup } from "../ui/Setting";
import { ConfirmationModal } from "../ui/Modal";
import { setIcon } from "../ui/Icon";

export class FilesSettingTab implements SettingTab {
  readonly id = "file";
  readonly name = "Files and links";
  readonly icon = "folder-cog";
  readonly section = "options" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");

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
    this.containerEl.className = "vertical-tab-content file-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();

    let defaultOpenAction = this.app.vault.getConfig<string>("openBehavior") ?? "";
    let defaultOpenFilePath = "";
    if (defaultOpenAction.startsWith("file:")) {
      defaultOpenFilePath = defaultOpenAction.slice(5);
      defaultOpenAction = "file";
    }
    let defaultOpenFileSetting: Setting | null = null;
    let defaultOpenFileInput: HTMLInputElement | null = null;
    const saveDefaultOpenAction = (): void => {
      const nextValue = defaultOpenAction === "file" ? `file:${defaultOpenFileInput?.value ?? ""}` : defaultOpenAction;
      this.app.vault.setConfig("openBehavior", nextValue);
    };
    new Setting(this.containerEl)
      .setName("Default open action")
      .setDesc("Choose what Obsidian opens when the vault starts.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("", "Last opened")
          .addOption("new", "New note")
          .addOption("file", "Specific file");
        if (this.app.internalPlugins.getEnabledPluginById("daily-notes")) dropdown.addOption("daily", "Daily note");
        dropdown
          .setValue(defaultOpenAction)
          .onChange((value) => {
            defaultOpenAction = value;
            if (defaultOpenFileSetting) defaultOpenFileSetting.settingEl.hidden = value !== "file";
            saveDefaultOpenAction();
          });
      });
    defaultOpenFileSetting = new Setting(this.containerEl)
      .setName("Default open file")
      .setDesc("Path to the file to open by default.")
      .addText((text) => {
        defaultOpenFileInput = text.inputEl;
        text
          .setValue(defaultOpenFilePath)
          .onChange(saveDefaultOpenAction);
      });
    defaultOpenFileSetting.settingEl.hidden = defaultOpenAction !== "file";

    let newFileFolderSetting: Setting | null = null;
    new Setting(this.containerEl)
      .setName("New note location")
      .setDesc("Choose where new notes are created.")
      .addDropdown((dropdown) => dropdown
        .addOption("root", "Vault root")
        .addOption("current", "Current folder")
        .addOption("folder", "Specified folder")
        .setValue(this.app.vault.getConfig<string>("newFileLocation") ?? "root")
        .onChange((value) => {
          this.app.vault.setConfig("newFileLocation", value);
          if (newFileFolderSetting) newFileFolderSetting.settingEl.hidden = value !== "folder";
        }));
    newFileFolderSetting = new Setting(this.containerEl)
      .setName("New file folder path")
      .setDesc("Folder path used when new notes are created in a specified folder.")
      .addText((text) => {
        const path = this.app.vault.getConfig<string>("newFileFolderPath") ?? "/";
        text.inputEl.placeholder = "folder/subfolder";
        text
          .setValue(path === "/" ? "" : path)
          .onChange((value) => this.app.vault.setConfig("newFileFolderPath", value || "/"));
      });
    newFileFolderSetting.settingEl.hidden = (this.app.vault.getConfig<string>("newFileLocation") ?? "root") !== "folder";

    const defaultAttachmentFolder = "attachments";
    let attachmentModeSetting: Setting | null = null;
    let attachmentFolderSetting: Setting | null = null;
    let attachmentSubfolderSetting: Setting | null = null;
    let attachmentFolderInput: HTMLInputElement | null = null;
    let attachmentSubfolderInput: HTMLInputElement | null = null;
    const updateAttachmentVisibility = (): void => {
      const value = attachmentModeSetting?.controlEl.querySelector<HTMLSelectElement>("select")?.value ?? "root";
      if (attachmentFolderSetting) attachmentFolderSetting.settingEl.hidden = value !== "folder";
      if (attachmentSubfolderSetting) attachmentSubfolderSetting.settingEl.hidden = value !== "subfolder";
    };
    const readAttachmentFolderPath = (): string => {
      const value = attachmentModeSetting?.controlEl.querySelector<HTMLSelectElement>("select")?.value ?? "root";
      if (value === "root") return "/";
      if (value === "current") return "./";
      if (value === "subfolder") return `./${attachmentSubfolderInput?.value || defaultAttachmentFolder}`;
      return attachmentFolderInput?.value || defaultAttachmentFolder;
    };
    const saveAttachmentFolderPath = (): void => this.app.vault.setConfig("attachmentFolderPath", readAttachmentFolderPath());
    attachmentModeSetting = new Setting(this.containerEl)
      .setName("New attachment location")
      .setDesc("Choose where newly added attachments are saved.")
      .addDropdown((dropdown) => dropdown
        .addOption("root", "Vault root")
        .addOption("current", "Current folder")
        .addOption("subfolder", "Subfolder under current folder")
        .addOption("folder", "Specified folder")
        .onChange(() => {
          updateAttachmentVisibility();
          saveAttachmentFolderPath();
        }));
    attachmentFolderSetting = new Setting(this.containerEl)
      .setName("Attachment folder path")
      .setDesc("Folder path used for attachments.")
      .addText((text) => {
        attachmentFolderInput = text.inputEl;
        text.inputEl.placeholder = defaultAttachmentFolder;
        text.onChange(saveAttachmentFolderPath);
      });
    attachmentSubfolderSetting = new Setting(this.containerEl)
      .setName("Attachment subfolder path")
      .setDesc("Subfolder under the current folder used for attachments.")
      .addText((text) => {
        attachmentSubfolderInput = text.inputEl;
        text.inputEl.placeholder = defaultAttachmentFolder;
        text.onChange(saveAttachmentFolderPath);
      });
    this.setAttachmentLocation(this.app.vault.getConfig<string>("attachmentFolderPath") ?? "/", attachmentModeSetting, attachmentFolderInput, attachmentSubfolderInput, defaultAttachmentFolder);
    updateAttachmentVisibility();

    const linksGroup = new SettingGroup(this.containerEl).setHeading("Links");
    new Setting(linksGroup.itemsEl)
      .setName("New link format")
      .setDesc("Format used when autocompleting links.")
      .addDropdown((dropdown) => dropdown
        .addOption("shortest", "Shortest path when possible")
        .addOption("relative", "Relative path to file")
        .addOption("absolute", "Absolute path in vault")
        .setValue(this.app.vault.getConfig<string>("newLinkFormat") ?? "shortest")
        .onChange((value) => this.app.vault.setConfig("newLinkFormat", value)));
    new Setting(linksGroup.itemsEl)
      .setName("Always update links")
      .setDesc("Automatically update links after files are renamed.")
      .addToggle((toggle) => toggle
        .setValue(Boolean(this.app.vault.getConfig("alwaysUpdateLinks")))
        .onChange((value) => this.app.vault.setConfig("alwaysUpdateLinks", value)));
    new Setting(linksGroup.itemsEl)
      .setName("Use [[Wikilinks]]")
      .setDesc("Use wiki links instead of Markdown links.")
      .addToggle((toggle) => toggle
        .setValue(!this.app.vault.getConfig<boolean>("useMarkdownLinks"))
        .onChange((value) => this.app.vault.setConfig("useMarkdownLinks", !value)));
    new Setting(linksGroup.itemsEl)
      .setName("Detect all file extensions")
      .setDesc("Show unsupported files in the file explorer.")
      .addToggle((toggle) => toggle
        .setValue(Boolean(this.app.vault.getConfig("showUnsupportedFiles")))
        .onChange((value) => this.app.vault.setConfig("showUnsupportedFiles", value)));

    const trashGroup = new SettingGroup(this.containerEl).setHeading("Trash");
    new Setting(trashGroup.itemsEl)
      .setName("Confirm file deletion")
      .setDesc("Ask for confirmation before deleting files.")
      .addToggle((toggle) => toggle
        .setValue(this.app.vault.getConfig<boolean>("promptDelete") ?? true)
        .onChange((value) => this.app.vault.setConfig("promptDelete", value)));
    new Setting(trashGroup.itemsEl)
      .setName("Delete unlinked attachments")
      .setDesc("Choose how Obsidian handles attachments that are no longer linked.")
      .addDropdown((dropdown) => dropdown
        .addOption("ask", "Ask every time")
        .addOption("always", "Always")
        .addOption("never", "Never")
        .setValue(this.app.vault.getConfig<string>("deleteUnlinkedAttachments") ?? "ask")
        .onChange((value) => this.app.vault.setConfig("deleteUnlinkedAttachments", value)));
    new Setting(trashGroup.itemsEl)
      .setName("Deleted files")
      .setDesc("Choose where deleted files are moved.")
      .addDropdown((dropdown) => dropdown
        .addOption("system", "System trash")
        .addOption("local", "Vault trash folder")
        .addOption("none", "Delete permanently")
        .setValue(this.app.vault.getConfig<string>("trashOption") ?? "system")
        .onChange((value) => this.app.vault.setConfig("trashOption", value)));

    const advancedGroup = new SettingGroup(this.containerEl).setHeading("Advanced");
    const excludedFilesSetting = new Setting(advancedGroup.itemsEl)
      .setName("Excluded files")
      .addButton((button) => button
        .setButtonText("Manage")
        .onClick(() => {
          const filters = this.app.vault.getConfig<string[] | null>("userIgnoreFilters") ?? [];
          new ExcludedFilesModal(this.app, [...filters], (nextFilters) => {
            this.app.vault.setConfig("userIgnoreFilters", nextFilters.length === 0 ? null : nextFilters);
            this.updateExcludedFilesDescription(excludedFilesSetting);
          }).open();
        }));
    this.updateExcludedFilesDescription(excludedFilesSetting);

    let configLocation = this.getConfigLocationOverride();
    let relaunchButton: HTMLButtonElement | null = null;
    new Setting(advancedGroup.itemsEl)
      .setName("Config location")
      .setDesc("Override the folder where Obsidian stores configuration for this vault.")
      .addButton((button) => {
        relaunchButton = button.buttonEl;
        button
          .setCta()
          .setButtonText("Relaunch")
          .onClick(async () => {
            await this.applyConfigLocation(configLocation);
            this.reloadWindow();
          });
        button.buttonEl.hidden = true;
      })
      .addText((text) => {
        text.inputEl.placeholder = ".obsidian";
        text
          .setValue(configLocation)
          .onChange((value) => {
            if (!isValidConfigDir(value)) {
              text.inputEl.classList.add("mod-error");
              return;
            }
            text.inputEl.classList.remove("mod-error");
            configLocation = value;
            if (relaunchButton) relaunchButton.hidden = value === this.getConfigLocationOverride();
          });
      });

    new Setting(advancedGroup.itemsEl)
      .setName("URI callbacks")
      .setDesc("Allow Obsidian URI x-callback-url parameters to return results to other apps.")
      .addToggle((toggle) => toggle
        .setValue(Boolean(this.app.vault.getConfig("uriCallbacks")))
        .onChange((value) => this.app.vault.setConfig("uriCallbacks", value)));

    new Setting(advancedGroup.itemsEl)
      .setName("Reindex vault")
      .setDesc("Clear and rebuild the metadata cache for the vault.")
      .addButton((button) => button
        .setButtonText("Reindex")
        .setClass("mod-destructive")
        .onClick(() => this.reindexVault()));
  }

  hide(): void {
    this.containerEl.remove();
  }

  private updateExcludedFilesDescription(setting: Setting): void {
    setting.descEl.replaceChildren();
    setting.descEl.append("Configure files and folders that Obsidian should ignore.");
    const filters = this.app.vault.getConfig<string[] | null>("userIgnoreFilters") ?? [];
    if (filters.length === 0) return;
    const listEl = document.createElement("ul");
    for (const filter of filters) {
      const itemEl = document.createElement("li");
      const textEl = document.createElement("span");
      textEl.textContent = filter;
      itemEl.appendChild(textEl);
      if (isRegexFilter(filter)) itemEl.appendChild(createRegexFlair());
      listEl.appendChild(itemEl);
    }
    setting.descEl.appendChild(listEl);
  }

  private setAttachmentLocation(
    path: string,
    setting: Setting,
    folderInput: HTMLInputElement | null,
    subfolderInput: HTMLInputElement | null,
    defaultFolder: string,
  ): void {
    const dropdown = setting.controlEl.querySelector<HTMLSelectElement>("select");
    if (!dropdown) return;
    if (path === "/") {
      dropdown.value = "root";
      return;
    }
    if (path === "." || path === "./") {
      dropdown.value = "current";
      return;
    }
    if (path.startsWith("./")) {
      dropdown.value = "subfolder";
      if (subfolderInput) subfolderInput.value = path.slice(2) === defaultFolder ? "" : path.slice(2);
      return;
    }
    dropdown.value = "folder";
    if (folderInput) folderInput.value = path === defaultFolder ? "" : path;
  }

  private async reindexVault(): Promise<void> {
    await this.app.metadataCache.clear();
    this.reloadWindow();
  }

  private getConfigLocationOverride(): string {
    return window.localStorage?.getItem(`${this.app.appId}-config`) ?? "";
  }

  private async applyConfigLocation(configDir: string): Promise<void> {
    window.localStorage?.setItem(`${this.app.appId}-config`, configDir);
    this.app.vault.setConfigDir(configDir);
  }

  private reloadWindow(): void {
    window.location.reload();
  }
}

class ExcludedFilesModal extends ConfirmationModal {
  private readonly descEl: HTMLParagraphElement;
  private readonly listEl: HTMLElement;
  private inputEl!: HTMLInputElement;

  constructor(app: App, private readonly values: string[], private readonly onSave: (values: string[]) => void) {
    super(app);
    this.setTitle("Excluded files");
    this.descEl = document.createElement("p");
    this.listEl = document.createElement("div");

    const setting = new Setting(this.contentEl)
      .setName("Excluded filter")
      .addText((text) => {
        text.inputEl.placeholder = "Enter a path, glob, or /regex/";
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.isComposing || event.key !== "Enter") return;
          event.preventDefault();
          this.addFilter();
        });
        this.inputEl = text.inputEl;
      })
      .addButton((button) => button.setButtonText("Add").onClick(() => this.addFilter()));
    setting.settingEl.classList.add("excluded-filter-entry");

    this.contentEl.append(this.descEl, this.listEl);
    this.addButton("mod-cta", "Save", () => {
      this.close();
      this.onSave(this.values);
    });
    this.addCancelButton();
  }

  override onOpen(): void {
    this.display();
  }

  private addFilter(): void {
    const value = this.inputEl.value;
    if (!value.trim()) {
      this.inputEl.classList.add("mod-error");
      return;
    }
    this.inputEl.classList.remove("mod-error");
    this.values.push(value);
    this.inputEl.value = "";
    this.display();
  }

  private display(): void {
    this.descEl.textContent = this.values.length === 0 ? "No excluded filters applied." : "Excluded filters applied.";
    this.listEl.replaceChildren();
    for (const value of this.values) {
      const itemEl = document.createElement("div");
      itemEl.className = "mobile-option-setting-item excluded-filter-item";

      const nameEl = document.createElement("span");
      nameEl.className = "mobile-option-setting-item-name";
      nameEl.textContent = value;
      if (isRegexFilter(value)) nameEl.appendChild(createRegexFlair());

      const removeEl = document.createElement("div");
      removeEl.className = "clickable-icon mobile-option-setting-item-option-icon excluded-filter-remove";
      removeEl.dataset.icon = "lucide-x";
      removeEl.title = "Delete";
      removeEl.addEventListener("click", () => {
        const index = this.values.indexOf(value);
        if (index !== -1) this.values.splice(index, 1);
        this.display();
      });

      itemEl.append(nameEl, removeEl);
      this.listEl.appendChild(itemEl);
    }
  }
}

function isRegexFilter(value: string): boolean {
  return value.length > 2 && value.startsWith("/") && value.endsWith("/");
}

function createRegexFlair(): HTMLElement {
  const flairEl = document.createElement("span");
  flairEl.className = "flair mod-flat";
  flairEl.textContent = "Regex";
  return flairEl;
}

function isValidConfigDir(value: string): boolean {
  return value === "" || !/[\\/:*?"<>|]/.test(value);
}
