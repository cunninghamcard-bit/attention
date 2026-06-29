import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { Modal } from "../ui/Modal";
import { Notice } from "../ui/Notice";
import { Setting, SettingGroup } from "../ui/Setting";
import { ItemView } from "../views/ItemView";
import type { WorkspaceLeaf } from "../workspace/WorkspaceLeaf";
import { setIcon } from "../ui/Icon";

interface SyncPluginData {
  paused: boolean;
  endpointId: string;
  remoteUrl: string;
  authType: "none" | "token" | "account";
  includePatterns: string[];
  excludePatterns: string[];
  log: SyncLogEntry[];
}

interface SyncLogEntry {
  time: string;
  level: "info" | "warning" | "error";
  message: string;
}

type SyncUiState = "uninitialized" | "disconnected" | "error" | "paused" | "syncing" | "synced";

const DEFAULT_SYNC_DATA: SyncPluginData = {
  paused: false,
  endpointId: "local-sync",
  remoteUrl: "local://sync",
  authType: "none",
  includePatterns: ["**/*"],
  excludePatterns: [".trash/**", ".obsidian/workspace*"],
  log: [],
};

export class SyncController {
  data: SyncPluginData = structuredClone(DEFAULT_SYNC_DATA);
  plugin: InternalPluginWrapper | null = null;
  private statusBarEl: HTMLElement | null = null;

  constructor(readonly app: App) {}

  async onEnable(plugin: InternalPluginWrapper): Promise<void> {
    this.plugin = plugin;
    this.data = normalizeSyncData(await plugin.loadData<Partial<SyncPluginData>>());
    this.ensureRemotePlan();
    plugin.addSettingTab(new SyncSettingTab(this.app, this));
    plugin.registerEvent(this.app.workspace.on("sync-start", () => this.handleRuntimeStatus("Sync started")));
    plugin.registerEvent(this.app.workspace.on("sync-stop", () => this.handleRuntimeStatus("Sync stopped")));
    plugin.registerEvent(this.app.workspace.on("sync-complete", () => this.handleRuntimeStatus("Sync completed")));
    plugin.registerEvent(this.app.workspace.on("sync-conflict", () => this.handleRuntimeStatus("Sync conflict detected", "warning")));
    this.statusBarEl = plugin.statusBarEl;
    this.statusBarEl?.addEventListener("click", () => this.openSyncView());
    plugin.register(() => {
      this.statusBarEl = null;
    });
    this.updateStatusBar();
  }

  getState(): SyncUiState {
    const status = this.app.sync.getStatus();
    if (!this.data.remoteUrl) return "uninitialized";
    if (this.data.paused) return "paused";
    if (status.running) return "syncing";
    if (status.conflicts > 0) return "error";
    if (status.lastSyncAt) return "synced";
    return "disconnected";
  }

  getStateLabel(): string {
    const state = this.getState();
    if (state === "uninitialized") return "Not configured";
    if (state === "disconnected") return "Disconnected";
    if (state === "error") return "Sync error";
    if (state === "paused") return "Paused";
    if (state === "syncing") return "Syncing";
    return "Synced";
  }

  async setup(): Promise<void> {
    const next = window.prompt("Remote sync endpoint", this.data.remoteUrl);
    if (next == null) return;
    await this.saveOptions({ remoteUrl: next.trim() || DEFAULT_SYNC_DATA.remoteUrl });
    this.log("info", `Sync endpoint set to ${this.data.remoteUrl}`);
    new Notice("Sync configured");
  }

  async runOnce(): Promise<void> {
    if (this.data.paused) {
      this.log("warning", "Sync is paused");
      new Notice("Sync is paused");
      return;
    }
    this.ensureRemotePlan();
    this.log("info", "Manual sync requested");
    await this.app.sync.runOnce();
    this.updateStatusBar();
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.saveOptions({ paused });
    this.log("info", paused ? "Sync paused" : "Sync resumed");
  }

  async saveOptions(options: Partial<SyncPluginData>): Promise<void> {
    this.data = normalizeSyncData({ ...this.data, ...options });
    this.ensureRemotePlan();
    await this.persist();
    this.updateStatusBar();
    this.app.workspace.trigger("sync-settings-change", this.data);
  }

  openSyncView(): void {
    const leaf = this.app.workspace.getLeaf("tab");
    void leaf.setViewState({ type: "sync", active: true });
  }

  openSyncLog(): void {
    new SyncLogModal(this.app, this).open();
  }

  openVersionHistory(): void {
    const file = this.app.workspace.activeEditor?.file;
    if (!file) {
      new Notice("No active file");
      return;
    }
    new SyncVersionHistoryModal(this.app, file.path).open();
  }

  latestLog(): readonly SyncLogEntry[] {
    return this.data.log;
  }

  statusClass(): string {
    const state = this.getState();
    if (state === "synced") return "mod-success";
    if (state === "syncing") return "mod-working mod-spin";
    if (state === "error") return "mod-error";
    return "";
  }

  private handleRuntimeStatus(message: string, level: SyncLogEntry["level"] = "info"): void {
    this.log(level, message);
    this.updateStatusBar();
  }

  private log(level: SyncLogEntry["level"], message: string): void {
    this.data.log = [{ level, message, time: new Date().toISOString() }, ...this.data.log].slice(0, 100);
    void this.persist();
    this.app.workspace.trigger("sync-log-change", this.data.log);
  }

  private ensureRemotePlan(): void {
    if (!this.data.remoteUrl) return;
    this.app.remoteSync.registerEndpoint({
      id: this.data.endpointId,
      name: "Local sync endpoint",
      url: this.data.remoteUrl,
      authType: this.data.authType,
    });
    this.app.remoteSync.setPlan({
      vaultId: "local",
      endpointId: this.data.endpointId,
      includePatterns: [...this.data.includePatterns],
      excludePatterns: [...this.data.excludePatterns],
    });
  }

  private updateStatusBar(): void {
    if (!this.statusBarEl) return;
    this.statusBarEl.replaceChildren();
    this.statusBarEl.classList.remove("mod-success", "mod-working", "mod-error", "mod-spin");
    for (const className of this.statusClass().split(/\s+/).filter(Boolean)) this.statusBarEl.classList.add(className);
    const iconEl = document.createElement("span");
    iconEl.className = "sync-status-icon";
    iconEl.dataset.icon = "lucide-refresh-cw";
    const textEl = document.createElement("span");
    textEl.className = "sync-status-text";
    textEl.textContent = this.getStateLabel();
    this.statusBarEl.title = `Obsidian Sync: ${this.getStateLabel()}`;
    this.statusBarEl.append(iconEl, textEl);
  }

  private async persist(): Promise<void> {
    await this.plugin?.saveData(this.data);
  }
}

class SyncView extends ItemView {
  icon = "lucide-refresh-cw";

  constructor(leaf: WorkspaceLeaf, readonly controller: SyncController) {
    super(leaf);
  }

  getViewType(): string {
    return "sync";
  }

  getDisplayText(): string {
    return "Sync";
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("sync-start", () => this.render()));
    this.registerEvent(this.app.workspace.on("sync-stop", () => this.render()));
    this.registerEvent(this.app.workspace.on("sync-complete", () => this.render()));
    this.registerEvent(this.app.workspace.on("sync-conflict", () => this.render()));
    this.registerEvent(this.app.workspace.on("sync-log-change", () => this.render()));
    this.render();
  }

  private render(): void {
    this.updateHeader();
    this.contentEl.replaceChildren();
    const status = this.app.sync.getStatus();
    const rootEl = document.createElement("div");
    rootEl.className = "sync-view";
    const summaryEl = document.createElement("div");
    summaryEl.className = "sync-status";
    const iconEl = document.createElement("div");
    iconEl.className = `sync-status-icon ${this.controller.statusClass()}`;
    iconEl.dataset.icon = "lucide-refresh-cw";
    const textEl = document.createElement("div");
    textEl.className = "sync-status-message";
    textEl.textContent = this.controller.getStateLabel();
    const metaEl = document.createElement("div");
    metaEl.className = "sync-status-details";
    metaEl.textContent = status.lastSyncAt ? `Last sync ${new Date(status.lastSyncAt).toLocaleString()}` : "No completed sync yet";
    summaryEl.append(iconEl, textEl, metaEl);

    const actionsEl = document.createElement("div");
    actionsEl.className = "sync-view-actions";
    actionsEl.append(
      this.button("Sync now", () => void this.controller.runOnce()),
      this.button(this.controller.data.paused ? "Resume" : "Pause", () => void this.controller.setPaused(!this.controller.data.paused)),
      this.button("Sync log", () => this.controller.openSyncLog()),
    );

    rootEl.append(summaryEl, actionsEl);
    this.renderCounts(rootEl);
    this.renderConflicts(rootEl);
    this.renderLog(rootEl);
    this.contentEl.appendChild(rootEl);
  }

  private renderCounts(parent: HTMLElement): void {
    const status = this.app.sync.getStatus();
    const countsEl = document.createElement("div");
    countsEl.className = "sync-counts";
    countsEl.append(
      this.count("Pending uploads", status.pendingUploads),
      this.count("Pending downloads", status.pendingDownloads),
      this.count("Conflicts", status.conflicts),
    );
    parent.appendChild(countsEl);
  }

  private renderConflicts(parent: HTMLElement): void {
    const sectionEl = document.createElement("div");
    sectionEl.className = "sync-section";
    const headerEl = document.createElement("div");
    headerEl.className = "sync-section-header";
    headerEl.textContent = "Conflicts";
    sectionEl.appendChild(headerEl);
    if (this.app.sync.conflicts.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "sync-empty-state";
      emptyEl.textContent = "No conflicts";
      sectionEl.appendChild(emptyEl);
    }
    for (const conflict of this.app.sync.conflicts) {
      const itemEl = document.createElement("div");
      itemEl.className = "sync-conflict-item";
      itemEl.textContent = `${conflict.path}: ${conflict.reason}`;
      sectionEl.appendChild(itemEl);
    }
    parent.appendChild(sectionEl);
  }

  private renderLog(parent: HTMLElement): void {
    const sectionEl = document.createElement("div");
    sectionEl.className = "sync-section sync-log";
    const headerEl = document.createElement("div");
    headerEl.className = "sync-section-header";
    headerEl.textContent = "Recent log";
    sectionEl.appendChild(headerEl);
    for (const entry of this.controller.latestLog().slice(0, 8)) {
      const itemEl = document.createElement("div");
      itemEl.className = `sync-log-item mod-${entry.level}`;
      itemEl.textContent = `${new Date(entry.time).toLocaleTimeString()} ${entry.message}`;
      sectionEl.appendChild(itemEl);
    }
    parent.appendChild(sectionEl);
  }

  private button(text: string, callback: () => void): HTMLButtonElement {
    const buttonEl = document.createElement("button");
    buttonEl.textContent = text;
    buttonEl.addEventListener("click", callback);
    return buttonEl;
  }

  private count(label: string, value: number): HTMLElement {
    const itemEl = document.createElement("div");
    itemEl.className = "sync-count";
    const valueEl = document.createElement("div");
    valueEl.className = "sync-count-value";
    valueEl.textContent = String(value);
    const labelEl = document.createElement("div");
    labelEl.className = "sync-count-label";
    labelEl.textContent = label;
    itemEl.append(valueEl, labelEl);
    return itemEl;
  }
}

class SyncLogModal extends Modal {
  constructor(app: App, readonly controller: SyncController) {
    super(app);
    this.setTitle("Sync log");
  }

  onOpen(): void {
    this.contentEl.replaceChildren();
    const listEl = document.createElement("div");
    listEl.className = "sync-log";
    for (const entry of this.controller.latestLog()) {
      const itemEl = document.createElement("div");
      itemEl.className = `sync-log-item mod-${entry.level}`;
      itemEl.textContent = `${new Date(entry.time).toLocaleString()} ${entry.message}`;
      listEl.appendChild(itemEl);
    }
    if (this.controller.latestLog().length === 0) listEl.textContent = "No sync log entries";
    this.contentEl.appendChild(listEl);
  }
}

class SyncVersionHistoryModal extends Modal {
  constructor(app: App, readonly path: string) {
    super(app);
    this.setTitle("Version history");
    this.modalEl.classList.add("mod-sync-history");
  }

  onOpen(): void {
    const revisions = this.app.revisions.listRevisions(this.path);
    this.contentEl.replaceChildren();
    const listEl = document.createElement("div");
    listEl.className = "sync-history-content";
    if (revisions.length === 0) {
      listEl.textContent = "No versions for this file";
    }
    for (const revision of revisions) {
      const itemEl = document.createElement("div");
      itemEl.className = "sync-history-item";
      const titleEl = document.createElement("div");
      titleEl.className = "sync-history-title";
      titleEl.textContent = new Date(revision.createdAt).toLocaleString();
      const sourceEl = document.createElement("div");
      sourceEl.className = "sync-history-source";
      sourceEl.textContent = revision.source;
      const previewEl = document.createElement("pre");
      previewEl.className = "sync-history-preview";
      previewEl.textContent = revision.content.slice(0, 800);
      itemEl.append(titleEl, sourceEl, previewEl);
      listEl.appendChild(itemEl);
    }
    this.contentEl.appendChild(listEl);
  }
}

class SyncSettingTab implements SettingTab {
  readonly id = "sync";
  readonly name = "Sync";
  readonly icon = "lucide-refresh-cw";
  readonly section = "core-plugins" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");

  constructor(readonly app: App, readonly controller: SyncController) {
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
    this.containerEl.className = "vertical-tab-content sync-settings";
  }

  display(): void {
    this.containerEl.replaceChildren();
    const group = new SettingGroup(this.containerEl).setHeading("Obsidian Sync");
    new Setting(group.itemsEl)
      .setName("Status")
      .setDesc(this.controller.getStateLabel())
      .addButton((button) => button.setButtonText("Open").onClick(() => this.controller.openSyncView()));
    new Setting(group.itemsEl)
      .setName("Pause sync")
      .setDesc("Temporarily stop sync runs without disabling the core plugin.")
      .addToggle((toggle) => toggle.setValue(this.controller.data.paused).onChange((value) => {
        void this.controller.setPaused(value).then(() => this.display());
      }));
    new Setting(group.itemsEl)
      .setName("Remote endpoint")
      .setDesc("Local reconstruction of the remote sync endpoint Obsidian stores for the vault.")
      .addText((text) => text.setValue(this.controller.data.remoteUrl).onChange((value) => {
        void this.controller.saveOptions({ remoteUrl: value });
      }));
    new Setting(group.itemsEl)
      .setName("Included patterns")
      .setDesc("Glob patterns included in the sync plan.")
      .addText((text) => text.setValue(this.controller.data.includePatterns.join(", ")).onChange((value) => {
        void this.controller.saveOptions({ includePatterns: splitPatternList(value) });
      }));
    new Setting(group.itemsEl)
      .setName("Excluded patterns")
      .setDesc("Glob patterns excluded from the sync plan.")
      .addText((text) => text.setValue(this.controller.data.excludePatterns.join(", ")).onChange((value) => {
        void this.controller.saveOptions({ excludePatterns: splitPatternList(value) });
      }));
    new Setting(group.itemsEl)
      .setName("Manual sync")
      .setDesc("Run one local sync cycle through the SyncEngine.")
      .addButton((button) => button.setButtonText("Sync now").onClick(() => void this.controller.runOnce().then(() => this.display())));
    new Setting(group.itemsEl)
      .setName("Sync log")
      .setDesc("Open the local sync event log.")
      .addButton((button) => button.setButtonText("Open log").onClick(() => this.controller.openSyncLog()));
  }

  hide(): void {
    this.containerEl.remove();
  }
}

export function createSyncPluginDefinition(): InternalPluginDefinition {
  let controller: SyncController | null = null;
  return {
    id: "sync",
    name: "Sync",
    description: "Status, settings, log, and view shell for Obsidian Sync.",
    defaultOn: true,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new SyncController(app);
      plugin.instance = controller;
      plugin.registerStatusBarItem();
      plugin.registerViewType("sync", (leaf) => new SyncView(leaf, controller as SyncController));
      plugin.registerGlobalCommand({
        id: "sync:setup",
        name: "Set up Obsidian Sync",
        icon: "lucide-refresh-cw",
        callback: () => void controller?.setup(),
      });
      plugin.registerGlobalCommand({
        id: "sync:view-version-history",
        name: "View version history",
        icon: "lucide-history",
        checkCallback: (checking) => {
          const available = !!app.workspace.activeEditor?.file;
          if (!checking && available) controller?.openVersionHistory();
          return available;
        },
      });
      plugin.registerGlobalCommand({
        id: "sync:open-sync-view",
        name: "Open Sync view",
        icon: "lucide-refresh-cw",
        callback: () => controller?.openSyncView(),
      });
      plugin.registerGlobalCommand({
        id: "sync:open-sync-log",
        name: "Open Sync log",
        icon: "lucide-list",
        callback: () => controller?.openSyncLog(),
      });
    },
    async onEnable(_app: App, plugin: InternalPluginWrapper) {
      await controller?.onEnable(plugin);
    },
  };
}

function normalizeSyncData(raw: Partial<SyncPluginData> | null): SyncPluginData {
  const authType = raw?.authType === "token" || raw?.authType === "account" ? raw.authType : "none";
  return {
    paused: Boolean(raw?.paused),
    endpointId: typeof raw?.endpointId === "string" && raw.endpointId.trim() ? raw.endpointId.trim() : DEFAULT_SYNC_DATA.endpointId,
    remoteUrl: typeof raw?.remoteUrl === "string" ? raw.remoteUrl : DEFAULT_SYNC_DATA.remoteUrl,
    authType,
    includePatterns: normalizePatterns(raw?.includePatterns, DEFAULT_SYNC_DATA.includePatterns),
    excludePatterns: normalizePatterns(raw?.excludePatterns, DEFAULT_SYNC_DATA.excludePatterns),
    log: Array.isArray(raw?.log) ? raw.log.filter(isLogEntry).slice(0, 100) : [],
  };
}

function normalizePatterns(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const normalized = value.map((item) => String(item).trim()).filter(Boolean);
  return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
}

function splitPatternList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function isLogEntry(value: unknown): value is SyncLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as SyncLogEntry;
  return typeof entry.time === "string" && typeof entry.message === "string" && ["info", "warning", "error"].includes(entry.level);
}
