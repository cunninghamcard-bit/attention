import type { App } from "../app/App";
import type { InternalPluginDefinition } from "../plugin/InternalPlugin";
import type { InternalPluginWrapper } from "../plugin/InternalPluginWrapper";
import { Modal } from "../ui/Modal";
import { Notice } from "../ui/Notice";
import { TFile } from "../vault/TAbstractFile";
import type { PublishedFileRecord } from "../publish/PublishService";

interface PublishPluginData {
  siteId: string;
  host: string;
  included: string[];
  excluded: string[];
  published: Record<string, PublishedSnapshot>;
}

interface PublishedSnapshot {
  hash: string;
  size: number;
  publishedAt: string;
  url?: string;
}

interface PublishCandidate {
  file: TFile;
  content: string;
  hash: string;
  size: number;
}

interface PublishScanResult {
  uploads: PublishCandidate[];
  removes: PublishedFileRecord[];
  unchanged: PublishedFileRecord[];
}

const DEFAULT_DATA: PublishPluginData = {
  siteId: "local",
  host: "https://publish.local",
  included: [],
  excluded: [],
  published: {},
};

const SPECIAL_FILES = new Set(["obsidian.css", "publish.css", "favicon.ico", "publish.js"]);
const SUPPORTED_EXTENSIONS = new Set([
  "md",
  "canvas",
  "base",
  "css",
  "js",
  "html",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "ico",
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "mp4",
  "mov",
  "webm",
]);

export class PublishController {
  data: PublishPluginData = structuredClone(DEFAULT_DATA);
  plugin: InternalPluginWrapper | null = null;

  constructor(readonly app: App) {}

  async onEnable(plugin: InternalPluginWrapper): Promise<void> {
    this.plugin = plugin;
    this.data = normalizePublishData(await plugin.loadData<Partial<PublishPluginData>>());
    this.ensureRuntimeSite();
  }

  openChanges(): void {
    new PublishChangesModal(this.app, this).open();
  }

  async publishActiveFile(): Promise<void> {
    const file = this.app.workspace.activeEditor?.file;
    if (!file) {
      new Notice("No active file to publish");
      return;
    }
    if (!isSupported(file)) {
      new Notice(`${file.path} is not publishable`);
      return;
    }
    this.includePath(file.path);
    const content = await this.app.vault.read(file);
    const candidate: PublishCandidate = {
      file,
      content,
      hash: hashContent(content),
      size: content.length,
    };
    this.publishCandidates([candidate], []);
    await this.persist();
    new Notice(`Published ${file.path}`);
  }

  openActiveFileOnSite(): void {
    const file = this.app.workspace.activeEditor?.file;
    if (!file) return;
    const record = this.app.publish.getPublishedFile(this.data.siteId, file.path);
    if (!record) {
      new Notice(`${file.path} has not been published`);
      return;
    }
    window.open(record.url ?? this.urlForPath(file.path), "_blank");
  }

  async scanForChanges(): Promise<PublishScanResult> {
    this.ensureRuntimeSite();
    const current = new Map<string, PublishCandidate>();
    for (const file of this.app.vault.getAllLoadedFiles()) {
      if (!(file instanceof TFile) || !isSupported(file)) continue;
      const content = await this.app.vault.read(file);
      if (!this.shouldPublish(file, content)) continue;
      current.set(file.path, {
        file,
        content,
        hash: hashContent(content),
        size: content.length,
      });
    }

    const published = new Map(this.app.publish.listPublishedFiles(this.data.siteId).map((record) => [record.path, record]));
    const uploads: PublishCandidate[] = [];
    const removes: PublishedFileRecord[] = [];
    const unchanged: PublishedFileRecord[] = [];

    for (const candidate of current.values()) {
      const existing = published.get(candidate.file.path);
      if (!existing || existing.hash !== candidate.hash) uploads.push(candidate);
      else unchanged.push(existing);
    }

    for (const record of published.values()) {
      if (!current.has(record.path)) removes.push(record);
    }

    return { uploads, removes, unchanged };
  }

  async publishChanges(scan?: PublishScanResult): Promise<void> {
    const result = scan ?? await this.scanForChanges();
    if (result.uploads.length === 0 && result.removes.length === 0) {
      new Notice("No publish changes");
      return;
    }
    const paths = [...result.uploads.map((candidate) => candidate.file.path), ...result.removes.map((record) => record.path)];
    const job = this.app.publish.createJob(this.data.siteId, paths);
    this.publishCandidates(result.uploads, result.removes);
    this.app.publish.completeJob(job.id);
    await this.persist();
    new Notice(`Published ${paths.length} change${paths.length === 1 ? "" : "s"}`);
  }

  setHost(host: string): void {
    this.data.host = host.trim() || DEFAULT_DATA.host;
    this.ensureRuntimeSite();
    void this.persist();
  }

  includePath(path: string): void {
    this.data.excluded = this.data.excluded.filter((item) => item !== path);
    if (!this.data.included.includes(path)) this.data.included.push(path);
  }

  excludePath(path: string): void {
    this.data.included = this.data.included.filter((item) => item !== path);
    if (!this.data.excluded.includes(path)) this.data.excluded.push(path);
  }

  async savePathLists(included: string[], excluded: string[]): Promise<void> {
    this.data.included = normalizePathList(included);
    this.data.excluded = normalizePathList(excluded).filter((path) => !this.data.included.includes(path));
    this.ensureRuntimeSite();
    await this.persist();
  }

  urlForPath(path: string): string {
    return `${this.data.host.replace(/\/+$/, "")}/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  private publishCandidates(uploads: PublishCandidate[], removes: PublishedFileRecord[]): void {
    for (const candidate of uploads) {
      const record: PublishedFileRecord = {
        siteId: this.data.siteId,
        path: candidate.file.path,
        hash: candidate.hash,
        size: candidate.size,
        publishedAt: new Date().toISOString(),
        url: this.urlForPath(candidate.file.path),
      };
      this.data.published[candidate.file.path] = {
        hash: record.hash,
        size: record.size,
        publishedAt: record.publishedAt,
        url: record.url,
      };
      this.app.publish.recordPublishedFile(record);
    }

    for (const record of removes) {
      delete this.data.published[record.path];
      this.app.publish.removePublishedFile(record.siteId, record.path);
    }
  }

  private shouldPublish(file: TFile, content: string): boolean {
    if (this.data.excluded.includes(file.path)) return false;
    if (this.data.included.includes(file.path)) return true;
    const flag = readPublishFlag(content);
    if (flag !== null) return flag;
    return SPECIAL_FILES.has(file.path);
  }

  private ensureRuntimeSite(): void {
    this.app.publish.registerSite({
      id: this.data.siteId,
      name: "Local publish site",
      domain: this.data.host,
      vaultId: "local",
    });
    for (const [path, snapshot] of Object.entries(this.data.published)) {
      this.app.publish.recordPublishedFile({
        siteId: this.data.siteId,
        path,
        hash: snapshot.hash,
        size: snapshot.size,
        publishedAt: snapshot.publishedAt,
        url: snapshot.url ?? this.urlForPath(path),
      });
    }
  }

  private async persist(): Promise<void> {
    await this.plugin?.saveData(this.data);
  }
}

class PublishChangesModal extends Modal {
  private scan: PublishScanResult | null = null;
  private scanning = false;

  constructor(app: App, readonly controller: PublishController) {
    super(app);
    this.setTitle("Publish changes");
    this.modalEl.classList.add("mod-publish");
  }

  onOpen(): void {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    this.scanning = true;
    this.render();
    this.scan = await this.controller.scanForChanges();
    this.scanning = false;
    this.render();
  }

  private render(): void {
    this.contentEl.replaceChildren();
    const buttonEl = this.ensureButtonContainer();
    buttonEl.replaceChildren();

    this.renderSiteSection();
    if (this.scanning) {
      const loadingEl = document.createElement("div");
      loadingEl.className = "publish-section";
      loadingEl.textContent = "Scanning publish changes...";
      this.contentEl.appendChild(loadingEl);
    } else if (this.scan) {
      this.renderFileSection("Files to publish", this.scan.uploads.map((candidate) => candidate.file.path), "publish-upload-item");
      this.renderFileSection("Files to remove", this.scan.removes.map((record) => record.path), "publish-remove-item");
      this.renderFileSection("Unchanged", this.scan.unchanged.map((record) => record.path), "publish-unchanged-item");
    }

    const closeButton = document.createElement("button");
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", () => this.close());
    const refreshButton = document.createElement("button");
    refreshButton.textContent = "Refresh";
    refreshButton.addEventListener("click", () => void this.refresh());
    const publishButton = document.createElement("button");
    publishButton.className = "mod-cta";
    publishButton.textContent = "Publish";
    publishButton.disabled = this.scanning || !this.scan || (this.scan.uploads.length === 0 && this.scan.removes.length === 0);
    publishButton.addEventListener("click", () => void this.publish());
    buttonEl.classList.add("publish-changes-buttons");
    buttonEl.append(closeButton, refreshButton, publishButton);
  }

  private renderSiteSection(): void {
    const sectionEl = document.createElement("div");
    sectionEl.className = "publish-section site-list-container";
    const headerEl = document.createElement("div");
    headerEl.className = "publish-section-header";
    headerEl.textContent = "Site";
    const hostEl = document.createElement("input");
    hostEl.className = "text-component";
    hostEl.value = this.controller.data.host;
    hostEl.addEventListener("change", () => this.controller.setHost(hostEl.value));

    const activeFile = this.app.workspace.activeEditor?.file;
    const activeButton = document.createElement("button");
    activeButton.textContent = activeFile ? `Include ${activeFile.path}` : "No active file";
    activeButton.disabled = !activeFile;
    activeButton.addEventListener("click", () => {
      if (!activeFile) return;
      this.controller.includePath(activeFile.path);
      void this.controller.publishActiveFile().then(() => this.refresh());
    });

    const listWrapperEl = document.createElement("div");
    listWrapperEl.className = "publish-path-lists";
    const includedEl = this.createPathTextarea("Included", this.controller.data.included);
    const excludedEl = this.createPathTextarea("Excluded", this.controller.data.excluded);
    const saveListsButton = document.createElement("button");
    saveListsButton.textContent = "Save lists";
    saveListsButton.addEventListener("click", () => {
      void this.controller
        .savePathLists(splitPaths(includedEl.value), splitPaths(excludedEl.value))
        .then(() => this.refresh());
    });
    listWrapperEl.append(includedEl, excludedEl, saveListsButton);
    sectionEl.append(headerEl, hostEl, activeButton, listWrapperEl);
    this.contentEl.appendChild(sectionEl);
  }

  private createPathTextarea(label: string, values: string[]): HTMLTextAreaElement {
    const inputEl = document.createElement("textarea");
    inputEl.className = "publish-path-list";
    inputEl.placeholder = `${label} paths, one per line`;
    inputEl.value = values.join("\n");
    return inputEl;
  }

  private renderFileSection(title: string, paths: string[], itemClass: string): void {
    const sectionEl = document.createElement("div");
    sectionEl.className = "publish-section";
    const headerEl = document.createElement("div");
    headerEl.className = "publish-section-header";
    headerEl.textContent = `${title} (${paths.length})`;
    const listEl = document.createElement("div");
    listEl.className = "publish-change-list";
    if (paths.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "publish-empty";
      emptyEl.textContent = "No files";
      listEl.appendChild(emptyEl);
    }
    for (const path of paths) {
      const itemEl = document.createElement("div");
      itemEl.className = itemClass;
      itemEl.textContent = path;
      listEl.appendChild(itemEl);
    }
    sectionEl.append(headerEl, listEl);
    this.contentEl.appendChild(sectionEl);
  }

  private async publish(): Promise<void> {
    if (!this.scan) return;
    await this.controller.publishChanges(this.scan);
    this.close();
  }
}

export function createPublishPluginDefinition(): InternalPluginDefinition {
  let controller: PublishController | null = null;
  return {
    id: "publish",
    name: "Publish",
    description: "Scan and publish selected vault files to a local publish site model.",
    defaultOn: false,
    init(app: App, plugin: InternalPluginWrapper) {
      controller = new PublishController(app);
      plugin.instance = controller;
      plugin.registerRibbonItem("Open publish changes", "lucide-send", () => controller?.openChanges());
      plugin.registerGlobalCommand({
        id: "publish:view-changes",
        name: "View publish changes",
        icon: "lucide-send",
        callback: () => controller?.openChanges(),
      });
      plugin.registerGlobalCommand({
        id: "publish:publish-file",
        name: "Publish current file",
        icon: "lucide-upload-cloud",
        checkCallback: (checking) => {
          const file = app.workspace.activeEditor?.file;
          const available = !!file && isSupported(file);
          if (!checking && available) void controller?.publishActiveFile();
          return available;
        },
      });
      plugin.registerGlobalCommand({
        id: "publish:open-in-live-site",
        name: "Open current file in live site",
        icon: "lucide-external-link",
        checkCallback: (checking) => {
          const file = app.workspace.activeEditor?.file;
          const available = !!file && !!controller?.app.publish.getPublishedFile(controller.data.siteId, file.path);
          if (!checking && available) controller?.openActiveFileOnSite();
          return available;
        },
      });
    },
    async onEnable(_app: App, plugin: InternalPluginWrapper) {
      await controller?.onEnable(plugin);
    },
  };
}

function normalizePublishData(raw: Partial<PublishPluginData> | null): PublishPluginData {
  return {
    siteId: typeof raw?.siteId === "string" && raw.siteId.trim() ? raw.siteId.trim() : DEFAULT_DATA.siteId,
    host: typeof raw?.host === "string" && raw.host.trim() ? raw.host.trim() : DEFAULT_DATA.host,
    included: normalizePathList(raw?.included),
    excluded: normalizePathList(raw?.excluded),
    published: typeof raw?.published === "object" && raw.published ? { ...raw.published } : {},
  };
}

function normalizePathList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function splitPaths(value: string): string[] {
  return value.split(/\r?\n/).map((path) => path.trim()).filter(Boolean);
}

function isSupported(file: TFile): boolean {
  return SPECIAL_FILES.has(file.path) || SUPPORTED_EXTENSIONS.has(file.extension.toLowerCase());
}

function readPublishFlag(content: string): boolean | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const line = match[1].split(/\r?\n/).find((item) => /^publish\s*:/.test(item.trim().toLowerCase()));
  if (!line) return null;
  const value = line.slice(line.indexOf(":") + 1).trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  if (value === "true" || value === "yes") return true;
  if (value === "false" || value === "no") return false;
  return null;
}

function hashContent(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
