import type { App } from "./App";
import { SuggestModal } from "../ui/suggest/SuggestModal";
import { TAbstractFile, TFile, TFolder } from "../vault/TAbstractFile";

export class MoveFileModal extends SuggestModal<TFolder> {
  constructor(
    app: App,
    readonly files: TAbstractFile[],
  ) {
    super(app);
    this.setPlaceholder(
      files.length === 1
        ? `Move ${files[0]?.name ?? "item"} to...`
        : `Move ${files.length} items to...`,
    );
    this.emptyStateText = "No folders found";
    this.setInstructions([
      { command: "↑↓", purpose: "Navigate" },
      { command: "↵", purpose: "Move" },
      { command: "esc", purpose: "Dismiss" },
    ]);
  }

  getSuggestions(query: string): TFolder[] {
    const normalizedQuery = query.trim().toLowerCase();
    return this.app.vault
      .getAllFolders(true)
      .filter((folder) => this.canMoveTo(folder))
      .filter((folder) => {
        if (!normalizedQuery) return true;
        return (
          getFolderLabel(this.app, folder).toLowerCase().includes(normalizedQuery) ||
          folder.path.toLowerCase().includes(normalizedQuery)
        );
      })
      .sort((left, right) =>
        getSortPath(left).localeCompare(getSortPath(right), undefined, {
          sensitivity: "base",
          numeric: true,
        }),
      );
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    const titleEl = el.ownerDocument.createElement("div");
    titleEl.className = "suggestion-title";
    titleEl.textContent = getFolderLabel(this.app, folder);
    const noteEl = el.ownerDocument.createElement("div");
    noteEl.className = "suggestion-note";
    noteEl.textContent = folder.isRoot() ? "/" : folder.path;
    el.append(titleEl, noteEl);
  }

  onChooseSuggestion(folder: TFolder): void {
    void this.moveFiles(folder);
  }

  private async moveFiles(folder: TFolder): Promise<void> {
    for (const file of this.files) {
      const targetPath = getMoveTargetPath(file, folder);
      if (targetPath === file.path) continue;
      await this.app.fileManager.renameAbstractFile(file, targetPath);
    }
  }

  private canMoveTo(folder: TFolder): boolean {
    return this.files.every((file) => {
      if (file instanceof TFolder && (folder === file || folder.path.startsWith(`${file.path}/`)))
        return false;
      return getMoveTargetPath(file, folder) !== file.path;
    });
  }
}

function getMoveTargetPath(file: TAbstractFile, folder: TFolder): string {
  const prefix = folder.isRoot() ? "" : `${folder.path}/`;
  return `${prefix}${file.name}`;
}

function getFolderLabel(app: App, folder: TFolder): string {
  return folder.isRoot() ? app.vault.getName() : folder.name;
}

function getSortPath(folder: TFolder): string {
  return folder.isRoot() ? "" : folder.path;
}
