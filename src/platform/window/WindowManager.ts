import type { App } from "../../app/App";
import { setActiveWindow } from "../../dom/ActiveDocument";
import type { WorkspaceWindow } from "../../workspace/WorkspaceWindow";

export interface AppWindowState {
  id: string;
  title: string;
  focused: boolean;
  win: Window;
  workspaceWindow: WorkspaceWindow | null;
}

export class WindowManager {
  private windows = new Map<string, AppWindowState>();
  private activeWindowId: string | null = null;

  constructor(readonly app: App) {}

  registerWindow(id: string, win: Window = window, title = "Obsidian"): AppWindowState {
    const state: AppWindowState = { id, title, focused: false, win, workspaceWindow: null };
    this.windows.set(id, state);
    if (!this.activeWindowId) this.focusWindow(id);
    this.app.workspace.trigger("window-register", state);
    return state;
  }

  unregisterWindow(id: string): void {
    const state = this.windows.get(id);
    if (!state) return;
    this.windows.delete(id);
    if (this.activeWindowId === id) this.activeWindowId = this.windows.keys().next().value ?? null;
    this.app.workspace.trigger("window-unregister", state);
  }

  focusWindow(id: string): void {
    for (const state of this.windows.values()) state.focused = false;
    const state = this.windows.get(id);
    if (!state) return;
    state.focused = true;
    this.activeWindowId = id;
    setActiveWindow(state.win);
    state.workspaceWindow?.focus();
    if (!state.workspaceWindow) {
      state.win.focus();
      this.app.workspace.rootSplit.onFocus();
    }
    this.app.workspace.trigger("window-focus", state);
  }

  getActiveWindow(): AppWindowState | null {
    return this.activeWindowId ? this.windows.get(this.activeWindowId) ?? null : null;
  }

  listWindows(): readonly AppWindowState[] {
    return [...this.windows.values()];
  }
}
