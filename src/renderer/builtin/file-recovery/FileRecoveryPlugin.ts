import type { App } from "../../app/App";
import type { SettingTab } from "../../app/SettingRegistry";
import type { FileRevision } from "./RevisionHistory";
import type { InternalPluginDefinition } from "../../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../../plugin/InternalPluginWrapper";
import { ConfirmationModal } from "../../ui/Modal";
import { Setting, SettingGroup } from "../../ui/Setting";
import { Notice } from "../../ui/Notice";
import { TFile } from "../../vault/TAbstractFile";
import { setIcon } from "../../ui/Icon";

export interface FileRecoveryOptions {
  intervalMinutes: number;
  keepDays: number;
}

const DEFAULT_OPTIONS: FileRecoveryOptions = {
  intervalMinutes: 5,
  keepDays: 7,
};

const SUPPORTED_EXTENSIONS = new Set(["md", "canvas", "base"]);

export class FileRecoveryController {
  options: FileRecoveryOptions = { ...DEFAULT_OPTIONS };
  plugin: InternalPluginWrapper | null = null;
  private lastSnapshotAt = new Map<string, number>();
  private cleanupTimer: number | undefined;

  constructor(readonly app: App) {}

  async onEnable(plugin: InternalPluginWrapper): Promise<void> {
    this.plugin = plugin;
    this.options = normalizeOptions(await plugin.loadData<Partial<FileRecoveryOptions>>());
    plugin.addSettingTab(new FileRecoverySettingTab(this.app, this));
    plugin.registerEvent(this.app.vault.on("modify", (file) => void this.onFileChanged(file)));
    plugin.registerEvent(this.app.vault.on("create", (file) => void this.onFileChanged(file)));
    plugin.registerEvent(
      this.app.workspace.on("file-open", (file) => void this.onFileChanged(file)),
    );
    this.cleanupTimer = window.setInterval(() => this.cleanup(), 60 * 60 * 1000);
    plugin.register(() => {
      if (this.cleanupTimer !== undefined) window.clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    });
    this.cleanup();
  }

  openModal(path?: string): void {
    new FileRecoveryModal(this.app, this, path).open();
  }

  async saveOptions(options: Partial<FileRecoveryOptions>): Promise<void> {
    this.options = normalizeOptions({ ...this.options, ...options });
    await this.plugin?.saveData(this.options);
    this.cleanup();
  }

  async snapshotFile(file: TFile, force = false): Promise<FileRevision | null> {
    if (!isSupported(file)) return null;
    const now = Date.now();
    const last = this.lastSnapshotAt.get(file.path) ?? 0;
    const interval = this.options.intervalMinutes * 60 * 1000;
    if (!force && now - last < interval) return null;
    const content = await this.app.vault.read(file);
    const latest = this.app.revisions.listRevisions(file.path)[0];
    if (!force && latest?.content === content) {
      this.lastSnapshotAt.set(file.path, now);
      return null;
    }
    this.lastSnapshotAt.set(file.path, now);
    return this.app.revisions.addRevision(file.path, content, "local");
  }

  async restore(path: string, revision: FileRevision): Promise<void> {
    await this.app.fileRecovery.recover(path, revision.id);
    const file = this.app.vault.getFileByPath(path);
    if (file) {
      await this.snapshotFile(file, true);
      await this.app.workspace.openFile(file, { active: true });
    }
    new Notice(`Restored ${path}`);
  }

  listPaths(): string[] {
    return this.app.revisions.listPaths();
  }

  listRevisions(path: string): readonly FileRevision[] {
    return this.app.revisions.listRevisions(path);
  }

  private onFileChanged(file: unknown): void {
    if (file instanceof TFile) void this.snapshotFile(file);
  }

  private cleanup(): void {
    const cutoff = new Date(Date.now() - this.options.keepDays * 24 * 60 * 60 * 1000);
    this.app.revisions.pruneOlderThan(cutoff);
  }
}

class FileRecoveryModal extends ConfirmationModal {
  private selectedPath = "";
  private selectedRevision: FileRevision | null = null;
  private readonly sidebarEl = document.createElement("div");
  private readonly previewEl = document.createElement("textarea");

  constructor(
    app: App,
    readonly controller: FileRecoveryController,
    initialPath?: string,
  ) {
    super(app);
    this.selectedPath = initialPath ?? controller.listPaths()[0] ?? "";
    this.setTitle("File recovery");
    this.modalEl.classList.add("mod-sync-history", "mod-sidebar-layout");
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    this.contentEl.replaceChildren();
    const buttonEl = this.buttonContainerEl;
    buttonEl.replaceChildren();
    const layoutEl = document.createElement("div");
    layoutEl.className = "sync-history-content";
    this.sidebarEl.className = "sync-history-sidebar";
    const contentEl = document.createElement("div");
    contentEl.className = "sync-history-content-container";
    this.previewEl.className = "file-recovery-text";
    this.previewEl.readOnly = true;
    contentEl.appendChild(this.previewEl);
    layoutEl.append(this.sidebarEl, contentEl);
    this.contentEl.appendChild(layoutEl);

    this.renderSidebar();
    this.renderPreview();

    const restoreButton = document.createElement("button");
    restoreButton.className = "mod-cta";
    restoreButton.textContent = "Restore";
    restoreButton.disabled = !this.selectedRevision;
    restoreButton.addEventListener("click", () => void this.restoreSelected());
    const closeButton = document.createElement("button");
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", () => this.close());
    buttonEl.append(closeButton, restoreButton);
  }

  private renderSidebar(): void {
    this.sidebarEl.replaceChildren();
    const paths = this.controller.listPaths();
    if (paths.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "file-recovery-list-item-container";
      emptyEl.textContent = "No recovery snapshots";
      this.sidebarEl.appendChild(emptyEl);
      return;
    }

    for (const path of paths) {
      const pathEl = document.createElement("div");
      pathEl.className = "file-recovery-list-item-container";
      pathEl.classList.toggle("is-active", path === this.selectedPath);
      pathEl.textContent = path;
      pathEl.addEventListener("click", () => {
        this.selectedPath = path;
        this.selectedRevision = this.controller.listRevisions(path)[0] ?? null;
        this.render();
      });
      this.sidebarEl.appendChild(pathEl);
      if (path !== this.selectedPath) continue;
      for (const revision of this.controller.listRevisions(path)) {
        const revisionEl = document.createElement("div");
        revisionEl.className = "file-recovery-list-item-container mod-revision";
        revisionEl.classList.toggle("is-active", revision.id === this.selectedRevision?.id);
        revisionEl.textContent = `${new Date(revision.createdAt).toLocaleString()} (${revision.source})`;
        revisionEl.addEventListener("click", (event) => {
          event.stopPropagation();
          this.selectedRevision = revision;
          this.render();
        });
        this.sidebarEl.appendChild(revisionEl);
      }
    }
    if (!this.selectedRevision && this.selectedPath)
      this.selectedRevision = this.controller.listRevisions(this.selectedPath)[0] ?? null;
  }

  private renderPreview(): void {
    this.previewEl.value = this.selectedRevision?.content ?? "";
  }

  private async restoreSelected(): Promise<void> {
    if (!this.selectedRevision) return;
    await this.controller.restore(this.selectedPath, this.selectedRevision);
    this.close();
  }
}

class FileRecoverySettingTab implements SettingTab {
  readonly id = "file-recovery";
  readonly name = "File recovery";
  readonly icon = "lucide-history";
  readonly section = "core-plugins" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");

  constructor(
    readonly app: App,
    readonly controller: FileRecoveryController,
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
    this.containerEl.className = "vertical-tab-content file-recovery-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const group = new SettingGroup(this.containerEl).setHeading("File recovery");
    new Setting(group.itemsEl)
      .setName("Snapshot interval")
      .setDesc("How often to save a recovery snapshot, in minutes.")
      .addText((text) =>
        text.setValue(String(this.controller.options.intervalMinutes)).onChange((value) => {
          void this.controller.saveOptions({ intervalMinutes: Number(value) });
        }),
      );
    new Setting(group.itemsEl)
      .setName("Keep snapshots")
      .setDesc("Delete recovery snapshots older than this many days.")
      .addText((text) =>
        text.setValue(String(this.controller.options.keepDays)).onChange((value) => {
          void this.controller.saveOptions({ keepDays: Number(value) });
        }),
      );
    new Setting(group.itemsEl)
      .setName("Open recovery")
      .setDesc("Browse and restore available snapshots.")
      .addButton((button) =>
        button.setButtonText("Open").onClick(() => this.controller.openModal()),
      );
  }

  hide(): void {
    this.containerEl.remove();
  }
}

export function createFileRecoveryPluginDefinition(): InternalPluginDefinition {
  let controller: FileRecoveryController | null = null;
  return {
    id: "file-recovery",
    name: "File recovery",
    description: "Keep local snapshots and restore previous file versions.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new FileRecoveryController(app);
      plugin.instance = controller;
      plugin.registerGlobalCommand({
        id: "file-recovery:open",
        name: "Open file recovery",
        icon: "lucide-history",
        callback: () => controller?.openModal(app.workspace.activeEditor?.file?.path),
      });
    },
    async onEnable(_app: App, plugin: InternalPluginWrapper) {
      await controller?.onEnable(plugin);
    },
  };
}

function normalizeOptions(raw: Partial<FileRecoveryOptions> | null): FileRecoveryOptions {
  const intervalMinutes = Number(raw?.intervalMinutes ?? DEFAULT_OPTIONS.intervalMinutes);
  const keepDays = Number(raw?.keepDays ?? DEFAULT_OPTIONS.keepDays);
  return {
    intervalMinutes:
      Number.isFinite(intervalMinutes) && intervalMinutes > 0
        ? intervalMinutes
        : DEFAULT_OPTIONS.intervalMinutes,
    keepDays: Number.isFinite(keepDays) && keepDays > 0 ? keepDays : DEFAULT_OPTIONS.keepDays,
  };
}

function isSupported(file: TFile): boolean {
  return SUPPORTED_EXTENSIONS.has(file.extension.toLowerCase());
}
