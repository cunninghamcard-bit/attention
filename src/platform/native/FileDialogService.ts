export interface OpenDialogOptions {
  title?: string;
  directory?: boolean;
  multiple?: boolean;
  extensions?: string[];
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  extensions?: string[];
}

export class FileDialogService {
  private lastOpenPath: string | null = null;
  private lastSavePath: string | null = null;

  async showOpenDialog(options: OpenDialogOptions = {}): Promise<string[]> {
    this.lastOpenPath = options.title ?? "open";
    return [];
  }

  async showSaveDialog(options: SaveDialogOptions = {}): Promise<string | null> {
    this.lastSavePath = options.defaultPath ?? null;
    return this.lastSavePath;
  }

  getLastOpenPath(): string | null { return this.lastOpenPath; }
  getLastSavePath(): string | null { return this.lastSavePath; }
}
