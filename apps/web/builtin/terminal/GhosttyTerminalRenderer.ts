/**
 * Input: None
 * Output: TerminalRendererOptions, TerminalRenderer, TerminalRendererFactory, buildTerminalTheme, createGhosttyRenderer
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

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

export type TerminalRendererFactory = (
  options: TerminalRendererOptions,
) => Promise<TerminalRenderer>;

/**
 * The ANSI palette, mapped onto the app's OWN design tokens. There is no
 * bundled color scheme: the terminal paints with the same tokens as the rest of
 * the app, so it follows light/dark and any community theme for free, and the
 * canvas can never be a near-miss of the surface it sits in.
 *
 * The resulting theme must be COMPLETE (all 16 ANSI + fg/bg/cursor):
 * ghostty-web's buildWasmConfig parses every field with undefined → 0x000000,
 * so one missing entry silently renders black.
 *
 * Three deliberate choices:
 * - `black` / `white` ride the base ramp, which INVERTS between light and dark
 *   (`--color-base-70` is dark grey on light, light grey on dark). ANSI black is
 *   what CLIs use for dim text, so it has to stay readable in both appearances.
 * - selection uses a solid ramp step rather than `--text-selection`: that token
 *   is `hsla(…, 0.2)` and ghostty-web cannot blend alpha (its allowTransparency
 *   option is stored but never read; the renderer never clears).
 * - the token layer has no bright* variants, so bright colors reuse their base
 *   hue — which is what most modern terminal themes do anyway.
 */
const TERMINAL_PALETTE = {
  background: "--background-primary",
  foreground: "--text-normal",
  cursor: "--text-accent",
  selectionBackground: "--color-base-30",
  black: "--color-base-70",
  red: "--color-red",
  green: "--color-green",
  yellow: "--color-yellow",
  blue: "--color-blue",
  magenta: "--color-purple",
  cyan: "--color-cyan",
  white: "--color-base-60",
  brightBlack: "--color-base-50",
  brightRed: "--color-red",
  brightGreen: "--color-green",
  brightYellow: "--color-yellow",
  brightBlue: "--color-blue",
  brightMagenta: "--color-purple",
  brightCyan: "--color-cyan",
  brightWhite: "--text-normal",
} as const;

/** Resolve every palette entry through `resolve` (injected so this stays pure). */
export function buildTerminalTheme(resolve: (token: string) => string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(TERMINAL_PALETTE).map(([field, token]) => [field, resolve(token)]),
  );
}

/**
 * A design token as a concrete hex. ghostty-web parses the color itself and
 * understands hex only, so the token's authored form (hex, rgb(), hsl(),
 * color-mix()) is normalized through a probe element — the same off-screen
 * probe GraphRenderer.testCSS uses to read theme colors the canvas can't
 * consume directly. Throws rather than substituting a color: a terminal
 * painted a different black than the surface it sits in is a defect, and the
 * renderer's caller already turns this into a visible "failed to load" state.
 */
function resolveTokenColor(token: string): string {
  const raw = getComputedStyle(document.body).getPropertyValue(token).trim();
  if (!raw) throw new Error(`Terminal: the ${token} design token is not defined.`);
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:-9999px";
  probe.style.color = raw;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(computed);
  if (!rgb) throw new Error(`Terminal: ${token} resolved to "${computed}", not a color.`);
  return `#${rgb
    .slice(1, 4)
    .map((channel) => Math.round(Number(channel)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function resolveThemeFromDocument(): Record<string, string> {
  return buildTerminalTheme(resolveTokenColor);
}

/**
 * The monospace font stack, from the app's own `--font-monospace` — which is
 * `--font-monospace-override` (Appearance ▸ Monospace font) → the theme's →
 * the platform default stack. So the terminal renders in whatever the user
 * picked for monospace app-wide; picking a Nerd Font there is what makes
 * prompt/CLI glyphs (private-use icons) render instead of tofu boxes.
 *
 * Resolved through a probe element, not read raw: the token's value is nested
 * `var()`s, while ghostty-web passes this string straight into ctx.font.
 */
function resolveTokenFontFamily(token: string): string {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:-9999px";
  probe.style.fontFamily = `var(${token})`;
  document.body.append(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  if (!family) throw new Error(`Terminal: the ${token} design token is not defined.`);
  return family;
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
  // ponytail: theme and font are captured once at spawn — ghostty-web warns
  // that theme changes after open() are unsupported, so a mid-session
  // appearance switch applies to the next terminal, not running ones.
  const theme = resolveThemeFromDocument();
  const term = new ghostty.Terminal({
    fontFamily: options.fontFamily || resolveTokenFontFamily("--font-monospace"),
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
