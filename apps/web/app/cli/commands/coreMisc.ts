/**
 * Input: ../../../app/App, ../../../platform/Platform, ../../../vault/TAbstractFile, ../../../mount/MountAdapter, ./helpers
 * Output: registerCoreMiscCommands
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { App } from "../../../app/App";
import { Platform } from "../../../platform/Platform";
import { TFile, TFolder } from "../../../vault/TAbstractFile";
import { MountAdapter } from "../../../mount/MountAdapter";
import { tabbed } from "./helpers";

/**
 * The core misc CLI batch — `version`, `mounts`, `folder`, `file`. `version`,
 * `folder` and `file` are faithful to real Obsidian's registrations (app.js
 * ~1497230-1503380). Real's `vaults` (the registry listing) died with the
 * vault registry; `mounts` is its workspace-form successor, listing the roots
 * of THE workspace instead. Every command error here is thrown as a bare
 * string (the bridge wraps it as `Error: ...`), matching the reference. Wired
 * by the glue layer after all command lanes land.
 */

// Real recursive size over `folder.children`: folders recurse, files add
// `stat.size`, any other AbstractFile contributes 0.
function folderSize(folder: TFolder): number {
  let total = 0;
  for (const child of folder.children) {
    if (child instanceof TFolder) total += folderSize(child);
    else if (child instanceof TFile) total += child.stat.size;
  }
  return total;
}

export function registerCoreMiscCommands(app: App): void {
  const cli = app.cli;

  // The reference registers `version` with literally no flags and reads the
  // platform/app-info global (`Yl.version`/`Yl.build` — our Platform).
  cli.registerHandler(
    "version",
    "Show Obsidian version",
    null,
    () => `${Platform.version} (installer ${Platform.build})`,
  );

  cli.registerHandler(
    "mounts",
    "List workspace mounts",
    {
      total: { description: "Return mount count" },
      verbose: { description: "Include mount paths" },
    },
    (params) => {
      const adapter = app.vault.adapter;
      if (!(adapter instanceof MountAdapter)) throw "This vault has no mounts.";
      const mounts = adapter.getMounts();
      if (params.total) return String(mounts.length);
      return mounts
        .map((mount) => {
          if (!params.verbose) return mount.name;
          // Home lives in the replica, not on disk — no base path to show.
          const base = (mount.adapter as { getBasePath?(): string }).getBasePath?.() ?? "";
          return `${mount.name}\t${base}`;
        })
        .join("\n");
    },
  );

  cli.registerHandler(
    "folder",
    "Show folder info",
    {
      path: { value: "<path>", description: "Folder path", required: true },
      info: { value: "files|folders|size", description: "Return specific info only" },
    },
    (params) => {
      // The reference duplicates its required-flag check at runtime (dead via
      // the dispatcher's own validation, kept for fidelity).
      if (!params.path)
        throw "Missing required parameter: path\nUsage: folder path=<folder-path> [info=files|folders|size]";
      const folder = app.vault.getAbstractFileByPath(params.path);
      if (!folder) throw `Folder "${params.path}" not found.`;
      if (!(folder instanceof TFolder)) throw `"${params.path}" is a file, not a folder.`;
      const fileCount = folder.getFileCount();
      const folderCount = folder.getFolderCount();
      if (params.info === "files") return String(fileCount);
      if (params.info === "folders") return String(folderCount);
      if (params.info === "size") return String(folderSize(folder));
      // Any other info value falls through to the full report.
      return tabbed({
        path: folder.path,
        files: String(fileCount),
        folders: String(folderCount),
        size: String(folderSize(folder)),
      });
    },
  );

  cli.registerHandler(
    "file",
    "Show file info",
    {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
    },
    // Async in the reference (awaiter-wrapped) though it awaits nothing.
    async (params) => {
      const file = cli.tryResolveFile(params);
      // created/modified are the raw epoch-ms numbers, not formatted dates.
      return tabbed({
        path: file.path,
        name: file.basename,
        extension: file.extension,
        size: String(file.stat.size),
        created: String(file.stat.ctime),
        modified: String(file.stat.mtime),
      });
    },
  );
}
