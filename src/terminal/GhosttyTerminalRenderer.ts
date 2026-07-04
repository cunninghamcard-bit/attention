/**
 * Thin wrapper around ghostty-web (libghostty-vt over WASM) so the rest of
 * the app never imports the package directly. Rendering, input capture, fit,
 * selection, focus and disposal only — PTY concerns stay in TerminalService.
 */

export interface TerminalRendererOptions {
  fontFamily?: string;
  fontSize?: number;
  scrollback?: number;
}

export interface TerminalRenderer {
  mount(el: HTMLElement): void;
  write(data: Uint8Array | string): void;
  onInput(callback: (data: string) => void): void;
  fit(): { cols: number; rows: number };
  getSelection(): string;
  focus(): void;
  dispose(): void;
}

export type TerminalRendererFactory = (options: TerminalRendererOptions) => Promise<TerminalRenderer>;

interface GhosttyTerminal {
  open(parent: HTMLElement): void;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  focus(): void;
  getSelection(): string;
  dispose(): void;
  onData(callback: (data: string) => void): { dispose(): void };
  loadAddon(addon: unknown): void;
  cols: number;
  rows: number;
}

interface GhosttyFitAddon {
  fit(): void;
  proposeDimensions?(): { cols: number; rows: number } | undefined;
}

export const createGhosttyRenderer: TerminalRendererFactory = async (options) => {
  const ghostty = await import("ghostty-web");
  await ghostty.init();
  const term = new ghostty.Terminal({
    fontFamily: options.fontFamily || "monospace",
    fontSize: options.fontSize ?? 13,
    scrollback: options.scrollback ?? 10000,
    cursorBlink: true,
  }) as unknown as GhosttyTerminal;
  const fitAddon = new ghostty.FitAddon() as unknown as GhosttyFitAddon;
  term.loadAddon(fitAddon);
  return {
    mount(el) {
      term.open(el);
      fitAddon.fit();
    },
    write(data) {
      term.write(data);
    },
    onInput(callback) {
      term.onData(callback);
    },
    fit() {
      fitAddon.fit();
      return { cols: term.cols, rows: term.rows };
    },
    getSelection() {
      return term.getSelection();
    },
    focus() {
      term.focus();
    },
    dispose() {
      term.dispose();
    },
  };
};
