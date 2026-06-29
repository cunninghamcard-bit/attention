import type { TAbstractFile } from "./TAbstractFile";

export interface RenameValidationResult {
  error: string;
  name: string;
  warning: string;
}

type RenameVault = {
  checkForDuplicate(file: TAbstractFile, name: string): boolean;
};

const unsafeRenameChars = "#^[]|";

export function validateVaultPath(path: string): void {
  validateWindowsSpecialName(path);
  const invalidChars = getVaultInvalidPathChars();
  const invalidPattern = new RegExp(`[${escapeRegExp(invalidChars)}]`);
  if (path.split("/").some((part) => invalidPattern.test(part))) {
    throw new Error(`File name cannot contain any of the following characters: ${formatCharacterList(invalidChars)}`);
  }
}

export function validateRenameName(vault: RenameVault, file: TAbstractFile, rawName: string, requireNonEmpty: boolean): RenameValidationResult {
  const name = rawName.trim();
  if (requireNonEmpty && name.length === 0) return { name, error: "File name cannot be empty", warning: "" };
  if (name.length === 0) return { name, error: "", warning: "" };
  try {
    validateFileName(name);
  } catch (error) {
    return { name, error: error instanceof Error ? error.message : String(error), warning: "" };
  }
  if (name.startsWith(".")) return { name, error: "File name cannot start with a dot", warning: "" };
  if (vault.checkForDuplicate(file, name)) return { name, error: "File already exists", warning: "" };
  return {
    name,
    error: "",
    warning: hasUnsafeRenameChars(name) ? `File name contains unsafe characters: ${formatCharacterList(unsafeRenameChars)}` : "",
  };
}

export function validateRenamePromptName(vault: RenameVault, file: TAbstractFile, rawName: string): RenameValidationResult {
  const name = rawName.trim();
  if (name.length === 0) return { name, error: "File name cannot be empty", warning: "" };
  try {
    validateFileName(name);
  } catch (error) {
    return { name, error: error instanceof Error ? error.message : String(error), warning: "" };
  }
  if (name.startsWith(".")) return { name, error: "File name cannot start with a dot", warning: "" };
  if (hasUnsafeRenameChars(name)) return { name, error: `File name contains unsafe characters: ${formatCharacterList(unsafeRenameChars)}`, warning: "" };
  if (vault.checkForDuplicate(file, name)) return { name, error: "File already exists", warning: "" };
  return { name, error: "", warning: "" };
}

function validateFileName(name: string): void {
  validateWindowsSpecialName(name);
  const invalidChars = getVaultInvalidPathChars();
  const invalidPattern = new RegExp(`[${escapeRegExp(invalidChars)}]`);
  if (invalidPattern.test(name)) throw new Error(`File name cannot contain any of the following characters: ${formatCharacterList(invalidChars)}`);
}

function validateWindowsSpecialName(pathOrName: string): void {
  if (!isWindowsRuntime()) return;
  const lastChar = pathOrName.charAt(pathOrName.length - 1);
  if (lastChar === "." || lastChar === " ") throw new Error("File names cannot end with a dot or a space.");
  const stem = getPathStem(pathOrName);
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)) throw new Error(`File name is forbidden: ${stem}`);
}

function getVaultInvalidPathChars(): string {
  if (isWindowsRuntime()) return "*\"\\/<>:|?";
  return "\\/:" + (isAndroidRuntime() ? "*?<>\"" : "");
}

function hasUnsafeRenameChars(name: string): boolean {
  return new RegExp(`[${escapeRegExp(unsafeRenameChars)}]`).test(name);
}

function formatCharacterList(chars: string): string {
  return chars.split("").join(" ");
}

function getPathStem(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dotIndex = name.lastIndexOf(".");
  return dotIndex <= 0 ? name : name.slice(0, dotIndex);
}

function isWindowsRuntime(): boolean {
  return /Win/.test(globalThis.navigator?.platform ?? "") || getProcessPlatform() === "win32";
}

function isAndroidRuntime(): boolean {
  const navigatorInfo = `${globalThis.navigator?.userAgent ?? ""} ${globalThis.navigator?.appVersion ?? ""} ${globalThis.navigator?.platform ?? ""}`;
  return /android/i.test(navigatorInfo);
}

function getProcessPlatform(): string | undefined {
  return (globalThis as { process?: { platform?: string } }).process?.platform;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
