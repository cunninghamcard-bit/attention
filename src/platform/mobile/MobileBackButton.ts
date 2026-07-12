import type { App } from "../../app/App";
import { closeTopActiveCloseable } from "../../ui/ActiveCloseableRegistry";
import { Notice } from "../../ui/Notice";
import { MobileDrawer } from "./MobileDrawer";

export interface MobileBackButtonBridge {
  addBackButtonListener(listener: () => void | Promise<void>): void | (() => void | Promise<void>);
  minimizeApp(): void | Promise<void>;
  now(): number;
}

export interface MobileBackButtonOptions {
  exitIntervalMs?: number;
  exitNoticeMessage?: string;
}

export class MobileBackButtonController {
  readonly exitIntervalMs: number;
  readonly exitNoticeMessage: string;
  private detachListener: (() => void | Promise<void>) | null = null;
  private lastExitBackAt = 0;
  private exitNotice: Notice | null = null;

  constructor(
    readonly app: App,
    readonly bridge: MobileBackButtonBridge = createDefaultMobileBackButtonBridge(),
    options: MobileBackButtonOptions = {},
  ) {
    this.exitIntervalMs = options.exitIntervalMs ?? 5000;
    this.exitNoticeMessage = options.exitNoticeMessage ?? "Press back again to exit";
  }

  attach(): void {
    if (this.detachListener) return;
    const detach = this.bridge.addBackButtonListener(() => void this.handleBackButton());
    this.detachListener = typeof detach === "function" ? detach : () => {};
  }

  detach(): void {
    const detach = this.detachListener;
    this.detachListener = null;
    if (detach) void detach();
    this.clearExitPrompt();
  }

  async handleBackButton(): Promise<boolean> {
    if (closeTopActiveCloseable()) {
      this.clearExitPrompt();
      return true;
    }
    if (this.collapseDrawer(this.app.mobileWorkspace.leftDrawer)) return true;
    if (this.collapseDrawer(this.app.mobileWorkspace.rightDrawer)) return true;
    const leaf = this.app.workspace.activeLeaf;
    if (leaf?.history.backHistory.length) {
      this.clearExitPrompt();
      await leaf.history.back();
      return true;
    }
    await this.handleExitBack();
    return true;
  }

  private collapseDrawer(drawer: MobileDrawer | null): boolean {
    if (!(drawer instanceof MobileDrawer) || drawer.collapsed || drawer.isPinned) return false;
    this.clearExitPrompt();
    drawer.collapse();
    return true;
  }

  private async handleExitBack(): Promise<void> {
    const now = this.bridge.now();
    if (this.lastExitBackAt > 0 && now - this.lastExitBackAt <= this.exitIntervalMs) {
      this.lastExitBackAt = 0;
      this.clearExitPrompt();
      await this.bridge.minimizeApp();
      return;
    }
    this.lastExitBackAt = now;
    this.exitNotice?.hide();
    this.exitNotice = new Notice(this.exitNoticeMessage, this.exitIntervalMs);
  }

  private clearExitPrompt(): void {
    this.lastExitBackAt = 0;
    this.exitNotice?.hide();
    this.exitNotice = null;
  }
}

export function createDefaultMobileBackButtonBridge(win: Window = window): MobileBackButtonBridge {
  return {
    addBackButtonListener(listener) {
      const plugin = getNativeAppPlugin(win);
      if (!plugin?.addListener) return undefined;
      let subscription: NativeBackButtonSubscription | null = null;
      void Promise.resolve(plugin.addListener("backButton", listener)).then((handle) => {
        subscription = handle ?? null;
      });
      return () => {
        const current = subscription;
        subscription = null;
        if (current) void current.remove();
      };
    },
    minimizeApp() {
      const plugin = getNativeAppPlugin(win);
      if (plugin?.minimizeApp) return plugin.minimizeApp();
      return undefined;
    },
    now() {
      return Date.now();
    },
  };
}

interface NativeBackButtonSubscription {
  remove(): void | Promise<void>;
}

interface NativeAppPlugin {
  addListener?(eventName: "backButton", listener: () => void | Promise<void>): NativeBackButtonSubscription | Promise<NativeBackButtonSubscription>;
  minimizeApp?(): void | Promise<void>;
}

function getNativeAppPlugin(win: Window): NativeAppPlugin | null {
  const global = win as Window & {
    Capacitor?: { Plugins?: { App?: NativeAppPlugin } };
    CapacitorApp?: NativeAppPlugin;
  };
  return global.Capacitor?.Plugins?.App ?? global.CapacitorApp ?? null;
}
