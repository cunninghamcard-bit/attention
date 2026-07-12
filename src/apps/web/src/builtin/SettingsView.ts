import { ItemView } from "../views/ItemView";
import { SettingsRenderer } from "./SettingsRenderer";

export class SettingsView extends ItemView {
  private renderer: SettingsRenderer | null = null;

  getViewType(): string { return "settings"; }
  getDisplayText(): string { return "Settings"; }

  async onOpen(): Promise<void> {
    this.renderSettingsHome();
  }

  renderSettingsHome(): void {
    this.contentEl.replaceChildren();
    this.contentEl.className = "view-content";
    this.renderer = new SettingsRenderer(this.app, this.contentEl);
    this.renderer.render();
  }
}
