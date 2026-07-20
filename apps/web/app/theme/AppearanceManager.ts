import type { App } from "../App";

export type BaseTheme = "obsidian" | "moonstone" | "system";

export interface AppearanceSettings {
  baseTheme: BaseTheme;
  accentColor: string;
  textFont: string;
  uiFont: string;
  monospaceFont: string;
  baseFontSize: number;
  tabSize: number;
  cssSnippetsEnabled: boolean;
}

export class AppearanceManager {
  private settings: AppearanceSettings = {
    baseTheme: "moonstone",
    accentColor: "#7c6df0",
    textFont: "serif",
    uiFont: "sans-serif",
    monospaceFont: "monospace",
    baseFontSize: 16,
    tabSize: 4,
    cssSnippetsEnabled: true,
  };

  constructor(readonly app: App) {}

  getSettings(): AppearanceSettings {
    return { ...this.settings };
  }

  applyFromConfig(): void {
    this.applyBaseTheme(this.app.vault.getConfig<BaseTheme>("theme") ?? "system");
    this.applyAccentColor(this.app.vault.getConfig<string>("accentColor") ?? "");
    this.applyFonts({
      textFont: this.app.vault.getConfig<string>("textFontFamily") ?? "",
      uiFont: this.app.vault.getConfig<string>("interfaceFontFamily") ?? "",
      monospaceFont: this.app.vault.getConfig<string>("monospaceFontFamily") ?? "",
    });
    this.updateFontSize();
    this.updateTabSize();
  }

  setBaseTheme(baseTheme: BaseTheme): void {
    this.applyBaseTheme(baseTheme);
    this.app.vault.setConfig("theme", baseTheme);
  }

  setAccentColor(color: string): void {
    this.applyAccentColor(color);
    this.app.vault.setConfig("accentColor", color);
  }

  isDarkMode(): boolean {
    return this.getBody().classList.contains("theme-dark");
  }

  getAccentColor(): string {
    const configured = this.app.vault.getConfig<string>("accentColor");
    if (configured) return configured;
    const style = this.getWindow().getComputedStyle(this.getBody());
    return hslToHex({
      h: parseCssNumber(style.getPropertyValue("--accent-h")),
      s: parseCssNumber(style.getPropertyValue("--accent-s")),
      l: parseCssNumber(style.getPropertyValue("--accent-l")),
    });
  }

  setFonts(
    settings: Partial<Pick<AppearanceSettings, "textFont" | "uiFont" | "monospaceFont">>,
  ): void {
    this.applyFonts(settings);
    if (settings.textFont !== undefined)
      this.app.vault.setConfig("textFontFamily", settings.textFont);
    if (settings.uiFont !== undefined)
      this.app.vault.setConfig("interfaceFontFamily", settings.uiFont);
    if (settings.monospaceFont !== undefined)
      this.app.vault.setConfig("monospaceFontFamily", settings.monospaceFont);
  }

  updateFontFamily(): void {
    this.applyFonts({
      textFont: this.app.vault.getConfig<string>("textFontFamily") ?? "",
      uiFont: this.app.vault.getConfig<string>("interfaceFontFamily") ?? "",
      monospaceFont: this.app.vault.getConfig<string>("monospaceFontFamily") ?? "",
    });
  }

  updateFontSize(): void {
    this.applyFontSize(this.app.vault.getConfig<number>("baseFontSize") ?? 16);
  }

  setFontSize(size: number): void {
    const baseFontSize = clampNumber(size, 10, 30);
    this.applyFontSize(baseFontSize);
    this.app.vault.setConfig("baseFontSize", baseFontSize);
  }

  updateTabSize(): void {
    this.applyTabSize(this.app.vault.getConfig<number>("tabSize") ?? 4);
  }

  setCssSnippetsEnabled(enabled: boolean): void {
    this.settings.cssSnippetsEnabled = enabled;
    this.getBody().classList.toggle("css-snippets-enabled", enabled);
    this.app.workspace.trigger("appearance-change", this.getSettings());
  }

  applyBaseTheme(baseTheme: BaseTheme): void {
    this.settings.baseTheme = baseTheme;
    const body = this.getBody();
    const prefersDark =
      this.getWindow().matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    const dark = baseTheme === "obsidian" || (baseTheme === "system" && prefersDark);
    const changed =
      body.classList.contains("theme-dark") !== dark ||
      body.classList.contains("theme-light") !== !dark;
    body.classList.toggle("theme-dark", dark);
    body.classList.toggle("theme-light", !dark);
    this.app.workspace.trigger("appearance-change", this.getSettings());
    if (changed) this.app.workspace.trigger("css-change", "base-theme");
  }

  applyAccentColor(color: string): void {
    const normalized = normalizeHexColor(color);
    this.settings.accentColor = normalized ?? "";
    const body = this.getBody();
    const root = body.ownerDocument.documentElement;
    const hsl = normalized ? hexToHsl(normalized) : null;
    if (!hsl) {
      body.style.removeProperty("--text-on-accent");
      body.style.removeProperty("--accent-h");
      body.style.removeProperty("--accent-s");
      body.style.removeProperty("--accent-l");
      root.style.removeProperty("--interactive-accent");
    } else {
      body.style.setProperty("--accent-h", String(hsl.h));
      body.style.setProperty("--accent-s", `${hsl.s}%`);
      body.style.setProperty("--accent-l", `${hsl.l}%`);
      if (isLightColor(normalized))
        body.style.setProperty("--text-on-accent", "var(--text-on-accent-inverted)");
      else body.style.removeProperty("--text-on-accent");
      root.style.setProperty("--interactive-accent", normalized);
    }
    this.app.workspace.trigger("appearance-change", this.getSettings());
    this.app.workspace.trigger("css-change", "accent-color");
  }

  private getBody(): HTMLElement {
    return this.app.dom.appContainerEl.ownerDocument.body;
  }

  private getWindow(): Window {
    return this.getBody().ownerDocument.defaultView ?? window;
  }

  private applyFonts(
    settings: Partial<Pick<AppearanceSettings, "textFont" | "uiFont" | "monospaceFont">>,
  ): void {
    this.settings = { ...this.settings, ...settings };
    const body = this.getBody();
    const root = this.getBody().ownerDocument.documentElement;
    const uiFont = formatFontFamilyOverride(this.settings.uiFont);
    const textFont = formatFontFamilyOverride(this.settings.textFont);
    const monospaceFont = formatFontFamilyOverride(this.settings.monospaceFont);
    body.style.setProperty("--font-interface-override", uiFont);
    body.style.setProperty("--font-text-override", textFont);
    if (textFont) body.style.setProperty("--font-print-override", textFont);
    else body.style.removeProperty("--font-print-override");
    body.style.setProperty("--font-monospace-override", monospaceFont);
    root.style.setProperty("--font-text", textFont);
    root.style.setProperty("--font-ui", uiFont);
    root.style.setProperty("--font-monospace", monospaceFont);
    this.app.workspace.trigger("appearance-change", this.getSettings());
    this.app.workspace.trigger("css-change", "font-family");
  }

  private applyFontSize(size: number): void {
    const baseFontSize = clampNumber(size, 10, 30);
    this.settings.baseFontSize = baseFontSize;
    const body = this.getBody();
    body.style.setProperty("--font-text-size", `${baseFontSize}px`);
    body.ownerDocument.documentElement.style.setProperty("font-size", `${baseFontSize}px`);
    this.app.workspace.trigger("appearance-change", this.getSettings());
    this.app.workspace.trigger("css-change", "font-size");
  }

  private applyTabSize(size: number): void {
    const tabSize = Number.isFinite(size) ? size : 4;
    this.settings.tabSize = tabSize;
    this.getBody().style.setProperty("--indent-size", String(tabSize));
  }
}

function formatFontFamilyOverride(value: string): string {
  return value
    .split(",")
    .map((font) => font.trim())
    .filter(Boolean)
    .map((font) => {
      if (
        /^['"]/.test(font) ||
        /^var\(/.test(font) ||
        /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace)$/i.test(
          font,
        )
      )
        return font;
      return /[^a-z0-9-]/i.test(font) ? JSON.stringify(font) : font;
    })
    .join(", ");
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(hex: string): string | null {
  const normalized = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(normalized)) {
    return `#${normalized
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toLowerCase()}`;
  }
  if (/^[0-9a-f]{6}$/i.test(normalized)) return `#${normalized.toLowerCase()}`;
  return null;
}

function parseCssNumber(value: string): number {
  const parsed = Number.parseFloat(value.trim().replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function hslToHex(hsl: { h: number; s: number; l: number }): string {
  const h = (((hsl.h % 360) + 360) % 360) / 360;
  const s = clamp(hsl.s / 100);
  const l = clamp(hsl.l / 100);
  if (s === 0) return rgbToHex(l, l, l);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgbToHex(hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3));
}

function hueToRgb(p: number, q: number, t: number): number {
  let channel = t;
  if (channel < 0) channel += 1;
  if (channel > 1) channel -= 1;
  if (channel < 1 / 6) return p + (q - p) * 6 * channel;
  if (channel < 1 / 2) return q;
  if (channel < 2 / 3) return p + (q - p) * (2 / 3 - channel) * 6;
  return p;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((channel) =>
      Math.round(clamp(channel) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isLightColor(hex: string): boolean {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return false;
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const linear = [r, g, b].map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2] > 0.5;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: Math.round(h * 60), s: Math.round(s * 100), l: Math.round(l * 100) };
}
