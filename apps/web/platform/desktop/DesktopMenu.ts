import type { CommandManager } from "../../app/commands/CommandManager";
import type { HotkeyManager } from "../../app/hotkeys/HotkeyManager";
import type { Hotkey } from "../../app/hotkeys/Keymap";
import { Platform } from "../Platform";
import type { Vault } from "../../vault/Vault";
import type { DesktopMain } from "./DesktopMain";
import type { SystemMenuItem } from "@app/shared/menu";

export interface DesktopMenuApp {
  appId: string;
  containerEl: HTMLElement;
  commands: CommandManager;
  hotkeys: HotkeyManager;
  vault: Vault;
  desktopMain: DesktopMain;
}

export interface DesktopMenuIpcRenderer {
  send?: (channel: string, ...args: unknown[]) => void;
}

export interface DesktopMenuElectronBridge {
  ipcRenderer?: DesktopMenuIpcRenderer;
}

export interface NativeMenuItemUpdate {
  itemId: string;
  eState: {
    enabled?: boolean;
    checked?: boolean;
    visible?: boolean;
    sharingItem?: { filePaths: string[] };
  };
}

export class DesktopMenu {
  lastTemplate: SystemMenuItem[] = [];

  constructor(readonly app: DesktopMenuApp) {}

  refresh(): SystemMenuItem[] {
    if (!this.shouldUseNativeMenu()) return this.lastTemplate;
    const template = this.buildMenu();
    this.lastTemplate = template;
    this.app.desktopMain.systemMenu.setMenu(template);
    this.sendMenuTemplate(template);
    return template;
  }

  buildMenu(): SystemMenuItem[] {
    const template: SystemMenuItem[] = [
      {
        id: "app",
        label: "Obsidian",
        submenu: [
          { id: "about", label: "About Obsidian", role: "about" },
          { type: "separator" },
          { id: "hide", label: "Hide Obsidian", role: "hide" },
          { id: "quit", label: "Quit Obsidian", role: "quit" },
        ],
      },
      {
        id: "file",
        label: "&File",
        submenu: [
          this.commandItem("file:new-note", "New note"),
          this.commandItem("workspace:new-tab", "New tab"),
          { type: "separator" },
          this.commandItem("editor:save-file", "Save current file"),
          this.commandItem("workspace:copy-path", "Copy path"),
          this.commandItem("workspace:copy-url", "Copy Obsidian URL"),
          { type: "separator" },
          this.commandItem("app:delete-file", "Delete current file"),
        ],
      },
      {
        id: "edit",
        label: "&Edit",
        submenu: [
          { id: "find-section", before: ["speech-section"], type: "separator" },
          this.commandItem("editor:open-search", "Find", { before: ["speech-section"] }),
          this.commandItem("editor:open-search-replace", "Replace", { before: ["speech-section"] }),
          { type: "separator" },
          { id: "undo", label: "Undo", role: "undo" },
          { id: "redo", label: "Redo", role: "redo" },
          { type: "separator" },
          { id: "cut", label: "Cut", role: "cut" },
          { id: "copy", label: "Copy", role: "copy" },
          { id: "paste", label: "Paste", role: "paste" },
          { id: "select-all", label: "Select all", role: "selectAll" },
        ],
      },
      {
        id: "insert",
        label: "&Insert",
        submenu: [
          this.commandItem("editor:insert-wikilink", "Insert internal link"),
          this.commandItem("editor:insert-link", "Insert Markdown link"),
          this.commandItem("editor:insert-callout", "Insert callout"),
          this.commandItem("editor:insert-blockquote", "Insert quote"),
          { type: "separator" },
          this.commandItem("editor:insert-codeblock", "Insert code block"),
          this.commandItem("editor:insert-mathblock", "Insert math block"),
          this.commandItem("editor:insert-table", "Insert table"),
          this.commandItem("editor:insert-footnote", "Insert footnote"),
          { type: "separator" },
          { type: "separator" },
          this.commandItem("editor:toggle-bullet-list", "Toggle bullet list"),
          this.commandItem("editor:toggle-numbered-list", "Toggle numbered list"),
          this.commandItem("editor:toggle-checklist-status", "Toggle checklist"),
          { type: "separator" },
          this.commandItem("editor:attach-file", "Insert attachment"),
          { type: "separator" },
          {
            id: "folding",
            label: "Folding",
            submenu: [
              this.commandItem("editor:fold-all", "Fold all"),
              this.commandItem("editor:unfold-all", "Unfold all"),
              { type: "separator" },
              this.commandItem("editor:fold-more", "Fold more"),
              this.commandItem("editor:fold-less", "Fold less"),
            ],
          },
        ],
      },
      {
        id: "format",
        label: "F&ormat",
        submenu: [
          {
            id: "heading-indeterminate",
            label: "Indeterminate heading level",
            type: "radio",
            visible: false,
          },
          ...([1, 2, 3, 4, 5, 6] as const).map((level) =>
            this.commandItem(`editor:set-heading-${level}`, `Heading ${level}`, { type: "radio" }),
          ),
          this.commandItem("editor:set-heading-0", "No heading", { type: "radio" }),
          { type: "separator" },
          this.commandItem("editor:toggle-bold", "Bold"),
          this.commandItem("editor:toggle-italics", "Italic"),
          this.commandItem("editor:toggle-strikethrough", "Strikethrough"),
          this.commandItem("editor:toggle-highlight", "Highlight"),
          this.commandItem("editor:toggle-code", "Inline code"),
          this.commandItem("editor:toggle-comments", "Comment"),
          { type: "separator" },
          this.commandItem("editor:clear-formatting", "Clear formatting"),
        ],
      },
      {
        id: "view",
        label: "&View",
        submenu: [
          this.commandItem("markdown:toggle-preview", "Toggle reading view"),
          this.commandItem("markdown:show-source", "Show source mode"),
          this.commandItem("markdown:show-preview", "Show reading view"),
          { type: "separator" },
          this.commandItem("app:toggle-left-sidebar", "Toggle left sidebar"),
          this.commandItem("app:toggle-right-sidebar", "Toggle right sidebar"),
          this.commandItem("app:toggle-ribbon", "Toggle ribbon"),
          { type: "separator" },
          { id: "reload", label: "Reload", role: "reload" },
          { id: "toggle-devtools", label: "Toggle developer tools", role: "toggleDevTools" },
        ],
      },
      {
        id: "help",
        label: "&Help",
        submenu: [
          this.commandItem("app:show-release-notes", "Show release notes"),
          this.commandItem("app:open-developer-console", "Open developer console"),
        ],
      },
    ];
    this.applyHotkeys(template);
    this.hideUnregisteredCommands(template);
    return template;
  }

  updateMenuItems(items: NativeMenuItemUpdate[], updateShareMenu = false): void {
    const ipcRenderer = getElectronBridge(
      this.app.containerEl.ownerDocument.defaultView,
    )?.ipcRenderer;
    ipcRenderer?.send?.("update-menu-items", items, updateShareMenu);
  }

  private commandItem(
    commandId: string,
    fallbackLabel: string,
    extra: Partial<SystemMenuItem> = {},
  ): SystemMenuItem {
    return {
      ...extra,
      appCommand: commandId,
      label: fallbackLabel,
    };
  }

  private applyHotkeys(items: SystemMenuItem[]): void {
    this.walkItems(items, (item) => {
      if (!item.appCommand) return;
      item.accelerator = this.getAccelerator(item.appCommand);
      item.registerAccelerator = false;
    });
  }

  private hideUnregisteredCommands(items: SystemMenuItem[]): void {
    this.walkItems(items, (item) => {
      if (item.appCommand && !this.app.commands.findCommand(item.appCommand)) item.visible = false;
    });
  }

  private walkItems(items: SystemMenuItem[], callback: (item: SystemMenuItem) => void): void {
    for (const item of items) {
      callback(item);
      if (item.submenu) this.walkItems(item.submenu, callback);
    }
  }

  private getAccelerator(commandId: string): string | undefined {
    const hotkeys = this.app.hotkeys.getEffectiveHotkeys(commandId);
    const hotkey = hotkeys?.[0];
    return hotkey ? formatElectronAccelerator(hotkey) : undefined;
  }

  private shouldUseNativeMenu(): boolean {
    return Platform.isDesktopApp && this.app.vault.getConfig("nativeMenus") !== false;
  }

  private sendMenuTemplate(template: SystemMenuItem[]): void {
    const ipcRenderer = getElectronBridge(
      this.app.containerEl.ownerDocument.defaultView,
    )?.ipcRenderer;
    ipcRenderer?.send?.("set-menu", { template });
  }
}

export function formatElectronAccelerator(hotkey: Hotkey): string {
  const modifiers = hotkey.modifiers.map((modifier) => {
    if (modifier === "Mod") return "CmdOrCtrl";
    if (modifier === "Meta") return "Cmd";
    return modifier;
  });
  const key = hotkey.key ?? hotkey.code;
  return key ? [...modifiers, normalizeAcceleratorKey(key)].join("+") : modifiers.join("+");
}

function normalizeAcceleratorKey(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function getElectronBridge(
  win: (Window & { electron?: DesktopMenuElectronBridge }) | null,
): DesktopMenuElectronBridge | null {
  const host = globalThis as { electron?: DesktopMenuElectronBridge };
  return win?.electron ?? host.electron ?? null;
}
