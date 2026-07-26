/**
 * Input: ../ui/drag/DragManager, ./protocol/UriRouter, ./App, ../platform/window/WindowManager, ../platform/window/PopoutManager, ../platform/mobile/MobileWorkspace, ../ui/hover/HoverPreviewController
 * Output: WorkspaceServices
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { DragManager } from "../ui/drag/DragManager";
import { UriRouter } from "./protocol/UriRouter";
import type { App } from "./App";
import { WindowManager } from "../platform/window/WindowManager";
import { PopoutManager } from "../platform/window/PopoutManager";
import { MobileWorkspace } from "../platform/mobile/MobileWorkspace";
import { HoverPreviewController } from "../ui/hover/HoverPreviewController";

export class WorkspaceServices {
  readonly dragManager: DragManager;
  readonly uriRouter: UriRouter;
  readonly windowManager: WindowManager;
  readonly popoutManager: PopoutManager;
  readonly mobileWorkspace: MobileWorkspace;
  readonly hoverPreview: HoverPreviewController;

  constructor(readonly app: App) {
    this.dragManager = app.dragManager;
    this.uriRouter = new UriRouter((data) => app.workspace.handleProtocolData(data));
    this.windowManager = new WindowManager(app);
    this.popoutManager = new PopoutManager(app);
    this.mobileWorkspace = new MobileWorkspace(app);
    this.hoverPreview = new HoverPreviewController(app);
    this.windowManager.registerWindow("main", window, "Obsidian");
  }
}
