/**
 * Input: ../../app/App, ./Cli, ../../vault/FileSystemAdapter, ../../vault/TAbstractFile, ../../vault/Vault, ../../views/MarkdownView, ./commands/coreMisc, ./commands/fileWrites, ./commands/graphLists, ./commands/metadata, ./commands/navigation
 * Output: registerCliCommands
 * Pos: Application code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import type { App } from "../../app/App";
import { alphaCompare } from "./Cli";
import { FileSystemAdapter } from "../../vault/FileSystemAdapter";
import { TFolder } from "../../vault/TAbstractFile";
import { Vault } from "../../vault/Vault";
import { MarkdownView } from "../../views/MarkdownView";
import { registerCoreMiscCommands } from "./commands/coreMisc";
import { registerFileWriteCommands } from "./commands/fileWrites";
import { registerGraphListCommands } from "./commands/graphLists";
import { registerMetadataCommands } from "./commands/metadata";
import { registerNavigationCommands } from "./commands/navigation";

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

  // Verbatim shape: info values checked one by one, unknown values (and a
  // bare `info` flag) fall through to the full report; the path row appears
  // only for a FileSystemAdapter, and info=path without one returns
  // "(not available)"; counts come from the root folder's recursive counters.
  cli.registerHandler(
    "vault",
    "Show vault info",
    { info: { value: "name|path|files|folders|size", description: "Return specific info only" } },
    (params) => {
      const adapter = app.vault.adapter;
      if (params.info === "name") return app.vault.getName();
      if (params.info === "path")
        return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "(not available)";
      const root = app.vault.getRoot();
      const fileCount = root.getFileCount();
      const folderCount = root.getFolderCount();
      if (params.info === "files") return String(fileCount);
      if (params.info === "folders") return String(folderCount);
      if (params.info === "size") {
        let size = 0;
        for (const file of app.vault.getFiles()) size += file.stat.size;
        return String(size);
      }
      const lines: string[] = [];
      lines.push(`name\t${app.vault.getName()}`);
      if (adapter instanceof FileSystemAdapter) lines.push(`path\t${adapter.getBasePath()}`);
      lines.push(`files\t${fileCount}`);
      lines.push(`folders\t${folderCount}`);
      let size = 0;
      for (const file of app.vault.getFiles()) size += file.stat.size;
      lines.push(`size\t${size}`);
      return lines.join("\n");
    },
  );

  // Flag checks are plain truthy (a bare `folder` filters by the folder
  // "true"); ext= strips a leading dot; output is ub-sorted paths.
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
      if (params.folder) {
        const prefix = params.folder.endsWith("/") ? params.folder : `${params.folder}/`;
        files = files.filter((f) => f.path.startsWith(prefix));
      }
      if (params.ext) {
        const ext = params.ext.startsWith(".") ? params.ext.slice(1) : params.ext;
        files = files.filter((f) => f.extension === ext);
      }
      if (params.total) return String(files.length);
      return files
        .map((f) => f.path)
        .sort(alphaCompare)
        .join("\n");
    },
  );

  // folder= picks the traversal ROOT (throwing when missing), not a prefix
  // filter; recurseChildren visits the start folder itself, so the vault root
  // "/" appears in the unfiltered list.
  cli.registerHandler(
    "folders",
    "List folders in the vault",
    {
      folder: { value: "<path>", description: "Filter by parent folder" },
      total: { description: "Return folder count" },
    },
    (params) => {
      const start = params.folder ? app.vault.getFolderByPath(params.folder) : app.vault.getRoot();
      if (!start) throw `Folder "${params.folder}" not found.`;
      const folders: TFolder[] = [];
      Vault.recurseChildren(start, (file) => {
        if (file instanceof TFolder) folders.push(file);
      });
      if (params.total) return String(folders.length);
      return folders
        .map((f) => f.path)
        .sort(alphaCompare)
        .join("\n");
    },
  );

  cli.registerHandler(
    "read",
    "Read file contents",
    {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
    },
    // Real handler: shared resolver (throws), then cachedRead.
    async (params) => app.vault.cachedRead(cli.tryResolveFile(params)),
  );

  cli.registerHandler(
    "open",
    "Open a file",
    {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      newtab: { description: "Open in new tab" },
      line: { value: "<n>", description: "Scroll to this line (1-based) and select it" },
      to: { value: "<n>", description: "With line=, select through this line (1-based)" },
    },
    // Real handler: NO active-file fallback (`tryResolveFile(t, !1)`) — bare
    // `open` throws "Missing required parameter: file or path".
    // line=/to= are Attention's own: they let an agent open a passage, not
    // just a file, through the eState every text view already honors.
    async (params) => {
      const file = cli.tryResolveFile(params, false);
      const range = parseLineRange(params.line, params.to);
      const leaf = app.workspace.getLeaf(params.newtab ? "tab" : false);
      await leaf.openFile(file, {
        active: true,
        ...(range ? { eState: { line: range.from - 1, endLine: range.to - 1 } } : {}),
      });
      if (!range) return `Opened: ${file.path}`;
      const view = leaf.view;
      if (view instanceof MarkdownView && view.getMode() === "source") {
        // The markdown editor scrolls to eState.line; the passage is selected here.
        const last = Math.min(range.to, view.editor.lineCount()) - 1;
        const anchor = { line: range.from - 1, ch: 0 };
        const head = { line: last, ch: view.editor.getLine(last).length };
        view.editor.setSelection(anchor, head);
        view.editor.scrollIntoView({ from: anchor, to: head }, true);
      }
      return `Opened: ${file.path}:${range.from === range.to ? range.from : `${range.from}-${range.to}`}`;
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
      let list = app.commands.listCommands();
      if (params.filter) list = list.filter((command) => command.id.startsWith(params.filter));
      list.sort((a, b) => alphaCompare(a.id, b.id));
      return list.map((command) => command.id).join("\n");
    },
  );

  registerFileWriteCommands(app);
  registerMetadataCommands(app);
  registerGraphListCommands(app);
  registerNavigationCommands(app);
  registerCoreMiscCommands(app);
}

/** `line=` / `to=` as a 1-based inclusive range; null when `line=` is absent. */
function parseLineRange(line: unknown, to: unknown): { from: number; to: number } | null {
  if (line === undefined) {
    if (to !== undefined) throw "to= needs line=";
    return null;
  }
  const from = Number(line);
  if (!Number.isInteger(from) || from < 1) throw `Invalid line: ${String(line)}`;
  if (to === undefined) return { from, to: from };
  const end = Number(to);
  if (!Number.isInteger(end) || end < from) throw `Invalid to: ${String(to)}`;
  return { from, to: end };
}
