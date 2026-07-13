import type { App } from "../App";

export interface CssSnippet {
  id: string;
  name: string;
  cssText: string;
  enabled: boolean;
}

export class CssSnippetManager {
  private snippets = new Map<string, CssSnippet>();

  constructor(readonly app: App) {}

  registerSnippet(snippet: CssSnippet): void {
    this.snippets.set(snippet.id, snippet);
    if (snippet.enabled) this.app.customCss.registerSnippetStyle(snippet.id, snippet.cssText);
  }

  replaceDiscoveredSnippets(snippets: CssSnippet[]): void {
    const nextIds = new Set(snippets.map((snippet) => snippet.id));
    for (const id of this.snippets.keys()) {
      if (nextIds.has(id)) continue;
      this.app.customCss.unregisterSnippetStyle(id);
      this.snippets.delete(id);
    }
    for (const snippet of snippets) this.registerSnippet(snippet);
  }

  unregisterSnippet(id: string): void {
    this.app.customCss.unregisterSnippetStyle(id);
    this.snippets.delete(id);
    void this.persistEnabledSnippets();
  }

  setEnabled(id: string, enabled: boolean): void {
    const snippet = this.snippets.get(id);
    if (!snippet) return;
    snippet.enabled = enabled;
    void this.persistEnabledSnippets();
    this.app.customCss.requestLoadSnippets();
    this.app.workspace.trigger("css-snippet-change", snippet);
  }

  setCssEnabledStatus(name: string, enabled: boolean): void {
    this.setEnabled(name, enabled);
  }

  applyEnabledSnippetsFromConfig(): void {
    const enabledIds = new Set(this.app.vault.getConfig<string[]>("enabledCssSnippets") ?? []);
    for (const snippet of this.snippets.values()) {
      snippet.enabled = enabledIds.has(snippet.id);
      if (snippet.enabled) this.app.customCss.registerSnippetStyle(snippet.id, snippet.cssText);
      else this.app.customCss.unregisterSnippetStyle(snippet.id);
    }
  }

  listSnippets(): readonly CssSnippet[] {
    return [...this.snippets.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private persistEnabledSnippets(): void {
    this.app.vault.setConfig(
      "enabledCssSnippets",
      this.listSnippets()
        .filter((snippet) => snippet.enabled)
        .map((snippet) => snippet.id),
    );
  }
}
