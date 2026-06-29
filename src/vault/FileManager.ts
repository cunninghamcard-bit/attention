import type { App } from "../app/App";
import { getTimestampForPastedImage, type AttachmentImportData, type AttachmentImportFile } from "../app/AttachmentImport";
import { deleteFrontmatterProperty, parseFrontmatter, renameFrontmatterProperty, updateFrontmatter } from "../properties/Frontmatter";
import type { PropertyValue } from "../properties/PropertyTypes";
import { Modal } from "../ui/Modal";
import type { DataWriteOptions } from "./DataAdapter";
import { validateRenamePromptName } from "./FileNameValidation";
import { TAbstractFile, TFile, TFolder } from "./TAbstractFile";

export class FileManager {
  private readonly fileParentCreatorByType: Record<string, (sourcePath: string) => TFolder> = {};

  constructor(readonly app: App) {
    this.registerFileParentCreator("md", (sourcePath) => this.getMarkdownNewFileParent(sourcePath));
  }

  registerFileParentCreator(extension: string, creator: (sourcePath: string) => TFolder): void {
    this.fileParentCreatorByType[normalizeRegisteredExtension(extension) || "md"] = creator;
  }

  unregisterFileCreator(extension: string): void {
    delete this.fileParentCreatorByType[normalizeRegisteredExtension(extension) || "md"];
  }

  canCreateFileWithExt(extension = "md"): boolean {
    const normalized = normalizeRegisteredExtension(extension) || "md";
    return normalized in this.fileParentCreatorByType;
  }

  getNewFileParent(sourcePath = "", newFilePath = ""): TFolder {
    const extension = getExtensionFromPath(newFilePath) || "md";
    const creator = this.fileParentCreatorByType[extension];
    if (creator) return creator(sourcePath);

    if (isAttachmentExtension(extension)) {
      const configuredPath = this.app.vault.getConfig<string>("attachmentFolderPath") ?? "/";
      return this.getFolderByPathOrVirtual(resolveAttachmentParentPath(configuredPath, sourcePath), true);
    }

    return this.getMarkdownNewFileParent(sourcePath);
  }

  getMarkdownNewFileParent(sourcePath = ""): TFolder {
    const location = this.app.vault.getConfig<string>("newFileLocation") ?? "root";
    const configuredPath = normalizeConfiguredPath(this.app.vault.getConfig<string>("newFileFolderPath") ?? "/");
    const parentPath = location === "current"
      ? sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : ""
      : location === "folder"
        ? configuredPath
        : "";
    return this.getFolderByPathOrVirtual(parentPath);
  }

  async createNewMarkdownFileFromLinktext(linktext: string, sourcePath = ""): Promise<TFile> {
    const parsed = splitLinktextTarget(linktext);
    if (!isValidNewFileLinktext(parsed.path)) throw new Error("File name contains invalid characters.");
    const parent = parsed.path.includes("/") ? null : this.getNewFileParent(sourcePath, parsed.path);
    return this.createNewMarkdownFile(parent, parsed.path);
  }

  async createNewMarkdownFile(folder: TFolder | string | null, basename = "Untitled", data = ""): Promise<TFile> {
    const targetFolder = folder ?? this.getNewFileParent(this.app.workspace.activeEditor?.file?.path ?? "");
    return this.createNewFile(targetFolder, basename, "md", data);
  }

  async createAndOpenMarkdownFile(sourcePath = "", basename = "Untitled"): Promise<TFile> {
    const file = await this.createNewMarkdownFile(this.getNewFileParent(sourcePath), basename);
    await this.app.workspace.openFile(file, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
    return file;
  }

  async createNewFile(folder: TFolder | string | null, filename = "Untitled", extension?: string, data = ""): Promise<TFile> {
    const folderPath = normalizeCreationFolderPath(typeof folder === "string" ? folder : folder?.path ?? "");
    const target = normalizeNewFileName(filename, extension);
    const rawPath = folderPath ? `${folderPath}/${target.basename}` : target.basename;
    const path = this.app.vault.getAvailablePath(rawPath, target.extension);
    return this.app.vault.create(path, data);
  }

  resolveAttachmentFile(file: AttachmentImportFile): TFile | null {
    if (!file.filepath) return null;
    return this.app.vault.resolveFileUrl(file.filepath)
      ?? this.app.vault.getFileByPath(file.filepath)
      ?? this.app.vault.getFileByPath(file.filepath.replace(/^\/+/, ""));
  }

  async importAttachments(files: AttachmentImportFile[], targetFolder: TFolder | null = null, sourceFile: TFile | null = this.app.workspace.getActiveFile()): Promise<TFile[]> {
    const imported: TFile[] = [];
    for (const file of files) {
      const existing = this.resolveAttachmentFile(file);
      if (existing) {
        imported.push(existing);
        continue;
      }

      const data = await file.data;
      if (!data) continue;
      const name = getAttachmentSaveName(file.name);
      const saved = targetFolder
        ? await this.saveAttachmentToFolder(name, file.extension, data, targetFolder)
        : await this.saveAttachment(name, file.extension, data, sourceFile);
      imported.push(saved);
    }
    return imported;
  }

  async saveAttachment(name: string, extension: string, data: AttachmentImportData, sourceFile: TFile | null = this.app.workspace.getActiveFile()): Promise<TFile> {
    const bytes = await data;
    if (!bytes) throw new Error("Attachment data is empty");
    const targetPath = await this.app.vault.getAvailablePathForAttachments(getAttachmentSaveName(name), extension, sourceFile);
    return this.app.vault.createBinary(targetPath, normalizeBinaryData(bytes));
  }

  async saveAttachmentToFolder(name: string, extension: string, data: AttachmentImportData, folder: TFolder): Promise<TFile> {
    const bytes = await data;
    if (!bytes) throw new Error("Attachment data is empty");
    const targetPath = this.getAvailableAttachmentPathInFolder(folder, getAttachmentSaveName(name), extension);
    return this.app.vault.createBinary(targetPath, normalizeBinaryData(bytes));
  }

  async createNewFolder(parent: TFolder | string | null, name = "Untitled"): Promise<TFolder> {
    const parentPath = normalizeCreationFolderPath(typeof parent === "string" ? parent : parent?.path ?? "");
    const rawPath = parentPath ? `${parentPath}/${name}` : name;
    return this.app.vault.createFolder(this.getAvailableFolderPath(rawPath));
  }

  async processFrontMatter(file: TFile, handler: (frontmatter: Record<string, PropertyValue>) => void, options?: DataWriteOptions): Promise<void> {
    if (file.extension !== "md") return;
    await this.app.vault.process(file, (source) => {
      const frontmatter = { ...parseFrontmatter(source).values };
      handler(frontmatter);
      return updateFrontmatter(source, (values) => {
        for (const key of Object.keys(values)) delete values[key];
        Object.assign(values, frontmatter);
      });
    }, options);
  }

  async renameProperty(oldId: string, newId: string): Promise<number> {
    const trimmed = newId.trim();
    if (!trimmed || trimmed === oldId) return 0;
    const assigned = this.app.metadataTypeManager.assignedWidgets.get(oldId.toLowerCase());
    if (assigned) {
      if (!isReservedProperty(oldId)) this.app.metadataTypeManager.unsetType(oldId);
      this.app.metadataTypeManager.setType(trimmed, assigned.widget);
    }
    let count = 0;
    for (const path of this.app.metadataCache.getCachedFiles()) {
      if (this.app.metadataCache.isUserIgnored(path)) continue;
      const frontmatter = this.app.metadataCache.getCacheByPath(path)?.frontmatter;
      if (!frontmatter || !Object.prototype.hasOwnProperty.call(frontmatter, oldId)) continue;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      await this.app.vault.process(file, (source) => renameFrontmatterProperty(source, oldId, trimmed));
      count += 1;
    }
    return count;
  }

  async deleteProperty(propertyId: string): Promise<number> {
    let count = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const source = await this.app.vault.read(file);
      if (!(propertyId in parseFrontmatter(source).values)) continue;
      await this.app.vault.modify(file, deleteFrontmatterProperty(source, propertyId));
      count += 1;
    }
    return count;
  }

  async renameFile(file: TAbstractFile, newPath: string): Promise<void> {
    await this.renameAbstractFile(file, newPath);
  }

  async renameAbstractFile(file: TAbstractFile, newPath: string): Promise<TAbstractFile> {
    const linkUpdates = file instanceof TFile ? await this.collectInternalLinkUpdates(file) : [];
    await this.app.vault.rename(file, newPath);
    if (file instanceof TFile) await this.applyInternalLinkUpdates(file, linkUpdates);
    return file;
  }

  async promptForDeletion(file: TAbstractFile): Promise<boolean> {
    return this.deleteFile(file);
  }

  async promptForFileRename(file: TAbstractFile): Promise<void> {
    new FileRenameModal(this.app, file).open();
  }

  async deleteFile(file: TAbstractFile): Promise<boolean> {
    const promptDelete = this.app.vault.getConfig<boolean>("promptDelete") ?? true;
    if (promptDelete && !await this.confirmDeletion(file)) return false;
    const linkedAttachments = file instanceof TFile ? await this.collectLinkedAttachments(file) : [];
    await this.trashFile(file);
    await this.deleteUnlinkedAttachments(file, linkedAttachments);
    return true;
  }

  async trashFile(file: TAbstractFile, system = this.app.vault.getConfig<string>("trashOption") ?? "system"): Promise<void> {
    if (system === "system") await this.app.vault.trash(file, true);
    else if (system === "local") await this.app.vault.trash(file, false);
    else if (system === "none") await this.app.vault.delete(file, true);
  }

  generateMarkdownLink(file: TFile, sourcePath = "", subpath = "", alias = ""): string {
    const linkpath = this.getLinkpath(file, sourcePath);
    const target = `${linkpath}${subpath}`;
    const label = alias || file.basename;
    if (this.app.vault.getConfig<boolean>("useMarkdownLinks")) {
      return `[${label}](${encodeMarkdownLink(target)})`;
    }
    return alias ? `[[${target}|${alias}]]` : `[[${target}]]`;
  }

  fileToLinktext(file: TFile, sourcePath = "", omitMdExtension = true): string {
    return this.app.metadataCache.fileToLinktext(file, sourcePath, omitMdExtension);
  }

  async getAvailablePathForAttachment(filename: string, sourcePath?: string): Promise<string> {
    const sourceFile = sourcePath ? this.app.vault.getFileByPath(sourcePath) : this.app.workspace.getActiveFile();
    const name = filename.split(/[\\/]/).pop() ?? filename;
    const dotIndex = name.lastIndexOf(".");
    const basename = dotIndex > 0 ? name.slice(0, dotIndex) : name;
    const extension = dotIndex > 0 ? name.slice(dotIndex + 1) : "";
    return this.app.vault.getAvailablePathForAttachments(basename, extension, sourceFile);
  }

  async insertIntoFile(file: TFile, content: string, position: "append" | "prepend" = "append"): Promise<void> {
    await this.app.vault.process(file, (existing) => {
      const before = position === "prepend" ? content : existing;
      const after = position === "prepend" ? existing : content;
      const separator = before && after && !`${before.slice(-2)}${after.slice(0, 2)}`.includes("\n\n")
        ? before.endsWith("\n") || after.startsWith("\n") ? "\n" : "\n\n"
        : "";
      return `${before}${separator}${after}`;
    });
  }

  private getAvailableFolderPath(path: string): string {
    let candidate = path;
    let index = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${path} ${index}`;
      index += 1;
    }
    return candidate;
  }

  private getAvailableAttachmentPathInFolder(folder: TFolder, basename: string, extension: string): string {
    const sanitizedBase = basename.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "Pasted image";
    const clippedBase = sanitizedBase.slice(0, 250);
    const folderPath = folder === this.app.vault.root || folder.path === "/" ? "" : folder.path;
    const path = folderPath ? `${folderPath}/${clippedBase}` : clippedBase;
    return this.app.vault.getAvailablePath(path, extension);
  }

  private getFolderByPathOrVirtual(path: string, rootIfPathIsFile = false): TFolder {
    const normalized = normalizeCreationFolderPath(path);
    const folder = this.app.vault.getFolderByPath(normalized);
    if (folder) return folder;
    if (rootIfPathIsFile && this.app.vault.getAbstractFileByPath(normalized)) return this.app.vault.root;
    return new TFolder(this.app.vault, normalized);
  }

  private getLinkpath(file: TFile, sourcePath: string): string {
    const format = this.app.vault.getConfig<string>("newLinkFormat") ?? "shortest";
    if (format === "absolute") return file.path;
    if (format === "relative") return relativePath(sourcePath, file.path);
    const sameBasenameFiles = this.app.vault.getMarkdownFiles().filter((item) => item.basename === file.basename);
    return sameBasenameFiles.length <= 1 ? file.basename : file.path;
  }

  private async collectInternalLinkUpdates(file: TFile): Promise<InternalLinkUpdate[]> {
    const updates: InternalLinkUpdate[] = [];
    for (const sourceFile of this.app.vault.getMarkdownFiles()) {
      if (sourceFile.path === file.path) continue;
      const source = await this.app.vault.read(sourceFile);
      const matches = collectInternalLinkMatches(source);
      const replacements = matches.filter((match) => {
        const destination = this.app.metadataCache.getFirstLinkpathDest(match.target, sourceFile.path);
        return destination?.path === file.path;
      });
      if (replacements.length > 0) updates.push({ file: sourceFile, source, replacements });
    }
    return updates;
  }

  private async applyInternalLinkUpdates(renamedFile: TFile, updates: InternalLinkUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const linkCount = updates.reduce((total, update) => total + update.replacements.length, 0);
    const shouldUpdate = await this.confirmInternalLinkUpdates(linkCount, updates.length);
    if (!shouldUpdate) return;

    for (const update of updates) {
      let source = update.source;
      for (const replacement of [...update.replacements].sort((left, right) => right.start - left.start)) {
        const linkpath = this.getLinkpath(renamedFile, update.file.path);
        const nextTarget = (replacement.kind === "wiki" ? stripMarkdownExtension(linkpath, renamedFile) : linkpath) + replacement.subpath;
        const nextLink = replacement.kind === "wiki"
          ? formatWikiLink(nextTarget, replacement)
          : formatMarkdownLink(nextTarget, replacement);
        source = `${source.slice(0, replacement.start)}${nextLink}${source.slice(replacement.end)}`;
      }
      if (source !== update.source) await this.app.vault.modify(update.file, source);
    }
  }

  private async confirmInternalLinkUpdates(linkCount: number, fileCount: number): Promise<boolean> {
    if (this.app.vault.getConfig<boolean>("alwaysUpdateLinks")) return true;
    return new Promise((resolve) => {
      const modal = new LinkUpdateConfirmModal(this.app, linkCount, fileCount, resolve);
      modal.open();
    });
  }

  private async confirmDeletion(file: TAbstractFile): Promise<boolean> {
    if (!(file instanceof TFile || file instanceof TFolder)) return false;
    const backlinkCount = file instanceof TFile ? await this.getBacklinkCount(file) : 0;
    return new Promise((resolve) => {
      const modal = new DeleteConfirmModal(this.app, file, backlinkCount, resolve);
      modal.open();
    });
  }

  private async getBacklinkCount(file: TFile): Promise<number> {
    await this.ensureMarkdownCaches();
    let count = 0;
    for (const sourceFile of this.app.vault.getMarkdownFiles()) {
      if (sourceFile === file) continue;
      const cache = this.app.metadataCache.getFileCache(sourceFile);
      for (const reference of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
        const resolved = this.app.metadataCache.getFirstLinkpathDest(reference.link, sourceFile.path);
        if (resolved?.path === file.path) count += 1;
      }
    }
    return count;
  }

  private async collectLinkedAttachments(file: TFile): Promise<TFile[]> {
    await this.ensureMarkdownCaches();
    const cache = this.app.metadataCache.getFileCache(file) ?? await this.app.metadataCache.computeFileMetadata(file);
    const attachments = new Map<string, TFile>();
    for (const reference of [...(cache.links ?? []), ...(cache.embeds ?? [])]) {
      const target = this.app.metadataCache.getFirstLinkpathDest(reference.link, file.path);
      if (target && isAttachmentFile(target)) attachments.set(target.path, target);
    }
    return [...attachments.values()];
  }

  private async deleteUnlinkedAttachments(deletedFile: TAbstractFile, candidates: TFile[]): Promise<void> {
    if (!(deletedFile instanceof TFile || deletedFile instanceof TFolder)) return;
    const mode = this.app.vault.getConfig<string>("deleteUnlinkedAttachments") ?? "ask";
    if (mode === "never" || candidates.length === 0) return;
    const unlinked = candidates.filter((candidate) => !this.isReferencedByOtherMarkdownFile(candidate, deletedFile));
    if (unlinked.length === 0) return;
    if (mode === "always") {
      for (const file of unlinked) await this.trashFile(file);
      return;
    }
    if (mode === "ask" && await this.confirmDeleteUnlinkedAttachments(unlinked)) {
      for (const file of unlinked.filter((candidate) => !this.isReferencedByOtherMarkdownFile(candidate, deletedFile))) {
        await this.trashFile(file);
      }
    }
  }

  private isReferencedByOtherMarkdownFile(target: TFile, deletedFile: TFile | TFolder): boolean {
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file === deletedFile) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) continue;
      for (const reference of [...(cache.links ?? []), ...(cache.embeds ?? [])]) {
        const resolved = this.app.metadataCache.getFirstLinkpathDest(reference.link, file.path);
        if (resolved?.path === target.path) return true;
      }
    }
    return false;
  }

  private async ensureMarkdownCaches(): Promise<void> {
    for (const file of this.app.vault.getMarkdownFiles()) {
      await this.app.metadataCache.computeFileMetadata(file);
    }
  }

  private async confirmDeleteUnlinkedAttachments(files: TFile[]): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new OrphanAttachmentsModal(this.app, files, async (selectedFiles) => {
        for (const file of selectedFiles) await this.trashFile(file);
        resolve(false);
      }, () => resolve(false));
      modal.open();
    });
  }
}

class FileRenameModal extends Modal {
  private readonly inputEl: HTMLTextAreaElement;

  constructor(app: App, private readonly file: TAbstractFile) {
    super(app);
    this.modalEl.classList.add("mod-file-rename");
    this.setTitle(file instanceof TFile && file.extension === "md" ? "Rename file" : "Rename");
    this.inputEl = document.createElement("textarea");
    this.inputEl.className = "rename-textarea";
    this.inputEl.rows = 1;
    this.inputEl.value = getRenameInputValue(file);
    this.inputEl.addEventListener("keypress", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      void this.submit(this.inputEl.value.trim());
    });
    this.inputEl.addEventListener("input", () => {
      this.resizeInput();
      const validation = validateRenamePromptName(this.app.vault, this.file, this.inputEl.value.trim());
      if (validation.error) this.displayError(validation.error);
      else this.clearError();
    });
    const contentEl = document.createElement("div");
    contentEl.appendChild(this.inputEl);
    this.setContent(contentEl);
    this.addButton("mod-cta", "Save", () => this.submit(this.inputEl.value.trim()));
    this.addCancelButton();
  }

  override onOpen(): void {
    super.onOpen();
    this.inputEl.select();
    this.inputEl.focus();
    this.resizeInput();
  }

  private async submit(rawName: string): Promise<void> {
    const validation = validateRenamePromptName(this.app.vault, this.file, rawName);
    if (validation.error) {
      this.displayError(validation.error);
      return;
    }

    this.close();
    const newPath = this.file.getNewPathAfterRename(validation.name);
    if (this.file.path === newPath) return;
    try {
      await this.app.fileManager.renameFile(this.file, newPath);
    } catch (error) {
      console.error(error);
    }
  }

  private displayError(message: string): void {
    this.inputEl.classList.add("mod-error");
    this.inputEl.title = message;
  }

  private clearError(): void {
    this.inputEl.classList.remove("mod-error");
    this.inputEl.removeAttribute("title");
  }

  private resizeInput(): void {
    this.inputEl.rows = 1;
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = `${this.inputEl.scrollHeight}px`;
  }
}

class LinkUpdateConfirmModal extends Modal {
  private resolved = false;

  constructor(app: App, linkCount: number, fileCount: number, private readonly resolveChoice: (value: boolean) => void) {
    super(app);
    this.setTitle("Update links");
    const contentEl = document.createElement("div");
    const introEl = document.createElement("p");
    introEl.textContent = "Do you want to update links to this file?";
    const countEl = document.createElement("p");
    countEl.textContent = `${linkCount} ${linkCount === 1 ? "link" : "links"} in ${fileCount} ${fileCount === 1 ? "file" : "files"} will be affected.`;
    contentEl.append(introEl, countEl);
    this.setContent(contentEl);
    this.setCloseCallback(() => this.resolve(false));
    this.addButton("mod-cta", "Always update", () => {
      this.app.vault.setConfig("alwaysUpdateLinks", true);
      this.resolve(true);
      this.close();
    });
    this.addButton("", "Just once", () => {
      this.resolve(true);
      this.close();
    });
    this.addButton("", "Do not update", () => {
      this.resolve(false);
      this.close();
    });
  }

  private resolve(value: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveChoice(value);
  }
}

class DeleteConfirmModal extends Modal {
  private resolved = false;
  private readonly doNotAskAgainEl: HTMLInputElement;

  constructor(app: App, file: TFile | TFolder, backlinkCount: number, private readonly resolveChoice: (value: boolean) => void) {
    super(app);
    this.setTitle(file instanceof TFolder ? "Delete folder" : "Delete file");
    const contentEl = document.createElement("div");
    const confirmEl = document.createElement("p");
    confirmEl.className = "u-break-word";
    confirmEl.textContent = `Are you sure you want to delete ${file.name}?`;
    contentEl.appendChild(confirmEl);

    const trashEl = document.createElement("p");
    const trashOption = app.vault.getConfig<string>("trashOption") ?? "system";
    if (trashOption === "system") trashEl.textContent = "This will move it to the system trash.";
    else if (trashOption === "local") trashEl.textContent = "This will move it to the vault trash.";
    else {
      trashEl.className = "mod-warning";
      trashEl.textContent = "This will permanently delete it.";
    }
    contentEl.appendChild(trashEl);

    if (file instanceof TFolder && file.children.length > 0) {
      const nonEmptyEl = document.createElement("p");
      nonEmptyEl.className = "mod-warning";
      nonEmptyEl.textContent = "This folder is not empty.";
      const folderWarningEl = document.createElement("p");
      folderWarningEl.className = "mod-warning";
      folderWarningEl.textContent = "Deleting this folder will delete all files inside.";
      contentEl.append(nonEmptyEl, folderWarningEl);
    }

    if (file instanceof TFile && backlinkCount > 0) {
      const backlinksEl = document.createElement("p");
      backlinksEl.className = "mod-warning";
      backlinksEl.textContent = `${backlinkCount} existing ${backlinkCount === 1 ? "backlink points" : "backlinks point"} to this file.`;
      contentEl.appendChild(backlinksEl);
    }

    const checkboxLabelEl = document.createElement("label");
    checkboxLabelEl.className = "delete-confirm-checkbox";
    this.doNotAskAgainEl = document.createElement("input");
    this.doNotAskAgainEl.type = "checkbox";
    const checkboxTextEl = document.createElement("span");
    checkboxTextEl.textContent = "Do not ask again";
    checkboxLabelEl.append(this.doNotAskAgainEl, checkboxTextEl);
    contentEl.appendChild(checkboxLabelEl);

    this.setContent(contentEl);
    this.setCloseCallback(() => this.resolve(false));
    this.addButton("mod-warning", "Delete", () => {
      if (this.doNotAskAgainEl.checked) this.app.vault.setConfig("promptDelete", false);
      this.resolve(true);
      this.close();
    });
    this.addCancelButton();
  }

  private resolve(value: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveChoice(value);
  }
}

class OrphanAttachmentsModal extends Modal {
  private readonly selectedPaths = new Set<string>();

  constructor(
    app: App,
    readonly files: TFile[],
    readonly onDelete: (files: TFile[]) => void | Promise<void>,
    readonly onCancel: () => void,
  ) {
    super(app);
    for (const file of files) this.selectedPaths.add(file.path);
    this.setTitle("Delete unlinked attachments");
    const contentEl = document.createElement("div");
    const descEl = document.createElement("p");
    descEl.className = "file-browser-description";
    descEl.textContent = `${files.length} unlinked ${files.length === 1 ? "attachment" : "attachments"} can be deleted.`;
    const listEl = document.createElement("div");
    listEl.className = "file-tree";
    for (const file of files.sort((left, right) => left.path.localeCompare(right.path))) {
      listEl.appendChild(this.createFileRow(file));
    }
    contentEl.append(descEl, listEl);
    this.setContent(contentEl);
    this.setCloseCallback(this.onCancel);
    this.addButton("mod-warning", "Delete", async () => {
      const selectedFiles = this.files.filter((file) => this.selectedPaths.has(file.path));
      this.setCloseCallback(() => {});
      this.close();
      await this.onDelete(selectedFiles);
    });
    this.addCancelButton();
  }

  private createFileRow(file: TFile): HTMLElement {
    const itemEl = document.createElement("div");
    itemEl.className = "file-tree-item mod-file is-selected";
    itemEl.dataset.path = file.path;
    const checkboxEl = document.createElement("input");
    checkboxEl.className = "file-tree-item-checkbox";
    checkboxEl.type = "checkbox";
    checkboxEl.checked = true;
    const titleEl = document.createElement("span");
    titleEl.className = "file-tree-item-title";
    titleEl.textContent = file.path;
    const toggle = (): void => {
      checkboxEl.checked = !checkboxEl.checked;
      if (checkboxEl.checked) this.selectedPaths.add(file.path);
      else this.selectedPaths.delete(file.path);
      itemEl.classList.toggle("is-selected", checkboxEl.checked);
    };
    checkboxEl.addEventListener("click", (event) => {
      event.stopPropagation();
      if (checkboxEl.checked) this.selectedPaths.add(file.path);
      else this.selectedPaths.delete(file.path);
      itemEl.classList.toggle("is-selected", checkboxEl.checked);
    });
    itemEl.addEventListener("click", (event) => {
      if (event.target === checkboxEl) return;
      toggle();
    });
    itemEl.append(checkboxEl, titleEl);
    return itemEl;
  }
}

function getRenameInputValue(file: TAbstractFile): string {
  return file instanceof TFile ? file.basename : file.name;
}

interface InternalLinkUpdate {
  file: TFile;
  source: string;
  replacements: InternalLinkMatch[];
}

interface InternalLinkMatch {
  kind: "wiki" | "markdown";
  embed: boolean;
  start: number;
  end: number;
  target: string;
  subpath: string;
  alias?: string;
  label?: string;
}

function collectInternalLinkMatches(source: string): InternalLinkMatch[] {
  const matches: InternalLinkMatch[] = [];
  for (const match of source.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
    const parsed = parseWikiTarget(match[1]);
    matches.push({
      kind: "wiki",
      embed: match[0].startsWith("!"),
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      target: parsed.target,
      subpath: parsed.subpath,
      ...(parsed.alias ? { alias: parsed.alias } : {}),
    });
  }
  for (const match of source.matchAll(/!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const linkpath = safeDecodeLinkpath(match[2]);
    if (isExternalLink(linkpath)) continue;
    const parsed = splitSubpath(linkpath);
    matches.push({
      kind: "markdown",
      embed: match[0].startsWith("!"),
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      target: parsed.target,
      subpath: parsed.subpath,
      label: match[1],
    });
  }
  return matches;
}

function parseWikiTarget(value: string): { target: string; subpath: string; alias?: string } {
  const [linkpath, alias] = value.split("|", 2);
  return { ...splitSubpath(linkpath), ...(alias ? { alias } : {}) };
}

function splitSubpath(value: string): { target: string; subpath: string } {
  const index = value.indexOf("#");
  if (index === -1) return { target: value.trim(), subpath: "" };
  return { target: value.slice(0, index).trim(), subpath: value.slice(index) };
}

function formatWikiLink(target: string, match: InternalLinkMatch): string {
  const prefix = match.embed ? "!" : "";
  const alias = match.alias ? `|${match.alias}` : "";
  return `${prefix}[[${target}${alias}]]`;
}

function formatMarkdownLink(target: string, match: InternalLinkMatch): string {
  const prefix = match.embed ? "!" : "";
  const label = match.label ?? "";
  return `${prefix}[${label}](${encodeMarkdownLink(target)})`;
}

function stripMarkdownExtension(linkpath: string, file: TFile): string {
  return file.extension === "md" && linkpath.endsWith(".md") ? linkpath.slice(0, -3) : linkpath;
}

function safeDecodeLinkpath(linkpath: string): string {
  try {
    return decodeURIComponent(linkpath);
  } catch {
    return linkpath;
  }
}

function isExternalLink(linkpath: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(linkpath) || linkpath.startsWith("#");
}

function isAttachmentFile(file: TFile): boolean {
  return file.extension !== "md" && file.extension !== "canvas";
}

function normalizeRegisteredExtension(extension: string): string {
  return extension.trim().replace(/^\.+/, "").toLowerCase();
}

function getExtensionFromPath(path: string): string {
  const filename = path.split(/[\\/]/).pop() ?? path;
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === filename.length - 1) return "";
  return filename.slice(dotIndex + 1).toLowerCase();
}

function isAttachmentExtension(extension: string): boolean {
  return extension !== "" && extension !== "md" && extension !== "canvas";
}

function splitLinktextTarget(linktext: string): { path: string } {
  const withoutAlias = linktext.split("|", 1)[0] ?? "";
  const subpathIndex = withoutAlias.indexOf("#");
  const path = (subpathIndex === -1 ? withoutAlias : withoutAlias.slice(0, subpathIndex)).trim();
  return { path };
}

function isValidNewFileLinktext(path: string): boolean {
  return path.length > 0 && !/[\\:*?"<>|]/.test(path) && path.split("/").every((part) => part.trim().length > 0);
}

function normalizeNewFileName(filename: string, extension?: string): { basename: string; extension: string } {
  const normalizedName = filename.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || "Untitled";
  const inferredExtension = getExtensionFromPath(normalizedName);
  const targetExtension = normalizeRegisteredExtension(extension ?? inferredExtension) || "md";
  const basename = inferredExtension === targetExtension
    ? normalizedName.slice(0, -(targetExtension.length + 1))
    : normalizedName;
  return { basename: basename || "Untitled", extension: targetExtension };
}

function usesAttachmentLocation(newFilePath: string): boolean {
  return isAttachmentExtension(getExtensionFromPath(newFilePath));
}

function resolveAttachmentParentPath(configuredPath: string, sourcePath: string): string {
  const normalized = configuredPath.replace(/\\/g, "/");
  if (normalized === "/" || normalized === "") return "";
  const sourceParentPath = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
  if (normalized === "." || normalized === "./") return sourceParentPath;
  if (normalized.startsWith("./")) {
    const subfolder = normalizeConfiguredPath(normalized.slice(2));
    return sourceParentPath ? `${sourceParentPath}/${subfolder}` : subfolder;
  }
  return normalizeConfiguredPath(normalized.replace(/^\/+/, ""));
}

function normalizeConfiguredPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function normalizeCreationFolderPath(path: string): string {
  return path === "/" ? "" : path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function normalizeBinaryData(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function getAttachmentSaveName(name: string): string {
  const basename = name || "Pasted image";
  return basename === "Pasted image" ? `${basename} ${getTimestampForPastedImage()}` : basename;
}

function isReservedProperty(id: string): boolean {
  const normalized = id.toLowerCase();
  return normalized === "aliases" || normalized === "cssclasses" || normalized === "tags";
}

function relativePath(sourcePath: string, targetPath: string): string {
  const sourceParts = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")).split("/").filter(Boolean) : [];
  const targetParts = targetPath.split("/").filter(Boolean);
  while (sourceParts.length > 0 && targetParts.length > 0 && sourceParts[0] === targetParts[0]) {
    sourceParts.shift();
    targetParts.shift();
  }
  const prefix = sourceParts.map(() => "..");
  return [...prefix, ...targetParts].join("/") || targetPath;
}

function encodeMarkdownLink(path: string): string {
  return path.replace(/ /g, "%20");
}
