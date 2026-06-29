import type { FileProperties } from "../properties/PropertyTypes";
import { getBasesPropertyValue } from "./BasesProperty";

export type BasesConfigFileFilter =
  | string
  | { and: BasesConfigFileFilter[] }
  | { or: BasesConfigFileFilter[] }
  | { not: BasesConfigFileFilter[] };

export function filterBasesRows(rows: FileProperties[], filter: BasesConfigFileFilter | undefined, formulas: Record<string, string> = {}): FileProperties[] {
  if (!filter) return rows;
  return rows.filter((row) => matchesBasesFilter(row, filter, formulas));
}

export function andBasesFilters(...filters: Array<BasesConfigFileFilter | undefined>): BasesConfigFileFilter | undefined {
  const active = filters.filter(Boolean) as BasesConfigFileFilter[];
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return { and: active };
}

export function matchesBasesFilter(file: FileProperties, filter: BasesConfigFileFilter, formulas: Record<string, string> = {}): boolean {
  if (typeof filter === "string") return matchesFormulaLikeFilter(file, filter, formulas);
  if ("and" in filter) return filter.and.every((child) => matchesBasesFilter(file, child, formulas));
  if ("or" in filter) return filter.or.some((child) => matchesBasesFilter(file, child, formulas));
  if ("not" in filter) return !filter.not.every((child) => matchesBasesFilter(file, child, formulas));
  return true;
}

function matchesFormulaLikeFilter(file: FileProperties, source: string, formulas: Record<string, string>): boolean {
  const trimmed = source.trim();
  if (!trimmed) return true;
  const hasTag = /^hasTag\(["'](.+)["']\)$/.exec(trimmed);
  if (hasTag) {
    const tags = getBasesPropertyValue(file, "note.tags", formulas);
    return Array.isArray(tags) && tags.includes(hasTag[1]);
  }
  const inFolder = /^inFolder\(["'](.+)["']\)$/.exec(trimmed);
  if (inFolder) return String(getBasesPropertyValue(file, "file.folder", formulas)).startsWith(inFolder[1]);
  const isEmpty = /^isEmpty\((.+)\)$/.exec(trimmed);
  if (isEmpty) {
    const value = getBasesPropertyValue(file, isEmpty[1].trim(), formulas);
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  }
  const contains = /^contains\((.+),\s*["'](.+)["']\)$/.exec(trimmed);
  if (contains) {
    const value = getBasesPropertyValue(file, contains[1].trim(), formulas);
    return Array.isArray(value) ? value.includes(contains[2]) : String(value ?? "").includes(contains[2]);
  }
  const hasProperty = /^hasProperty\(["'](.+)["']\)$/.exec(trimmed);
  if (hasProperty) return getBasesPropertyValue(file, hasProperty[1], formulas) != null;
  return String(getBasesPropertyValue(file, trimmed, formulas) ?? "").length > 0;
}
