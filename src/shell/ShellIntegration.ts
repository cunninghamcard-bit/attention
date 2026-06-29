import { NativeBridge } from "../native/NativeBridge";
import { PreloadApi } from "../native/PreloadApi";
import { FileDialogService } from "../native/FileDialogService";
import { WindowFrameController } from "../native/WindowFrameController";

export class ShellIntegration {
  readonly bridge = new NativeBridge();
  readonly preloadApi = new PreloadApi(this.bridge);
  readonly fileDialogs = new FileDialogService();
  readonly windowFrame = new WindowFrameController();

  constructor() {
    this.bridge.handle("dialog:open", (payload) => this.fileDialogs.showOpenDialog(payload as never));
    this.bridge.handle("dialog:save", (payload) => this.fileDialogs.showSaveDialog(payload as never));
    this.bridge.handle("window:set-fullscreen", (value) => this.windowFrame.setFullscreen(Boolean(value)));
  }
}
