import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import type { TFile } from "../vault/TAbstractFile";
import { Setting, SettingGroup } from "../ui/Setting";
import { setIcon } from "../ui/Icon";

export interface DailyNotesOptions {
  folder?: string;
  format?: string;
  template?: string;
}

export class DailyNotesController {
  options: DailyNotesOptions = {
    folder: "",
    format: "YYYY-MM-DD",
    template: "",
  };
  plugin: InternalPluginWrapper | null = null;

  constructor(readonly app: App) {}

  async onEnable(plugin: InternalPluginWrapper): Promise<void> {
    this.plugin = plugin;
    this.options = { ...this.options, ...((await plugin.loadData<DailyNotesOptions>()) ?? {}) };
    plugin.addSettingTab(new DailyNotesSettingTab(this.app, this));
  }

  async openToday(): Promise<void> {
    await this.openDate(new Date());
  }

  async openAdjacentDailyNote(offsetDays: number): Promise<void> {
    const base = this.getActiveDailyDate() ?? new Date();
    const next = new Date(base);
    next.setDate(base.getDate() + offsetDays);
    await this.openDate(next);
  }

  async openDate(date: Date): Promise<void> {
    const file = await this.getDailyNote(date);
    await this.app.workspace.openFile(file, { active: true, state: { mode: "source" } });
  }

  async getDailyNote(date = new Date()): Promise<TFile> {
    const path = this.getDatePath(date);
    let file = this.app.vault.getFileByPath(path);
    if (!file) {
      const content = await this.getTemplateContent(date);
      file = await this.app.vault.create(path, content);
    }
    return file;
  }

  async saveOptions(options: DailyNotesOptions): Promise<void> {
    this.options = { ...this.options, ...options };
    await this.plugin?.saveData(this.options);
  }

  private getDatePath(date: Date): string {
    const name = formatDate(date, this.options.format || "YYYY-MM-DD");
    const folder = (this.options.folder ?? "").replace(/^\/+|\/+$/g, "");
    return folder ? `${folder}/${name}.md` : `${name}.md`;
  }

  private async getTemplateContent(date: Date): Promise<string> {
    const templatePath = this.options.template?.trim();
    if (!templatePath) return "";
    const file = this.app.vault.getFileByPath(templatePath);
    if (!file) return "";
    const source = await this.app.vault.read(file);
    return renderTemplate(source, { title: formatDate(date, this.options.format || "YYYY-MM-DD"), date });
  }

  private getActiveDailyDate(): Date | null {
    const activePath = this.app.workspace.activeEditor?.file?.path;
    if (!activePath) return null;
    const today = new Date();
    for (let offset = -3660; offset <= 3660; offset += 1) {
      const candidate = new Date(today);
      candidate.setDate(today.getDate() + offset);
      if (this.getDatePath(candidate) === activePath) return candidate;
    }
    return null;
  }
}

class DailyNotesSettingTab implements SettingTab {
  readonly id = "daily-notes";
  readonly name = "Daily notes";
  readonly icon = "lucide-calendar-days";
  readonly section = "core-plugins" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");

  constructor(readonly app: App, readonly controller: DailyNotesController) {
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
    this.containerEl.className = "vertical-tab-content daily-notes-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const group = new SettingGroup(this.containerEl).setHeading("Daily notes");
    new Setting(group.itemsEl)
      .setName("Date format")
      .setDesc("Filename format for today's note.")
      .addText((text) => text.setValue(this.controller.options.format ?? "YYYY-MM-DD").onChange((format) => {
        void this.controller.saveOptions({ format });
      }));
    new Setting(group.itemsEl)
      .setName("New file location")
      .setDesc("Folder where daily notes are created.")
      .addText((text) => text.setValue(this.controller.options.folder ?? "").onChange((folder) => {
        void this.controller.saveOptions({ folder });
      }));
    new Setting(group.itemsEl)
      .setName("Template file location")
      .setDesc("Optional markdown template used when a daily note is created.")
      .addText((text) => text.setValue(this.controller.options.template ?? "").onChange((template) => {
        void this.controller.saveOptions({ template });
      }));
  }

  hide(): void {
    this.containerEl.remove();
  }
}

export function createDailyNotesPluginDefinition(): InternalPluginDefinition {
  let controller: DailyNotesController | null = null;
  return {
    id: "daily-notes",
    name: "Daily notes",
    description: "Open or create today's daily note.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new DailyNotesController(app);
      plugin.instance = controller;
      plugin.registerGlobalCommand({
        id: "daily-notes",
        name: "Open today's daily note",
        icon: "lucide-calendar-days",
        callback: () => void controller?.openToday(),
      });
      plugin.registerGlobalCommand({
        id: "daily-notes:goto-prev",
        name: "Open previous daily note",
        icon: "lucide-chevron-left",
        callback: () => void controller?.openAdjacentDailyNote(-1),
      });
      plugin.registerGlobalCommand({
        id: "daily-notes:goto-next",
        name: "Open next daily note",
        icon: "lucide-chevron-right",
        callback: () => void controller?.openAdjacentDailyNote(1),
      });
    },
    async onEnable(_app: App, plugin: InternalPluginWrapper) {
      await controller?.onEnable(plugin);
    },
  };
}

export function formatDate(date: Date, format: string): string {
  const values: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad(date.getDate()),
    D: String(date.getDate()),
    HH: pad(date.getHours()),
    H: String(date.getHours()),
    mm: pad(date.getMinutes()),
    m: String(date.getMinutes()),
    ss: pad(date.getSeconds()),
    s: String(date.getSeconds()),
  };
  return format.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s/g, (token) => values[token] ?? token);
}

export function renderTemplate(source: string, context: { title?: string; date?: Date } = {}): string {
  const now = context.date ?? new Date();
  return source
    .replace(/{{date}}/gi, formatDate(now, "YYYY-MM-DD"))
    .replace(/{{time}}/gi, formatDate(now, "HH:mm"))
    .replace(/{{title}}/gi, context.title ?? "");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
