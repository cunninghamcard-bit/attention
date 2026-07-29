/**
 * Input: None
 * Output: TerminalRendererOptions, TerminalRenderer, TerminalRendererFactory, buildTerminalTheme, createResttyRenderer
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

/**
 * Thin wrapper around restty (libghostty-vt in WASM, WebGPU/WebGL2 renderer,
 * own OpenType shaping) so the rest of the app never imports the package
 * directly. Rendering, input, sizing, selection, focus and disposal only —
 * PTY concerns stay in TerminalService.
 *
 * restty wants to OWN the PTY connection: it takes a `PtyTransport` and drives
 * connect / sendInput / resize through it. Our PTY lives behind Electron IPC in
 * TerminalService, so the transport here is a shim with no socket — it hands
 * restty's input to our callback, and lets `write()` push shell output back in
 * through the callbacks restty gave us at connect time.
 */

import type { GhosttyTheme } from "restty";

/** restty's color shape: byte components. Not exported from the package root. */
type ThemeColor = { r: number; g: number; b: number };

/**
 * A notification the running program asked for (OSC 9 / OSC 777). Restated as
 * our own shape rather than re-exporting restty's, so the app's notice path
 * never depends on the package.
 */
export interface TerminalNotification {
  title: string;
  body: string;
}

export interface TerminalRendererOptions {
  fontFamily?: string;
  fontSize?: number;
  scrollback?: number;
}

export interface TerminalRenderer {
  mount(el: HTMLElement): void;
  write(data: Uint8Array | string): void;
  onInput(callback: (data: string) => void): void;
  /**
   * restty resizes itself (autoResize) and reports the new grid through the
   * transport, so the PTY hears the same cols/rows the renderer actually drew.
   * There is no `fit()` to call: a second, hand-rolled sizing path is what
   * desynchronizes COLUMNS from the rendered grid and wraps prompts mid-glyph.
   */
  onResize(callback: (size: { cols: number; rows: number }) => void): void;
  /** OSC 9 / OSC 777 from the running program. Unset, notifications are dropped. */
  onNotification(callback: (notification: TerminalNotification) => void): void;
  copySelection(): Promise<boolean>;
  focus(): void;
  /** Repaint the palette from the current design tokens (appearance change). */
  applyTheme(): void;
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
 * Two deliberate choices survive from the ghostty-web renderer:
 * - `black` / `white` ride the base ramp, which INVERTS between light and dark
 *   (`--color-base-70` is dark grey on light, light grey on dark). ANSI black is
 *   what CLIs use for dim text, so it has to stay readable in both appearances.
 * - the token layer has no bright* variants, so bright colors reuse their base
 *   hue — which is what most modern terminal themes do anyway.
 *
 * `--text-selection` still stays out: it is `hsla(…, 0.2)` and the probe below
 * drops alpha, so taken literally it would paint an opaque near-white block.
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

/** ANSI 0-15, in palette-index order. */
const ANSI_ORDER = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

/** Resolve every palette entry through `resolve` (injected so this stays pure). */
export function buildTerminalTheme(resolve: (token: string) => string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(TERMINAL_PALETTE).map(([field, token]) => [field, resolve(token)]),
  );
}

/**
 * A design token as a concrete hex. The token's authored form (hex, rgb(),
 * hsl(), color-mix()) is normalized through a probe element — the same
 * off-screen probe GraphRenderer.testCSS uses to read theme colors the canvas
 * cannot consume directly. Throws rather than substituting a color: a terminal
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

/** `#rrggbb` to restty's byte-component color. */
function hexToThemeColor(hex: string): ThemeColor {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/**
 * The token palette as a Ghostty theme. restty takes the same shape its own
 * theme files parse into, so the app's tokens go in where a `.conf` would.
 */
function resolveGhosttyTheme(): GhosttyTheme {
  const hex = buildTerminalTheme(resolveTokenColor);
  const palette: ThemeColor[] = ANSI_ORDER.map((field) => hexToThemeColor(hex[field]));
  return {
    name: "attention-tokens",
    colors: {
      background: hexToThemeColor(hex.background),
      foreground: hexToThemeColor(hex.foreground),
      cursor: hexToThemeColor(hex.cursor),
      selectionBackground: hexToThemeColor(hex.selectionBackground),
      palette,
    },
    raw: {},
  };
}

/**
 * The monospace font stack, from the app's own `--font-monospace` — which is
 * `--font-monospace-override` (Appearance ▸ Monospace font) → the theme's →
 * the platform default stack. So the terminal renders in whatever the user
 * picked for monospace app-wide; picking a Nerd Font there is what makes
 * prompt/CLI glyphs (private-use icons) render instead of tofu boxes.
 *
 * restty shapes text itself, so the whole stack is handed over in order rather
 * than the browser resolving it: it takes an array of font inputs and falls
 * back across them per glyph, which is what makes the Nerd Font icons in a
 * powerline prompt render instead of tofu when the first family lacks them.
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

/**
 * Entries that can never match a local font face: CSS keywords, and Obsidian's
 * literal `"??"` placeholder for an unset override/theme font (the browser
 * skips an unknown family silently; restty would enumerate the system fonts
 * for it and warn).
 */
const NON_LOCAL_FAMILIES = new Set(["??", "monospace", "ui-monospace", "system-ui"]);

/** A CSS font stack as an ordered list of families, unquoted and de-duped. */
export function fontStackFamilies(stack: string): string[] {
  const seen = new Set<string>();
  for (const entry of stack.split(",")) {
    const family = entry.trim().replace(/^["']|["']$/g, "");
    if (family && !NON_LOCAL_FAMILIES.has(family.toLowerCase())) seen.add(family);
  }
  return [...seen];
}

export const createResttyRenderer: TerminalRendererFactory = async (options) => {
  const { Restty } = await import("restty");

  let onInput: ((data: string) => void) | null = null;
  let onResize: ((size: { cols: number; rows: number }) => void) | null = null;
  let onNotification: ((notification: TerminalNotification) => void) | null = null;
  // Set by the transport when restty "connects": its own sink for shell output.
  let sink: ((data: string) => void) | null = null;
  let surface: InstanceType<typeof Restty> | null = null;
  const decoder = new TextDecoder();

  // No socket: restty drives this like any PTY transport, but both directions
  // land on our callbacks instead of the wire.
  const transport = {
    connect(connectOptions: {
      callbacks?: { onData?: (data: string) => void; onConnect?: () => void };
    }) {
      sink = connectOptions.callbacks?.onData ?? null;
      connectOptions.callbacks?.onConnect?.();
    },
    disconnect() {
      sink = null;
    },
    sendInput(data: string) {
      onInput?.(data);
      return true;
    },
    resize(cols: number, rows: number) {
      onResize?.({ cols, rows });
      return true;
    },
    isConnected() {
      return sink !== null;
    },
    destroy() {
      sink = null;
    },
  };

  // Every family handed over is EAGERLY matched against Local Font Access
  // and, when found, fully parsed and atlas-rasterized on the main thread —
  // measured at ~400ms of main-thread block for a stock stack, more with big
  // Nerd Fonts. The tail of the stack is only a safety net, so cap it at the
  // user's pick plus two understudies; restty's built-in local nerd-font
  // fallback still covers prompt icons.
  const families = fontStackFamilies(
    options.fontFamily || resolveTokenFontFamily("--font-monospace"),
  ).slice(0, 3);

  return {
    mount(el) {
      surface = new Restty({
        root: el,
        terminal: {
          renderer: "auto",
          fontSize: options.fontSize ?? 13,
          // Powerline separators are EM-box glyphs meant to fill a cell edge to
          // edge. restty's default sizing mode is "height" — fontSize read as
          // ascender+descender+lineGap — which rasterizes them a hair short of
          // the cell and leaves a seam between segments. "em" makes the glyph
          // box and the cell agree.
          fontSizeMode: "em",
          // …and hinting so those edges land on whole pixels instead of
          // half-covered ones. Off by default; a terminal grid is exactly the
          // case it exists for.
          fontHinting: true,
          fonts: families.length
            ? families.map((family) => ({ family, local: "prefer" as const }))
            : undefined,
          theme: resolveGhosttyTheme(),
          // Ours is a tab in the workspace, not a terminal multiplexer: restty's
          // own splits, context menu and resize badge would be a second, rival
          // set of chrome inside one Obsidian leaf.
          showResizeOverlay: false,
        },
        surface: {
          searchUi: false,
          shortcuts: false,
          defaultContextMenu: false,
        },
        services: {
          ptyTransport: transport,
          // Read through the closure, so registration order does not matter:
          // the callback can be set before or after mount, like onInput.
          callbacks: {
            onDesktopNotification: ({ title, body }: TerminalNotification) =>
              onNotification?.({ title, body }),
          },
        },
      });
      // Nothing to dial: the transport has no URL. This is what makes restty
      // consider the pane live and start pumping input through sendInput.
      surface.connectPty();
    },
    write(data) {
      sink?.(typeof data === "string" ? data : decoder.decode(data, { stream: true }));
    },
    onInput(callback) {
      onInput = callback;
    },
    onResize(callback) {
      onResize = callback;
    },
    onNotification(callback) {
      onNotification = callback;
    },
    async copySelection() {
      return (await surface?.copySelectionToClipboard()) ?? false;
    },
    focus() {
      // focusedPane() is a getter, not an action — the pane handle owns focus.
      surface?.activePane()?.focus();
    },
    applyTheme() {
      surface?.applyTheme(resolveGhosttyTheme(), "attention-tokens");
    },
    dispose() {
      surface?.disconnectPty();
      surface = null;
      sink = null;
    },
  };
};
