import type { Workspace } from "./Workspace";
import { WorkspaceSplit } from "./WorkspaceSplit";

export class WorkspaceFloating extends WorkspaceSplit {
  constructor(workspace: Workspace, id?: string, ownerDocument?: Document) {
    super(workspace, "vertical", id, ownerDocument);
    this.type = "floating";
    this.allowSingleChild = true;
    this.autoManageDOM = false;
  }

  openPopout(): void {
    this.containerEl.classList.add("is-popout-window");
  }

  closePopout(): void {
    this.containerEl.classList.remove("is-popout-window");
  }
}
