/**
 * Input: ../../app/App, ../../app/SettingRegistry, ../../plugin/InternalPlugin, ../../plugin/InternalPluginWrapper, ../../ui/Icon, ../../ui/Setting, ./AgentService, ./AgentView
 * Output: AgentController, createAgentPluginDefinition
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { App } from "../../app/App";
import type { SettingTab } from "../../app/SettingRegistry";
import type { InternalPluginDefinition } from "../../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../../plugin/InternalPluginWrapper";
import { setIcon } from "../../ui/Icon";
import { Setting, SettingGroup } from "../../ui/Setting";
import {
  AGENT_PROVIDERS,
  AGENT_VIEW_TYPE,
  DEFAULT_SYSTEM_PROMPT,
  getAgentService,
  type AgentService,
} from "./AgentService";
import { AgentView } from "./AgentView";

const AGENT_ICON = "lucide-messages-square";

export class AgentController {
  constructor(readonly app: App) {}

  /** Reveals the agent in the right dock, the same seat the terminal takes on
   * the other side — one leaf, reused. */
  async open(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(AGENT_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: AGENT_VIEW_TYPE, icon: AGENT_ICON, title: "Agent" } as never);
    this.app.workspace.revealLeaf(leaf);
  }
}

class AgentSettingTab implements SettingTab {
  readonly id = "agent";
  readonly name = "Agent";
  readonly icon = AGENT_ICON;
  readonly section = "core-plugins" as const;
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
    this.containerEl.className = "vertical-tab-content agent-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const service: AgentService = getAgentService(this.app);
    const settings = service.getSettings();
    const group = new SettingGroup(this.containerEl).setHeading("Agent");

    new Setting(group.itemsEl)
      .setName("Provider")
      .setDesc("Which account answers. Changing it selects that provider's default model.")
      .addDropdown((dropdown) => {
        for (const provider of AGENT_PROVIDERS) dropdown.addOption(provider.id, provider.name);
        dropdown.setValue(settings.provider).onChange((value) => {
          const provider = AGENT_PROVIDERS.find((candidate) => candidate.id === value);
          if (!provider) return;
          service.saveSettings({ provider: provider.id, model: provider.defaultModel });
          // The model list and the key field both belong to the provider, so
          // the panel is redrawn rather than patched in place.
          this.display();
        });
      });

    new Setting(group.itemsEl)
      .setName("Model")
      .setDesc("Models pi knows about for this provider.")
      .addDropdown((dropdown) => {
        // The model list comes from pi, which is behind a dynamic import — the
        // row renders with the saved model now and fills in when the SDK lands.
        dropdown.addOption(settings.model, settings.model);
        dropdown
          .setValue(settings.model)
          .onChange((value) => service.saveSettings({ model: value }));
        void service.listModelIds(settings.provider).then((ids) => {
          dropdown.selectEl.replaceChildren();
          for (const id of ids) dropdown.addOption(id, id);
          dropdown.setValue(settings.model);
        });
      });

    new Setting(group.itemsEl)
      .setName("API key")
      .setDesc("Stored with this vault's settings. Leave empty to clear it.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("sk-…").onChange((value) => {
          void service.setApiKey(settings.provider, value);
        });
        void service.getApiKey(settings.provider).then((key) => text.setValue(key));
      });

    new Setting(group.itemsEl)
      .setName("System prompt")
      .setDesc("Sent with every turn.")
      .addTextArea((text) =>
        text
          .setValue(settings.systemPrompt)
          .setPlaceholder(DEFAULT_SYSTEM_PROMPT)
          .onChange((value) =>
            service.saveSettings({
              systemPrompt: value.trim() === "" ? DEFAULT_SYSTEM_PROMPT : value,
            }),
          ),
      );
  }

  hide(): void {
    this.containerEl.remove();
  }
}

/**
 * Core plugin seating pi's Agent SDK (`@earendil-works/pi-agent-core`) in the
 * workspace: one chat view in the right dock, the vault as the agent's tools.
 * The loop, the providers and the tool protocol are pi's — this definition only
 * registers the surface and the settings that feed it.
 */
export function createAgentPluginDefinition(): InternalPluginDefinition {
  let controller: AgentController | null = null;
  return {
    id: "agent",
    name: "Agent",
    description: "Chat with an agent that reads and writes this vault, powered by the pi SDK.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new AgentController(app);
      plugin.instance = controller;
      plugin.registerViewType(AGENT_VIEW_TYPE, (leaf) => new AgentView(leaf));
      plugin.registerGlobalCommand({
        id: "agent:open",
        name: "Open agent",
        icon: AGENT_ICON,
        callback: () => void controller?.open(),
      });
      plugin.registerRibbonItem("Open agent", AGENT_ICON, () => void controller?.open());
      plugin.addSettingTab(new AgentSettingTab(app));
    },
  };
}
