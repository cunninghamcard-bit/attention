import { Plugin, ItemView, type WorkspaceLeaf } from "../../../src/apps/web/src";

class ExampleView extends ItemView {
  getViewType(): string { return "example-view"; }
  getDisplayText(): string { return "Example View"; }
  async onOpen(): Promise<void> {
    this.contentEl.textContent = "A plugin-provided view mounted inside WorkspaceLeaf.";
  }
}

export default class CustomViewPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView("example-view", (leaf: WorkspaceLeaf) => new ExampleView(leaf));
    this.addCommand({ id: "open-example-view", name: "Open example view", callback: () => void this.app.workspace.getLeaf("tab").setViewState({ type: "example-view" }) });
    this.addRibbonIcon("lucide-square", "Open example view", () => void this.app.workspace.getLeaf("tab").setViewState({ type: "example-view" }));
  }
}
