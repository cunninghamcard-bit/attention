import { DragManager } from "../drag/DragManager";
import { UriRouter } from "../protocol/UriRouter";
import type { App } from "./App";
import { WindowManager } from "../window/WindowManager";
import { PopoutManager } from "../window/PopoutManager";
import { MobileWorkspace } from "../mobile/MobileWorkspace";
import { HoverPreviewController } from "../hover/HoverPreviewController";

export class WorkspaceServices {
  readonly dragManager: DragManager;
  readonly uriRouter = new UriRouter();
  readonly windowManager: WindowManager;
  readonly popoutManager: PopoutManager;
  readonly mobileWorkspace: MobileWorkspace;
  readonly hoverPreview: HoverPreviewController;

  constructor(readonly app: App) {
    this.dragManager = app.dragManager;
    this.windowManager = new WindowManager(app);
    this.popoutManager = new PopoutManager(app);
    this.mobileWorkspace = new MobileWorkspace(app);
    this.hoverPreview = new HoverPreviewController(app);
    this.windowManager.registerWindow("main", window, "Obsidian");
  }
}
