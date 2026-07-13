import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import type { BaseTheme } from "../app/theme/AppearanceManager";
import { Setting, SettingGroup } from "../ui/Setting";
import { setIcon } from "../ui/Icon";
import { Notice } from "../ui/Notice";
import { ThemeMarketplaceModal } from "./theme-market/ThemeMarketplaceModal";

const DEFAULT_FONT_SIZE = 16;

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
    this.renderThemeSettings();
    this.renderInterfaceSettings();
    this.renderFontSettings();
    this.renderAdvancedSettings();
    this.renderSnippetSettings();
  }

  hide(): void {
    this.containerEl.remove();
  }

  private renderThemeSettings(): void {
    const settings = this.app.appearance.getSettings();
    const group = new SettingGroup(this.containerEl);
    group.addSetting((setting) =>
      setting
        .setName("Base color scheme")
        .setDesc("Choose the color scheme used by the app.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("system", "Adapt to system")
            .addOption("moonstone", "Light")
            .addOption("obsidian", "Dark")
            .setValue(settings.baseTheme)
            .onChange((value) => this.app.appearance.setBaseTheme(value as BaseTheme)),
        ),
    );

    let picker: HTMLInputElement;
    let resetButton: { setDisabled(disabled: boolean): unknown };
    const syncAccentReset = (): void => {
      resetButton.setDisabled(!this.app.vault.getConfig<string>("accentColor"));
    };
    group.addSetting((setting) =>
      setting
        .setName("Accent color")
        .setDesc("Choose the color used for links, buttons, and focused controls.")
        .setClass("mod-toggle")
        .addExtraButton((button) => {
          resetButton = button
            .setIcon("lucide-rotate-ccw")
            .setTooltip("Restore default")
            .onClick(() => {
              this.app.appearance.setAccentColor("");
              picker.value = this.app.appearance.getAccentColor();
              syncAccentReset();
            });
        })
        .addColorPicker((color) => {
          picker = color.colorPickerEl;
          color.setValue(this.app.appearance.getAccentColor()).onChange((value) => {
            this.app.appearance.setAccentColor(value);
            syncAccentReset();
          });
        }),
    );
    syncAccentReset();

    const communityThemes = this.communityThemes();
    group.addSetting((setting) =>
      setting
        .setName("Themes")
        .setDesc("Manage installed themes and browse community themes.")
        .addExtraButton((button) =>
          button
            .setIcon("lucide-folder-open")
            .setTooltip("Open themes folder")
            .onClick(() => void this.openFolder(this.app.customCss.getThemeFolder())),
        )
        .addDropdown((dropdown) => {
          dropdown.addOption("", "Default");
          for (const theme of communityThemes) dropdown.addOption(theme.id, theme.name);
          dropdown
            .setValue(this.app.vault.getConfig<string>("cssTheme") ?? "")
            .onChange((value) => this.app.themes.setTheme(value));
        })
        .addButton((button) =>
          button
            .setButtonText("Manage")
            .setCta()
            .onClick(() => new ThemeMarketplaceModal(this.app).open()),
        ),
    );

    group.addSetting((setting) =>
      setting.setName("Current themes").setDesc(`${communityThemes.length} installed`),
    );
  }

  private renderInterfaceSettings(): void {
    const group = new SettingGroup(this.containerEl).setHeading("Interface");
    this.addConfigToggle(
      group,
      "Show inline title",
      "Display the note title above the editor.",
      "showInlineTitle",
      false,
    );
    this.addConfigToggle(
      group,
      "Show view header",
      "Display the header at the top of each view.",
      "showViewHeader",
      true,
    );
    this.addConfigToggle(
      group,
      "Show ribbon",
      "Display the ribbon on the left side of the window.",
      "showRibbon",
      true,
    );
  }

  private renderFontSettings(): void {
    const settings = this.app.appearance.getSettings();
    const group = new SettingGroup(this.containerEl).setHeading("Font");
    this.addFontSetting(
      group,
      "Interface font",
      "Font used by menus, buttons, and navigation.",
      "uiFont",
      settings.uiFont,
    );
    this.addFontSetting(
      group,
      "Text font",
      "Font used in the editor and reading view.",
      "textFont",
      settings.textFont,
    );
    this.addFontSetting(
      group,
      "Monospace font",
      "Font used for code blocks and code editors.",
      "monospaceFont",
      settings.monospaceFont,
    );

    let slider: HTMLInputElement;
    let resetButton: { setDisabled(disabled: boolean): unknown };
    const syncFontReset = (): void => {
      resetButton.setDisabled(slider.valueAsNumber === DEFAULT_FONT_SIZE);
    };
    group.addSetting((setting) =>
      setting
        .setName("Font size")
        .setDesc("Base font size used for text.")
        .addExtraButton((button) => {
          resetButton = button
            .setIcon("lucide-rotate-ccw")
            .setTooltip("Restore default")
            .onClick(() => {
              slider.valueAsNumber = DEFAULT_FONT_SIZE;
              this.app.appearance.setFontSize(DEFAULT_FONT_SIZE);
              syncFontReset();
            });
        })
        .addSlider((component) => {
          slider = component.sliderEl;
          component
            .setLimits(10, 30, 1)
            .setDynamicTooltip()
            .setValue(settings.baseFontSize)
            .onChange((value) => {
              this.app.appearance.setFontSize(value);
              syncFontReset();
            });
        }),
    );
    syncFontReset();
  }

  private renderAdvancedSettings(): void {
    const group = new SettingGroup(this.containerEl).setHeading("Advanced");
    this.addConfigToggle(
      group,
      "Native menus",
      "Use the operating system's native application menus.",
      "nativeMenus",
      false,
    );
    group.addSetting((setting) =>
      setting
        .setName("Translucent window")
        .setDesc("Allow supported themes to make the window translucent.")
        .addToggle((toggle) =>
          toggle
            .setValue(Boolean(this.app.vault.getConfig("translucency")))
            .onChange((value) => this.app.customCss.setTranslucency(value)),
        ),
    );
  }

  private renderSnippetSettings(): void {
    const group = new SettingGroup(this.containerEl)
      .setHeading("CSS snippets")
      .addExtraButton((button) =>
        button
          .setIcon("lucide-refresh-cw")
          .setTooltip("Reload snippets")
          .onClick(() => void this.reloadSnippets()),
      )
      .addExtraButton((button) =>
        button
          .setIcon("lucide-folder-open")
          .setTooltip("Open snippets folder")
          .onClick(() => void this.openFolder(this.app.customCss.getSnippetsFolder())),
      );

    const snippets = this.app.cssSnippets.listSnippets();
    if (snippets.length === 0) {
      group.addSetting((setting) =>
        setting
          .setName("No CSS snippets found")
          .setDesc(`Add CSS files to vault/${this.app.customCss.getSnippetsFolder()}.`),
      );
      return;
    }
    for (const snippet of snippets) {
      group.addSetting((setting) =>
        setting
          .setName(snippet.name)
          .setDesc(`vault/${this.app.customCss.getSnippetPath(snippet.id)}`)
          .addToggle((toggle) =>
            toggle
              .setValue(snippet.enabled)
              .onChange((value) => this.app.cssSnippets.setEnabled(snippet.id, value)),
          ),
      );
    }
  }

  private addConfigToggle(
    group: SettingGroup,
    name: string,
    description: string,
    key: string,
    defaultValue: boolean,
  ): void {
    group.addSetting((setting) =>
      setting
        .setName(name)
        .setDesc(description)
        .addToggle((toggle) =>
          toggle
            .setValue(this.app.vault.getConfig<boolean>(key) ?? defaultValue)
            .onChange((value) => this.app.vault.setConfig(key, value)),
        ),
    );
  }

  private addFontSetting(
    group: SettingGroup,
    name: string,
    description: string,
    key: "uiFont" | "textFont" | "monospaceFont",
    value: string,
  ): void {
    group.addSetting((setting) =>
      setting
        .setName(name)
        .setDesc(description)
        .addText((text) =>
          text
            .setPlaceholder("Default")
            .setValue(value)
            .onChange((font) => this.app.appearance.setFonts({ [key]: font })),
        ),
    );
  }

  private communityThemes() {
    return this.app.themes
      .listThemes()
      .filter((theme) => !theme.id.startsWith("obsidian-default-"));
  }

  private async reloadSnippets(): Promise<void> {
    await this.app.customCss.readSnippets(true);
    new Notice("CSS snippets reloaded");
    this.display();
  }

  private async openFolder(path: string): Promise<void> {
    try {
      if (!(await this.app.vault.exists(path))) await this.app.vault.createFolder(path);
      await this.app.openWithDefaultApp(path);
    } catch (error) {
      new Notice(
        `Could not open folder: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
