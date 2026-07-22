import { EmptyView } from "./EmptyView";
import { normalizeViewStatePayload } from "./View";
import type { WorkspaceLeaf } from "./workspace/WorkspaceLeaf";

export class UnknownView extends EmptyView {
  protected unknownState: unknown = {};

  constructor(
    leaf: WorkspaceLeaf,
    readonly viewType: string,
  ) {
    super(leaf);
    this.icon = "lucide-ghost";
    this.containerEl.dataset.type = viewType;
  }

  getViewType(): string {
    return this.viewType;
  }

  getDisplayText(): string {
    return this.viewType;
  }

  async setState(state: unknown): Promise<void> {
    this.unknownState = state;
  }

  getState(): Record<string, unknown> {
    return normalizeViewStatePayload(this.unknownState);
  }

  async onOpen(): Promise<void> {
    this.renderEmptyState({
      title: "Unknown pane",
      description: `No registered view can render the "${this.viewType}" pane type.`,
      actions: [
        { label: "Close this pane", run: () => this.leaf.detach(), danger: true },
        {
          label: `Close all ${this.viewType} panes`,
          run: () => this.app.workspace.detachLeavesOfType(this.viewType),
          danger: true,
        },
      ],
    });
  }
}
