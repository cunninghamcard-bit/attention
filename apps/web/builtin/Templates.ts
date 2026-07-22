import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { FuzzySuggestModal, type FuzzySuggestion } from "../ui/suggest/SuggestModal";
import type { TFile } from "../vault/TAbstractFile";
import { MarkdownView } from "../views/MarkdownView";
import { Setting, SettingGroup } from "../ui/Setting";
import { formatDate, renderTemplate } from "./DailyNotes";
import { setIcon } from "../ui/Icon";

export interface TemplatesOptions {
  folder?: string;
  dateFormat?: string;
  timeFormat?: string;
}

export class TemplatesController {
  options: TemplatesOptions = {
    folder: "Templates",
    dateFormat: "YYYY-MM-DD",
    timeFormat: "HH:mm",
  };
  plugin: InternalPluginWrapper | null = null;

  constructor(readonly app: App) {}

  async onEnable(plugin: InternalPluginWrapper): Promise<void> {
    this.plugin = plugin;
    this.options = { ...this.options, ...(await plugin.loadData<TemplatesOptions>()) };
    plugin.addSettingTab(new TemplatesSettingTab(this.app, this));
  }

  listTemplates(): TFile[] {
    const folder = (this.options.folder ?? "").replace(/^\/+|\/+$/g, "");
    return this.app.vault
      .getMarkdownFiles()
      .filter(
        (file) => !folder || file.path === `${folder}.md` || file.path.startsWith(`${folder}/`),
      )
      .sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { sensitivity: "base", numeric: true }),
      );
  }

  openTemplatePicker(): void {
    const templates = this.listTemplates();
    if (templates.length === 0) return;
    new TemplateSuggestModal(this.app, this, templates).open();
  }

  async insertTemplate(file: TFile): Promise<void> {
    const markdownView = this.app.workspace.activeLeaf?.view;
    if (!(markdownView instanceof MarkdownView)) return;
    const source = await this.app.vault.read(file);
    markdownView.insertText(renderTemplate(source, { title: markdownView.file?.basename }));
  }

  insertCurrentDate(): void {
    this.insertText(formatDate(new Date(), this.options.dateFormat || "YYYY-MM-DD"));
  }

  insertCurrentTime(): void {
    this.insertText(formatDate(new Date(), this.options.timeFormat || "HH:mm"));
  }

  async saveOptions(options: TemplatesOptions): Promise<void> {
    this.options = { ...this.options, ...options };
    await this.plugin?.saveData(this.options);
  }

  private insertText(text: string): void {
    const markdownView = this.app.workspace.activeLeaf?.view;
    if (markdownView instanceof MarkdownView) markdownView.insertText(text);
  }
}

class TemplateSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    readonly controller: TemplatesController,
    readonly templates: TFile[],
  ) {
    super(app);
    this.setPlaceholder("Choose a template...");
    this.emptyStateText = "No templates found";
  }

  getItems(): TFile[] {
    return this.templates;
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  renderSuggestion(value: FuzzySuggestion<TFile>, el: HTMLElement): void {
    const titleEl = document.createElement("div");
    titleEl.className = "suggestion-title";
    titleEl.textContent = value.item.path;
    el.appendChild(titleEl);
  }

  onChooseItem(item: TFile): void {
    void this.controller.insertTemplate(item);
  }
}

class TemplatesSettingTab implements SettingTab {
  readonly id = "templates";
  readonly name = "Templates";
  readonly icon = "lucide-scroll-text";
  readonly section = "core-plugins" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");

  constructor(
    readonly app: App,
    readonly controller: TemplatesController,
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
    this.containerEl.className = "vertical-tab-content templates-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const group = new SettingGroup(this.containerEl).setHeading("Templates");
    new Setting(group.itemsEl)
      .setName("Template folder location")
      .setDesc("Markdown files in this folder are available as templates.")
      .addText((text) =>
        text.setValue(this.controller.options.folder ?? "").onChange((folder) => {
          void this.controller.saveOptions({ folder });
        }),
      );
    new Setting(group.itemsEl)
      .setName("Date format")
      .setDesc("Format used by {{date}} and Insert current date.")
      .addText((text) =>
        text.setValue(this.controller.options.dateFormat ?? "YYYY-MM-DD").onChange((dateFormat) => {
          void this.controller.saveOptions({ dateFormat });
        }),
      );
    new Setting(group.itemsEl)
      .setName("Time format")
      .setDesc("Format used by {{time}} and Insert current time.")
      .addText((text) =>
        text.setValue(this.controller.options.timeFormat ?? "HH:mm").onChange((timeFormat) => {
          void this.controller.saveOptions({ timeFormat });
        }),
      );
  }

  hide(): void {
    this.containerEl.remove();
  }
}

export function createTemplatesPluginDefinition(): InternalPluginDefinition {
  let controller: TemplatesController | null = null;
  return {
    id: "templates",
    name: "Templates",
    description: "Insert template files and formatted dates into notes.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new TemplatesController(app);
      plugin.instance = controller;
      plugin.registerGlobalCommand({
        id: "insert-template",
        name: "Insert template",
        icon: "lucide-scroll-text",
        checkCallback: (checking) => {
          const available =
            app.workspace.activeLeaf?.view instanceof MarkdownView &&
            (controller?.listTemplates().length ?? 0) > 0;
          if (!checking && available) controller?.openTemplatePicker();
          return available;
        },
      });
      plugin.registerGlobalCommand({
        id: "insert-current-date",
        name: "Insert current date",
        icon: "lucide-calendar",
        checkCallback: (checking) => {
          const available = app.workspace.activeLeaf?.view instanceof MarkdownView;
          if (!checking && available) controller?.insertCurrentDate();
          return available;
        },
      });
      plugin.registerGlobalCommand({
        id: "insert-current-time",
        name: "Insert current time",
        icon: "lucide-clock",
        checkCallback: (checking) => {
          const available = app.workspace.activeLeaf?.view instanceof MarkdownView;
          if (!checking && available) controller?.insertCurrentTime();
          return available;
        },
      });
    },
    async onEnable(_app: App, plugin: InternalPluginWrapper) {
      await controller?.onEnable(plugin);
    },
  };
}
