import type { App } from "../../app/App";
import type { WorkspaceLeaf } from "../../workspace/WorkspaceLeaf";
import type { WorkspaceWindow } from "../../workspace/WorkspaceWindow";

export interface PopoutState {
  id: string;
  window: WorkspaceWindow;
  sourceLeaf: WorkspaceLeaf | null;
}

export class PopoutManager {
  private popouts = new Map<string, PopoutState>();

  constructor(readonly app: App) {}

  openPopout(sourceLeaf: WorkspaceLeaf | null = this.app.workspace.activeLeaf): PopoutState {
    const workspaceWindow = this.app.workspace.openPopout();
    const state: PopoutState = { id: workspaceWindow.id, window: workspaceWindow, sourceLeaf };
    this.popouts.set(state.id, state);
    this.app.workspace.trigger("popout-open", state);
    return state;
  }

  closePopout(id: string): void {
    const state = this.popouts.get(id);
    if (!state) return;
    state.window.close();
    this.popouts.delete(id);
    this.app.workspace.trigger("popout-close", state);
  }

  listPopouts(): readonly PopoutState[] {
    for (const [id, state] of this.popouts) {
      if (state.window.parent !== this.app.workspace.floatingSplit || state.window.win.closed) this.popouts.delete(id);
    }
    return [...this.popouts.values()];
  }
}
