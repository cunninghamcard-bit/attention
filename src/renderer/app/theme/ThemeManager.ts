import type { App } from "../App";

export interface ThemeDefinition {
  id: string;
  name: string;
  variables: Record<string, string>;
  cssText?: string;
  author?: string;
}

export class ThemeManager {
  private themes = new Map<string, ThemeDefinition>();
  private activeThemeId: string | null = null;

  constructor(readonly app: App) {}

  registerTheme(theme: ThemeDefinition): void {
    this.themes.set(theme.id, theme);
  }

  unregisterTheme(id: string): void {
    this.themes.delete(id);
    if (this.activeThemeId === id) {
      this.activeThemeId = null;
      this.app.customCss.setThemeCss("", "");
    }
  }

  setTheme(id: string): void {
    this.app.vault.setConfig("cssTheme", id);
    this.app.customCss.requestLoadTheme();
  }

  applyConfiguredTheme(): void {
    const configuredTheme = this.app.vault.getConfig<string>("cssTheme") ?? "";
    if (!configuredTheme) return;
    if (this.themes.has(configuredTheme)) {
      this.applyTheme(configuredTheme);
      return;
    }
    // Vault themes (.obsidian/themes/<id>/theme.css) live on disk, not in the
    // registry — Obsidian-installed themes work by sharing the vault.
    void this.applyThemeFromVault(configuredTheme);
  }

  private async applyThemeFromVault(id: string): Promise<void> {
    const cssText = await this.app.vault.readText(this.app.customCss.getThemePath(id));
    // Guard against a theme switch racing the read.
    if ((this.app.vault.getConfig<string>("cssTheme") ?? "") !== id) return;
    if (cssText === null) return;
    this.app.customCss.setThemeCss(cssText, id);
    this.activeThemeId = id;
  }

  private applyTheme(id: string): void {
    const theme = this.themes.get(id);
    if (!theme) throw new Error(`Unknown theme: ${id}`);
    for (const [name, value] of Object.entries(theme.variables)) {
      document.documentElement.style.setProperty(name, value);
    }
    this.app.customCss.setThemeCss(theme.cssText ?? "", theme.id);
    this.activeThemeId = id;
  }

  loadDefaultTheme(): void {
    this.registerTheme({
      id: "obsidian-default-light",
      name: "Obsidian Default Light",
      variables: {
        "--background-primary": "#ffffff",
        "--background-secondary": "#f6f6f6",
        "--text-normal": "#222222",
        "--text-muted": "#777777",
        "--interactive-accent": "#7c6df0",
      },
    });
    this.applyTheme("obsidian-default-light");
  }

  getActiveTheme(): ThemeDefinition | null {
    return this.activeThemeId ? (this.themes.get(this.activeThemeId) ?? null) : null;
  }

  listThemes(): readonly ThemeDefinition[] {
    return [...this.themes.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
