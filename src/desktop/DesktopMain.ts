import { SystemMenuBuilder } from "./SystemMenuBuilder";
import { DesktopProtocolHandler } from "./DesktopProtocolHandler";
import { AutoUpdateService } from "./AutoUpdateService";

export interface DesktopWindowOptions {
  title: string;
  width: number;
  height: number;
  preloadPath?: string;
}

export class DesktopMain {
  readonly systemMenu = new SystemMenuBuilder();
  readonly protocolHandler = new DesktopProtocolHandler();
  readonly autoUpdate = new AutoUpdateService();
  private windows = new Map<string, DesktopWindowOptions>();

  createWindow(id: string, options: DesktopWindowOptions): void {
    this.windows.set(id, options);
  }

  closeWindow(id: string): void {
    this.windows.delete(id);
  }

  listWindows(): Array<{ id: string; options: DesktopWindowOptions }> {
    return [...this.windows.entries()].map(([id, options]) => ({ id, options }));
  }

  bootstrap(): void {
    this.systemMenu.buildDefaultMenu();
    this.protocolHandler.registerProtocol("obsidian");
  }
}
