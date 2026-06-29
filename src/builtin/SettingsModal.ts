import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import { Modal } from "../ui/Modal";
import { SettingsRenderer } from "./SettingsRenderer";

export class SettingsModal extends Modal {
  private renderer: SettingsRenderer | null = null;

  constructor(
    app: App,
    private preferredTabId?: string,
    readonly onTabOpen?: (tab: SettingTab) => void,
    readonly onModalClose?: () => void,
  ) {
    super(app);
    this.modalEl.classList.add("mod-settings", "mod-sidebar-layout");
    this.contentEl.classList.add("vertical-tabs-container");
    this.updateModalTitle();
  }

  onOpen(): void {
    this.contentEl.replaceChildren();
    this.updateModalTitle();
    this.renderer = new SettingsRenderer(this.app, this.contentEl, (tab) => {
      this.updateModalTitle(tab);
      this.onTabOpen?.(tab);
    });
    this.renderer.render(this.preferredTabId);
  }

  onClose(): void {
    this.renderer = null;
    this.updateModalTitle();
    this.onModalClose?.();
  }

  openTabById(id: string): SettingTab | null {
    this.preferredTabId = id;
    return this.renderer?.openTabById(id) ?? null;
  }

  addSettingTab(tab: SettingTab): void {
    this.renderer?.addSettingTab(tab);
  }

  removeSettingTab(tab: SettingTab): void {
    this.renderer?.removeSettingTab(tab);
  }

  private updateModalTitle(tab?: SettingTab): void {
    this.titleEl.replaceChildren();
    this.titleEl.textContent = tab?.name ?? "Settings";
  }
}
