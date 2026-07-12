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
    const invoke = getElectronInvoke();
    if (invoke) {
      // Desktop: forward to the real Electron main process.
      this.bridge.handle("dialog:open", (payload) => invoke("dialog:open", payload));
      this.bridge.handle("dialog:save", (payload) => invoke("dialog:save", payload));
      this.bridge.handle("window:set-fullscreen", (value) =>
        invoke("window:set-fullscreen", value),
      );
      this.bridge.handle("request-url", (payload) => invoke("request-url", payload));
    } else {
      // Browser / tests: in-process mocks.
      this.bridge.handle("dialog:open", (payload) =>
        this.fileDialogs.showOpenDialog(payload as never),
      );
      this.bridge.handle("dialog:save", (payload) =>
        this.fileDialogs.showSaveDialog(payload as never),
      );
      this.bridge.handle("window:set-fullscreen", (value) =>
        this.windowFrame.setFullscreen(Boolean(value)),
      );
    }
  }
}

type ElectronInvoke = (channel: string, payload?: unknown) => Promise<unknown>;

/** The Electron main-process `ipcRenderer.invoke`, if running under the shell. */
function getElectronInvoke(): ElectronInvoke | null {
  const host = globalThis as { electron?: { ipcRenderer?: { invoke?: ElectronInvoke } } };
  const ipc = host.electron?.ipcRenderer;
  return typeof ipc?.invoke === "function" ? ipc.invoke.bind(ipc) : null;
}
