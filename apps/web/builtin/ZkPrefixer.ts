import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { Setting, SettingGroup } from "../ui/Setting";
import { MarkdownView } from "../views/MarkdownView";
import { formatDate, renderTemplate } from "./DailyNotes";
import { setIcon } from "../ui/Icon";

export interface ZkPrefixerOptions {
  folder?: string;
  template?: string;
  format?: string;
}

const DEFAULT_FORMAT = "YYYYMMDDHHmm";

export class ZkPrefixerController {
  options: ZkPrefixerOptions = {};
  plugin: InternalPluginWrapper | null = null;

  constructor(readonly app: App) {}

  async onEnable(plugin: InternalPluginWrapper): Promise<void> {
    this.plugin = plugin;
    this.options = { ...(await plugin.loadData<ZkPrefixerOptions>()) };
    plugin.addSettingTab(new ZkPrefixerSettingTab(this.app, this));
  }

  getFormat(): string {
    return this.options.format?.trim() || DEFAULT_FORMAT;
  }

  async createUniqueNote(open = true): Promise<string> {
    const id = this.getUniqueId();
    const folder = (this.options.folder ?? "").replace(/^\/+|\/+$/g, "");
    const content = await this.getTemplateContent(id);
    const file = await this.app.fileManager.createNewMarkdownFile(folder, id);
    if (content) await this.app.vault.modify(file, content);
    if (open)
      await this.app.workspace.openFile(file, {
        active: true,
        state: { mode: "source" },
        eState: { rename: "end" },
      });
    return folder ? `${folder}/${id}` : id;
  }

  async insertUniqueLink(): Promise<void> {
    const view = this.app.workspace.activeLeaf?.view;
    if (!(view instanceof MarkdownView)) return;
    const path = await this.createUniqueNote(false);
    const selection = view.getSelection();
    const link = selection ? `[[${path}|${selection}]]` : `[[${path}]]`;
    view.insertText(link);
  }

  async saveOptions(options: ZkPrefixerOptions): Promise<void> {
    this.options = { ...this.options, ...options };
    await this.plugin?.saveData(this.options);
  }

  private getUniqueId(): string {
    const date = new Date();
    for (let offset = 0; offset < 525600; offset += 1) {
      const candidateDate = new Date(date.getTime() + offset * 60_000);
      const id = formatDate(candidateDate, this.getFormat());
      const folder = (this.options.folder ?? "").replace(/^\/+|\/+$/g, "");
      const path = folder ? `${folder}/${id}.md` : `${id}.md`;
      if (!this.app.vault.getFileByPath(path)) return id;
    }
    return `${formatDate(date, this.getFormat())}-${Date.now()}`;
  }

  private async getTemplateContent(title: string): Promise<string> {
    const template = this.options.template?.trim();
    if (!template) return "";
    const file =
      this.app.metadataCache.getFirstLinkpathDest(template, "") ??
      this.app.vault.getFileByPath(template);
    if (!file) return "";
    const source = await this.app.vault.read(file);
    return renderTemplate(source, { title });
  }
}

class ZkPrefixerSettingTab implements SettingTab {
  readonly id = "zk-prefixer";
  readonly name = "Unique note creator";
  readonly icon = "sheets-in-box";
  readonly section = "core-plugins" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");

  constructor(
    readonly app: App,
    readonly controller: ZkPrefixerController,
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
    this.containerEl.className = "vertical-tab-content zk-prefixer-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const group = new SettingGroup(this.containerEl).setHeading("Unique note creator");
    new Setting(group.itemsEl)
      .setName("New file location")
      .setDesc("Folder where unique notes are created.")
      .addText((text) =>
        text.setValue(this.controller.options.folder ?? "").onChange((folder) => {
          void this.controller.saveOptions({ folder });
        }),
      );
    new Setting(group.itemsEl)
      .setName("Template file location")
      .setDesc("Optional template used for new unique notes.")
      .addText((text) =>
        text.setValue(this.controller.options.template ?? "").onChange((template) => {
          void this.controller.saveOptions({ template });
        }),
      );
    new Setting(group.itemsEl)
      .setName("Unique ID format")
      .setDesc("Moment-style format. Default: YYYYMMDDHHmm.")
      .addText((text) =>
        text.setValue(this.controller.options.format ?? DEFAULT_FORMAT).onChange((format) => {
          void this.controller.saveOptions({ format });
        }),
      );
  }

  hide(): void {
    this.containerEl.remove();
  }
}

export function createZkPrefixerPluginDefinition(): InternalPluginDefinition {
  let controller: ZkPrefixerController | null = null;
  return {
    id: "zk-prefixer",
    name: "Unique note creator",
    description: "Create timestamp-prefixed unique notes.",
    defaultOn: false,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new ZkPrefixerController(app);
      plugin.instance = controller;
      plugin.registerGlobalCommand({
        id: "zk-prefixer",
        name: "Create new unique note",
        icon: "box-glyph",
        callback: () => void controller?.createUniqueNote(true),
      });
      plugin.registerGlobalCommand({
        id: "insert-unique-link",
        name: "Insert unique note link",
        icon: "lucide-link",
        checkCallback: (checking) => {
          const available = app.workspace.activeLeaf?.view instanceof MarkdownView;
          if (!checking && available) void controller?.insertUniqueLink();
          return available;
        },
      });
      plugin.registerRibbonItem("Create new unique note", "box-glyph", () => {
        void controller?.createUniqueNote(true);
      });
    },
    async onEnable(_app: App, plugin: InternalPluginWrapper) {
      await controller?.onEnable(plugin);
    },
  };
}
