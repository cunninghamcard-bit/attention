import type { Workspace } from "./Workspace";
import { WorkspaceSplit } from "./WorkspaceSplit";

export class WorkspaceContainer extends WorkspaceSplit {
  override isWorkspaceContainer = true;

  constructor(
    workspace: Workspace,
    direction: "vertical" | "horizontal" = "vertical",
    id?: string,
    ownerDocument?: Document,
  ) {
    super(workspace, direction, id, ownerDocument);
  }

  onFocus(): void {
    const doc = this.getDocument();
    const win = doc.defaultView ?? window;
    win.setTimeout(() => {
      if (!doc.hasFocus()) return;
      if (this.workspace.activeLeaf?.getContainer() === this) return;
      const hasModal = Boolean(doc.querySelector(".modal-container"));
      const leaf = this.workspace.getMostRecentLeaf(this);
      if (leaf) this.workspace.setActiveLeaf(leaf, { focus: !isMobileRuntime(doc) && !hasModal });
    }, 100);
  }

  focus(): void {
    this.getDocument().defaultView?.focus();
  }

  protected getDocument(): Document {
    return this.containerEl.ownerDocument;
  }
}

function isMobileRuntime(doc: Document): boolean {
  return doc.body.classList.contains("is-mobile") || navigator.userAgent.includes("Mobile");
}
