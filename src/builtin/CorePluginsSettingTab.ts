import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import { Setting, SettingGroup } from "../ui/Setting";
import { setIcon } from "../ui/Icon";

export class CorePluginsSettingTab implements SettingTab {
  readonly id = "plugins";
  readonly name = "Core plugins";
  readonly icon = "toy-brick";
  readonly section = "core-plugins" as const;
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
    this.containerEl.className = "vertical-tab-content core-plugins-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const group = new SettingGroup(this.containerEl).setHeading("Core plugins");
    const searchEl = document.createElement("input");
    searchEl.className = "setting-group-search";
    searchEl.type = "text";
    searchEl.placeholder = "Search core plugins...";
    searchEl.value = this.query;
    group.groupEl.insertBefore(searchEl, group.itemsEl);
    searchEl.addEventListener("input", () => {
      this.query = searchEl.value;
      this.display();
    });

    const tokens = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const states = [...this.app.internalPlugins.list()]
      .filter((state) => !state.definition.hiddenFromList)
      .sort((a, b) => a.definition.name.localeCompare(b.definition.name));
    for (const state of states) {
      const haystack = `${state.definition.name} ${state.definition.description ?? ""} ${state.id}`.toLowerCase();
      if (tokens.length > 0 && !tokens.every((token) => haystack.includes(token))) continue;
      const setting = new Setting(group.itemsEl)
        .setName(state.definition.name)
        .setDesc(state.definition.description ?? state.id)
        .addToggle((toggle) => toggle.setValue(state.enabled).onChange((enabled) => {
          const action = enabled ? this.app.internalPlugins.enable(state.id, true) : this.app.internalPlugins.disable(state.id, true);
          void action.then(() => this.display());
        }));
      const pluginSettingsTab = this.app.setting.getTabById(state.id);
      if (state.enabled && pluginSettingsTab) {
        setting.addButton((button) => button
          .setButtonText("Options")
          .onClick(() => {
            this.app.setting.openTabById(state.id);
          }));
      }
      const hasCommands = this.app.commands.getCommands().some((command) => command.id.startsWith(`${state.id}:`));
      if (state.enabled && hasCommands && this.app.setting.getTabById("hotkeys")) {
        setting.addButton((button) => button
          .setButtonText("Hotkeys")
          .onClick(() => {
            const hotkeysTab = this.app.setting.getTabById("hotkeys") as ({ setQuery?: (query: string) => void } | null);
            hotkeysTab?.setQuery?.(state.id);
            this.app.setting.openTabById("hotkeys");
          }));
      }
    }
  }

  hide(): void {
    this.containerEl.remove();
  }
}
