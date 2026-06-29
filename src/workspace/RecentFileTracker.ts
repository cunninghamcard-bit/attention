import type { Vault } from "../vault/Vault";
import { TAbstractFile, TFile } from "../vault/TAbstractFile";
import type { Workspace } from "./Workspace";

export interface RecentFilesOptions {
  showMarkdown?: boolean;
  showNonAttachments?: boolean;
  showNonImageAttachments?: boolean;
  showImages?: boolean;
  maxCount?: number;
}

const collectLimits: Record<RecentFileKind, number> = {
  md: 25,
  canvas: 10,
  image: 10,
  other: 10,
};

const imageExtensions = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
type RecentFileKind = "md" | "canvas" | "image" | "other";

export class RecentFileTracker {
  private lastOpenFiles: string[] = [];

  constructor(readonly workspace: Workspace, readonly vault: Vault) {
    this.vault.on<[TAbstractFile]>("create", (file) => this.addRecentFile(file));
    this.vault.on<[TAbstractFile, string]>("rename", (file, oldPath) => this.onRename(file, oldPath));
  }

  load(paths: string[] | null | undefined): void {
    this.lastOpenFiles = Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string") : [];
  }

  serialize(): string[] {
    return [...this.lastOpenFiles];
  }

  collect(file: TFile): void {
    if (this.lastOpenFiles[0] === file.path) return;
    const counts: Record<RecentFileKind, number> = { md: 0, canvas: 0, image: 0, other: 0 };
    const next = [file.path];
    for (const path of this.lastOpenFiles) {
      if (path === file.path) continue;
      const kind = this.getKind(path);
      if (counts[kind] >= collectLimits[kind]) continue;
      counts[kind] += 1;
      next.push(path);
    }
    this.lastOpenFiles = next;
  }

  onFileOpen(activeFile: TFile | null, previousFile: TFile | null): void {
    if (!this.workspace.isLayoutReady() || !previousFile || previousFile === activeFile) return;
    this.collect(previousFile);
    this.workspace.requestSaveLayout();
  }

  addRecentFile(file: TAbstractFile): void {
    if (!this.workspace.isLayoutReady() || !(file instanceof TFile)) return;
    this.collect(file);
    this.workspace.requestSaveLayout();
  }

  onRename(file: TAbstractFile, oldPath: string): void {
    if (!this.workspace.isLayoutReady() || !(file instanceof TFile)) return;
    this.lastOpenFiles = this.lastOpenFiles.map((path) => path === oldPath ? file.path : path);
    this.workspace.requestSaveLayout();
  }

  getLastOpenFiles(): string[] {
    return this.getRecentFilePaths({
      showMarkdown: true,
      showNonAttachments: true,
      showNonImageAttachments: true,
      showImages: true,
    });
  }

  getRecentFiles(options: RecentFilesOptions = {}): string[] {
    return this.getRecentFilePaths(options);
  }

  getRecentFilePaths(options: RecentFilesOptions = {}): string[] {
    const merged = {
      showMarkdown: true,
      showNonAttachments: true,
      showNonImageAttachments: false,
      showImages: false,
      maxCount: 10,
      ...options,
    };
    const files: string[] = [];
    for (const path of this.lastOpenFiles) {
      const file = this.vault.getFileByPath(path);
      if (!file || !this.isVisibleKind(this.getKind(path), merged)) continue;
      files.push(file.path);
      if (files.length >= merged.maxCount) break;
    }
    return files;
  }

  private isVisibleKind(kind: RecentFileKind, options: Required<RecentFilesOptions>): boolean {
    if (kind === "md") return options.showMarkdown;
    if (kind === "canvas") return options.showNonAttachments;
    if (kind === "image") return options.showImages;
    return options.showNonImageAttachments;
  }

  private getKind(path: string): RecentFileKind {
    const extension = getExtension(path);
    if (extension === "md") return "md";
    if (extension === "canvas" || extension === "base") return "canvas";
    if (imageExtensions.has(extension)) return "image";
    return "other";
  }
}

function getExtension(path: string): string {
  const filename = path.split("/").pop() ?? "";
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index + 1).toLowerCase();
}
