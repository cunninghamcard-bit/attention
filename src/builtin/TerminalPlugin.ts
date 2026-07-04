import type { App } from "../app/App";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import type { SettingTab } from "../app/SettingRegistry";
import type { Menu } from "../ui/Menu";
import { Setting, SettingGroup } from "../ui/Setting";
import { setIcon } from "../ui/Icon";
import { TFolder, type TAbstractFile } from "../vault/TAbstractFile";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { TERMINAL_VIEW_TYPE } from "../terminal/TerminalService";
import { TerminalView } from "./TerminalView";

/**
 * Built-in Terminal core plugin (docs/specs/terminal-view.spec.md), following
 * the WebViewerPlugin shape: view registration, commands, file/folder menu
 * cwd opening, and a settings tab. PTY and renderer live in src/terminal.
 */

export class TerminalController {
  constructor(readonly app: App) {}

  onEnable(plugin: InternalPluginWrapper): void {
    plugin.addSettingTab(new TerminalSettingTab(this.app));
    plugin.registerEvent(this.app.workspace.on<[Menu, TAbstractFile, string, WorkspaceLeaf]>("file-menu", (menu, file) => {
      menu.addItem((item) => item
        .setSection("system")
        .setTitle("Open terminal here")
        .setIcon("lucide-terminal")
        .onClick(() => void this.openAt(file)));
    }));
  }

  async open(cwd?: string): Promise<void> {
    await this.app.terminals.open({ cwd });
  }

  private async openAt(file: TAbstractFile): Promise<void> {
    const base = this.app.terminals.defaultCwd();
    const folder = file instanceof TFolder ? file.path : (file.parent?.path ?? "/");
    const relative = folder === "/" ? "" : `/${folder}`;
    await this.open(base ? `${base}${relative}` : undefined);
  }
}

class TerminalSettingTab implements SettingTab {
  readonly id = "terminal";
  readonly name = "Terminal";
  readonly icon = "lucide-terminal";
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
    this.containerEl.className = "vertical-tab-content terminal-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const settings = this.app.terminals.getSettings();
    const group = new SettingGroup(this.containerEl).setHeading("Terminal");
    new Setting(group.itemsEl)
      .setName("Shell path")
      .setDesc("Leave empty to use the login shell from $SHELL.")
      .addText((text) => text.setValue(settings.shell).onChange((value) => {
        this.app.terminals.saveSettings({ shell: value.trim() });
      }));
    new Setting(group.itemsEl)
      .setName("Default location")
      .setDesc("Where new terminals open in the workspace.")
      .addDropdown((dropdown) => dropdown
        .addOption("tab", "New tab")
        .addOption("split", "Split pane")
        .addOption("right", "Right sidebar")
        .setValue(settings.location)
        .onChange((value) => {
          this.app.terminals.saveSettings({ location: value === "split" || value === "right" ? value : "tab" });
        }));
    new Setting(group.itemsEl)
      .setName("Font family")
      .setDesc("Leave empty to use the interface monospace font.")
      .addText((text) => text.setValue(settings.fontFamily).onChange((value) => {
        this.app.terminals.saveSettings({ fontFamily: value.trim() });
      }));
    new Setting(group.itemsEl)
      .setName("Font size")
      .addText((text) => text.setValue(String(settings.fontSize)).onChange((value) => {
        const size = Number(value);
        if (Number.isFinite(size) && size > 0) this.app.terminals.saveSettings({ fontSize: size });
      }));
    new Setting(group.itemsEl)
      .setName("Scrollback lines")
      .addText((text) => text.setValue(String(settings.scrollback)).onChange((value) => {
        const lines = Number(value);
        if (Number.isFinite(lines) && lines >= 0) this.app.terminals.saveSettings({ scrollback: lines });
      }));
  }

  hide(): void {
    this.containerEl.remove();
  }
}

export function createTerminalPluginDefinition(): InternalPluginDefinition {
  let controller: TerminalController | null = null;
  return {
    id: "terminal",
    name: "Terminal",
    description: "Opens a real local shell inside the workspace.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new TerminalController(app);
      plugin.instance = controller;
      plugin.registerViewType(TERMINAL_VIEW_TYPE, (leaf) => new TerminalView(leaf));
      plugin.registerGlobalCommand({
        id: "terminal:open",
        name: "Open terminal",
        icon: "lucide-terminal",
        hotkeys: [{ modifiers: ["Mod"], key: "J" }],
        callback: () => void controller?.open(),
      });
      plugin.registerRibbonItem("Open terminal", "lucide-terminal", () => void controller?.open());
      // Desktop workspaces start with a Terminal tab in the right dock. The
      // deferred view keeps the PTY unspawned until the tab is revealed; the
      // bridge check keeps browser mode (which cannot spawn shells) clean.
      app.workspace.onLayoutReady(() => {
        const bridge = (globalThis as { electronTerminal?: { available?: boolean } }).electronTerminal;
        if (!bridge?.available) return;
        if (app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE).length > 0) return;
        const leaf = app.workspace.getRightLeaf(false);
        if (leaf) void leaf.setViewState({ type: TERMINAL_VIEW_TYPE, state: { lazy: true }, icon: "lucide-terminal", title: "Terminal" } as never);
      });
      controller.onEnable(plugin);
      plugin.register(() => app.terminals.killAll());
    },
  };
}
