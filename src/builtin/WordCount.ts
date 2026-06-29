import type { App } from "../app/App";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { MarkdownView } from "../views/MarkdownView";

export interface WordCountResult {
  words: number;
  characters: number;
}

export class WordCountController {
  plugin: InternalPluginWrapper | null = null;
  private wordsEl: HTMLElement | null = null;
  private charactersEl: HTMLElement | null = null;
  private updateTimer: number | undefined;

  constructor(readonly app: App) {}

  onEnable(plugin: InternalPluginWrapper): void {
    this.plugin = plugin;
    const el = plugin.statusBarEl;
    if (!el) return;
    this.wordsEl = document.createElement("span");
    this.wordsEl.className = "status-bar-item-segment";
    this.charactersEl = document.createElement("span");
    this.charactersEl.className = "status-bar-item-segment";
    el.replaceChildren(this.wordsEl, this.charactersEl);
    plugin.registerEvent(this.app.workspace.on("file-open", () => this.requestUpdate()));
    plugin.registerEvent(this.app.workspace.on("active-leaf-change", () => this.requestUpdate()));
    plugin.registerEvent(this.app.workspace.on("quick-preview", () => this.requestUpdate()));
    plugin.registerEvent(this.app.workspace.on("editor-selection-change", () => this.requestUpdate()));
    this.requestUpdate();
  }

  requestUpdate(): void {
    if (this.updateTimer !== undefined) window.clearTimeout(this.updateTimer);
    this.updateTimer = window.setTimeout(() => {
      this.updateTimer = undefined;
      this.updateDisplay();
    }, 200);
  }

  updateDisplay(): void {
    const el = this.plugin?.statusBarEl;
    if (!el || !this.wordsEl || !this.charactersEl) return;
    const view = this.app.workspace.activeLeaf?.view;
    if (!(view instanceof MarkdownView)) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    const result = this.countActiveText(view);
    this.wordsEl.textContent = `${result.words} words`;
    this.charactersEl.textContent = `${result.characters} characters`;
  }

  countActiveText(view: MarkdownView): WordCountResult {
    const selection = this.app.workspace.activeEditor?.editor.getSelection();
    const source = selection || view.getViewData();
    return countWords(stripFrontmatter(source));
  }
}

export function stripFrontmatter(source: string): string {
  return source.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "");
}

export function countWords(source: string): WordCountResult {
  const characters = Array.from(source.replace(/\s/g, "")).length;
  const cjkMatches = source.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? [];
  const withoutCjk = source.replace(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, " ");
  const wordMatches = withoutCjk.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? [];
  return {
    words: cjkMatches.length + wordMatches.length,
    characters,
  };
}

export function createWordCountPluginDefinition(): InternalPluginDefinition {
  let controller: WordCountController | null = null;
  return {
    id: "word-count",
    name: "Word count",
    description: "Shows word and character counts for the active Markdown file.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new WordCountController(app);
      plugin.instance = controller;
      plugin.registerStatusBarItem();
      plugin.registerMobileFileInfo(() => controller?.requestUpdate());
    },
    onEnable(_app: App, plugin: InternalPluginWrapper) {
      controller?.onEnable(plugin);
    },
  };
}
