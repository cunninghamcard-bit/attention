import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import type { BaseTheme } from "../app/theme/AppearanceManager";
import { Setting, SettingGroup } from "../ui/Setting";
import { setIcon } from "../ui/Icon";
import { Notice } from "../ui/Notice";
import { ThemeMarketplaceModal } from "./theme-market/ThemeMarketplaceModal";
import type { ThemeMarketplaceEntry } from "./theme-market/ThemeMarketplace";
import {
  FontManagerModal,
  RibbonConfigurationModal,
  fontAvailable,
  parseFontFamilies,
} from "./AppearanceModals";
import { Platform } from "../platform/Platform";
import { setTooltip } from "../ui/Popover";

const DEFAULT_FONT_SIZE = 16;

export class AppearanceSettingTab implements SettingTab {
  readonly id = "appearance";
  readonly name = "Appearance";
  readonly icon = "palette";
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");
  private themeUpdates: ThemeMarketplaceEntry[] | null = null;

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

    group.addSetting((setting) => {
      setting
        .setName("Current themes")
        .setDesc(
          this.themeUpdates?.length
            ? `${communityThemes.length} installed · ${this.themeUpdates.length} update${this.themeUpdates.length === 1 ? "" : "s"} available`
            : `${communityThemes.length} installed${this.themeUpdates ? " · Themes are up to date" : ""}`,
        );
      if (this.themeUpdates?.length) {
        setting
          .addButton((button) =>
            button
              .setButtonText("View updates")
              .onClick(() =>
                new ThemeMarketplaceModal(
                  this.app,
                  new Set(this.themeUpdates?.map((entry) => entry.manifest.id)),
                ).open(),
              ),
          )
          .addButton((button) =>
            button
              .setButtonText("Update all themes")
              .setCta()
              .onClick(() => this.updateAllThemes()),
          );
      } else if (communityThemes.length) {
        setting.addButton((button) =>
          button.setButtonText("Check for updates").onClick(() => this.checkThemeUpdates()),
        );
      }
    });
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
    group.addSetting((setting) =>
      setting
        .setName("Show ribbon")
        .setDesc("Display the ribbon on the left side of the window.")
        .addToggle((toggle) =>
          toggle
            .setValue(this.app.vault.getConfig<boolean>("showRibbon") ?? true)
            .onChange((value) => {
              this.app.vault.setConfig("showRibbon", value);
              this.display();
            }),
        ),
    );
    if (
      Platform.canDisplayRibbon &&
      (Platform.isMobile || this.app.vault.getConfig("showRibbon"))
    ) {
      group.addSetting((setting) =>
        setting
          .setName("Configure ribbon")
          .setDesc("Choose which actions appear in the ribbon.")
          .addButton((button) =>
            button
              .setButtonText("Manage")
              .onClick(() => new RibbonConfigurationModal(this.app).open()),
          ),
      );
    }
  }

  private renderFontSettings(): void {
    const settings = this.app.appearance.getSettings();
    const group = new SettingGroup(this.containerEl).setHeading("Font");
    this.addFontSetting(
      group,
      "Interface font",
      "Choose the font used by menus, buttons, and navigation.",
      "uiFont",
      settings.uiFont,
    );
    this.addFontSetting(
      group,
      "Text font",
      "Choose the font used in the editor and reading view.",
      "textFont",
      settings.textFont,
    );
    this.addFontSetting(
      group,
      "Monospace font",
      "Choose the font used for code blocks and code editors.",
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
    this.addConfigToggle(
      group,
      "Increase base font size on mobile",
      "Increase the base font size when editing on a mobile device.",
      "baseFontSizeAction",
      false,
    );
  }

  private renderAdvancedSettings(): void {
    const group = new SettingGroup(this.containerEl).setHeading("Advanced");
    const electron = desktopElectron();
    if (Platform.isDesktop) {
      let zoomSlider: HTMLInputElement;
      let zoomReset: { setDisabled(disabled: boolean): unknown };
      const syncZoomReset = (): void => {
        zoomReset.setDisabled(zoomSlider.valueAsNumber === 0);
      };
      group.addSetting((setting) =>
        setting
          .setName("Zoom level")
          .setDesc("Adjust the overall zoom level of the app.")
          .addExtraButton((button) => {
            zoomReset = button
              .setIcon("lucide-rotate-ccw")
              .setTooltip("Restore default")
              .onClick(() => {
                zoomSlider.valueAsNumber = 0;
                electron?.webFrame?.setZoomLevel?.(0);
                syncZoomReset();
              });
          })
          .addSlider((slider) => {
            zoomSlider = slider.sliderEl;
            slider
              .setLimits(-2.5, 3, 0.5)
              .setDisplayFormat((value) => `${Math.round(100 * 1.2 ** value)}%`)
              .setDynamicTooltip()
              .setValue(electron?.webFrame?.getZoomLevel?.() ?? 0)
              .onChange((value) => {
                electron?.webFrame?.setZoomLevel?.(value);
                syncZoomReset();
              });
          }),
      );
      syncZoomReset();
    }
    this.addConfigToggle(
      group,
      "Native menus",
      "Use the operating system's native application menus.",
      "nativeMenus",
      false,
    );
    if (Platform.isDesktopApp) {
      group.addSetting((setting) => {
        const showRelaunch = this.addRelaunchButton(setting);
        setting
          .setName("Frame style")
          .setDesc("Choose how the application window frame is displayed.")
          .addDropdown((dropdown) =>
            dropdown
              .addOption("hidden", "Hidden (default)")
              .addOption("custom", "Custom")
              .addOption("native", "Native")
              .setValue(String(electron?.ipcRenderer?.sendSync?.("frame") ?? "hidden"))
              .onChange((value) => {
                electron?.ipcRenderer?.sendSync?.("frame", value);
                showRelaunch();
              }),
          );
      });

      group.addSetting((setting) => {
        const iconData = electron?.ipcRenderer?.sendSync?.("get-icon");
        const preview = this.containerEl.ownerDocument.createElement("img");
        preview.className = "setting-icon-preview";
        preview.alt = "Custom icon preview";
        preview.width = 64;
        preview.height = 64;
        if (typeof iconData === "string") preview.src = iconData;
        else preview.hidden = true;
        setting.descEl.appendChild(preview);
        const showRelaunch = this.addRelaunchButton(setting);
        setting
          .setName("Custom icon")
          .addExtraButton((button) =>
            button
              .setIcon("lucide-rotate-ccw")
              .setTooltip("Restore default")
              .onClick(() => {
                electron?.ipcRenderer?.sendSync?.("set-icon", null);
                preview.hidden = true;
                showRelaunch();
              }),
          )
          .addButton((button) =>
            button.setButtonText("Choose").onClick(async () => {
              const paths = await electron?.ipcRenderer?.invoke?.("dialog:open", {
                title: "Choose custom icon",
                extensions: ["png", "ico", "icns"],
              });
              const path = Array.isArray(paths) && typeof paths[0] === "string" ? paths[0] : null;
              if (!path) return;
              const data = electron?.ipcRenderer?.sendSync?.("set-icon", path);
              if (typeof data !== "string") return;
              preview.src = data;
              preview.hidden = false;
              showRelaunch();
            }),
          );
      });
    }
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
    if (Platform.isDesktopApp) {
      group.addSetting((setting) => {
        const showRelaunch = this.addRelaunchButton(setting);
        setting
          .setName("Hardware acceleration")
          .setDesc("Use the graphics processor to improve rendering performance.")
          .addToggle((toggle) =>
            toggle
              .setValue(!Boolean(electron?.ipcRenderer?.sendSync?.("disable-gpu")))
              .onChange((enabled) => {
                electron?.ipcRenderer?.sendSync?.("disable-gpu", !enabled);
                showRelaunch();
              }),
          );
      });
    }
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

  private addRelaunchButton(setting: Setting): () => void {
    let relaunch: HTMLButtonElement;
    setting.addButton((button) => {
      relaunch = button.buttonEl;
      relaunch.hidden = true;
      button
        .setButtonText("Relaunch")
        .onClick(() => desktopElectron()?.ipcRenderer?.send?.("relaunch"));
    });
    return () => (relaunch.hidden = false);
  }

  private addFontSetting(
    group: SettingGroup,
    name: string,
    description: string,
    key: "uiFont" | "textFont" | "monospaceFont",
    value: string,
  ): void {
    const doc = this.containerEl.ownerDocument;
    const fonts = parseFontFamilies(value);
    // Source shape: description text, then either a single u-pop name or a ul of families.
    const desc = doc.createDocumentFragment();
    desc.append(doc.createTextNode(description));
    if (fonts.length === 1) {
      const label = doc.createElement("span");
      label.textContent = "Currently in effect: ";
      const pop = doc.createElement("span");
      pop.className = "u-pop";
      pop.textContent = fonts[0];
      desc.append(label, pop);
    } else if (fonts.length > 1) {
      const label = doc.createElement("span");
      label.textContent = "Fonts currently in effect:";
      const list = doc.createElement("ul");
      for (const font of fonts) {
        const item = doc.createElement("li");
        const nameEl = doc.createElement("span");
        nameEl.textContent = font;
        item.append(nameEl);
        // Source attaches missing-font warnings after fonts.ready. The list
        // item may still be in a DocumentFragment when the promise starts, so
        // do not gate on isConnected — only skip if the row was removed/replaced.
        void fontAvailable(font, doc).then((available) => {
          if (available || item.querySelector(".mod-warning")) return;
          item.append(" ");
          const warning = doc.createElement("span");
          warning.className = "mod-warning";
          setIcon(warning, "lucide-alert-circle");
          setTooltip(warning, "Font not found");
          item.append(warning);
        });
        list.appendChild(item);
      }
      desc.append(label, list);
    }
    group.addSetting((setting) =>
      setting
        .setName(name)
        .setDesc(desc)
        .addButton((button) =>
          button
            .setButtonText("Manage")
            .setCta()
            .onClick(() =>
              new FontManagerModal(this.app, name, value, (font) =>
                this.app.appearance.setFonts({ [key]: font }),
              )
                .setCloseCallback(() => this.display())
                .open(),
            ),
        ),
    );
  }

  private communityThemes() {
    return this.app.themes
      .listThemes()
      .filter((theme) => !theme.id.startsWith("obsidian-default-"));
  }

  private async checkThemeUpdates(): Promise<void> {
    try {
      this.themeUpdates = await this.app.themeMarketplace.findUpdates(this.communityThemes());
      if (this.themeUpdates.length === 0) new Notice("Themes are up to date");
      this.display();
    } catch (error) {
      new Notice(
        `Theme update check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async updateAllThemes(): Promise<void> {
    try {
      for (const entry of this.themeUpdates ?? []) {
        await this.app.themeInstaller.update(entry.manifest.id);
      }
      this.themeUpdates = [];
      new Notice("Themes updated");
      this.display();
    } catch (error) {
      new Notice(`Theme update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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

interface DesktopElectron {
  webFrame?: {
    getZoomLevel?: () => number;
    setZoomLevel?: (value: number) => void;
  };
  ipcRenderer?: {
    send?: (channel: string, ...args: unknown[]) => void;
    sendSync?: (channel: string, ...args: unknown[]) => unknown;
    invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
}

function desktopElectron(): DesktopElectron | undefined {
  return (globalThis as typeof globalThis & { electron?: DesktopElectron }).electron;
}
