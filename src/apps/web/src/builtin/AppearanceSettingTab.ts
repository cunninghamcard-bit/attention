import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import { Setting, SettingGroup } from "../ui/Setting";
import type { BaseTheme } from "../app/theme/AppearanceManager";
import { ThemeMarketplaceModal } from "./theme-market/ThemeMarketplaceModal";
import { setIcon } from "../ui/Icon";

export class AppearanceSettingTab implements SettingTab {
  readonly id = "appearance";
  readonly name = "Appearance";
  readonly icon = "palette";
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
    this.containerEl.className = "vertical-tab-content appearance-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const settings = this.app.appearance.getSettings();

    const baseGroup = new SettingGroup(this.containerEl).setHeading("Base theme");
    new Setting(baseGroup.itemsEl)
      .setName("Base color scheme")
      .setDesc("Matches Obsidian's obsidian/moonstone/system base theme options.")
      .addDropdown((dropdown) => dropdown
        .addOption("obsidian", "Dark")
        .addOption("moonstone", "Light")
        .addOption("system", "Adapt to system")
        .setValue(settings.baseTheme)
        .onChange((value) => this.app.appearance.setBaseTheme(value as BaseTheme)));

    new Setting(baseGroup.itemsEl)
      .setName("Accent color")
      .setDesc("Writes accent HSL variables on document.body.")
      .addText((text) => text.setValue(settings.accentColor).onChange((value) => this.app.appearance.setAccentColor(value)));

    const themeGroup = new SettingGroup(this.containerEl).setHeading("Themes");
    new Setting(themeGroup.itemsEl)
      .setName("CSS theme")
      .setDesc("Loaded into CustomCss.styleEl, after plugin CSS and before snippets.")
      .addDropdown((dropdown) => {
        for (const theme of this.app.themes.listThemes()) dropdown.addOption(theme.id, theme.name);
        const active = this.app.themes.getActiveTheme();
        if (active) dropdown.setValue(active.id);
        dropdown.onChange((value) => this.app.themes.setTheme(value));
      });
    new Setting(themeGroup.itemsEl)
      .setName("Community themes")
      .setDesc("Browse and install themes from the official catalog.")
      .addButton((button) => button.setButtonText("Browse").onClick(() => {
        new ThemeMarketplaceModal(this.app).open();
      }));

    const snippetsGroup = new SettingGroup(this.containerEl).setHeading("CSS snippets");
    const snippets = this.app.cssSnippets.listSnippets();
    if (snippets.length === 0) {
      new Setting(snippetsGroup.itemsEl)
        .setName("No snippets found")
        .setDesc("Snippets live after the active theme in the CSS cascade.")
        .setDisabled(true);
    }
    for (const snippet of snippets) {
      new Setting(snippetsGroup.itemsEl)
        .setName(snippet.name)
        .setDesc(snippet.id)
        .addToggle((toggle) => toggle.setValue(snippet.enabled).onChange((value) => this.app.cssSnippets.setEnabled(snippet.id, value)));
    }
  }

  hide(): void {
    this.containerEl.remove();
  }
}
