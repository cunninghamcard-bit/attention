import type { App } from "../App";

export class CustomCss {
  readonly styleEl: HTMLStyleElement;
  private styleEls = new Map<string, HTMLStyleElement>();
  private snippetStyleEls = new Map<string, HTMLStyleElement>();
  private snippetOrder: string[] = [];
  private cssCache = new Map<string, string>();
  private legacyThemes = new Set<string>();
  private folderThemes = new Set<string>();
  readonly requestLoadTheme = createDebouncedCustomCssRequest(() => this.loadTheme(), 100);
  readonly requestLoadSnippets = createDebouncedCustomCssRequest(() => this.loadSnippets(), 100);
  readonly requestReadThemes = createDebouncedCustomCssRequest(() => this.readThemes(), 2_000);

  constructor(readonly app: App) {
    this.styleEl = document.createElement("style");
    this.styleEl.type = "text/css";
    this.styleEl.dataset.obsidianReconstructedCss = "theme";
    document.head.appendChild(this.styleEl);
  }

  async load(): Promise<void> {
    this.loadData();
    await this.readThemes();
    await this.readSnippets();
    this.loadTheme();
    this.loadSnippets();
  }

  async readThemes(reload = false): Promise<void> {
    const folder = this.getThemeFolder();
    const listed = await this.app.vault.listConfigFolder(folder);
    this.legacyThemes.clear();
    this.folderThemes.clear();
    for (const file of listed.files) {
      const id = getCssBasename(file);
      if (!id || id.startsWith(".")) continue;
      const cssText = await this.loadCss(`${folder}/${file}`);
      this.legacyThemes.add(id);
      this.app.themes.registerTheme({ id, name: id, variables: {}, cssText });
    }

    for (const themeFolder of listed.folders) {
      if (themeFolder.startsWith(".")) continue;
      const manifest = await this.app.vault.readJson<{ name?: string; author?: string; version?: string }>(`${folder}/${themeFolder}/manifest.json`);
      const cssText = await this.loadCss(`${folder}/${themeFolder}/theme.css`);
      if (!cssText || manifest?.name !== themeFolder) continue;
      const id = manifest.name;
      this.folderThemes.add(id);
      this.app.themes.registerTheme({ id, name: id, author: manifest?.author, variables: {}, cssText });
    }

    if (reload) this.requestLoadTheme();
  }

  async readSnippets(reload = false): Promise<void> {
    const folder = this.getSnippetsFolder();
    const listed = await this.app.vault.listConfigFolder(folder);
    const enabledSnippets = new Set(this.app.vault.getConfig<string[]>("enabledCssSnippets") ?? []);
    const snippets = [];
    for (const file of listed.files.sort((a, b) => a.localeCompare(b))) {
      const id = getCssBasename(file);
      if (!id || id.startsWith(".")) continue;
      const cssText = await this.loadCss(`${folder}/${file}`);
      snippets.push({ id, name: id, cssText, enabled: enabledSnippets.has(id) });
    }
    this.app.cssSnippets.replaceDiscoveredSnippets(snippets);
    if (reload) this.requestLoadSnippets();
  }

  onRaw(path: string): void {
    this.cssCache.delete(path);
    const filename = path.split("/").pop() ?? "";
    const extension = filename.split(".").pop() ?? "";
    const activeTheme = this.app.vault.getConfig<string>("cssTheme") ?? "";
    if (path === this.getThemePath(activeTheme)) this.requestLoadTheme();
    if (path.startsWith(this.getThemeFolder()) && (filename === "theme.css" || filename === "manifest.json" || extension === "css")) this.requestReadThemes();
    if (path.startsWith(this.getSnippetsFolder()) && extension === "css") void this.readSnippets(true);
  }

  isCssConfigPath(path: string): boolean {
    return path.startsWith(this.getThemeFolder()) || path.startsWith(this.getSnippetsFolder());
  }

  loadData(): void {
    document.body.classList.toggle("is-translucent", Boolean(this.app.vault.getConfig("translucency")));
  }

  loadTheme(): void {
    this.app.themes.applyConfiguredTheme();
  }

  loadSnippets(): void {
    this.app.cssSnippets.applyEnabledSnippetsFromConfig();
  }

  getThemeFolder(): string {
    return `${this.app.vault.configDir}/themes`;
  }

  getSnippetsFolder(): string {
    return `${this.app.vault.configDir}/snippets`;
  }

  getThemePath(id: string): string {
    if (this.legacyThemes.has(id) && !this.folderThemes.has(id)) return `${this.getThemeFolder()}/${id}.css`;
    return `${this.getThemeFolder()}/${id}/theme.css`;
  }

  getSnippetPath(id: string): string {
    return `${this.getSnippetsFolder()}/${id}.css`;
  }

  registerCss(id: string, cssText: string): HTMLStyleElement {
    this.unregisterCss(id);
    const style = this.styleEl.ownerDocument.createElement("style");
    style.type = "text/css";
    style.dataset.obsidianReconstructedCss = id;
    style.textContent = cssText;
    document.head.insertBefore(style, this.styleEl);
    this.styleEls.set(id, style);
    this.app.workspace.trigger("css-change", id);
    return style;
  }

  unregisterCss(id: string): void {
    const style = this.styleEls.get(id);
    style?.remove();
    this.styleEls.delete(id);
    if (style) this.app.workspace.trigger("css-change", id);
  }

  registerPluginStyle(pluginId: string, cssText: string): HTMLStyleElement {
    const id = `plugin:${pluginId}`;
    const style = this.styleEl.ownerDocument.createElement("style");
    style.type = "text/css";
    style.dataset.obsidianReconstructedCss = id;
    style.textContent = cssText;
    document.head.insertBefore(style, this.styleEl);
    this.app.workspace.trigger("css-change", id);
    return style;
  }

  unregisterPluginStyle(pluginId: string, style: HTMLStyleElement): void {
    const wasConnected = style.isConnected;
    style.remove();
    if (wasConnected) this.app.workspace.trigger("css-change", `plugin:${pluginId}`);
  }

  setThemeCss(cssText: string, id = "theme"): void {
    const changed = this.styleEl.textContent !== cssText;
    this.styleEl.textContent = cssText;
    this.styleEl.dataset.theme = id;
    if (changed) {
      this.app.workspace.trigger("css-change", id);
      this.app.workspace.trigger("resize");
    }
  }

  registerSnippetStyle(id: string, cssText: string): void {
    this.unregisterSnippetStyle(id);
    const style = this.styleEl.ownerDocument.createElement("style");
    style.type = "text/css";
    style.dataset.obsidianReconstructedCss = `snippet:${id}`;
    style.textContent = cssText;
    const anchor = this.getLastSnippetAnchor();
    anchor.parentNode?.insertBefore(style, anchor.nextSibling);
    this.snippetStyleEls.set(id, style);
    this.snippetOrder.push(id);
    this.app.workspace.trigger("css-change", `snippet:${id}`);
    this.app.workspace.trigger("resize");
  }

  unregisterSnippetStyle(id: string): void {
    const style = this.snippetStyleEls.get(id);
    style?.remove();
    this.snippetStyleEls.delete(id);
    this.snippetOrder = this.snippetOrder.filter((item) => item !== id);
    if (style) {
      this.app.workspace.trigger("css-change", `snippet:${id}`);
      this.app.workspace.trigger("resize");
    }
  }

  private getLastSnippetAnchor(): HTMLStyleElement {
    for (let index = this.snippetOrder.length - 1; index >= 0; index -= 1) {
      const style = this.snippetStyleEls.get(this.snippetOrder[index]);
      if (style?.parentNode) return style;
    }
    return this.styleEl;
  }

  private async loadCss(path: string): Promise<string> {
    const cached = this.cssCache.get(path);
    if (cached !== undefined) return cached;
    const cssText = await this.app.vault.readText(path) ?? "";
    this.cssCache.set(path, cssText);
    return cssText;
  }
}

function getCssBasename(file: string): string | null {
  const filename = file.split("/").pop() ?? file;
  if (!filename.endsWith(".css")) return null;
  return filename.slice(0, -4);
}

function createDebouncedCustomCssRequest(run: () => void | Promise<void>, delay: number): (() => void) & { run: () => Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = (): void => {
    if (timer == null) return;
    clearTimeout(timer);
    timer = null;
  };
  const request = (() => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delay);
  }) as (() => void) & { run: () => Promise<void>; cancel: () => void };
  request.run = async () => {
    cancel();
    await run();
  };
  request.cancel = cancel;
  return request;
}
