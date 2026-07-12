import type { App } from "../../app/App";
import type { SettingTab } from "../../app/SettingRegistry";
import { setIcon } from "../../ui/Icon";
import { Setting, SettingGroup } from "../../ui/Setting";
import { STRINGS } from "./AgentStrings";
import { DEFAULT_CHAT_BRIDGE_URL } from "./AgentTransport";
import { DEFAULT_PASTE_CARD_THRESHOLD } from "./ChatComposerPaste";

export class ChatSettingTab implements SettingTab {
  readonly id = "agents";
  readonly name = "Agents";
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
    const group = new SettingGroup(this.containerEl).setHeading(STRINGS.settings.engineHeading);
    new Setting(group.itemsEl)
      .setName(STRINGS.settings.bridgeUrl)
      .setDesc(STRINGS.settings.bridgeUrlDesc)
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_CHAT_BRIDGE_URL)
          .setValue(window.localStorage?.getItem("chat-bridge-url") ?? "")
          .onChange((value) => {
            const trimmed = value.trim();
            if (trimmed) window.localStorage?.setItem("chat-bridge-url", trimmed);
            else window.localStorage?.removeItem("chat-bridge-url");
          }),
      );

    const chatGroup = new SettingGroup(this.containerEl).setHeading(STRINGS.settings.chatHeading);
    new Setting(chatGroup.itemsEl)
      .setName(STRINGS.settings.typewriter)
      .setDesc(STRINGS.settings.typewriterDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(window.localStorage?.getItem("chat-typewriter") !== "off")
          .onChange((value) => {
            if (value) window.localStorage?.removeItem("chat-typewriter");
            else window.localStorage?.setItem("chat-typewriter", "off");
          }),
      );
    new Setting(chatGroup.itemsEl)
      .setName(STRINGS.settings.collapseThinking)
      .setDesc(STRINGS.settings.collapseThinkingDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(window.localStorage?.getItem("chat-thinking-collapse") !== "off")
          .onChange((value) => {
            if (value) window.localStorage?.removeItem("chat-thinking-collapse");
            else window.localStorage?.setItem("chat-thinking-collapse", "off");
          }),
      );

    const composerGroup = new SettingGroup(this.containerEl).setHeading(
      STRINGS.settings.composerHeading,
    );
    new Setting(composerGroup.itemsEl)
      .setName(STRINGS.settings.pasteThreshold)
      .setDesc(STRINGS.settings.pasteThresholdDesc(DEFAULT_PASTE_CARD_THRESHOLD))
      .addText((text) =>
        text
          .setPlaceholder(String(DEFAULT_PASTE_CARD_THRESHOLD))
          .setValue(window.localStorage?.getItem("chat-paste-threshold") ?? "")
          .onChange((value) => {
            const parsed = Number(value.trim());
            if (Number.isFinite(parsed) && parsed > 0)
              window.localStorage?.setItem("chat-paste-threshold", String(parsed));
            else window.localStorage?.removeItem("chat-paste-threshold");
          }),
      );
  }
}
