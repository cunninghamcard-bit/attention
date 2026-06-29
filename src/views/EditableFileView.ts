import { FileView } from "./FileView";
import type { TFile } from "../vault/TAbstractFile";
import { validateRenameName, type RenameValidationResult } from "../vault/FileNameValidation";
import type { Menu } from "../ui/Menu";

export class EditableFileView extends FileView {
  protected fileBeingRenamed: TFile | null = null;

  async onOpen(): Promise<void> {
    await super.onOpen();
    this.titleEl.contentEditable = "true";
    this.titleEl.spellcheck = false;
    this.titleEl.addEventListener("focus", () => this.onHeaderTitleFocus());
    this.titleEl.addEventListener("blur", () => void this.onHeaderTitleBlur());
    this.titleEl.addEventListener("input", () => this.onHeaderTitleChange());
    this.titleEl.addEventListener("paste", (event) => this.onHeaderTitlePaste(event));
    this.titleEl.addEventListener("keydown", (event) => void this.onHeaderTitleKeydown(event));
  }

  override onPaneMenu(menu: Menu, source?: string): void {
    super.onPaneMenu(menu, source);
    const file = this.file;
    if (!file) return;
    menu
      .addItem((item) => item
        .setSection("action")
        .setTitle("Rename")
        .setIcon("lucide-edit-3")
        .onClick(() => {
          void this.app.fileManager.promptForFileRename(file);
        }))
      .addItem((item) => item
        .setSection("danger")
        .setTitle("Delete")
        .setIcon("lucide-trash-2")
        .setWarning(true)
        .onClick(() => {
          void this.app.fileManager.promptForDeletion(file);
        }));
    this.triggerFileMenu(menu, source);
  }

  getSelection(): string {
    return "";
  }

  override setEphemeralState(state: unknown): void {
    super.setEphemeralState(state);
    if (!state || typeof state !== "object" || !("rename" in state)) return;
    const rename = (state as { rename?: unknown }).rename;
    if (!rename || !this.file) return;
    if (this.titleEl.offsetParent !== null) this.focusHeaderTitle(rename);
    else void this.app.fileManager.promptForFileRename(this.file);
  }

  protected focusHeaderTitle(rename: unknown): void {
    this.fileBeingRenamed = this.file;
    this.titleEl.focus();
    const text = this.titleEl.textContent ?? "";
    const range = document.createRange();
    const selection = this.titleEl.ownerDocument.getSelection();
    range.selectNodeContents(this.titleEl);
    if (rename === "start") range.setEnd(this.titleEl.firstChild ?? this.titleEl, 0);
    else if (rename === "end") range.setStart(this.titleEl.firstChild ?? this.titleEl, text.length);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  protected onHeaderTitleFocus(): void {
    this.fileBeingRenamed = this.file;
    this.titleEl.textContent = this.file?.basename ?? "";
    this.titleParentEl.style.display = "none";
  }

  protected async onHeaderTitleBlur(): Promise<void> {
    const saved = await this.saveHeaderTitle();
    if (!saved) this.titleEl.textContent = this.getDisplayText();
    this.titleParentEl.style.display = "";
    this.fileBeingRenamed = null;
  }

  protected onHeaderTitleChange(): void {
    const validation = this.getHeaderTitleValidation(false);
    this.applyHeaderTitleValidation(validation);
  }

  protected onHeaderTitlePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    this.titleEl.ownerDocument.execCommand("insertText", false, text.replace(/[\r\n]/g, " "));
    this.onHeaderTitleChange();
  }

  protected async onHeaderTitleKeydown(event: KeyboardEvent): Promise<void> {
    if (event.key === "Escape") {
      event.preventDefault();
      this.titleEl.textContent = this.getDisplayText();
      this.titleEl.blur();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab" || event.key === "ArrowDown") {
      event.preventDefault();
      if (await this.saveHeaderTitle()) this.titleEl.blur();
    }
  }

  protected async saveHeaderTitle(): Promise<boolean> {
    const file = this.fileBeingRenamed;
    if (!file || this.file !== file) return false;
    const validation = this.getHeaderTitleValidation(true);
    this.applyHeaderTitleValidation(validation);
    if (validation.error) return false;
    if (!validation.name || validation.name === file.basename) return Boolean(validation.name);
    await this.app.fileManager.renameFile(file, file.getNewPathAfterRename(validation.name));
    return true;
  }

  protected getValidHeaderTitle(): string | null {
    const file = this.fileBeingRenamed ?? this.file;
    if (!file) return null;
    const validation = validateRenameName(this.app.vault, file, this.titleEl.textContent ?? "", true);
    return validation.error ? null : validation.name;
  }

  protected getHeaderTitleValidation(requireNonEmpty: boolean): RenameValidationResult {
    const file = this.fileBeingRenamed ?? this.file;
    if (!file) return { name: "", error: "File name cannot be empty", warning: "" };
    return validateRenameName(this.app.vault, file, this.titleEl.textContent ?? "", requireNonEmpty);
  }

  protected applyHeaderTitleValidation(validation: RenameValidationResult): void {
    const isError = Boolean(validation.error);
    const isWarning = !isError && Boolean(validation.warning);
    this.titleEl.classList.toggle("is-invalid", isError);
    this.titleEl.classList.toggle("mod-warning", isWarning);
    if (validation.error || validation.warning) this.titleEl.title = validation.error || validation.warning;
    else this.titleEl.removeAttribute("title");
  }
}
