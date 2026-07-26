/**
 * Input: ./Workspace, ./WorkspaceContainer
 * Output: WorkspaceRoot
 * Pos: UI Layer - View templates
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { Workspace } from "./Workspace";
import { WorkspaceContainer } from "./WorkspaceContainer";

export class WorkspaceRoot extends WorkspaceContainer {
  constructor(workspace: Workspace, id?: string, ownerDocument?: Document) {
    super(workspace, "vertical", id, ownerDocument);
    this.type = "root";
    this.containerEl.classList.add("mod-root");
  }
}
