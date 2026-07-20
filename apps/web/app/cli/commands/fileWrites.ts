import type { App } from "../../../app/App";
import { formatDate } from "../../../builtin/DailyNotes";
import type { TemplatesController } from "../../../builtin/Templates";
import { TFile, TFolder } from "../../../vault/TAbstractFile";

/**
 * The file-write CLI command batch — `create`, `append`, `prepend`, `move`,
 * `rename`, `delete`, reconstructed verbatim from real Obsidian's built-in
 * handlers. All user-facing errors are thrown as raw strings (the electron
 * bridge wraps them as "Error: ..."), never returned as results.
 */

// Literal 2-char \n and \t sequences in the argument become real characters.
// Applied only to create's content branch, append, and prepend — never to
// template content.
function unescapeContent(content: string): string {
  return content.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

// Real `cu()` path normalize, used by create's overwrite lookup and the
// template resolver's folder path.
function normalizePath(path: string): string {
  const collapsed = path
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/[\\/]+/g, "/")
    .replace(/^\/+|\/+$/g, "");
  return (collapsed === "" ? "/" : collapsed).normalize("NFC");
}

// Reconstructs the templates plugin's `resolveTemplateFile` (our controller
// does not expose it): exact `<folder>/<name>` lookup with ".md" appended
// only when the name lacks it, then a case-insensitive match of the raw name
// against each md file's folder-relative path minus its ".md" (real slices
// -3 unconditionally). Error cases are RETURNED as strings (the real
// resolver's shape); create re-throws them.
function resolveTemplateFile(app: App, folder: string, name: string): TFile | string {
  if (!name) return "Missing required parameter: name\nUsage: name=<template>";
  if (!folder) return "No template folder configured.";
  const folderPath = normalizePath(folder);
  if (!(app.vault.getAbstractFileByPath(folderPath) instanceof TFolder))
    return `Template folder "${folder}" not found.`;
  let exactPath = `${folderPath}/${name}`;
  if (!exactPath.endsWith(".md")) exactPath += ".md";
  const exact = app.vault.getAbstractFileByPath(exactPath);
  if (exact instanceof TFile) return exact;
  const lowered = name.toLowerCase();
  const match = app.vault
    .getMarkdownFiles()
    .find(
      (file) =>
        file.path.startsWith(`${folderPath}/`) &&
        file.path.slice(folderPath.length + 1, -3).toLowerCase() === lowered,
    );
  return match ?? `Template "${name}" not found.`;
}

// Real `QD()`: {{title}} first (case-insensitive, global), then every
// {{date}}/{{time}}/{{date:FMT}}/{{time:FMT}} from ONE shared instant.
// Divergence: our formatDate supports a moment-token subset, not full moment.
function substituteTemplateVars(
  text: string,
  title: string,
  dateFormat: string | undefined,
  timeFormat: string | undefined,
): string {
  let now: Date | null = null;
  return text
    .replace(/{{title}}/gi, title)
    .replace(/{{(date|time)(?::(.*?))?}}/gi, (_match, kind: string, format?: string) => {
      now ??= new Date();
      const fallback =
        kind.toLowerCase() === "date" ? dateFormat || "YYYY-MM-DD" : timeFormat || "HH:mm";
      return formatDate(now, format || fallback);
    });
}

// Real `Xx()` frontmatter locator: prepend inserts after a terminated YAML
// block; an absent or unterminated block means the very top (index 0).
function frontmatterContentStart(text: string): number {
  const opener = /^---(\r?\n)/.exec(text);
  if (!opener) return 0;
  const closer = /---(\r?\n|$)/g;
  closer.lastIndex = opener[0].length;
  for (let match = closer.exec(text); match; match = closer.exec(text)) {
    if (text.charAt(match.index - 1) === "\n") return closer.lastIndex;
  }
  return 0;
}

export function registerFileWriteCommands(app: App): void {
  const cli = app.cli;

  cli.registerHandler(
    "create",
    "Create a new file",
    {
      name: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      content: { value: "<text>", description: "Initial content" },
      template: { value: "<name>", description: "Template to use" },
      overwrite: { description: "Overwrite if file exists" },
      open: { description: "Open file after creating" },
      newtab: { description: "Open in new tab" },
    },
    async (params) => {
      if (params.name && params.name.includes("/"))
        throw 'name cannot contain "/". Use path for a full file path.';
      let basePath =
        params.path && params.name
          ? `${params.path.replace(/\/+$/, "")}/${params.name}`
          : params.path || params.name || "Untitled";
      let extension = "md";
      const dot = basePath.lastIndexOf(".");
      // Strictly > 0 so a leading dot does not split off an extension.
      if (dot > 0) {
        extension = basePath.slice(dot + 1);
        basePath = basePath.slice(0, dot);
      }

      let content = "";
      // Truthiness, not key presence: an empty `template=` falls through to
      // the content branch, so the resolver's missing-name error is
      // unreachable from here. Template wins; content is ignored.
      if (params.template) {
        const templates =
          app.internalPlugins.getEnabledPluginById<TemplatesController>("templates");
        if (!templates) throw "Templates plugin is not enabled.";
        const resolved = resolveTemplateFile(app, templates.options.folder ?? "", params.template);
        if (typeof resolved === "string") throw resolved;
        const title = basePath.split("/").pop() ?? "";
        content = substituteTemplateVars(
          await app.vault.cachedRead(resolved),
          title,
          templates.options.dateFormat,
          templates.options.timeFormat,
        );
      } else if (params.content) {
        content = unescapeContent(params.content);
      }

      const openIfRequested = async (file: TFile) => {
        // Real shape `!!args.newtab && "tab"`, spelled as a ternary for TS.
        if (params.open)
          await app.workspace
            .getLeaf(params.newtab ? "tab" : false)
            .openFile(file, { active: true });
      };

      if (params.overwrite) {
        const existing = app.vault.getAbstractFileByPath(normalizePath(`${basePath}.${extension}`));
        let file: TFile;
        if (existing instanceof TFile) {
          await app.vault.modify(existing, content);
          file = existing;
        } else {
          file = await app.fileManager.createNewFile(null, basePath, extension, content);
        }
        await openIfRequested(file);
        // Faithful quirk: a folder at the target still reports "Overwrote:"
        // even though a fresh file was created next to it.
        return `${existing ? "Overwrote" : "Created"}: ${file.path}`;
      }

      const file = await app.fileManager.createNewFile(null, basePath, extension, content);
      await openIfRequested(file);
      return `Created: ${file.path}`;
    },
  );

  cli.registerHandler(
    "append",
    "Append content to a file",
    {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      content: { value: "<text>", description: "Content to append", required: true },
      inline: { description: "Append without newline" },
    },
    async (params) => {
      const file = cli.tryResolveFile(params);
      if (!params.content)
        throw "Missing required parameter: content\nUsage: append [file=<name>] [path=<path>] content=<text> [inline]";
      const content = unescapeContent(params.content);
      // Unconditional "\n" before the content unless inline, even if the file
      // is empty or already ends with a newline; nothing appended after.
      await app.vault.process(file, (data) => data + (params.inline ? "" : "\n") + content);
      return `Appended to: ${file.path}`;
    },
  );

  cli.registerHandler(
    "prepend",
    "Prepend content to a file",
    {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      content: { value: "<text>", description: "Content to prepend", required: true },
      inline: { description: "Prepend without newline" },
    },
    async (params) => {
      const file = cli.tryResolveFile(params);
      if (!params.content)
        throw "Missing required parameter: content\nUsage: prepend [file=<name>] [path=<path>] content=<text> [inline]";
      const content = unescapeContent(params.content);
      await app.vault.process(file, (data) => {
        const at = frontmatterContentStart(data);
        return data.substring(0, at) + content + (params.inline ? "" : "\n") + data.substring(at);
      });
      return `Prepended to: ${file.path}`;
    },
  );

  cli.registerHandler(
    "move",
    "Move or rename a file",
    {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      to: { value: "<path>", description: "Destination folder or path", required: true },
    },
    async (params) => {
      // The handler's own usage text differs from the dispatcher's generic
      // one (which fires first when the key is entirely absent).
      if (!params.to) throw "Missing required parameter: to\nUsage: move to=<folder> or to=<path>";
      const file = cli.tryResolveFile(params);
      const target = params.to.replace(/^\/+|\/+$/g, "");
      // A dot ANYWHERE makes it a full file path; else folder move keeping
      // the filename; only-slashes means vault root.
      const destination = target.includes(".")
        ? target
        : target
          ? `${target}/${file.name}`
          : file.name;
      const oldPath = file.path;
      await app.fileManager.renameFile(file, destination);
      return `Moved: ${oldPath} -> ${destination}`;
    },
  );

  cli.registerHandler(
    "rename",
    "Rename a file",
    {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      name: { value: "<name>", description: "New file name", required: true },
    },
    async (params) => {
      if (!params.name) throw "Missing required parameter: name\nUsage: rename name=<new name>";
      const file = cli.tryResolveFile(params);
      let newName = params.name;
      // Extension preserved for a bare name; any dot means the name is literal.
      if (!newName.includes(".") && file.extension) newName += `.${file.extension}`;
      const parentPath = file.parent ? file.parent.path.replace(/^\/+|\/+$/g, "") : "";
      const destination = parentPath ? `${parentPath}/${newName}` : newName;
      const oldPath = file.path;
      await app.fileManager.renameFile(file, destination);
      return `Renamed: ${oldPath} -> ${destination}`;
    },
  );

  cli.registerHandler(
    "delete",
    "Delete a file",
    {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      permanent: { description: "Skip trash, delete permanently" },
    },
    async (params) => {
      const file = cli.tryResolveFile(params);
      if (params.permanent) {
        await app.vault.delete(file);
        return `Deleted permanently: ${file.path}`;
      }
      // Second arg hard-coded true = system trash, NOT the user's configured
      // trash preference. No confirmation prompt.
      await app.vault.trash(file, true);
      return `Moved to trash: ${file.path}`;
    },
  );
}
