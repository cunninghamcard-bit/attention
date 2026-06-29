import type { App } from "../app/App";
import type { BasesViewRegistration } from "../bases/BasesRegistry";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { Notice } from "../ui/Notice";
import { TFile } from "../vault/TAbstractFile";

const DEFAULT_BASE_FILE = `name: Base
columns:
  - property: file.path, title: File
  - property: note.tags, title: Tags
views:
  - id: table, name: Table, type: table
  - id: cards, name: Cards, type: cards
  - id: list, name: List, type: list
`;

export function createBasesPluginDefinition(): InternalPluginDefinition {
  return {
    id: "bases",
    name: "Bases",
    description: "Create, open, embed, and extend .base database views.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      plugin.instance = new BasesPluginController(app);
      plugin.registerGlobalCommand({
        id: "bases:create-base",
        name: "Create new base",
        icon: "lucide-table",
        callback: async () => {
          const activePath = app.workspace.activeEditor?.file?.parentPath ?? "";
          const path = app.vault.getAvailablePath(activePath ? `${activePath}/Untitled` : "Untitled", "base");
          const file = await app.vault.create(path, DEFAULT_BASE_FILE);
          await app.workspace.openFile(file, { active: true });
          new Notice(`Created ${file.path}`);
        },
      });
      plugin.registerGlobalCommand({
        id: "bases:open-active-base",
        name: "Open active base",
        icon: "lucide-table",
        checkCallback: (checking) => {
          const file = app.workspace.activeEditor?.file;
          const available = file instanceof TFile && file.extension === "base";
          if (!checking && available) void app.workspace.openFile(file, { active: true });
          return available;
        },
      });
    },
  };
}

export class BasesPluginController {
  constructor(readonly app: App) {}

  registerView(viewId: string, registration: BasesViewRegistration): void {
    this.app.bases.registerView(viewId, registration);
  }

  deregisterView(viewId: string): void {
    this.app.bases.deregisterView(viewId);
  }

  getRegistration(viewId: string): unknown {
    return this.app.bases.getRegistration(viewId);
  }

  getRegistrations(): readonly unknown[] {
    return this.app.bases.getRegistrations();
  }

  getViewFactory(viewId: string): unknown {
    return this.app.bases.getViewFactory(viewId);
  }
}
