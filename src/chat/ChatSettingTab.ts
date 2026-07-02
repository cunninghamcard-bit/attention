import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import { setIcon } from "../ui/Icon";
import { Setting, SettingGroup } from "../ui/Setting";
import { DEFAULT_CHAT_BRIDGE_URL } from "./ChatTransport";

export class ChatSettingTab implements SettingTab {
  readonly id = "chat";
  readonly name = "Chat";
  readonly icon = "message-circle";
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
    this.containerEl.className = "vertical-tab-content chat-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const group = new SettingGroup(this.containerEl).setHeading("Engine");
    new Setting(group.itemsEl)
      .setName("Bridge URL")
      .setDesc("REST + SSE endpoint of the chat bridge. Applies to newly opened threads.")
      .addText((text) => text
        .setPlaceholder(DEFAULT_CHAT_BRIDGE_URL)
        .setValue(window.localStorage?.getItem("chat-bridge-url") ?? "")
        .onChange((value) => {
          const trimmed = value.trim();
          if (trimmed) window.localStorage?.setItem("chat-bridge-url", trimmed);
          else window.localStorage?.removeItem("chat-bridge-url");
        }));
  }
}
