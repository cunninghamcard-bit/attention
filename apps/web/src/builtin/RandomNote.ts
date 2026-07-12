import type { App } from "../app/App";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";

export class RandomNoteController {
  constructor(readonly app: App) {}

  async openRandomNote(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    if (files.length === 0) return;
    const file = files[Math.floor(Math.random() * files.length)];
    await this.app.workspace.openFile(file, { active: true });
  }
}

export function createRandomNotePluginDefinition(): InternalPluginDefinition {
  let controller: RandomNoteController | null = null;
  return {
    id: "random-note",
    name: "Random note",
    description: "Open a random note from the vault.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new RandomNoteController(app);
      plugin.instance = controller;
      plugin.registerGlobalCommand({
        id: "random-note",
        name: "Open random note",
        icon: "lucide-dices",
        checkCallback: (checking) => {
          const available = app.vault.getMarkdownFiles().length > 0;
          if (!checking && available) void controller?.openRandomNote();
          return available;
        },
      });
      plugin.registerRibbonItem("Open random note", "lucide-dices", () => {
        void controller?.openRandomNote();
      });
    },
  };
}
