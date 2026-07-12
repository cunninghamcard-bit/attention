import { Events } from "../core/Events";
import type { TAbstractFile } from "./TAbstractFile";
import type { Vault } from "./Vault";

export type FileWatchEventType = "create" | "modify" | "delete" | "rename";

export interface FileWatchEvent {
  type: FileWatchEventType;
  file: TAbstractFile;
  oldPath?: string;
}

export class FileWatcher extends Events {
  constructor(readonly vault: Vault) {
    super();
    vault.on("create", (file: TAbstractFile) => this.emit({ type: "create", file }));
    vault.on("modify", (file: TAbstractFile) => this.emit({ type: "modify", file }));
    vault.on("delete", (file: TAbstractFile) => this.emit({ type: "delete", file }));
    vault.on("rename", (file: TAbstractFile, oldPath: string) =>
      this.emit({ type: "rename", file, oldPath }),
    );
  }

  emit(event: FileWatchEvent): void {
    this.trigger("change", event);
    this.trigger(event.type, event);
  }
}
