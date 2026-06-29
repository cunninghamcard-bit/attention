import type { App } from "../app/App";
import type { FileProperties, PropertyValue } from "../properties/PropertyTypes";

export type QueryOperator = "exists" | "not-exists" | "equals" | "not-equals" | "contains" | "gt" | "lt";

export interface QueryFilter {
  property: string;
  operator: QueryOperator;
  value?: PropertyValue;
}

export interface QuerySort {
  property: string;
  direction: "asc" | "desc";
}

export interface QueryRequest {
  filters?: QueryFilter[];
  sort?: QuerySort[];
  limit?: number;
}

export interface QueryResult {
  rows: FileProperties[];
  total: number;
}

export class QueryEngine {
  constructor(readonly app: App) {}

  run(request: QueryRequest = {}): QueryResult {
    let rows = this.app.properties.listFilesWithProperties();
    for (const filter of request.filters ?? []) rows = rows.filter((row) => matches(getValue(row, filter.property), filter));
    for (const sort of [...(request.sort ?? [])].reverse()) {
      rows = rows.sort((a, b) => compare(getValue(a, sort.property), getValue(b, sort.property)) * (sort.direction === "asc" ? 1 : -1));
    }
    const total = rows.length;
    if (request.limit != null) rows = rows.slice(0, request.limit);
    this.app.workspace.trigger("query-complete", request, { rows, total });
    return { rows, total };
  }
}

function getValue(row: FileProperties, property: string): PropertyValue | undefined {
  if (property.startsWith("note.")) return row.values[property.slice("note.".length)];
  if (property === "file.path") return row.path;
  if (property === "file.file") return row.path;
  if (property === "file.name" || property === "file.fullname") return row.path.split("/").pop() ?? row.path;
  if (property === "file.basename") return (row.path.split("/").pop() ?? row.path).replace(/\.[^.]+$/, "");
  if (property === "file.folder") return row.path.includes("/") ? row.path.slice(0, row.path.lastIndexOf("/")) : "";
  if (property === "file.ext") return row.path.includes(".") ? row.path.split(".").pop() ?? "" : "";
  if (property === "file.tags") return row.values.tags;
  if (property === "path") return row.path;
  if (property === "file" || property === "name") return row.path.split("/").pop() ?? row.path;
  if (property === "folder") return row.path.includes("/") ? row.path.slice(0, row.path.lastIndexOf("/")) : "";
  return row.values[property];
}

function matches(value: PropertyValue | undefined, filter: QueryFilter): boolean {
  if (filter.operator === "exists") return value != null;
  if (filter.operator === "not-exists") return value == null;
  if (filter.operator === "equals") return value === filter.value;
  if (filter.operator === "not-equals") return value !== filter.value;
  if (filter.operator === "contains") return Array.isArray(value) ? value.includes(String(filter.value)) : String(value ?? "").includes(String(filter.value ?? ""));
  if (filter.operator === "gt") return Number(value) > Number(filter.value);
  if (filter.operator === "lt") return Number(value) < Number(filter.value);
  return false;
}

function compare(a: PropertyValue | undefined, b: PropertyValue | undefined): number {
  return String(a ?? "").localeCompare(String(b ?? ""));
}
