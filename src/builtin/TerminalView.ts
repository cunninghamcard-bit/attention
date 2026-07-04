import { ItemView } from "../views/ItemView";
import type { ViewStateResult } from "../views/View";
import { Menu } from "../ui/Menu";
import { setIcon } from "../ui/Icon";
import { Scope } from "../hotkeys/Scope";
import { TERMINAL_VIEW_TYPE, type TTerminal } from "../terminal/TerminalService";
import { createGhosttyRenderer, type TerminalRenderer, type TerminalRendererFactory } from "../terminal/GhosttyTerminalRenderer";

interface TerminalViewState extends Record<string, unknown> {
  terminalId?: string;
  cwd?: string;
  shell?: string;
  /** Postpone the PTY until the tab is first shown (seeded/restored tabs). */
  lazy?: boolean;
}

export class TerminalView extends ItemView {
  /** Swappable in tests — jsdom has no canvas for the WASM renderer. */
  static rendererFactory: TerminalRendererFactory = createGhosttyRenderer;

  private terminalId: string | null = null;
  private renderer: TerminalRenderer | null = null;
  private surfaceEl: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private detachOutput: (() => void) | null = null;
  private detachExit: (() => void) | null = null;
  private pendingState: TerminalViewState = {};
  private lazyBindPending = false;
  // While the terminal surface is focused, an empty scope shields keystrokes
  // from global workspace hotkeys (spec: keyboard input must not be stolen).
  private readonly focusScope = new Scope();
  private focusScopePushed = false;

  getViewType(): string { return TERMINAL_VIEW_TYPE; }
  getDisplayText(): string {
    const terminal = this.getTerminal();
    return terminal ? `Terminal — ${shellName(terminal.shell)}` : "Terminal";
  }
  getIcon(): string { return "lucide-terminal"; }

  getTerminal(): TTerminal | null {
    return this.terminalId ? this.app.terminals.getTerminal(this.terminalId) : null;
  }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("terminal-view");
    this.surfaceEl = this.contentEl.ownerDocument.createElement("div");
    this.surfaceEl.className = "terminal-view-surface";
    this.contentEl.appendChild(this.surfaceEl);
    this.surfaceEl.addEventListener("contextmenu", (event) => this.showContextMenu(event));
    this.surfaceEl.addEventListener("focusin", () => this.pushFocusScope());
    this.surfaceEl.addEventListener("focusout", () => this.popFocusScope());
    this.addAction("lucide-rotate-ccw", "Restart terminal", () => void this.restart());
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (state && typeof state === "object") this.pendingState = state as TerminalViewState;
    if (this.pendingState.lazy && !this.terminalId) {
      this.lazyBindPending = true;
      return;
    }
    await this.bindSession();
  }

  // Lazy tabs bind on their first resize — WorkspaceTabs resizes a leaf when
  // its tab is revealed, so the shell spawns the moment the user first sees
  // the terminal instead of at app startup.
  override onResize(): void {
    if (!this.lazyBindPending) return;
    this.lazyBindPending = false;
    void this.bindSession();
  }

  getState(): Record<string, unknown> {
    const terminal = this.getTerminal();
    // Persisted layouts restore lazily: the session id dies with the app, so
    // the restored tab respawns its shell on first reveal, not at boot.
    return { terminalId: this.terminalId, cwd: terminal?.cwd, shell: terminal?.shell, lazy: true };
  }

  async restart(): Promise<void> {
    if (!this.terminalId) return void this.bindSession();
    const terminal = this.app.terminals.getTerminal(this.terminalId);
    if (!terminal) return;
    if (terminal.status === "error") {
      // Spawn never succeeded — recreate the session with the same context.
      this.app.terminals.dispose(this.terminalId);
      this.pendingState = { cwd: terminal.cwd, shell: terminal.shell };
      this.terminalId = null;
      await this.bindSession();
      return;
    }
    this.detachSession();
    await this.app.terminals.restart(this.terminalId);
    this.attachSession(this.terminalId);
  }

  async onClose(): Promise<void> {
    this.popFocusScope();
    this.detachSession();
    if (this.terminalId) this.app.terminals.dispose(this.terminalId);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.renderer?.dispose();
    this.renderer = null;
    await super.onClose();
  }

  private async bindSession(): Promise<void> {
    if (!this.surfaceEl) return;
    let id = this.pendingState.terminalId ?? this.terminalId;
    if (!id || !this.app.terminals.getTerminal(id)) {
      const terminal = this.app.terminals.createSession({ cwd: this.pendingState.cwd, shell: this.pendingState.shell });
      id = terminal.id;
    }
    this.terminalId = id;
    const terminal = this.app.terminals.getTerminal(id);
    if (terminal?.status === "error") {
      const error = this.app.terminals.getError(id);
      this.showError(error?.message ?? "The terminal could not start. Check the configured shell path, then restart.");
      return;
    }
    this.hideOverlay();
    if (!this.renderer) {
      const settings = this.app.terminals.getSettings();
      try {
        this.renderer = await TerminalView.rendererFactory({
          fontFamily: settings.fontFamily || undefined,
          fontSize: settings.fontSize,
          scrollback: settings.scrollback,
        });
      } catch (error) {
        this.showError(`Terminal renderer failed to load: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      this.renderer.mount(this.surfaceEl);
      this.renderer.onInput((data) => {
        if (this.terminalId) this.app.terminals.write(this.terminalId, data);
      });
      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => this.fit());
        this.resizeObserver.observe(this.surfaceEl);
      }
    }
    this.attachSession(id);
    this.fit();
    this.renderer.focus();
    this.leaf.updateHeader();
  }

  private attachSession(id: string): void {
    this.detachSession();
    this.detachOutput = this.app.terminals.onOutput(id, (data) => this.renderer?.write(data));
    this.detachExit = this.app.terminals.onExit(id, (code) => {
      this.showError(`Shell exited with code ${code}.`, "Restart");
    });
  }

  private detachSession(): void {
    this.detachOutput?.();
    this.detachOutput = null;
    this.detachExit?.();
    this.detachExit = null;
  }

  private fit(): void {
    if (!this.renderer || !this.terminalId) return;
    const { cols, rows } = this.renderer.fit();
    this.app.terminals.resize(this.terminalId, cols, rows);
  }

  private showContextMenu(event: MouseEvent): void {
    event.preventDefault();
    const terminal = this.getTerminal();
    if (!terminal) return;
    const menu = new Menu(this.contentEl.ownerDocument);
    menu.addItem((item) => item.setTitle("Copy").setIcon("lucide-copy").onClick(() => {
      const selection = this.renderer?.getSelection() ?? "";
      if (selection) void navigator.clipboard.writeText(selection);
    }));
    menu.addItem((item) => item.setTitle("Paste").setIcon("lucide-clipboard-paste").onClick(async () => {
      const text = await navigator.clipboard.readText();
      if (text && this.terminalId) this.app.terminals.write(this.terminalId, text);
    }));
    menu.addItem((item) => item.setTitle("Restart terminal").setIcon("lucide-rotate-ccw").onClick(() => void this.restart()));
    this.app.workspace.trigger("terminal-menu", menu, {
      terminalId: terminal.id,
      cwd: terminal.cwd,
      shell: terminal.shell,
      status: terminal.status,
      selection: this.renderer?.getSelection() ?? "",
      view: this,
    });
    menu.showAtMouseEvent(event);
  }

  private showError(message: string, actionLabel = "Restart"): void {
    if (!this.surfaceEl) return;
    this.hideOverlay();
    const doc = this.contentEl.ownerDocument;
    this.overlayEl = doc.createElement("div");
    this.overlayEl.className = "terminal-view-overlay";
    const messageEl = doc.createElement("div");
    messageEl.className = "terminal-view-overlay-message";
    messageEl.textContent = message;
    const buttonEl = doc.createElement("button");
    buttonEl.className = "terminal-view-restart mod-cta";
    const iconEl = doc.createElement("span");
    setIcon(iconEl, "lucide-rotate-ccw");
    buttonEl.append(iconEl, doc.createTextNode(` ${actionLabel}`));
    buttonEl.addEventListener("click", () => void this.restart());
    this.overlayEl.append(messageEl, buttonEl);
    this.contentEl.appendChild(this.overlayEl);
  }

  private hideOverlay(): void {
    this.overlayEl?.remove();
    this.overlayEl = null;
  }

  private pushFocusScope(): void {
    if (this.focusScopePushed) return;
    this.focusScopePushed = true;
    this.app.keymap.pushScope(this.focusScope);
  }

  private popFocusScope(): void {
    if (!this.focusScopePushed) return;
    this.focusScopePushed = false;
    this.app.keymap.popScope(this.focusScope);
  }
}

function shellName(shell: string): string {
  return shell.split("/").pop() || shell;
}
