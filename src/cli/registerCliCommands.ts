import type { App } from "../app/App";
import type { CliData } from "./Cli";
import { TFile, TFolder } from "../vault/TAbstractFile";

/**
 * The core CLI command batch — registered by the app itself (not a plugin)
 * against services that actually work in this reconstruction. Per the spec: no
 * empty handlers, no fake results. Commands whose service is absent
 * (vaults across the registry, sync, graph, bases) are deliberately NOT here.
 *
 * Reconstructed command names/flags/output shapes from real Obsidian's `obsidian
 * help` (e.g. `vault` returns tab-separated `key\tvalue` lines).
 */
export function registerCliCommands(app: App): void {
  const cli = app.cli;

  cli.registerHandler(
    "vault",
    "Show vault info",
    { info: { value: "name|path|files|folders|size", description: "Return specific info only" } },
    (params) => {
      const adapter = app.vault.adapter as { getBasePath?(): string } | undefined;
      const rows: Record<string, string> = {
        name: app.vault.getName(),
        path: adapter?.getBasePath?.() ?? "",
        files: String(app.vault.getFiles().length),
        folders: String(allFolders(app).length),
        size: String(app.vault.getFiles().reduce((sum, file) => sum + (file.stat?.size ?? 0), 0)),
      };
      // `info=<key>` returns just that value; otherwise all rows tab-separated.
      const info = params.info;
      if (info && info !== "true") return rows[info] ?? "";
      return tabbed(rows);
    },
  );

  cli.registerHandler(
    "files",
    "List files in the vault",
    {
      folder: { value: "<path>", description: "Filter by folder" },
      ext: { value: "<extension>", description: "Filter by extension" },
      total: { description: "Return file count" },
    },
    (params) => {
      let files = app.vault.getFiles();
      if (params.folder && params.folder !== "true") files = files.filter((f) => f.path.startsWith(`${params.folder}/`));
      if (params.ext && params.ext !== "true") files = files.filter((f) => f.extension === params.ext);
      if (params.total === "true") return String(files.length);
      return files.map((f) => f.path).join("\n");
    },
  );

  cli.registerHandler(
    "folders",
    "List folders in the vault",
    {
      folder: { value: "<path>", description: "Filter by parent folder" },
      total: { description: "Return folder count" },
    },
    (params) => {
      let folders = allFolders(app);
      if (params.folder && params.folder !== "true") folders = folders.filter((f) => f.path.startsWith(`${params.folder}/`));
      if (params.total === "true") return String(folders.length);
      return folders.map((f) => f.path).join("\n");
    },
  );

  cli.registerHandler(
    "read",
    "Read file contents",
    { file: { value: "<name>", description: "File name" }, path: { value: "<path>", description: "File path" } },
    async (params) => {
      const file = resolveFile(app, params);
      if (!file) return "File not found.";
      return app.vault.read(file);
    },
  );

  cli.registerHandler(
    "open",
    "Open a file",
    {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      newtab: { description: "Open in new tab" },
    },
    async (params) => {
      const file = resolveFile(app, params);
      if (!file) return "File not found.";
      await app.workspace.openLinkText(file.path, "", params.newtab === "true" ? "tab" : false);
      return `Opened ${file.path}`;
    },
  );

  cli.registerHandler(
    "command",
    "Execute an Obsidian command",
    { id: { value: "<command-id>", description: "Command ID to execute", required: true } },
    (params) => {
      const ran = app.commands.executeCommandById(String(params.id));
      return ran ? `Executed ${params.id}` : `Command "${params.id}" not found.`;
    },
  );

  cli.registerHandler(
    "commands",
    "List available commands",
    { filter: { value: "<prefix>", description: "Filter by ID prefix" } },
    (params) => {
      let ids = app.commands.listCommands().map((command) => command.id);
      if (params.filter && params.filter !== "true") ids = ids.filter((id) => id.startsWith(String(params.filter)));
      return ids.sort().join("\n");
    },
  );
}

// `file=<name>` resolves like a wikilink; `path=<path>` is exact. Falls back to
// the active file when neither is given (real Obsidian's default).
function resolveFile(app: App, params: CliData): TFile | null {
  if (params.path && params.path !== "true") {
    const file = app.vault.getAbstractFileByPath(String(params.path));
    return file instanceof TFile ? file : null;
  }
  if (params.file && params.file !== "true") {
    return app.metadataCache.getFirstLinkpathDest(String(params.file), "");
  }
  return app.workspace.getActiveFile();
}

function allFolders(app: App): TFolder[] {
  return app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder && file.path !== "/");
}

function tabbed(rows: Record<string, string>): string {
  return Object.entries(rows)
    .map(([key, value]) => `${key}\t${value}`)
    .join("\n");
}
