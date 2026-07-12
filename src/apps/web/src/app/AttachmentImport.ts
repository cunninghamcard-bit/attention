export type AttachmentImportData =
  | ArrayBuffer
  | ArrayBufferView
  | null
  | Promise<ArrayBuffer | ArrayBufferView | null>;

export interface AttachmentImportFile {
  name: string;
  extension: string;
  filepath: string;
  data: AttachmentImportData;
  file?: File;
}

export type AttachmentImportMode = "drop" | "clipboard";

export function getAttachmentFilesFromDataTransfer(
  dataTransfer: DataTransfer | null,
  modeOrIncludeData: AttachmentImportMode | boolean = "drop",
  includeData = true,
): AttachmentImportFile[] {
  const shouldIncludeData =
    typeof modeOrIncludeData === "boolean" ? modeOrIncludeData : includeData;
  const itemFiles = Array.from(dataTransfer?.items ?? []).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    if (!file) return [];
    return [createAttachmentImportFile(file, shouldIncludeData)];
  });
  if (itemFiles.length) return itemFiles;
  return Array.from(dataTransfer?.files ?? []).map((file) =>
    createAttachmentImportFile(file, shouldIncludeData),
  );
}

export function hasDataTransferAttachmentFiles(dataTransfer: DataTransfer | null): boolean {
  return Boolean(
    Array.from(dataTransfer?.items ?? []).some((item) => item.kind === "file") ||
    (dataTransfer?.files?.length ?? 0) > 0 ||
    Array.from(dataTransfer?.types ?? []).includes("Files"),
  );
}

export function createAttachmentImportFile(file: File, includeData = true): AttachmentImportFile {
  const { basename, extension } = splitAttachmentFilename(file.name || "Pasted image");
  return {
    file,
    name: basename || "Pasted image",
    extension: extension || getAttachmentExtensionFromMime(file.type),
    filepath: getAttachmentFilePath(file),
    data: includeData && typeof file.arrayBuffer === "function" ? file.arrayBuffer() : null,
  };
}

export function getTimestampForPastedImage(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export function splitAttachmentFilename(name: string): { basename: string; extension: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { basename: name, extension: "" };
  return { basename: name.slice(0, dot), extension: name.slice(dot + 1).toLowerCase() };
}

function getAttachmentFilePath(file: File): string {
  const electronPath = getElectronFilePath(file);
  if (electronPath) return electronPath;
  const fileLike = file as File & { path?: string; webkitRelativePath?: string };
  return fileLike.path || fileLike.webkitRelativePath || "";
}

function getAttachmentExtensionFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  return "";
}

interface ElectronFilePathModule {
  webUtils?: {
    getPathForFile?: (file: File) => string;
  };
}

type ElectronRequire = (moduleName: "electron") => ElectronFilePathModule;

function getElectronFilePath(file: File): string {
  const globalWithRequire = globalThis as typeof globalThis & {
    require?: ElectronRequire;
    window?: Window & { require?: ElectronRequire };
  };
  const candidates = [globalWithRequire.require, globalWithRequire.window?.require];
  for (const requireElectron of candidates) {
    if (!requireElectron) continue;
    try {
      const path = requireElectron("electron").webUtils?.getPathForFile?.(file) ?? "";
      if (path) return path;
    } catch {
      continue;
    }
  }
  return "";
}
