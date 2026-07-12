import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { FuzzySuggestModal, type FuzzySuggestion } from "../ui/suggest/SuggestModal";
import { Setting, SettingGroup } from "../ui/Setting";
import { TFile } from "../vault/TAbstractFile";
import { Keymap } from "../app/hotkeys/Keymap";
import { setIcon } from "../ui/Icon";

export interface QuickSwitcherOptions {
  showExistingOnly: boolean;
  showAttachments: boolean;
  showAllFileTypes: boolean;
}

export type QuickSwitcherItem =
  | { type: "file"; file: TFile }
  | { type: "create"; path: string }
  | { type: "unresolved"; linktext: string };

export type QuickSwitcherSuggestionItem = QuickSwitcherItem | null;

const DEFAULT_OPTIONS: QuickSwitcherOptions = {
  showExistingOnly: false,
  showAttachments: true,
  showAllFileTypes: false,
};

export class QuickSwitcherController {
  options: QuickSwitcherOptions = { ...DEFAULT_OPTIONS };
  plugin: InternalPluginWrapper | null = null;
  activeModal: QuickSwitcherModal | null = null;

  constructor(readonly app: App) {}

  async onEnable(plugin: InternalPluginWrapper): Promise<void> {
    this.plugin = plugin;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...((await plugin.loadData<Partial<QuickSwitcherOptions>>()) ?? {}),
    };
    plugin.addSettingTab(new QuickSwitcherSettingTab(this.app, this));
  }

  open(): void {
    if (!this.activeModal) {
      this.activeModal = new QuickSwitcherModal(this.app, this).setCloseCallback(() => {
        this.activeModal = null;
      }) as QuickSwitcherModal;
    }
    this.activeModal.open();
  }

  getItems(): QuickSwitcherItem[] {
    return this.app.vault
      .getFiles()
      .filter((file) => isVisibleQuickSwitcherFile(file, this.options, this.app))
      .sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { sensitivity: "base", numeric: true }),
      )
      .map((file) => ({ type: "file", file }) as QuickSwitcherItem)
      .concat(this.getUnresolvedItems());
  }

  getRecentItems(): QuickSwitcherItem[] {
    return this.app.workspace
      .getRecentFiles({
        showMarkdown: true,
        showNonAttachments: true,
        showNonImageAttachments: this.options.showAttachments,
        showImages: this.options.showAttachments,
        maxCount: 10,
      })
      .flatMap((path) => {
        const file = this.app.vault.getFileByPath(path);
        return file ? [{ type: "file", file } as QuickSwitcherItem] : [];
      });
  }

  getUnresolvedItems(): QuickSwitcherItem[] {
    if (this.options.showExistingOnly) return [];
    const seen = new Set<string>();
    const items: QuickSwitcherItem[] = [];
    for (const unresolved of Object.values(this.app.metadataCache.unresolvedLinks)) {
      for (const linktext of Object.keys(unresolved)) {
        const truncated = linktext.length > 500 ? linktext.slice(0, 500) : linktext;
        if (seen.has(truncated)) continue;
        seen.add(truncated);
        items.push({ type: "unresolved", linktext: truncated });
      }
    }
    return items;
  }

  async choose(item: QuickSwitcherItem, event?: MouseEvent | KeyboardEvent): Promise<void> {
    const paneType = event ? Keymap.isModEvent(event) : false;
    if (item.type === "file") {
      await this.app.workspace.getLeaf(paneType).openFile(item.file, { active: true });
      return;
    }
    if (item.type === "unresolved") {
      await this.app.workspace
        .getLeaf(paneType)
        .openLinkText(item.linktext, this.app.workspace.getActiveFile()?.path ?? "", {
          active: true,
        });
      return;
    }

    await this.app.workspace.openLinkText(
      item.path,
      this.app.workspace.getActiveFile()?.path ?? "",
      paneType,
      { active: true },
    );
  }

  async saveOptions(options: Partial<QuickSwitcherOptions>): Promise<void> {
    this.options = { ...this.options, ...options };
    await this.plugin?.saveData(this.options);
  }
}

export class QuickSwitcherModal extends FuzzySuggestModal<QuickSwitcherSuggestionItem> {
  private query = "";

  constructor(
    app: App,
    readonly controller: QuickSwitcherController,
  ) {
    super(app);
    this.limit = 20;
    this.setPlaceholder("Type to switch files...");
    this.emptyStateText = "No matching files";
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to open" },
      { command: isMacLike() ? "⌘ ↵" : "ctrl ↵", purpose: "to open in new tab" },
      { command: isMacLike() ? "⌘ ⌥ ↵" : "ctrl alt ↵", purpose: "to open to the right" },
      { command: "shift ↵", purpose: "to create" },
      { command: "esc", purpose: "to dismiss" },
    ]);
    this.scope.register(["Shift"], "Enter", (event) => {
      this.selectSuggestion(toSuggestion(null), event);
      return false;
    });
    this.scope.register(["Mod", "Shift"], "Enter", (event) => {
      this.selectSuggestion(toSuggestion(null), event);
      return false;
    });
    this.scope.register(null, "Enter", (event) => {
      this.selectActiveSuggestion(event);
      return false;
    });
  }

  /** Item list frozen per modal open: on 20k-file vaults the enumerate+sort
   * would otherwise run on every keystroke to render at most `limit` rows. */
  private cachedItems: QuickSwitcherSuggestionItem[] | null = null;

  override onOpen(): void {
    this.cachedItems = null;
    super.onOpen();
  }

  getItems(): QuickSwitcherSuggestionItem[] {
    return (this.cachedItems ??= this.controller.getItems());
  }

  getItemText(item: QuickSwitcherSuggestionItem): string {
    if (item === null) return this.query || this.inputEl.value.trim();
    if (item.type === "file") return getQuickSwitcherFileTitle(item.file);
    if (item.type === "unresolved") return item.linktext;
    return item.path;
  }

  getSuggestions(query: string): FuzzySuggestion<QuickSwitcherSuggestionItem>[] {
    this.query = query.trim();
    if (!this.query) return this.controller.getRecentItems().map((item) => toSuggestion(item));
    const suggestions = super.getSuggestions(query);
    if (suggestions.length > 0) return suggestions;
    const requestedPath = this.query.endsWith(".md") ? this.query : `${this.query}.md`;
    const alreadyExists = this.controller.app.vault.getFileByPath(requestedPath);
    if (alreadyExists) return suggestions;
    return [toSuggestion(null)];
  }

  renderSuggestion(value: FuzzySuggestion<QuickSwitcherSuggestionItem>, el: HTMLElement): void {
    el.classList.add("mod-complex");
    const contentEl = document.createElement("div");
    contentEl.className = "suggestion-content";
    const titleEl = document.createElement("div");
    titleEl.className = "suggestion-title";
    const noteEl = document.createElement("div");
    noteEl.className = "suggestion-note";
    if (value.item === null) {
      titleEl.textContent = this.query || this.inputEl.value.trim();
      const actionEl = document.createElement("div");
      actionEl.className = "suggestion-action";
      actionEl.textContent = "Create new note";
      contentEl.append(titleEl, actionEl);
    } else if (value.item.type === "file") {
      titleEl.textContent = getQuickSwitcherFileTitle(value.item.file);
      noteEl.textContent = value.item.file.path;
      contentEl.append(titleEl, noteEl);
    } else if (value.item.type === "unresolved") {
      titleEl.textContent = value.item.linktext;
      contentEl.append(titleEl);
      const flairEl = document.createElement("div");
      flairEl.className = "suggestion-flair";
      flairEl.dataset.icon = "lucide-file-plus";
      flairEl.title = "Not created yet";
      el.append(contentEl, flairEl);
      return;
    } else {
      titleEl.textContent = value.item.path;
      const actionEl = document.createElement("div");
      actionEl.className = "suggestion-action";
      actionEl.textContent = "Create new note";
      contentEl.append(titleEl, actionEl);
    }
    el.appendChild(contentEl);
  }

  override onChooseSuggestion(
    value: FuzzySuggestion<QuickSwitcherSuggestionItem> | null,
    event: MouseEvent | KeyboardEvent,
  ): void {
    if (!value || value.item === null) {
      const path = this.query || this.inputEl.value.trim();
      if (path) void this.controller.choose({ type: "create", path }, event);
      return;
    }
    this.onChooseItem(value.item, event);
  }

  onChooseItem(item: QuickSwitcherSuggestionItem, event: MouseEvent | KeyboardEvent): void {
    if (item === null) {
      const path = this.query || this.inputEl.value.trim();
      if (path) void this.controller.choose({ type: "create", path }, event);
      return;
    }
    void this.controller.choose(item, event);
  }
}

class QuickSwitcherSettingTab implements SettingTab {
  readonly id = "switcher";
  readonly name = "Quick switcher";
  readonly icon = "file-search";
  readonly section = "core-plugins" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");

  constructor(
    readonly app: App,
    readonly controller: QuickSwitcherController,
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
    this.containerEl.className = "vertical-tab-content switcher-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const group = new SettingGroup(this.containerEl).setHeading("Quick switcher");
    new Setting(group.itemsEl)
      .setName("Show existing files only")
      .setDesc("When disabled, typing a missing Markdown path offers to create it.")
      .addToggle((toggle) =>
        toggle.setValue(this.controller.options.showExistingOnly).onChange((showExistingOnly) => {
          void this.controller.saveOptions({ showExistingOnly });
        }),
      );
    new Setting(group.itemsEl)
      .setName("Show attachments")
      .setDesc("Include non-Markdown files alongside notes.")
      .addToggle((toggle) =>
        toggle.setValue(this.controller.options.showAttachments).onChange((showAttachments) => {
          void this.controller.saveOptions({ showAttachments });
        }),
      );
    new Setting(group.itemsEl)
      .setName("Show all file types")
      .setDesc("Include every loaded file type in the switcher.")
      .addToggle((toggle) =>
        toggle.setValue(this.controller.options.showAllFileTypes).onChange((showAllFileTypes) => {
          void this.controller.saveOptions({ showAllFileTypes });
        }),
      );
  }

  hide(): void {
    this.containerEl.remove();
  }
}

export function createQuickSwitcherPluginDefinition(): InternalPluginDefinition {
  let controller: QuickSwitcherController | null = null;
  return {
    id: "switcher",
    name: "Quick switcher",
    description: "Search and open notes from a modal.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new QuickSwitcherController(app);
      plugin.instance = controller;
      plugin.registerGlobalCommand({
        id: "switcher:open",
        name: "Open quick switcher",
        icon: "lucide-navigation",
        hotkeys: [{ modifiers: ["Mod"], key: "O" }],
        callback: () => controller?.open(),
      });
      plugin.registerRibbonItem("Open quick switcher", "lucide-file-search", () =>
        controller?.open(),
      );
    },
    async onEnable(_app: App, plugin: InternalPluginWrapper) {
      await controller?.onEnable(plugin);
    },
  };
}

function isMacLike(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

function toSuggestion(
  item: QuickSwitcherSuggestionItem,
): FuzzySuggestion<QuickSwitcherSuggestionItem> {
  return { item, match: { score: 0, matches: [] } };
}

function getQuickSwitcherFileTitle(file: TFile): string {
  return file.extension.toLowerCase() === "md" ? file.path.replace(/\.md$/i, "") : file.path;
}

function isVisibleQuickSwitcherFile(file: TFile, options: QuickSwitcherOptions, app: App): boolean {
  if (options.showAllFileTypes) return true;
  const extension = file.extension.toLowerCase();
  if (extension === "md" || extension === "canvas" || extension === "base") return true;
  return options.showAttachments && isRegisteredQuickSwitcherAttachment(file, app);
}

function isRegisteredQuickSwitcherAttachment(file: TFile, app: App): boolean {
  return (
    app.viewRegistry.isExtensionRegistered(file.extension) ||
    isKnownAttachmentExtension(file.extension)
  );
}

function isKnownAttachmentExtension(extension: string): boolean {
  return new Set([
    "avif",
    "bmp",
    "gif",
    "jpeg",
    "jpg",
    "png",
    "svg",
    "webp",
    "mp3",
    "wav",
    "m4a",
    "3gp",
    "flac",
    "ogg",
    "oga",
    "opus",
    "mp4",
    "webm",
    "ogv",
    "mov",
    "mkv",
    "pdf",
  ]).has(extension.toLowerCase());
}
