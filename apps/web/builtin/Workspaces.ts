import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import type { WorkspaceLayout } from "../views/workspace/WorkspaceLayout";
import { FuzzySuggestModal, type FuzzySuggestion } from "../ui/suggest/SuggestModal";
import { Setting, SettingGroup } from "../ui/Setting";
import { setIcon } from "../ui/Icon";
import { registerWorkspacesCliHandlers } from "../app/cli/commands/workspacesCli";

export interface SavedWorkspace {
  name: string;
  layout: WorkspaceLayout;
  savedAt: string;
}

export interface WorkspacesOptions {
  workspaces: Record<string, SavedWorkspace>;
  // The last saved/loaded workspace name — real Obsidian persists {workspaces, active}.
  active: string;
}

export class WorkspacesController {
  options: WorkspacesOptions = { workspaces: {}, active: "" };
  plugin: InternalPluginWrapper | null = null;

  constructor(readonly app: App) {}

  async onEnable(plugin: InternalPluginWrapper): Promise<void> {
    this.plugin = plugin;
    this.options = {
      workspaces: {},
      active: "",
      ...(await plugin.loadData<WorkspacesOptions>()),
    };
    plugin.addSettingTab(new WorkspacesSettingTab(this.app, this));
  }

  listWorkspaces(): SavedWorkspace[] {
    return Object.values(this.options.workspaces).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
    );
  }

  get activeWorkspace(): string {
    return this.options.active;
  }

  // Real setActiveWorkspace: sets the field only; persistence rides the next
  // saveData from the mutation that follows.
  setActiveWorkspace(name: string): void {
    this.options.active = name;
  }

  // Real saveWorkspace does not trim or validate the name — callers do.
  async saveCurrentWorkspace(name: string): Promise<void> {
    this.options.workspaces[name] = {
      name,
      layout: this.app.workspace.getLayout(),
      savedAt: new Date().toISOString(),
    };
    await this.persist();
  }

  // Real loadWorkspace: set active, apply the layout, persist.
  async loadWorkspace(name: string): Promise<void> {
    const workspace = this.options.workspaces[name];
    if (!workspace) return;
    this.options.active = name;
    await this.app.workspace.changeLayout(workspace.layout);
    await this.persist();
  }

  async deleteWorkspace(name: string): Promise<void> {
    delete this.options.workspaces[name];
    await this.persist();
  }

  async renameWorkspace(oldName: string, newName: string): Promise<void> {
    const workspace = this.options.workspaces[oldName];
    const trimmed = newName.trim();
    if (!workspace || !trimmed) return;
    delete this.options.workspaces[oldName];
    this.options.workspaces[trimmed] = { ...workspace, name: trimmed };
    await this.persist();
  }

  openLoadModal(): void {
    new WorkspaceSuggestModal(this.app, this).open();
  }

  async promptSaveCurrentWorkspace(): Promise<void> {
    const name = window.prompt("Workspace name");
    if (name) await this.saveCurrentWorkspace(name);
  }

  async promptSaveThenLoadWorkspace(): Promise<void> {
    await this.promptSaveCurrentWorkspace();
    this.openLoadModal();
  }

  openWorkspacesModal(): void {
    this.openLoadModal();
  }

  private async persist(): Promise<void> {
    await this.plugin?.saveData(this.options);
  }
}

class WorkspaceSuggestModal extends FuzzySuggestModal<SavedWorkspace> {
  constructor(
    app: App,
    readonly controller: WorkspacesController,
  ) {
    super(app);
    this.setPlaceholder("Load workspace...");
    this.emptyStateText = "No saved workspaces";
  }

  getItems(): SavedWorkspace[] {
    return this.controller.listWorkspaces();
  }

  getItemText(item: SavedWorkspace): string {
    return item.name;
  }

  renderSuggestion(value: FuzzySuggestion<SavedWorkspace>, el: HTMLElement): void {
    const titleEl = document.createElement("div");
    titleEl.className = "suggestion-title";
    titleEl.textContent = value.item.name;
    const noteEl = document.createElement("div");
    noteEl.className = "suggestion-note";
    noteEl.textContent = `Saved ${new Date(value.item.savedAt).toLocaleString()}`;
    el.append(titleEl, noteEl);
  }

  onChooseItem(item: SavedWorkspace): void {
    void this.controller.loadWorkspace(item.name);
  }
}

class WorkspacesSettingTab implements SettingTab {
  readonly id = "workspaces";
  readonly name = "Workspaces";
  readonly icon = "lucide-layout-dashboard";
  readonly section = "core-plugins" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");

  constructor(
    readonly app: App,
    readonly controller: WorkspacesController,
  ) {
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
    this.containerEl.className = "vertical-tab-content workspaces-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const group = new SettingGroup(this.containerEl).setHeading("Workspaces");
    new Setting(group.itemsEl)
      .setName("Save current workspace")
      .setDesc("Stores the current layout under a name.")
      .addButton((button) =>
        button.setButtonText("Save").onClick(() => {
          void this.controller.promptSaveCurrentWorkspace().then(() => this.display());
        }),
      );

    const saved = this.controller.listWorkspaces();
    if (saved.length === 0) {
      new Setting(group.itemsEl)
        .setName("No saved workspaces")
        .setDesc("Save a workspace to make it available here.")
        .setDisabled(true);
      return;
    }

    for (const workspace of saved) {
      new Setting(group.itemsEl)
        .setName(workspace.name)
        .setDesc(`Saved ${new Date(workspace.savedAt).toLocaleString()}`)
        .addButton((button) =>
          button.setButtonText("Load").onClick(() => {
            void this.controller.loadWorkspace(workspace.name);
          }),
        )
        .addButton((button) =>
          button.setButtonText("Rename").onClick(() => {
            const next = window.prompt("Workspace name", workspace.name);
            if (next)
              void this.controller.renameWorkspace(workspace.name, next).then(() => this.display());
          }),
        )
        .addButton((button) =>
          button.setButtonText("Delete").onClick(() => {
            void this.controller.deleteWorkspace(workspace.name).then(() => this.display());
          }),
        );
    }
  }

  hide(): void {
    this.containerEl.remove();
  }
}

export function createWorkspacesPluginDefinition(): InternalPluginDefinition {
  let controller: WorkspacesController | null = null;
  return {
    id: "workspaces",
    name: "Workspaces",
    description: "Save and load named workspace layouts.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new WorkspacesController(app);
      plugin.instance = controller;
      registerWorkspacesCliHandlers(plugin, controller);
      plugin.registerGlobalCommand({
        id: "workspaces:save",
        name: "Save current workspace",
        icon: "lucide-save",
        callback: () => void controller?.promptSaveCurrentWorkspace(),
      });
      plugin.registerGlobalCommand({
        id: "workspaces:load",
        name: "Load workspace",
        icon: "lucide-layout-dashboard",
        checkCallback: (checking) => {
          const available = (controller?.listWorkspaces().length ?? 0) > 0;
          if (!checking && available) controller?.openLoadModal();
          return available;
        },
      });
      plugin.registerGlobalCommand({
        id: "workspaces:save-and-load",
        name: "Save and load another workspace",
        icon: "lucide-copy-check",
        callback: () => void controller?.promptSaveThenLoadWorkspace(),
      });
      plugin.registerGlobalCommand({
        id: "workspaces:open-modal",
        name: "Manage workspace layouts",
        icon: "lucide-layout-dashboard",
        callback: () => controller?.openWorkspacesModal(),
      });
    },
    async onEnable(_app: App, plugin: InternalPluginWrapper) {
      await controller?.onEnable(plugin);
    },
  };
}
