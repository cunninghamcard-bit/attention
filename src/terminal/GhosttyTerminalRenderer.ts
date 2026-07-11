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

/**
 * Terminal color schemes, transcribed from the Kaku terminal's local install
 * (/Applications/Kaku.app/Contents/Resources/kaku.lua — tw93/Kaku, WezTerm
 * `Kaku Dark` / `Kaku Light`). Dark is Aura-derived; light is Flexoki paper.
 * Selected by the app's theme-dark body class, captured per terminal spawn.
 *
 * Both themes are COMPLETE (all 16 ANSI + fg/bg/cursor) on purpose:
 * ghostty-web's buildWasmConfig parses every field with undefined → 0x000000,
 * so a partial theme silently turns the missing colors black. ghostty-web also
 * can't do real alpha (its allowTransparency option is stored but never read;
 * no clearRect in the renderer), so the dark scheme's rgba() selection color is
 * pre-blended against the background here (#29263c ≈ its SURFACE_ACTIVE).
 */
const LIGHT_SCHEME = {
  background: "#fffcf0", foreground: "#100f0f", cursor: "#343331",
  selectionBackground: "#e8e6db", selectionForeground: "#100f0f",
  black: "#100f0f", red: "#af3029", green: "#536907", yellow: "#8e6b02",
  blue: "#205ea6", magenta: "#a02f6f", cyan: "#1c6c66", white: "#575653",
  brightBlack: "#6f6e69", brightRed: "#c03e35", brightGreen: "#66790d", brightYellow: "#8e6b02",
  brightBlue: "#3171b2", brightMagenta: "#b74583", brightCyan: "#2f968d", brightWhite: "#403e3c",
};
const DARK_SCHEME = {
  background: "#15141b", foreground: "#d5d4d6", cursor: "#8e6ad9",
  selectionBackground: "#29263c",
  // The source scheme renders ANSI-black foregrounds as light text on dark bg.
  black: "#c8c6cc", red: "#d85d5d", green: "#58d8ad", yellow: "#daae76",
  blue: "#68afda", magenta: "#8e6ad9", cyan: "#58d8ad", white: "#d5d4d6",
  brightBlack: "#6d6d6d", brightRed: "#d85d5d", brightGreen: "#58d8ad", brightYellow: "#daae76",
  brightBlue: "#90c9e6", brightMagenta: "#8e6ad9", brightCyan: "#58d8ad", brightWhite: "#d5d4d6",
};

export function buildTerminalTheme(dark: boolean): Record<string, string> {
  return { ...(dark ? DARK_SCHEME : LIGHT_SCHEME) };
}

function resolveThemeFromDocument(): Record<string, string> {
  return buildTerminalTheme(document.body.classList.contains("theme-dark"));
}

/**
 * Starship and the user's Kaku shell profile use Nerd Font glyphs
 * (private-use icons); a plain `monospace` canvas font draws them as tofu
 * boxes. ghostty-web passes this stack straight into ctx.font and canvas
 * falls back per glyph like CSS.
 */
export const DEFAULT_FONT_STACK =
  '"Arkloop JetBrains Mono", "Arkloop Nerd Symbols", "PingFang SC", "Apple Color Emoji", monospace';

export const BUNDLED_FONT_FACES = [
  { family: "Arkloop JetBrains Mono", file: "JetBrainsMono-Regular.ttf", weight: "400" },
  // SemiBold, not Medium: Medium's usWeightClass is 500 — registering it as
  // 700 renders bold cells barely heavier than regular.
  { family: "Arkloop JetBrains Mono", file: "JetBrainsMono-SemiBold.ttf", weight: "700" },
  { family: "Arkloop Nerd Symbols", file: "SymbolsNerdFontMono-Regular.ttf", weight: "400" },
  // ghostty-web emits CSS `bold` for ANSI bold cells. Registering the same
  // symbol face at 700 prevents Chromium from synthesizing a swollen glyph,
  // which blurred Powerline edges and shifted eza icons inside their cells.
  { family: "Arkloop Nerd Symbols", file: "SymbolsNerdFontMono-Regular.ttf", weight: "700" },
] as const;

/**
 * Register Kaku's bundled JetBrains Mono + Symbols Nerd Font with the
 * document so the stack above works even when nothing suitable is installed
 * system-wide. Desktop only (needs the non-sandboxed require for node:fs);
 * silently a no-op in the browser build or without Kaku.app.
 */
async function registerBundledFonts(doc: Document): Promise<void> {
  const requireFn = (globalThis as { require?: (id: string) => unknown }).require;
  if (!requireFn) return;
  try {
    const fs = requireFn("node:fs") as {
      existsSync(path: string): boolean;
      readFileSync(path: string): Uint8Array;
    };
    for (const { family, file, weight } of BUNDLED_FONT_FACES) {
      // NOT fonts.check(): per spec it returns a vacuous TRUE for a family
      // with no matching FontFace (treated as "system font, nothing to load"),
      // so it skipped every registration and the whole stack silently fell
      // through to PingFang. Scan the FontFaceSet for a real match instead.
      let registered = false;
      doc.fonts.forEach((face) => {
        if (face.family.replace(/["']/g, "") === family && face.weight === weight) registered = true;
      });
      if (registered) continue;
      const path = `/Applications/Kaku.app/Contents/Resources/fonts/${file}`;
      if (!fs.existsSync(path)) continue;
      const bytes = fs.readFileSync(path);
      // Copy only the font bytes. Node Buffer's backing store can be larger
      // than its byte range, so passing `.buffer` directly is not valid font
      // data; a fresh Uint8Array is an exact browser BufferSource.
      const data = new Uint8Array(bytes);
      const face = new FontFace(family, data, { weight });
      await face.load();
      doc.fonts.add(face);
    }
  } catch {
    // ponytail: fonts are progressive enhancement — the stack still ends in
    // monospace, so failure here degrades to today's rendering, never breaks.
  }
}

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
  // Fonts must be available before the terminal measures its cell size.
  await registerBundledFonts(document);
  // ponytail: theme is captured once at spawn — ghostty-web warns that theme
  // changes after open() are unsupported, so a mid-session appearance switch
  // applies to the next terminal, not running ones.
  const theme = resolveThemeFromDocument();
  const term = new ghostty.Terminal({
    fontFamily: options.fontFamily || DEFAULT_FONT_STACK,
    fontSize: options.fontSize ?? 13,
    scrollback: options.scrollback ?? 10000,
    cursorBlink: true,
    theme,
  }) as unknown as GhosttyTerminal;
  const fitAddon = new ghostty.FitAddon() as unknown as GhosttyFitAddon;
  term.loadAddon(fitAddon);

  // Single source of truth for cols/rows: ghostty's own FitAddon. It reserves
  // a 15px scrollbar strip the canvas backend never draws, but a second
  // hand-rolled fit path desynchronizes the PTY's COLUMNS from the columns
  // ghostty actually renders (ghostty refits internally with the reserve, the
  // PTY only hears the wider hand-rolled number → prompts wrap mid-glyph).
  // The reserve strip stays invisible because mount() paints the host in the
  // terminal's exact background color.
  const fit = (): { cols: number; rows: number } => {
    fitAddon.fit();
    return { cols: term.cols, rows: term.rows };
  };

  return {
    mount(el) {
      // The cell grid can't cover the scrollbar reserve or the sub-cell
      // remainder on the right/bottom; painting the host in the exact canvas
      // background makes both invisible in any theme.
      el.style.background = theme.background;
      term.open(el);
      fit();
    },
    write(data) {
      term.write(data);
    },
    onInput(callback) {
      term.onData(callback);
    },
    fit,
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
