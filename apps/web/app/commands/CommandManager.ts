import type { Hotkey } from "../hotkeys/Keymap";
import type { HotkeyManager } from "../hotkeys/HotkeyManager";
import type { Editor } from "../../editor/Editor";
import type { MarkdownFileInfo } from "../../editor/EditorStateField";
import type { IconName } from "../../ui/Icon";
import type { View } from "../../views/View";
import { MarkdownView } from "../../views/MarkdownView";
import { Platform } from "../../platform/Platform";

export interface Command {
  id: string;
  name: string;
  icon?: IconName;
  callback?: () => any;
  checkCallback?: (checking: boolean) => boolean | void | null;
  editorCallback?: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => any;
  editorCheckCallback?: (
    checking: boolean,
    editor: Editor,
    ctx: MarkdownView | MarkdownFileInfo,
  ) => boolean | void | null;
  allowPreview?: boolean;
  allowProperties?: boolean;
  hotkeys?: Hotkey[];
  showOnMobileToolbar?: boolean;
  mobileOnly?: boolean;
  repeatable?: boolean;
}

export interface EditorCommandContext {
  editor: Editor;
  view: View | MarkdownView | MarkdownFileInfo;
}

interface CommandManagerApp {
  lastEvent: Event | null;
  workspace?: {
    activeEditor: MarkdownFileInfo | null;
  };
}

export class CommandManager {
  readonly commands: Record<string, Command> = Object.create(null);
  readonly editorCommands: Record<string, Command> = Object.create(null);
  private editorContextProvider: (() => EditorCommandContext | null) | null = null;

  constructor(
    private readonly hotkeyManager?: HotkeyManager,
    private readonly app?: CommandManagerApp,
  ) {}

  setEditorContextProvider(provider: () => EditorCommandContext | null): void {
    this.editorContextProvider = provider;
  }

  addCommand(command: Command): void {
    if (command.mobileOnly && !isMobileRuntime()) return;
    if (command.editorCallback || command.editorCheckCallback) {
      command.checkCallback = (checking) => {
        // "Not applicable" must be the explicit false: runCommandCallback treats
        // a void answer as executed (the plain-checkCallback contract), so a
        // null/undefined here would report "executed" and swallow a hotkey
        // shared with another command.
        const context = this.getEditorContext();
        if (!context) return false;
        const view = context.view as View & {
          getMode?: () => string;
          inlineTitleEl?: HTMLElement;
          titleEl?: HTMLElement;
        };
        const mode = view.getMode?.();
        if (!command.allowPreview && mode === "preview") return false;
        if (isMarkdownView(view)) {
          if (view.inlineTitleEl && isActiveElement(view.inlineTitleEl)) return false;
          if (view.titleEl && isActiveElement(view.titleEl)) return false;
          if (
            !command.allowProperties &&
            isMetadataFocused(view.inlineTitleEl?.ownerDocument ?? view.titleEl?.ownerDocument)
          )
            return false;
        }
        if (command.editorCheckCallback)
          return command.editorCheckCallback(
            checking,
            context.editor,
            context.view as MarkdownView | MarkdownFileInfo,
          );
        if (command.editorCallback) {
          if (!checking)
            void command.editorCallback(
              context.editor,
              context.view as MarkdownView | MarkdownFileInfo,
            );
          return true;
        }
        // Unreachable while the wrapper installs only for editor commands —
        // but if it ever runs, nothing executed, and only the explicit false
        // keeps a shared hotkey alive.
        return false;
      };
      this.editorCommands[command.id] = command;
    }
    if (command.showOnMobileToolbar) this.editorCommands[command.id] = command;
    this.commands[command.id] = command;
    if (command.hotkeys) this.hotkeyManager?.addDefaultHotkeys(command.id, command.hotkeys);
  }

  removeCommand(id: string): void {
    if (this.commands[id]) this.hotkeyManager?.removeDefaultHotkeys(id);
    delete this.commands[id];
    delete this.editorCommands[id];
  }

  findCommand(id: string): Command | undefined {
    return this.commands[id];
  }

  listCommands(): Command[] {
    return Object.values(this.commands).filter((command) => {
      if (!command.checkCallback) return true;
      try {
        return Boolean(command.checkCallback(true));
      } catch (error) {
        console.error(`Command failed to execute: ${command.id}`, error);
        return false;
      }
    });
  }

  getCommands(): readonly Command[] {
    return Object.values(this.commands);
  }

  getEditorCommands(): readonly Command[] {
    return Object.values(this.editorCommands);
  }

  executeCommandById(id: string, event?: Event): boolean {
    const command = this.findCommand(id);
    if (!command) return false;
    return this.executeCommand(command, event);
  }

  executeCommand(command: Command, event?: Event): boolean {
    if (this.app) this.app.lastEvent = event ?? null;
    try {
      return runCommandCallback(command);
    } catch (error) {
      console.error(`Command failed to execute: ${command.id}`, error);
      return false;
    }
  }

  private getEditorContext(): EditorCommandContext | null {
    const provided = this.editorContextProvider?.();
    if (provided) return provided;
    const activeEditor = this.app?.workspace?.activeEditor;
    if (!activeEditor?.editor) return null;
    return { editor: activeEditor.editor, view: activeEditor };
  }
}

/** Runs a command and reports whether it executed. The upstream contract
 * (obsidian.d.ts, `Command.checkCallback`: "@returns Whether this command can
 * be executed at the moment") makes the return value meaningful with
 * `checking` false too: a command that answers false has declined, and a
 * hotkey shared with other commands must fall through to the next one
 * (`HotkeyManager.onTrigger` stops on the first executor). */
export function runCommandCallback(command: Command): boolean {
  if (command.checkCallback) {
    return command.checkCallback(false) !== false;
  }
  if (command.callback) {
    command.callback();
    return true;
  }
  console.error(`Command ${command.id} did not provide a callback`);
  return false;
}

function isMobileRuntime(): boolean {
  return Platform.isMobile;
}

function isActiveElement(el: HTMLElement): boolean {
  return el.ownerDocument.activeElement === el;
}

function isMetadataFocused(doc: Document = document): boolean {
  const activeElement = doc.activeElement;
  const closest = (activeElement as { closest?: (selector: string) => Element | null } | null)
    ?.closest;
  return (
    typeof closest === "function" && Boolean(closest.call(activeElement, ".metadata-container"))
  );
}

function isMarkdownView(view: View): view is MarkdownView {
  return view instanceof MarkdownView;
}
