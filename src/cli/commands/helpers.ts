import type { App } from "../../app/App";
import { TFolder } from "../../vault/TAbstractFile";

// Shared helpers for the CLI command batches (core + internal-plugin lanes).
// File resolution lives on the Cli class itself (`cli.tryResolveFile`), the
// real home.

export function allFolders(app: App): TFolder[] {
  return app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder && file.path !== "/");
}

export function tabbed(rows: Record<string, string>): string {
  return Object.entries(rows)
    .map(([key, value]) => `${key}\t${value}`)
    .join("\n");
}
