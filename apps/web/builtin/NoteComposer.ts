import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import type { Menu } from "../ui/Menu";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { FuzzySuggestModal, type FuzzySuggestion } from "../ui/suggest/SuggestModal";
import { Setting, SettingGroup } from "../ui/Setting";
import { TFile } from "../vault/TAbstractFile";
import { MarkdownView } from "../views/MarkdownView";
import { setIcon } from "../ui/Icon";

export type NoteComposerReplacementText = "link" | "embed" | "none";

export interface NoteComposerOptions {
  askBeforeMerging: boolean;
  replacementText: NoteComposerReplacementText;
  template?: string;
}

type TargetItem = { type: "file"; file: TFile } | { type: "create"; path: string };

const DEFAULT_OPTIONS: NoteComposerOptions = {
  askBeforeMerging: true,
  replacementText: "link",
  template: "",
};

export class NoteComposerController {
  options: NoteComposerOptions = { ...DEFAULT_OPTIONS };
  plugin: InternalPluginWrapper | null = null;

  constructor(readonly app: App) {}

  async onEnable(plugin: InternalPluginWrapper): Promise<void> {
    this.plugin = plugin;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...(await plugin.loadData<Partial<NoteComposerOptions>>()),
    };
    plugin.addSettingTab(new NoteComposerSettingTab(this.app, this));
    plugin.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source) =>
        this.onFileMenu(menu as Menu, file, source),
      ),
    );
    plugin.registerEvent(
      this.app.workspace.on("editor-menu", (menu) => this.onEditorMenu(menu as Menu)),
    );
  }

  openMergeModal(source = this.activeFile()): void {
    if (!source) return;
    new NoteComposerTargetModal(this.app, this, { mode: "merge", source }).open();
  }

  openSplitModal(defaultName = "Untitled"): void {
    const view = this.activeMarkdownView();
    if (!view || !view.getSelection().trim()) return;
    new NoteComposerTargetModal(this.app, this, { mode: "split", view, defaultName }).open();
  }

  extractHeading(): void {
    const view = this.activeMarkdownView();
    if (!view) return;
    const source = view.getViewData();
    const lines = source.split(/\r?\n/);
    const cursor = view.editor.getCursor("from");
    const line = lines[cursor.line] ?? "";
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!heading) return;
    const level = heading[1].length;
    let endLine = lines.length;
    for (let index = cursor.line + 1; index < lines.length; index += 1) {
      const next = /^(#{1,6})\s+/.exec(lines[index]);
      if (next && next[1].length <= level) {
        endLine = index;
        break;
      }
    }
    const start = lineOffset(lines, cursor.line);
    const end = lineOffset(lines, endLine);
    view.selectRange(start, end);
    this.openSplitModal(heading[2].trim());
  }

  async mergeFile(source: TFile, target: TFile): Promise<void> {
    if (source.path === target.path) return;
    if (
      this.options.askBeforeMerging &&
      !window.confirm(`Merge ${source.path} into ${target.path}?`)
    )
      return;
    const content = await this.applyTemplate(
      await this.app.vault.read(source),
      source.basename,
      target.basename,
    );
    await this.insertIntoFile(target, content);
    await this.updateLinksToMergedFile(source, target);
    await this.app.vault.delete(source);
    await this.app.workspace.openFile(target, { active: true });
  }

  async splitSelection(view: MarkdownView, target: TFile): Promise<void> {
    const selection = view.getSelection().trim();
    if (!selection) return;
    const content = await this.applyTemplate(selection, view.file?.basename ?? "", target.basename);
    await this.insertIntoFile(target, content);
    view.replaceSelection(this.getReplacementText(target));
  }

  async createTarget(path: string): Promise<TFile> {
    const normalized = path.endsWith(".md") ? path.slice(0, -3) : path;
    const folder = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
    const basename = normalized.includes("/")
      ? normalized.slice(normalized.lastIndexOf("/") + 1)
      : normalized;
    return this.app.fileManager.createNewMarkdownFile(folder, basename || "Untitled");
  }

  async saveOptions(options: Partial<NoteComposerOptions>): Promise<void> {
    this.options = { ...this.options, ...options };
    if (!["link", "embed", "none"].includes(this.options.replacementText))
      this.options.replacementText = "link";
    await this.plugin?.saveData(this.options);
  }

  private onFileMenu(menu: Menu, file: unknown, source?: string): void {
    if (source === "link-context-menu" || !(file instanceof TFile) || file.extension !== "md")
      return;
    menu.addItem((item) =>
      item
        .setSection("action")
        .setTitle("Merge entire file with...")
        .setIcon("lucide-git-merge")
        .onClick(() => this.openMergeModal(file)),
    );
  }

  private onEditorMenu(menu: Menu): void {
    const view = this.activeMarkdownView();
    if (!view?.getSelection().trim()) return;
    menu.addItem((item) =>
      item
        .setTitle("Extract current selection...")
        .setIcon("lucide-scissors")
        .onClick(() => this.openSplitModal()),
    );
  }

  private activeMarkdownView(): MarkdownView | null {
    const view = this.app.workspace.activeLeaf?.view;
    return view instanceof MarkdownView ? view : null;
  }

  activeFile(): TFile | null {
    const file = this.activeMarkdownView()?.file;
    return file instanceof TFile ? file : null;
  }

  private async insertIntoFile(file: TFile, content: string): Promise<void> {
    const existing = await this.app.vault.read(file);
    const separator = existing.trim() && content.trim() ? "\n\n" : "";
    await this.app.vault.modify(file, `${existing}${separator}${content}`);
  }

  private async applyTemplate(
    content: string,
    fromTitle: string,
    newTitle: string,
  ): Promise<string> {
    const templatePath = this.options.template?.trim();
    if (!templatePath) return content;
    const templateFile =
      this.app.metadataCache.getFirstLinkpathDest(templatePath, "") ??
      this.app.vault.getFileByPath(templatePath);
    if (!templateFile) return content;
    let template = await this.app.vault.read(templateFile);
    if (!template.includes("{{content}}")) template = `${template}\n\n{{content}}`;
    return template
      .replace(/{{content}}/gi, content)
      .replace(/{{fromTitle}}/gi, fromTitle)
      .replace(/{{newTitle}}/gi, newTitle);
  }

  private getReplacementText(target: TFile): string {
    const linktext = target.path.replace(/\.md$/i, "");
    if (this.options.replacementText === "embed") return `![[${linktext}]]`;
    if (this.options.replacementText === "none") return "";
    return `[[${linktext}]]`;
  }

  private async updateLinksToMergedFile(source: TFile, target: TFile): Promise<void> {
    const sourceLink = source.path.replace(/\.md$/i, "");
    const targetLink = target.path.replace(/\.md$/i, "");
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.path === source.path) continue;
      const text = await this.app.vault.read(file);
      const next = text
        .replaceAll(`[[${sourceLink}]]`, `[[${targetLink}]]`)
        .replaceAll(`[[${source.basename}]]`, `[[${targetLink}]]`);
      if (next !== text) await this.app.vault.modify(file, next);
    }
  }
}

class NoteComposerTargetModal extends FuzzySuggestModal<TargetItem> {
  private query = "";

  constructor(
    app: App,
    readonly controller: NoteComposerController,
    readonly request:
      | { mode: "merge"; source: TFile }
      | { mode: "split"; view: MarkdownView; defaultName: string },
  ) {
    super(app);
    this.setPlaceholder(
      request.mode === "merge" ? "Select file to merge into..." : "Select file to extract into...",
    );
    this.emptyStateText = "No files found";
  }

  getItems(): TargetItem[] {
    const excluded = this.request.mode === "merge" ? this.request.source.path : "";
    return this.controller.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path !== excluded)
      .sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { sensitivity: "base", numeric: true }),
      )
      .map((file) => ({ type: "file", file }));
  }

  getItemText(item: TargetItem): string {
    return item.type === "file" ? item.file.path : item.path;
  }

  getSuggestions(query: string): FuzzySuggestion<TargetItem>[] {
    this.query = query.trim();
    const suggestions = super.getSuggestions(query) as FuzzySuggestion<TargetItem>[];
    const createPath =
      this.query || (this.request.mode === "split" ? this.request.defaultName : "");
    if (!createPath) return suggestions;
    const path = createPath.endsWith(".md") ? createPath : `${createPath}.md`;
    if (this.controller.app.vault.getFileByPath(path)) return suggestions;
    return [
      {
        item: { type: "create", path: createPath },
        match: { score: 0, matches: [] },
      } as FuzzySuggestion<TargetItem>,
      ...suggestions,
    ];
  }

  renderSuggestion(value: FuzzySuggestion<TargetItem>, el: HTMLElement): void {
    const titleEl = document.createElement("div");
    titleEl.className = "suggestion-title";
    titleEl.textContent =
      value.item.type === "file" ? value.item.file.basename : `Create ${value.item.path}`;
    const noteEl = document.createElement("div");
    noteEl.className = "suggestion-note";
    noteEl.textContent = value.item.type === "file" ? value.item.file.path : "New note";
    el.append(titleEl, noteEl);
  }

  onChooseItem(item: TargetItem): void {
    void this.choose(item);
  }

  private async choose(item: TargetItem): Promise<void> {
    const target = item.type === "file" ? item.file : await this.controller.createTarget(item.path);
    if (this.request.mode === "merge") await this.controller.mergeFile(this.request.source, target);
    else await this.controller.splitSelection(this.request.view, target);
  }
}

class NoteComposerSettingTab implements SettingTab {
  readonly id = "note-composer";
  readonly name = "Note composer";
  readonly icon = "merge";
  readonly section = "core-plugins" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");

  constructor(
    readonly app: App,
    readonly controller: NoteComposerController,
  ) {
    this.navEl.className = "vertical-tab-nav-item tappable";
    const iconEl = document.createElement("div");
    iconEl.className = "vertical-tab-nav-item-icon";
    setIcon(iconEl, this.icon);
    const titleEl = document.createElement("div");
    titleEl.className = "vertical-tab-nav-item-title";
    titleEl.textContent = this.name;
    const chevronEl = document.createElement("div");
    chevronEl.className = "vertical-tab-nav-item-chevron";
    this.navEl.append(iconEl, titleEl, chevronEl);
    this.containerEl.className = "vertical-tab-content note-composer-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const group = new SettingGroup(this.containerEl).setHeading("Note composer");
    new Setting(group.itemsEl)
      .setName("Split replacement text")
      .setDesc("Use link, embed, or none.")
      .addText((text) =>
        text.setValue(this.controller.options.replacementText).onChange((replacementText) => {
          void this.controller.saveOptions({
            replacementText: replacementText as NoteComposerReplacementText,
          });
        }),
      );
    new Setting(group.itemsEl)
      .setName("Template file location")
      .setDesc("Optional template. Supports {{content}}, {{fromTitle}}, and {{newTitle}}.")
      .addText((text) =>
        text.setValue(this.controller.options.template ?? "").onChange((template) => {
          void this.controller.saveOptions({ template });
        }),
      );
    new Setting(group.itemsEl)
      .setName("Confirm file merge")
      .setDesc("Ask before merging a whole file into another note.")
      .addToggle((toggle) =>
        toggle.setValue(this.controller.options.askBeforeMerging).onChange((askBeforeMerging) => {
          void this.controller.saveOptions({ askBeforeMerging });
        }),
      );
  }

  hide(): void {
    this.containerEl.remove();
  }
}

export function createNoteComposerPluginDefinition(): InternalPluginDefinition {
  let controller: NoteComposerController | null = null;
  return {
    id: "note-composer",
    name: "Note composer",
    description: "Merge notes, split selections, and extract headings.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new NoteComposerController(app);
      plugin.instance = controller;
      plugin.registerGlobalCommand({
        id: "note-composer:merge-file",
        name: "Merge current file with another file...",
        icon: "merge",
        checkCallback: (checking) => {
          const available = Boolean(controller?.activeFile());
          if (!checking && available) controller?.openMergeModal();
          return available;
        },
      });
      plugin.registerGlobalCommand({
        id: "note-composer:split-file",
        name: "Extract current selection...",
        icon: "lucide-scissors",
        checkCallback: (checking) => {
          const view = app.workspace.activeLeaf?.view;
          const available = view instanceof MarkdownView && Boolean(view.getSelection().trim());
          if (!checking && available) controller?.openSplitModal();
          return available;
        },
      });
      plugin.registerGlobalCommand({
        id: "note-composer:extract-heading",
        name: "Extract current heading...",
        icon: "lucide-heading",
        checkCallback: (checking) => {
          const available = app.workspace.activeLeaf?.view instanceof MarkdownView;
          if (!checking && available) controller?.extractHeading();
          return available;
        },
      });
    },
    async onEnable(_app: App, plugin: InternalPluginWrapper) {
      await controller?.onEnable(plugin);
    },
  };
}

function lineOffset(lines: string[], line: number): number {
  let offset = 0;
  for (let index = 0; index < Math.min(line, lines.length); index += 1)
    offset += lines[index].length + 1;
  return offset;
}
