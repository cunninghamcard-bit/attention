import type { App } from "../app/App";
import type { WorkspaceLayout } from "./WorkspaceLayout";
import { WorkspaceLayoutSerializer } from "./WorkspaceLayoutSerializer";

export class WorkspaceLayoutPersistence {
  readonly serializer = new WorkspaceLayoutSerializer();
  private lastSaved: WorkspaceLayout | null = null;

  constructor(readonly app: App, readonly fileName = getWorkspaceLayoutFileName()) {}

  async saveCurrentLayout(): Promise<WorkspaceLayout> {
    const layout = this.serializer.serialize(this.app.workspace);
    if (this.app.workspace.recentFilePaths.length > 0) layout.lastOpenFiles = [...this.app.workspace.recentFilePaths];
    this.lastSaved = layout;
    await this.writeWorkspaceFile(layout);
    return layout;
  }

  async loadSavedLayout(): Promise<WorkspaceLayout | null> {
    const layout = await this.readWorkspaceFile();
    this.lastSaved = layout;
    return layout;
  }

  async restoreSavedLayout(): Promise<WorkspaceLayout | null> {
    const layout = await this.app.workspace.loadLayout();
    return layout;
  }

  getLastSavedLayout(): WorkspaceLayout | null {
    return this.lastSaved ? structuredClone(this.lastSaved) : null;
  }

  readWorkspaceFile(): Promise<WorkspaceLayout | null> {
    return this.app.vault.readJson<WorkspaceLayout>(this.getWorkspaceFilePath());
  }

  writeWorkspaceFile(layout: WorkspaceLayout): Promise<void> {
    return this.app.vault.writeJson(this.getWorkspaceFilePath(), layout);
  }

  getWorkspaceFilePath(): string {
    return `${this.app.vault.configDir}/${this.fileName}`;
  }
}

export const desktopWorkspaceFileName = "workspace.json";
export const mobileWorkspaceFileName = "workspace-mobile.json";

function getWorkspaceLayoutFileName(): string {
  return isMobileRuntime() ? mobileWorkspaceFileName : desktopWorkspaceFileName;
}

function isMobileRuntime(): boolean {
  return document.body.classList.contains("is-mobile") || navigator.userAgent.includes("Mobile");
}
