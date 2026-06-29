import type { App } from "./App";
import { Notice } from "../ui/Notice";
import { TFile, TFolder } from "../vault/TAbstractFile";
import type { LeafOpenMode } from "../workspace/Workspace";
import { readClipboardText, writeClipboardText } from "../dom/Clipboard";
import { parseLinktext } from "../metadata/Linkpath";

export function registerAppProtocolHandlers(app: App): void {
  app.uriRouter.registerAction("open", async ({ params }) => {
    const linktext = params.get("file");
    if (!linktext) return;
    const parsed = parseLinktext(linktext);
    const file = app.metadataCache.getFirstLinkpathDest(parsed.path, "");
    if (!file) {
      new Notice(`File not found: ${linktext}`);
      return;
    }

    const eState = parsed.subpath ? { subpath: parsed.subpath } : undefined;
    await app.workspace.getLeaf(parsePaneType(params.get("paneType"))).openFile(file, { active: true, eState });
    new Notice(`Opened ${file.path}`);
  });

  app.uriRouter.registerAction("search", async ({ params }) => {
    await app.corePluginsReady;
    const query = params.get("query") ?? "";
    const leaf = await app.workspace.ensureSideLeaf("search", "left", { active: true, reveal: true, state: { query } });
    const view = leaf.view as { focusSearch?: (query?: string) => void } | null;
    view?.focusSearch?.(query);
  });

  app.uriRouter.registerAction("show-release-notes", async ({ params }) => {
    await app.showReleaseNotes(params.get("version") ?? "current");
  });

  app.uriRouter.registerAction("new", async ({ params }) => {
    const file = await resolveProtocolNewFile(app, params);
    if (!file) return;

    let content = params.get("content") ?? "";
    if (hasFlag(params, "clipboard")) content = await readClipboardText();
    if (content) {
      if (hasFlag(params, "append") || hasFlag(params, "prepend")) {
        await app.fileManager.insertIntoFile(file, content, hasFlag(params, "prepend") ? "prepend" : "append");
      } else {
        await app.vault.modify(file, content);
      }
    }

    if (!hasFlag(params, "silent")) {
      await app.workspace.getLeaf(parsePaneType(params.get("paneType"))).openFile(file, {
        active: true,
        state: { mode: "source" },
        eState: { rename: "all" },
      });
    }
    app.workspace.handleXCallback(params, file);
  });

  app.uriRouter.registerAction("hook-get-address", async ({ params }) => {
    const file = app.workspace.getActiveFile();
    if (!file) {
      app.workspace.handleXErrorCallback(params, "NotFound", "No file is open at the moment");
      return;
    }

    if (!app.workspace.handleXCallback(params, file)) {
      await writeClipboardText(`[${file.basename}](${app.getObsidianUrl(file)})`);
    }
  });
}

async function resolveProtocolNewFile(app: App, params: URLSearchParams): Promise<TFile | null> {
  const shouldReuse = hasFlag(params, "append") || hasFlag(params, "prepend") || hasFlag(params, "overwrite");
  const filePath = params.get("file");
  if (filePath) {
    if (/\.\.[/\\]/.test(filePath)) return null;
    const existing = shouldReuse ? findExistingFile(app, filePath) : null;
    if (existing) return existing;

    const folderPath = parentPath(filePath);
    let folder = folderPath ? app.vault.getAbstractFileByPathInsensitive(folderPath) : app.vault.getFolderByPath("");
    if (folderPath && !folder) folder = await app.vault.createFolder(folderPath);
    if (!(folder instanceof TFolder) && folderPath) return null;

    try {
      return await app.fileManager.createNewFile(folder instanceof TFolder ? folder : null, basename(filePath));
    } catch (error) {
      new Notice(String(error));
      return null;
    }
  }

  const name = (params.get("name") ?? "").replace(/[/\\]/, "") || "Untitled";
  const existing = shouldReuse ? findExistingFile(app, name) : null;
  if (existing) return existing;

  const activePath = app.workspace.getActiveFile()?.path ?? "";
  const folder = app.fileManager.getNewFileParent(activePath, name);
  try {
    return await app.fileManager.createNewFile(folder, name);
  } catch (error) {
    new Notice(String(error));
    return null;
  }
}

function findExistingFile(app: App, linkpath: string): TFile | null {
  const fromMetadata = app.metadataCache.getFirstLinkpathDest(linkpath, "");
  if (fromMetadata) return fromMetadata;
  const abstractFile = app.vault.getAbstractFileByPathInsensitive(linkpath);
  return abstractFile instanceof TFile ? abstractFile : null;
}

function parsePaneType(value: string | null): LeafOpenMode | undefined {
  if (value === "tab" || value === "split" || value === "window") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function hasFlag(params: URLSearchParams, name: string): boolean {
  if (!params.has(name)) return false;
  const value = params.get(name);
  return value == null || value === "" || value === "1" || value.toLowerCase() === "true";
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}
