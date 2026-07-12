import { ItemView } from "./ItemView";

export interface EmptyViewAction {
  label: string;
  run: () => void | Promise<void>;
  danger?: boolean;
}

export interface EmptyViewStateOptions {
  title: string;
  description?: string;
  actions: EmptyViewAction[];
}

export class EmptyView extends ItemView {
  canDropAnywhere = true;
  navigation = true;

  getViewType(): string {
    return "empty";
  }

  getDisplayText(): string {
    return "New tab";
  }

  // The real new-tab actions (app.js tD.onOpen): command-backed entries with
  // the command's hotkey suffixed, Go to file only when the vault has files,
  // Open web viewer only when that plugin is enabled, then a mod-close Close.
  async onOpen(): Promise<void> {
    const command =
      (id: string): EmptyViewAction["run"] =>
      () =>
        void this.app.commands.executeCommandById(id);
    const withHotkey = (label: string, id: string): string => {
      const hotkey = this.app.hotkeys.printHotkeyForCommand(id);
      return hotkey ? `${label} (${hotkey})` : label;
    };
    const actions: EmptyViewAction[] = [];
    // The workspace leads with its own identity: terminal first, notes after.
    if (this.app.internalPlugins.getEnabledPluginById("terminal")) {
      actions.push({
        label: withHotkey("Open terminal", "terminal:open"),
        run: command("terminal:open"),
      });
    }
    if (!this.app.vault.isEmpty()) {
      actions.push({
        label: withHotkey("Go to file", "switcher:open"),
        run: command("switcher:open"),
      });
    }
    actions.push({
      label: withHotkey("Create new note", "file-explorer:new-file"),
      run: command("file-explorer:new-file"),
    });
    if (this.app.internalPlugins.getEnabledPluginById("webviewer")) {
      actions.push({
        label: withHotkey("Open web viewer", "webviewer:open"),
        run: command("webviewer:open"),
      });
    }
    actions.push({ label: "Close", run: () => this.leaf.detach(), danger: true });
    this.renderEmptyState({ title: "", actions });
  }

  protected renderEmptyState(options: EmptyViewStateOptions): void {
    this.contentEl.replaceChildren();
    this.contentEl.classList.add("empty-state");
    const doc = this.contentEl.ownerDocument;

    const container = doc.createElement("div");
    container.className = "empty-state-container";

    const title = doc.createElement("div");
    title.className = "empty-state-title";
    if (options.title) title.textContent = options.title;
    container.appendChild(title);

    if (options.description) {
      const description = doc.createElement("div");
      description.className = "empty-state-description";
      description.textContent = options.description;
      container.appendChild(description);
    }

    const actionList = doc.createElement("div");
    actionList.className = "empty-state-action-list";
    for (const action of options.actions) {
      // Real actions are divs (app.js tD.onOpen) — app.css styles them as the
      // vertical accent-colored link list; a <button> misses all of it.
      const actionEl = doc.createElement("div");
      actionEl.className = action.danger
        ? "empty-state-action tappable mod-close"
        : "empty-state-action tappable";
      actionEl.textContent = action.label;
      actionEl.addEventListener("click", () => void action.run());
      actionList.appendChild(actionEl);
    }

    container.appendChild(actionList);
    this.contentEl.appendChild(container);
  }
}
