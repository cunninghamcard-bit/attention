import { ItemView } from "../views/ItemView";
import { setIcon } from "../ui/Icon";
import { getFileTypeInfo } from "../ui/FileTypeIcon";
import { setTooltip } from "../ui/Popover";
import { Menu } from "../ui/Menu";
import { TAbstractFile, TFile, TFolder } from "../vault/TAbstractFile";
import { setAllowedDropEffect, type DragDropResult, type DragSource, type FileDragSource, type FilesDragSource, type FolderDragSource } from "../drag/DragManager";
import { getAttachmentFilesFromDataTransfer, hasDataTransferAttachmentFiles } from "../app/AttachmentImport";
import { Platform } from "../platform/Platform";
import { validateRenameName } from "../vault/FileNameValidation";

export class FileExplorerView extends ItemView {
  private collapsedFolders = new Set<string>();
  private selectedPaths = new Set<string>();
  private focusedPath: string | null = null;
  private treeActivePath: string | null = null;
  private folderExpandTimer: ReturnType<typeof setTimeout> | null = null;
  private folderExpandPath: string | null = null;
  private renamingPath: string | null = null;

  getViewType(): string { return "file-explorer"; }
  getDisplayText(): string { return "Files"; }
  getIcon(): string { return "lucide-folder-closed"; }

  async onOpen(): Promise<void> {
    this.contentEl.classList.add("nav-files-container");
    this.contentEl.tabIndex = 0;
    this.contentEl.addEventListener("keydown", (event) => this.onTreeKeydown(event));
    this.installActions();
    this.renderFileTree();
    this.registerEvent(this.app.vault.on("create", () => this.renderFileTree()));
    this.registerEvent(this.app.vault.on("modify", () => this.renderFileTree()));
    this.registerEvent(this.app.vault.on("delete", () => this.renderFileTree()));
    this.registerEvent(this.app.vault.on("rename", () => this.renderFileTree()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.renderFileTree()));
  }

  override async setState(state: unknown): Promise<void> {
    await super.setState(state);
    if (!state || typeof state !== "object") return;
    const newFile = (state as { newFile?: unknown }).newFile;
    if (typeof newFile !== "string") return;
    const file = this.app.vault.getAbstractFileByPath(newFile);
    if (file instanceof TFile || file instanceof TFolder) this.afterCreate(file);
  }

  renderFileTree(): void {
    this.contentEl.replaceChildren();
    const rootEl = document.createElement("div");
    rootEl.className = "nav-files-container node-insert-event";
    rootEl.addEventListener("contextmenu", (event) => {
      if (event.target !== rootEl) return;
      this.openFileContextMenu(this.app.vault.root, event);
    });
    this.installRootDrop(rootEl);
    const headerEl = document.createElement("div");
    headerEl.className = "nav-header";
    headerEl.textContent = "Vault";
    headerEl.addEventListener("contextmenu", (event) => this.openFileContextMenu(this.app.vault.root, event));
    this.installFolderDrop(headerEl, this.app.vault.root, headerEl);
    rootEl.appendChild(headerEl);

    const rootChildrenEl = document.createElement("div");
    rootChildrenEl.className = "nav-folder-children";
    for (const child of this.getRootChildren()) this.renderTreeItem(child, rootChildrenEl);
    rootEl.appendChild(rootChildrenEl);
    this.contentEl.appendChild(rootEl);
  }

  revealFile(file: TAbstractFile): void {
    let parentPath = file.parentPath;
    while (parentPath) {
      this.collapsedFolders.delete(parentPath);
      parentPath = parentPath.includes("/") ? parentPath.slice(0, parentPath.lastIndexOf("/")) : "";
    }
    this.renderFileTree();
    const itemClass = file instanceof TFolder ? "nav-folder" : "nav-file";
    this.contentEl.querySelector<HTMLElement>(`.${itemClass}-title[data-path="${cssEscape(file.path)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  private installActions(): void {
    this.actionsEl.replaceChildren();
    this.actionsEl.append(
      this.createActionButton("New note", "lucide-file-plus", () => void this.createNote(null)),
      this.createActionButton("New folder", "lucide-folder-plus", () => void this.createFolder(null)),
    );
  }

  private renderTreeItem(file: TAbstractFile, parentEl: HTMLElement): void {
    if (file instanceof TFolder) {
      this.renderFolder(file, parentEl);
      return;
    }
    if (file instanceof TFile) this.renderFile(file, parentEl);
  }

  private renderFolder(folder: TFolder, parentEl: HTMLElement): void {
    const folderEl = document.createElement("div");
    folderEl.className = "tree-item nav-folder";
    folderEl.classList.toggle("is-collapsed", this.collapsedFolders.has(folder.path));
    const titleEl = document.createElement("div");
    titleEl.className = "tree-item-self nav-folder-title tappable is-clickable mod-collapsible";
    titleEl.dataset.path = folder.path;
    const collapseEl = document.createElement("div");
    collapseEl.className = "tree-item-icon collapse-icon nav-folder-collapse-indicator";
    collapseEl.classList.toggle("is-collapsed", this.collapsedFolders.has(folder.path));
    setIcon(collapseEl, "right-triangle");
    const folderIconEl = document.createElement("div");
    folderIconEl.className = "tree-item-icon nav-folder-icon";
    setIcon(folderIconEl, this.collapsedFolders.has(folder.path) ? "lucide-folder-closed" : "lucide-folder-open");
    const titleContentEl = document.createElement("div");
    titleContentEl.className = "tree-item-inner nav-folder-title-content";
    titleContentEl.textContent = folder.name;
    titleEl.append(collapseEl, folderIconEl, titleContentEl);
    this.applySelectionState(titleEl, folder);
    this.applyRenameState(titleEl, titleContentEl, folder);
    titleEl.addEventListener("click", (event) => this.onFolderClick(folder, event));
    titleEl.addEventListener("contextmenu", (event) => this.openFileContextMenu(folder, event));
    this.app.dragManager.handleDrag(titleEl, (event) => this.createDragSource(event, folder, titleEl));
    this.installFolderDrop(titleEl, folder, folderEl);
    folderEl.appendChild(titleEl);

    const childrenEl = document.createElement("div");
    childrenEl.className = "tree-item-children nav-folder-children";
    childrenEl.hidden = this.collapsedFolders.has(folder.path);
    for (const child of [...folder.children].sort(sortFiles)) this.renderTreeItem(child, childrenEl);
    folderEl.appendChild(childrenEl);
    parentEl.appendChild(folderEl);
  }

  private renderFile(file: TFile, parentEl: HTMLElement): void {
    const fileEl = document.createElement("div");
    fileEl.className = "tree-item nav-file";
    const titleEl = document.createElement("div");
    titleEl.className = "tree-item-self nav-file-title tappable is-clickable";
    titleEl.dataset.path = file.path;
    titleEl.classList.toggle("is-active", this.app.workspace.activeEditor?.file?.path === file.path);
    titleEl.classList.toggle("is-unsupported", !this.app.viewRegistry.getTypeByExtension(file.extension));
    this.applySelectionState(titleEl, file);
    const iconEl = document.createElement("div");
    iconEl.className = "tree-item-icon nav-file-icon";
    const typeInfo = getFileTypeInfo(file.name, file.extension);
    if (typeInfo.lang) iconEl.dataset.lang = typeInfo.lang;
    setIcon(iconEl, typeInfo.icon);
    titleEl.appendChild(iconEl);
    const titleContentEl = document.createElement("div");
    titleContentEl.className = "tree-item-inner nav-file-title-content";
    titleContentEl.textContent = file.name;
    titleEl.appendChild(titleContentEl);
    this.applyRenameState(titleEl, titleContentEl, file);
    titleEl.addEventListener("click", (event) => this.onFileClick(file, event));
    titleEl.addEventListener("contextmenu", (event) => this.openFileContextMenu(file, event));
    this.app.dragManager.handleDrag(titleEl, (event) => this.createDragSource(event, file, titleEl));
    fileEl.appendChild(titleEl);
    parentEl.appendChild(fileEl);
  }

  private openFileContextMenu(file: TFile | TFolder, event: MouseEvent): void {
    event.preventDefault();
    const selected = this.getSelectedFilesForMenu(file);
    if (selected.length > 1) {
      this.openFilesContextMenu(selected, file, event);
      return;
    }
    const menu = this.buildFileExplorerContextMenu(file);
    this.app.workspace.trigger("file-menu", menu, file, "file-explorer-context-menu", null);
    menu.showAtMouseEvent(event);
  }

  private openFilesContextMenu(files: TAbstractFile[], target: TFile | TFolder, event: MouseEvent): void {
    const selectedRoots = this.filterSelectionRoots(files);
    const menu = new Menu()
      .addSections(["title", "open", "action-primary", "action", "info", "info.copy", "view", "system", "", "danger"])
      .addItem((item) => item
        .setSection("action-primary")
        .setTitle(`New folder with selection (${selectedRoots.length} ${selectedRoots.length === 1 ? "item" : "items"})`)
        .setIcon("lucide-folder-plus")
        .onClick(() => void this.createFolderWithSelection(target, selectedRoots)))
      .addItem((item) => item
        .setSection("danger")
        .setTitle("Delete")
        .setIcon("lucide-trash-2")
        .setWarning(true)
        .onClick(() => void this.deleteFiles(files)));
    this.app.workspace.trigger("files-menu", menu, files, "file-explorer-context-menu", null);
    menu.showAtMouseEvent(event);
  }

  private buildFileExplorerContextMenu(file: TFile | TFolder): Menu {
    const menu = new Menu().addSections(["title", "open", "action-primary", "action", "info", "info.copy", "view", "system", "", "danger"]);
    if (file instanceof TFolder) {
      menu
        .addItem((item) => item.setSection("action-primary").setTitle("New note").setIcon("lucide-edit").onClick(() => void this.createNote(file.isRoot() ? null : file)))
        .addItem((item) => item.setSection("action-primary").setTitle("New folder").setIcon("lucide-folder-open").onClick(() => void this.createFolder(file.isRoot() ? null : file)));
      if (!file.isRoot()) this.addFileExplorerMutationItems(menu, file);
      return menu;
    }
    menu
      .addItem((item) => item.setSection("open").setTitle("Open in new tab").setIcon("lucide-file-plus").onClick(() => {
        void this.app.workspace.getLeaf(true).openFile(file, { active: true });
      }));
    if (Platform.canSplit) {
      menu.addItem((item) => item.setSection("open").setTitle("Open to the right").setIcon("lucide-separator-vertical").onClick(() => {
        void this.app.workspace.getLeaf("split").openFile(file, { active: true });
      }));
    }
    this.addFileExplorerMutationItems(menu, file);
    return menu;
  }

  private addFileExplorerMutationItems(menu: Menu, file: TFile | TFolder): void {
    menu
      .addItem((item) => item.setSection("danger").setTitle("Rename").setIcon("lucide-edit-3").onClick(() => this.startRename(file)))
      .addItem((item) => item.setSection("action").setTitle("Make copy").setIcon("lucide-files").onClick(() => void this.makeCopy(file)))
      .addItem((item) => item.setSection("danger").setTitle("Delete").setIcon("lucide-trash-2").setWarning(true).onClick(() => void this.deleteFile(file)));
  }

  private async createNote(folder: TFolder | null): Promise<void> {
    const file = await this.app.fileManager.createNewMarkdownFile(folder);
    await this.app.workspace.openFile(file, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
  }

  private async createFolder(folder: TFolder | null): Promise<void> {
    const created = await this.app.fileManager.createNewFolder(folder);
    this.afterCreate(created);
  }

  private async createFolderWithSelection(target: TFile | TFolder, files: TAbstractFile[]): Promise<void> {
    const parent = target instanceof TFolder ? target.isRoot() ? null : target : target.parent;
    const folder = await this.app.fileManager.createNewFolder(parent);
    this.afterCreate(folder);
    const movable = files.filter((file): file is TFile | TFolder => file instanceof TFile || file instanceof TFolder);
    await this.moveFilesIntoFolder(movable, folder);
    this.clearSelection();
  }

  private async deleteFile(file: TAbstractFile): Promise<void> {
    if (file instanceof TFile || file instanceof TFolder) await this.app.fileManager.deleteFile(file);
    this.renderFileTree();
  }

  private async deleteFiles(files: TAbstractFile[]): Promise<void> {
    for (const file of files) {
      if (!this.app.vault.getAbstractFileByPath(file.path)) continue;
      await this.app.fileManager.promptForDeletion(file);
    }
    this.renderFileTree();
  }

  private filterSelectionRoots(files: TAbstractFile[]): TAbstractFile[] {
    const selectedFolders = files.filter((file): file is TFolder => file instanceof TFolder);
    return files.filter((file) => !selectedFolders.some((folder) => folder !== file && file.path.startsWith(`${folder.path}/`)));
  }

  private async makeCopy(file: TFile | TFolder): Promise<void> {
    await this.app.vault.copy(file, this.getAvailableCopyPath(file));
    this.renderFileTree();
  }

  private getAvailableCopyPath(file: TFile | TFolder): string {
    const prefix = file.parentPath ? `${file.parentPath}/` : "";
    return file instanceof TFile
      ? this.app.vault.getAvailablePath(`${prefix}${file.basename}`, file.extension)
      : this.app.vault.getAvailablePath(`${prefix}${file.name}`, "");
  }

  private toggleFolder(folder: TFolder): void {
    if (this.collapsedFolders.has(folder.path)) this.collapsedFolders.delete(folder.path);
    else this.collapsedFolders.add(folder.path);
    this.renderFileTree();
  }

  private onFolderClick(folder: TFolder, event: MouseEvent): void {
    if (this.updateSelectionFromMouseEvent(folder, event)) return;
    this.clearSelection();
    this.treeActivePath = folder.path;
    this.toggleFolder(folder);
  }

  private onFileClick(file: TFile, event: MouseEvent): void {
    if (this.updateSelectionFromMouseEvent(file, event)) return;
    this.clearSelection();
    this.treeActivePath = file.path;
    if (this.app.workspace.activeEditor?.file?.path === file.path) {
      this.focusTreeItem(file.path);
      return;
    }
    void this.app.workspace.openFile(file, { active: true });
  }

  private updateSelectionFromMouseEvent(file: TAbstractFile, event: MouseEvent): boolean {
    if (!(event.altKey || event.shiftKey)) return false;
    event.preventDefault();
    event.stopPropagation();
    if (event.altKey && !event.shiftKey) {
      if (this.selectedPaths.has(file.path)) this.selectedPaths.delete(file.path);
      else {
        if (this.treeActivePath && this.treeActivePath !== file.path) this.selectedPaths.add(this.treeActivePath);
        this.selectedPaths.add(file.path);
      }
      this.treeActivePath = file.path;
      this.focusTreeItem(file.path);
      this.refreshSelectionDom();
      return true;
    }
    if (event.shiftKey) {
      this.selectRangeTo(file.path);
      this.refreshSelectionDom();
      return true;
    }
    return true;
  }

  private applySelectionState(titleEl: HTMLElement, file: TAbstractFile): void {
    titleEl.classList.toggle("is-selected", this.selectedPaths.has(file.path));
    titleEl.classList.toggle("has-focus", this.focusedPath === file.path);
  }

  private applyRenameState(rowEl: HTMLElement, titleEl: HTMLElement, file: TFile | TFolder): void {
    const isRenaming = this.renamingPath === file.path;
    rowEl.classList.toggle("is-being-renamed", isRenaming);
    if (!isRenaming) return;
    // Rename edits the basename — getNewPathAfterRename re-appends the
    // extension, so the displayed "name.ext" must not be the editing text.
    if (file instanceof TFile) titleEl.textContent = file.basename;
    titleEl.setAttribute("contenteditable", "true");
    titleEl.setAttribute("spellcheck", String(this.app.vault.getConfig("spellcheck") ?? false));
    titleEl.addEventListener("click", (event) => event.stopPropagation());
    titleEl.addEventListener("input", () => this.onRenameInput(file, titleEl));
    titleEl.addEventListener("paste", (event) => this.onRenamePaste(event));
    titleEl.addEventListener("keydown", (event) => void this.onRenameKeydown(event, file, titleEl));
    titleEl.addEventListener("blur", () => void this.stopRename(file, titleEl, true));
    queueMicrotask(() => {
      if (this.renamingPath === file.path && titleEl.isConnected) this.focusRenameTitle(titleEl);
    });
  }

  private startRename(file: TFile | TFolder): void {
    if (file === this.app.vault.root || file.path === "/") return;
    this.expandParents(file);
    this.renamingPath = file.path;
    this.selectedPaths = new Set([file.path]);
    this.treeActivePath = file.path;
    this.focusTreeItem(file.path);
    this.renderFileTree();
  }

  private afterCreate(file: TFile | TFolder): void {
    this.expandParents(file);
    this.startRename(file);
  }

  private expandParents(file: TAbstractFile): void {
    let parentPath = file.parentPath;
    while (parentPath) {
      this.collapsedFolders.delete(parentPath);
      parentPath = parentPath.includes("/") ? parentPath.slice(0, parentPath.lastIndexOf("/")) : "";
    }
  }

  private focusRenameTitle(titleEl: HTMLElement): void {
    titleEl.focus();
    const range = document.createRange();
    const selection = titleEl.ownerDocument.getSelection();
    range.selectNodeContents(titleEl);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  private async onRenameKeydown(event: KeyboardEvent, file: TFile | TFolder, titleEl: HTMLElement): Promise<void> {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      titleEl.textContent = file instanceof TFile ? file.basename : file.name;
      await this.stopRename(file, titleEl, false);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      await this.stopRename(file, titleEl, true);
    }
  }

  private onRenamePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    const target = event.currentTarget;
    if (target instanceof HTMLElement) target.ownerDocument.execCommand("insertText", false, text.replace(/[\r\n]/g, " "));
  }

  private async stopRename(file: TFile | TFolder, titleEl: HTMLElement, save: boolean): Promise<void> {
    if (this.renamingPath !== file.path) return;
    const nextName = (titleEl.textContent ?? "").trim();
    const validation = this.getRenameValidation(file, nextName, true);
    if (save && validation.error) {
      this.applyRenameValidation(titleEl, validation.error, validation.warning);
      return;
    }
    this.exitRename(titleEl);
    if (save && validation.name && validation.name !== file.name) {
      await this.app.fileManager.renameAbstractFile(file, this.getRenameTargetPath(file, validation.name));
    }
    this.renderFileTree();
  }

  private exitRename(titleEl: HTMLElement): void {
    this.renamingPath = null;
    titleEl.closest<HTMLElement>(".tree-item-self")?.classList.remove("is-being-renamed");
    this.applyRenameValidation(titleEl, "", "");
    titleEl.removeAttribute("contenteditable");
    titleEl.removeAttribute("spellcheck");
    titleEl.scrollLeft = 0;
  }

  private onTreeKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || this.isEditingRenameTarget(event.target)) return;
    if (event.key !== "F2" && !(Platform.isMacOS && event.key === "Enter")) return;
    const file = this.focusedPath ? this.app.vault.getAbstractFileByPath(this.focusedPath) : null;
    if (!(file instanceof TFile || file instanceof TFolder)) return;
    event.preventDefault();
    event.stopPropagation();
    this.startRename(file);
  }

  private isEditingRenameTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.isContentEditable;
  }

  private onRenameInput(file: TFile | TFolder, titleEl: HTMLElement): void {
    const validation = this.getRenameValidation(file, titleEl.textContent ?? "", false);
    this.applyRenameValidation(titleEl, validation.error, validation.warning);
  }

  private getRenameValidation(file: TFile | TFolder, name: string, requireNonEmpty: boolean): ReturnType<typeof validateRenameName> {
    return validateRenameName(this.app.vault, file, name, requireNonEmpty);
  }

  private applyRenameValidation(titleEl: HTMLElement, error: string, warning: string): void {
    const rowEl = titleEl.closest<HTMLElement>(".tree-item-self");
    const message = error || warning;
    titleEl.classList.toggle("mod-error", Boolean(error));
    titleEl.classList.toggle("mod-warning", !error && Boolean(warning));
    rowEl?.classList.toggle("mod-error", Boolean(error));
    rowEl?.classList.toggle("mod-warning", !error && Boolean(warning));
    if (message) titleEl.title = message;
    else titleEl.removeAttribute("title");
  }

  private getRenameTargetPath(file: TFile | TFolder, name: string): string {
    return file.getNewPathAfterRename(name);
  }

  private getSelectedFilesForMenu(target: TAbstractFile): TAbstractFile[] {
    if (!this.selectedPaths.has(target.path)) return [target];
    const selected = [...this.selectedPaths]
      .map((path) => this.app.vault.getAbstractFileByPath(path))
      .filter((file): file is TAbstractFile => file instanceof TAbstractFile);
    return selected.length > 0 ? selected : [target];
  }

  private createActionButton(title: string, icon: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "view-action clickable-icon";
    button.type = "button";
    setTooltip(button, title);
    setIcon(button, icon);
    button.addEventListener("click", callback);
    return button;
  }

  private getRootChildren(): TAbstractFile[] {
    return this.app.vault.getAllLoadedFiles().filter((file) => file.parentPath === "" && file.path !== "/").sort(sortFiles);
  }

  private installRootDrop(targetEl: HTMLElement): void {
    const preview = (event: DragEvent): void => {
      if (event.target !== targetEl) return;
      const result = this.handleFolderDrop(event, this.app.dragManager.getSource(), true, this.app.vault.root, targetEl);
      if (!result) return;
      event.stopPropagation();
      event.preventDefault();
      if (result.dropEffect) setAllowedDropEffect(event, result.dropEffect);
      this.app.dragManager.updateHover(result.hoverEl ?? null, result.hoverClass ?? "");
    };
    targetEl.addEventListener("dragover", preview);
    targetEl.addEventListener("dragenter", preview);
    targetEl.addEventListener("dragleave", (event) => {
      if (event.target === targetEl) {
        this.clearFolderExpandTimer();
        this.app.dragManager.clearPreview();
      }
    });
    targetEl.addEventListener("drop", (event) => {
      if (event.target !== targetEl) return;
      const source = this.app.dragManager.getSource();
      const result = this.handleFolderDrop(event, source, false, this.app.vault.root, targetEl);
      if (!result) return;
      event.stopPropagation();
      event.preventDefault();
      if (result.dropEffect) setAllowedDropEffect(event, result.dropEffect);
      if (source) this.app.dragManager.clearSource();
      else this.app.dragManager.clearPreview();
    });
  }

  private installFolderDrop(targetEl: HTMLElement, folder: TFolder, hoverEl: HTMLElement): void {
    this.app.dragManager.handleDrop(targetEl, (event, source, hovering) => this.handleFolderDrop(event, source, hovering, folder, hoverEl), true);
    targetEl.addEventListener("dragleave", () => this.clearFolderExpandTimer());
  }

  private createDragSource(event: DragEvent, file: TAbstractFile, titleEl: HTMLElement): DragSource | null {
    const selectedSource = this.createSelectedDragSource(event, file);
    if (selectedSource) return selectedSource;
    if (!this.selectedPaths.has(file.path)) {
      this.selectedPaths = new Set([file.path]);
      this.treeActivePath = file.path;
      this.focusTreeItem(file.path);
      this.refreshSelectionDom();
    }
    if (file instanceof TFile) return this.app.dragManager.dragFile(event, file, undefined, [titleEl]);
    if (file instanceof TFolder) return this.app.dragManager.dragFolder(event, file, undefined, [titleEl]);
    return null;
  }

  private createSelectedDragSource(event: DragEvent, file: TAbstractFile): DragSource | null {
    if (this.selectedPaths.size === 0) return null;
    if (this.selectedPaths.size === 1 && this.selectedPaths.has(file.path)) return null;
    if (!this.selectedPaths.has(file.path)) return null;
    const entries = [...this.selectedPaths]
      .map((path) => {
        const abstractFile = this.app.vault.getAbstractFileByPath(path);
        const titleEl = abstractFile ? this.getTitleEl(abstractFile.path) : null;
        const itemEl = titleEl?.closest<HTMLElement>(".tree-item") ?? null;
        return (abstractFile instanceof TFile || abstractFile instanceof TFolder) && titleEl && itemEl ? { file: abstractFile, titleEl, itemEl } : null;
      })
      .filter((entry): entry is { file: TFile | TFolder; titleEl: HTMLElement; itemEl: HTMLElement } => entry !== null)
      .sort((a, b) => a.titleEl.offsetTop - b.titleEl.offsetTop);
    return this.app.dragManager.dragFiles(event, entries.map((entry) => entry.file), undefined, entries.map((entry) => entry.itemEl));
  }

  private handleFolderDrop(event: DragEvent, source: DragSource | null, hovering: boolean, folder: TFolder, hoverEl: HTMLElement): DragDropResult {
    if (source) {
      const result = this.handleInternalFolderDrop(source, hovering, folder, this.resolveFolderHoverEl(event, folder, hoverEl));
      if (result) event.stopPropagation();
      return result;
    }
    this.clearFolderExpandTimer();
    if (!hasDataTransferAttachmentFiles(event.dataTransfer)) return undefined;
    if (!hovering) void this.app.importAttachments(getAttachmentFilesFromDataTransfer(event.dataTransfer), folder, null);
    event.stopPropagation();
    return {
      action: "Import attachments",
      dropEffect: "copy",
      hoverEl,
      hoverClass: "is-being-dragged-over",
    };
  }

  private resolveFolderHoverEl(event: DragEvent, folder: TFolder, fallbackEl: HTMLElement): HTMLElement {
    if (folder.isRoot()) return fallbackEl;
    const currentTarget = event.currentTarget;
    if (!(currentTarget instanceof HTMLElement)) return fallbackEl;
    return currentTarget.closest<HTMLElement>(".tree-item.nav-folder") ?? fallbackEl;
  }

  private handleInternalFolderDrop(source: DragSource, hovering: boolean, folder: TFolder, hoverEl: HTMLElement): DragDropResult {
    const files = this.getMovableFilesForFolderDrop(source, folder);
    if (files.length === 0) {
      this.clearFolderExpandTimer();
      return undefined;
    }
    if (hovering) {
      hoverEl.classList.add("is-being-dragged-over");
      this.scheduleFolderExpand(folder);
    }
    else {
      this.clearFolderExpandTimer();
      void this.moveFilesIntoFolder(files, folder);
    }
    return {
      action: files.length === 1 ? `Move to ${folder.isRoot() ? this.app.vault.getName() : folder.name}` : `Move ${files.length} items`,
      dropEffect: "move",
      hoverEl,
      hoverClass: "is-being-dragged-over",
    };
  }

  private getMovableFilesForFolderDrop(source: DragSource, targetFolder: TFolder): Array<TFile | TFolder> {
    if (isFileDragSource(source)) {
      return this.canMoveIntoFolder(source.file, targetFolder) ? [source.file] : [];
    }
    if (isFolderDragSource(source)) {
      return this.canMoveIntoFolder(source.file, targetFolder) ? [source.file] : [];
    }
    if (!isFilesDragSource(source)) return [];
    return this.removeSelectedDescendants(source.files.filter((file) => this.canMoveIntoFolder(file, targetFolder)));
  }

  private canMoveIntoFolder(file: TFile | TFolder, targetFolder: TFolder): boolean {
    if (file === this.app.vault.root || file.path === "/") return false;
    if (file === targetFolder) return false;
    if (this.isDirectChildOf(file, targetFolder)) return false;
    if (file instanceof TFolder && targetFolder.path.startsWith(`${file.path}/`)) return false;
    return true;
  }

  private isDirectChildOf(file: TFile | TFolder, targetFolder: TFolder): boolean {
    if (file.parent === targetFolder) return true;
    const targetPath = targetFolder.isRoot() ? "" : targetFolder.path;
    return file.parentPath === targetPath;
  }

  private removeSelectedDescendants(files: Array<TFile | TFolder>): Array<TFile | TFolder> {
    const selectedFolders = files.filter((file): file is TFolder => file instanceof TFolder);
    return files.filter((file) => !selectedFolders.some((folder) => folder !== file && file.path.startsWith(`${folder.path}/`)));
  }

  private async moveFilesIntoFolder(files: Array<TFile | TFolder>, targetFolder: TFolder): Promise<void> {
    for (const file of files) {
      if (!this.canMoveIntoFolder(file, targetFolder)) continue;
      const targetPath = this.getAvailableMovePath(file, targetFolder);
      await this.app.fileManager.renameAbstractFile(file, targetPath);
    }
    this.renderFileTree();
  }

  private getAvailableMovePath(file: TFile | TFolder, targetFolder: TFolder): string {
    const prefix = targetFolder.isRoot() ? "" : `${targetFolder.path}/`;
    return file instanceof TFolder
      ? this.app.vault.getAvailablePath(`${prefix}${file.name}`, "")
      : this.app.vault.getAvailablePath(`${prefix}${file.basename}`, file.extension);
  }

  private scheduleFolderExpand(folder: TFolder): void {
    if (folder.isRoot() || !this.collapsedFolders.has(folder.path)) return;
    if (this.folderExpandPath === folder.path && this.folderExpandTimer) return;
    this.clearFolderExpandTimer();
    this.folderExpandPath = folder.path;
    this.folderExpandTimer = setTimeout(() => {
      this.folderExpandTimer = null;
      this.folderExpandPath = null;
      this.collapsedFolders.delete(folder.path);
      this.renderFileTree();
    }, 750);
  }

  private clearFolderExpandTimer(): void {
    if (this.folderExpandTimer) clearTimeout(this.folderExpandTimer);
    this.folderExpandTimer = null;
    this.folderExpandPath = null;
  }

  private clearSelection(): void {
    this.selectedPaths.clear();
    this.focusedPath = null;
    this.refreshSelectionDom();
  }

  private focusTreeItem(path: string | null): void {
    this.focusedPath = path;
    this.refreshSelectionDom();
    if (path) this.contentEl.focus();
  }

  private selectRangeTo(path: string): void {
    if (!this.treeActivePath) {
      this.selectedPaths.add(path);
      return;
    }
    const paths = [...this.contentEl.querySelectorAll<HTMLElement>(".nav-folder-title[data-path], .nav-file-title[data-path]")]
      .map((el) => el.dataset.path)
      .filter((value): value is string => Boolean(value));
    const start = paths.indexOf(this.treeActivePath);
    const end = paths.indexOf(path);
    if (start === -1 || end === -1) {
      this.selectedPaths.add(path);
      return;
    }
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    for (let index = from; index <= to; index += 1) this.selectedPaths.add(paths[index]);
  }

  private refreshSelectionDom(): void {
    for (const titleEl of this.contentEl.querySelectorAll<HTMLElement>(".nav-folder-title, .nav-file-title")) {
      const path = titleEl.dataset.path;
      titleEl.classList.toggle("is-selected", !!path && this.selectedPaths.has(path));
      titleEl.classList.toggle("has-focus", !!path && this.focusedPath === path);
    }
  }

  private getTitleEl(path: string): HTMLElement | null {
    const el = this.contentEl.querySelector<HTMLElement>(`.nav-folder-title[data-path="${cssEscape(path)}"], .nav-file-title[data-path="${cssEscape(path)}"]`);
    return el;
  }
}

function sortFiles(a: TAbstractFile, b: TAbstractFile): number {
  const folderDelta = Number(b instanceof TFolder) - Number(a instanceof TFolder);
  return folderDelta || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function isFileDragSource(source: DragSource): source is FileDragSource {
  return source.type === "file" && (source as Partial<FileDragSource>).file instanceof TFile;
}

function isFilesDragSource(source: DragSource): source is FilesDragSource {
  return source.type === "files" && Array.isArray((source as FilesDragSource).files);
}

function isFolderDragSource(source: DragSource): source is FolderDragSource {
  return source.type === "folder" && (source as Partial<FolderDragSource>).file instanceof TFolder;
}
