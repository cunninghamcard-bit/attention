import type { InternalViewState } from "../views/View";
import type { WorkspaceLeaf } from "./WorkspaceLeaf";

export interface WorkspaceHistoryEntry {
  leafId: string;
  state: InternalViewState;
  eState?: unknown;
  parentId?: string;
  rootId?: string;
}

export class WorkspaceHistory {
  private backHistory: WorkspaceHistoryEntry[] = [];
  private forwardHistory: WorkspaceHistoryEntry[] = [];

  constructor(readonly owner: WorkspaceLeaf) {}

  pushState(entry: WorkspaceHistoryEntry): void {
    this.backHistory.unshift(entry);
    this.forwardHistory = [];
    if (this.backHistory.length > 50) this.backHistory.pop();
  }

  async back(): Promise<boolean> {
    const entry = this.backHistory.shift();
    if (!entry) return false;
    const current = this.owner.getViewState();
    this.forwardHistory.unshift({ leafId: this.owner.id, state: current });
    await this.owner.setViewState(entry.state, entry.eState);
    return true;
  }

  async forward(): Promise<boolean> {
    const entry = this.forwardHistory.shift();
    if (!entry) return false;
    const current = this.owner.getViewState();
    this.backHistory.unshift({ leafId: this.owner.id, state: current });
    await this.owner.setViewState(entry.state, entry.eState);
    return true;
  }

  serialize(): WorkspaceHistoryEntry[] {
    return [...this.backHistory];
  }
}
