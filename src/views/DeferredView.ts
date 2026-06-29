import { normalizeViewStatePayload, View } from "./View";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";

export class DeferredView extends View {
  protected viewState: unknown = {};
  protected ephemeralViewState: unknown = {};
  private readonly stopNodeInserted: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    readonly viewType: string,
    icon = "lucide-file",
    readonly title = "",
  ) {
    super(leaf);
    this.icon = icon;
    this.navigation = false;
    this.containerEl.dataset.type = viewType;
    this.stopNodeInserted = this.containerEl.onNodeInserted(() => void this.rerender());
    this.containerEl.addEventListener("click", () => void this.rerender());
  }

  getViewType(): string {
    return this.viewType;
  }

  getDisplayText(): string {
    return this.title;
  }

  async setState(state: unknown): Promise<void> {
    this.viewState = state;
  }

  getState(): Record<string, unknown> {
    return normalizeViewStatePayload(this.viewState);
  }

  setEphemeralState(state: unknown): void {
    this.ephemeralViewState = state;
  }

  getEphemeralState(): unknown {
    return this.ephemeralViewState;
  }

  override async onClose(): Promise<void> {
    this.stopNodeInserted();
  }

  async rerender(): Promise<void> {
    if (this.leaf.view !== this || this.leaf.working) return;
    await this.leaf.setViewState({ type: this.viewType, state: normalizeViewStatePayload(this.viewState) }, this.ephemeralViewState);
    if (this.leaf.view !== this) this.app.workspace.requestLayoutChangeEvents();
  }
}
