import type { FileProperties } from "../properties/PropertyTypes";

export type BasesPropertyType = "note" | "formula" | "file";
export type BasesPropertyId = `${BasesPropertyType}.${string}`;

export interface BasesProperty {
  type: BasesPropertyType;
  name: string;
}

export interface FormulaContext {}

export interface ParsedBasesPropertyId {
  type: BasesPropertyType;
  name: string;
  id: BasesPropertyId;
}

export const FILE_PROPERTIES = [
  "file",
  "name",
  "basename",
  "fullname",
  "path",
  "folder",
  "ext",
  "ctime",
  "mtime",
  "size",
  "links",
  "backlinks",
  "embeds",
  "tags",
] as const;

export function parsePropertyId(propertyId: string): ParsedBasesPropertyId {
  const raw = propertyId.trim();
  if (raw === "file") return { type: "file", name: "file", id: "file.file" };
  const [prefix, ...rest] = raw.split(".");
  const name = rest.join(".");
  if ((prefix === "note" || prefix === "file" || prefix === "formula") && name) {
    return { type: prefix, name, id: `${prefix}.${name}` as BasesPropertyId };
  }
  return { type: "note", name: raw, id: `note.${raw}` as BasesPropertyId };
}

export function serializePropertyId(propertyId: string): string {
  const parsed = parsePropertyId(propertyId);
  return parsed.type === "note" ? parsed.name : parsed.id;
}

export function getBasesPropertyValue(file: FileProperties, propertyId: string, formulas: Record<string, string> = {}): unknown {
  const parsed = parsePropertyId(propertyId);
  if (parsed.type === "note") return file.values[parsed.name] ?? null;
  if (parsed.type === "formula") return evaluateBaseFormula(formulas[parsed.name] ?? parsed.name, file, formulas);
  return getFilePropertyValue(file, parsed.name);
}

export function getFilePropertyValue(file: FileProperties, property: string): unknown {
  if (property === "file" || property === "path") return file.path;
  if (property === "fullname" || property === "name") return file.file.name;
  if (property === "basename") return file.file.basename;
  if (property === "folder") return file.file.parentPath;
  if (property === "ext") return file.file.extension;
  if (property === "tags") return file.values.tags ?? [];
  if (property === "links" || property === "backlinks" || property === "embeds") return [];
  if (property === "ctime") return file.file.stat.ctime;
  if (property === "mtime") return file.file.stat.mtime;
  if (property === "size") return file.file.stat.size;
  return null;
}

export function evaluateBaseFormula(formula: string, file: FileProperties, formulas: Record<string, string> = {}, stack: string[] = []): unknown {
  const trimmed = formula.trim();
  if (!trimmed) return null;
  if (stack.includes(trimmed)) throw new Error(`Infinite formula loop: ${trimmed}`);
  if (trimmed.startsWith("formula.") && formulas[trimmed.slice("formula.".length)]) {
    return evaluateBaseFormula(formulas[trimmed.slice("formula.".length)], file, formulas, [...stack, trimmed]);
  }
  if (trimmed.startsWith("note.") || trimmed.startsWith("file.")) return getBasesPropertyValue(file, trimmed, formulas);
  const propertyMatch = /^property\(["'](.+)["']\)$/.exec(trimmed);
  if (propertyMatch) return getBasesPropertyValue(file, propertyMatch[1], formulas);
  const countMatch = /^count\(["'](.+)["']\)$/.exec(trimmed);
  if (countMatch) {
    const value = getBasesPropertyValue(file, countMatch[1], formulas);
    return Array.isArray(value) ? value.length : value == null ? 0 : 1;
  }
  if (trimmed === "file.name") return getFilePropertyValue(file, "name");
  if (trimmed === "file.path") return file.path;
  if (trimmed === "file.folder") return getFilePropertyValue(file, "folder");
  throw new Error(`Unsupported formula: ${formula}`);
}
