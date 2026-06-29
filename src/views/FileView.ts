import { ItemView } from "./ItemView";
import { Menu } from "../ui/Menu";
import { TFile, type TAbstractFile, type TFolder } from "../vault/TAbstractFile";
import type { InternalViewStateResult, ViewStateResult } from "./View";
import { EmptyView } from "./EmptyView";
import { Notice } from "../ui/Notice";

export type TFileLike = TFile;

function toFile(value: unknown, view: FileView): TFile | null {
  if (!value) return null;
  if (value instanceof TFile) return view.app.vault.getFileByPath(value.path) ?? value;
  if (typeof value === "string") return view.app.vault.getFileByPath(value);
  if (typeof value === "object" && "path" in value && typeof value.path === "string") return view.app.vault.getFileByPath(value.path);
  return null;
}

export class FileView extends ItemView {
  file: TFile | null = null;
  allowNoFile = false;
  navigation = true;

  override async onOpen(): Promise<void> {
    await super.onOpen();
    this.registerEvent(this.app.vault.on<[TFile, string]>("rename", (file, oldPath) => {
      if (file === this.file) void this.onRename(file, oldPath);
    }));
    this.registerEvent(this.app.vault.on<[TAbstractFile]>("delete", (file) => {
      void this.onDelete(file);
    }));
  }

  getDisplayText(): string {
    return this.file?.basename ?? "No file";
  }

  override updateHeader(): void {
    super.updateHeader();
    this.renderBreadcrumbs();
  }

  async openFile(file: TFile, state?: unknown): Promise<void> {
    this.file = file;
    await this.setState(state ?? { file });
  }

  canAcceptExtension(_extension: string): boolean {
    return false;
  }

  override onPaneMenu(menu: Menu, source?: string): void {
    this.onFilePaneMenu(menu, source);
    this.triggerFileMenu(menu, source);
  }

  protected onFilePaneMenu(menu: Menu, source?: string): void {
    super.onPaneMenu(menu, source);
  }

  override async onClose(): Promise<void> {
    this.contentEl.empty();
    await this.loadFile(null);
  }

  async loadFile(file: TFile | null): Promise<boolean> {
    const previousFile = this.file;
    if (previousFile === file) return false;
    if (previousFile) await this.onUnloadFile(previousFile);
    this.file = null;
    if (file) {
      try {
        this.file = file;
        await this.onLoadFile(file);
      } catch (error) {
        this.file = null;
        new Notice(`Failed to load file: ${file.path}`);
        console.error(error);
      }
    }
    this.updateHeader();
    this.workspaceEventsAfterFileChange();
    return true;
  }

  async onLoadFile(_file: TFile): Promise<void> {}
  async onUnloadFile(_file: TFile): Promise<void> {}
  async onRename(file: TFile, _oldPath?: string): Promise<void> {
    if (file !== this.file) return;
    this.updateHeader();
    this.app.workspace.onLayoutChange();
    this.leaf.updateHeader();
  }

  async onDelete(file: TAbstractFile): Promise<void> {
    if (file !== this.file) return;
    if (this.allowNoFile) await this.loadFile(null);
    else {
      const leaf = this.leaf;
      if (leaf.history.backHistory.length > 0) await leaf.history.back();
      else await leaf.open(null);
      if (leaf.view instanceof EmptyView && leaf.parent?.children.length && leaf.parent.children.length > 1) leaf.detach();
    }
    this.app.workspace.onLayoutChange();
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    const previousPath = this.file?.path ?? null;
    await super.setState(state, result);
    let nextFile = this.file;
    let hasFileState = false;
    if (state && typeof state === "object" && "file" in state) {
      hasFileState = true;
      nextFile = toFile((state as { file?: unknown }).file, this);
    }
    const changedFile = hasFileState ? await this.loadFile(nextFile) : false;
    const nextPath = this.file?.path ?? null;
    const internalResult = result as InternalViewStateResult | undefined;
    if (changedFile || previousPath !== nextPath) {
      if (result) result.history = true;
      if (internalResult) internalResult.layout = true;
    }
    if (hasFileState && !this.file && !this.allowNoFile && internalResult) {
      internalResult.close = true;
    }
    const isSync = state && typeof state === "object" && Boolean((state as { sync?: unknown }).sync);
    if (internalResult && state && typeof state === "object" && !isSync && (internalResult.layout || internalResult.history)) {
      internalResult.done = () => this.syncState();
    }
  }

  getState(): Record<string, unknown> {
    return this.file ? { file: this.file.path } : {};
  }

  protected workspaceEventsAfterFileChange(): void {
    if (this.leaf === this.app.workspace.activeLeaf) this.app.workspace.requestActiveLeafEvents();
    this.updateHeader();
  }

  protected triggerFileMenu(menu: Menu, source?: string): void {
    const file = this.file;
    if (!file) return;
    this.app.workspace.trigger("file-menu", menu, file, source ?? "tab-header", this.leaf);
  }

  protected renderBreadcrumbs(): void {
    this.titleParentEl.replaceChildren();
    const parentPath = this.file?.parent?.path;
    if (!parentPath || parentPath === "/") return;
    const parts = parentPath.split("/").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const folderPath = parts.slice(0, index + 1).join("/");
      const breadcrumbEl = document.createElement("span");
      breadcrumbEl.className = "view-header-breadcrumb";
      breadcrumbEl.textContent = parts[index] ?? "";
      breadcrumbEl.addEventListener("click", (event) => {
        event.preventDefault();
        void this.revealBreadcrumbFolder(folderPath);
      });
      breadcrumbEl.addEventListener("contextmenu", (event) => this.openBreadcrumbFolderMenu(folderPath, breadcrumbEl, event));
      this.app.dragManager.handleDrag(breadcrumbEl, (event) => {
        const folder = this.app.vault.getFolderByPath(folderPath);
        return folder ? this.app.dragManager.dragFolder(event, folder, "file-explorer", [breadcrumbEl]) : null;
      });
      const separatorEl = document.createElement("span");
      separatorEl.className = "view-header-breadcrumb-separator";
      separatorEl.textContent = "/";
      this.titleParentEl.append(breadcrumbEl, separatorEl);
    }
  }

  private async revealBreadcrumbFolder(folderPath: string): Promise<void> {
    const folder = this.app.vault.getFolderByPath(folderPath);
    if (!folder) return;
    const leaf = await this.app.workspace.ensureSideLeaf("file-explorer", "left", { reveal: true });
    const view = leaf.view as unknown as { revealFile?: (target: TFolder) => void };
    view.revealFile?.(folder);
  }

  private openBreadcrumbFolderMenu(folderPath: string, parentEl: HTMLElement, event: MouseEvent): void {
    event.preventDefault();
    const folder = this.app.vault.getFolderByPath(folderPath);
    if (!folder) return;
    const menu = new Menu(parentEl.ownerDocument).addSections(["title", "open", "action-primary", "action", "info", "info.copy", "view", "system", "", "danger"]);
    menu.addItem((item) => item
      .setSection("action-primary")
      .setTitle("New note")
      .setIcon("lucide-file-plus")
      .onClick(() => void this.createBreadcrumbNote(folder)));
    menu.addItem((item) => item
      .setSection("action-primary")
      .setTitle("New folder")
      .setIcon("lucide-folder-plus")
      .onClick(() => void this.app.fileManager.createNewFolder(folder)));
    menu.setParentElement(parentEl);
    this.app.workspace.trigger("file-menu", menu, folder, "file-explorer-context-menu", this.leaf);
    menu.showAtMouseEvent(event);
  }

  private async createBreadcrumbNote(folder: TFolder): Promise<void> {
    const file = await this.app.fileManager.createNewMarkdownFile(folder);
    await this.app.workspace.getLeaf(false).openFile(file, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
  }

  protected syncState(): void {
    const group = this.leaf.group;
    if (!group) return;
    for (const leaf of this.app.workspace.getGroupLeaves(group)) {
      if (leaf === this.leaf) continue;
      const view = leaf.view;
      if (view instanceof FileView) void view.receiveSyncState(this);
    }
  }

  protected async receiveSyncState(source: FileView): Promise<void> {
    if (!source.file || source.file === this.file) return;
    await this.leaf.openFile(source.file);
  }
}
