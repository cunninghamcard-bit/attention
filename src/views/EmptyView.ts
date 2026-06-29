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

  async onOpen(): Promise<void> {
    this.renderEmptyState({
      title: "New tab",
      description: "This empty pane is the default landing state for a WorkspaceLeaf.",
      actions: [
        { label: "Create new note", run: () => void this.app.commands.executeCommandById("file:new-note") },
        { label: "Open command palette", run: () => void this.app.commands.executeCommandById("command-palette:open") },
        { label: "Close this pane", run: () => this.leaf.detach(), danger: true },
      ],
    });
  }

  protected renderEmptyState(options: EmptyViewStateOptions): void {
    this.contentEl.replaceChildren();
    this.contentEl.classList.add("empty-state");

    const container = document.createElement("div");
    container.className = "empty-state-container";

    const title = document.createElement("div");
    title.className = "empty-state-title";
    title.textContent = options.title;
    container.appendChild(title);

    if (options.description) {
      const description = document.createElement("div");
      description.className = "empty-state-description";
      description.textContent = options.description;
      container.appendChild(description);
    }

    const actionList = document.createElement("div");
    actionList.className = "empty-state-action-list";
    for (const action of options.actions) {
      const button = document.createElement("button");
      button.className = action.danger ? "empty-state-action tappable mod-close" : "empty-state-action tappable";
      button.textContent = action.label;
      button.addEventListener("click", () => void action.run());
      actionList.appendChild(button);
    }

    container.appendChild(actionList);
    this.contentEl.appendChild(container);
  }
}
