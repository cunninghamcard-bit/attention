import { EditableFileView } from "./EditableFileView";
import type { ViewStateResult } from "./View";
import type { TFile } from "../vault/TAbstractFile";

export class TextFileView extends EditableFileView {
  protected source = "";
  protected dirty = false;
  protected lastSavedData = "";
  protected saving = false;
  protected saveAgain = false;
  private saveTimer: ReturnType<typeof window.setTimeout> | null = null;
  requestSave = (): void => {
    this.dirty = true;
    this.scheduleSave();
  };

  get data(): string {
    return this.source;
  }

  set data(data: string) {
    this.source = data;
  }

  async onOpen(): Promise<void> {
    await super.onOpen();
    this.registerEvent(this.app.vault.on("modify", (file: TFile) => {
      void this.onExternalModify(file);
    }));
  }

  getViewData(): string {
    return this.source;
  }

  setViewData(data: string, clearDirty = false): void {
    this.source = data;
    this.dirty = !clearDirty;
    if (clearDirty) this.lastSavedData = data;
  }

  clear(): void {
    this.source = "";
    this.dirty = false;
    this.lastSavedData = "";
  }

  override async onLoadFile(file: TFile): Promise<void> {
    const data = await this.app.vault.read(file);
    this.setData(data, true);
  }

  override async onUnloadFile(_file: TFile): Promise<void> {
    await this.save(true);
  }

  async setState(state: unknown, result?: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (!this.file) this.clear();
  }

  async onClose(): Promise<void> {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
    await super.onClose();
  }

  async save(unload = false): Promise<void> {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty || !this.file) return;
    if (this.saving) {
      this.saveAgain = true;
      return;
    }

    this.saving = true;
    this.saveAgain = false;
    try {
      const file = this.app.vault.getFileByPath(this.file.path);
      const data = this.getViewData();
      if (unload) {
        this.clear();
      }
      if (file && data !== this.lastSavedData && this.lastSavedData !== null) await this.app.vault.modify(file, data);
      if (!unload) {
        this.lastSavedData = data;
        this.dirty = false;
      }
      this.app.workspace.trigger("file-saved", this.file, this);
    } finally {
      this.saving = false;
    }

    if (this.saveAgain) await this.save();
  }

  saveImmediately(): Promise<void> | void {
    if (this.dirty) return this.save(false);
  }

  protected setData(data: string, clear: boolean): void {
    this.lastSavedData = data;
    this.setViewData(data, clear);
  }

  protected async onExternalModify(file: TFile): Promise<void> {
    if (!this.file || file.path !== this.file.path || this.saving) return;
    const data = await this.app.vault.read(file);
    if (!this.dirty) {
      this.setData(data, true);
      return;
    }
    if (data !== this.lastSavedData) {
      this.setData(data, false);
    }
  }

  protected scheduleSave(delay = 2000): void {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, delay);
  }
}
