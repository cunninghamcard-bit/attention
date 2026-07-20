import type { App } from "./App";
import type { SettingTab } from "./SettingTab";
export { SettingTab } from "./SettingTab";
export type { SettingSection } from "./SettingTab";
import { SettingsModal } from "../builtin/SettingsModal";

export class SettingRegistry {
  private tabs: SettingTab[] = [];
  private activeTab: SettingTab | null = null;
  private modal: SettingsModal | null = null;
  private lastTabId: string | null = null;

  constructor(readonly app: App) {}

  addSettingTab(tab: SettingTab): void {
    tab.update?.();
    this.tabs.push(tab);
    this.modal?.addSettingTab(tab);
  }

  removeSettingTab(tab: SettingTab): void {
    this.tabs = this.tabs.filter((item) => item !== tab);
    this.modal?.removeSettingTab(tab);
    if (this.activeTab === tab) {
      this.activeTab = null;
      if (tab.id === this.lastTabId) this.lastTabId = null;
    }
  }

  openTab(tab: SettingTab): void {
    if (tab.id) {
      this.openTabById(tab.id);
      return;
    }
    this.activeTab?.hide?.();
    this.activeTab = tab;
    tab.display?.();
  }

  getTabs(): readonly SettingTab[] {
    return this.tabs;
  }

  getTabById(id: string): SettingTab | null {
    return this.tabs.find((tab) => tab.id === id) ?? null;
  }

  open(preferredTabId = this.lastTabId ?? undefined): void {
    this.modal?.close();
    this.modal = new SettingsModal(
      this.app,
      preferredTabId,
      (tab) => {
        this.activeTab = tab;
        if (tab.id) this.lastTabId = tab.id;
      },
      () => {
        this.modal = null;
      },
    );
    this.modal.open();
  }

  openTabById(id: string): SettingTab | null {
    const tab = this.getTabById(id);
    if (!tab) return null;
    if (this.modal) {
      return this.modal.openTabById(id);
    }
    this.open(id);
    return tab;
  }
}
