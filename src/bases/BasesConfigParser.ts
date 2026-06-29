import type { BasesConfigFile, BasesViewColumn, BasesFileConfig, BasesViewDefinition } from "./BasesViewConfig";
import { DEFAULT_BASES_COLUMNS, DEFAULT_BASES_CONFIG } from "./BasesViewConfig";
import { andBasesFilters, type BasesConfigFileFilter } from "./BasesFilter";

export function parseBasesConfig(source: string, sourcePath = ""): BasesFileConfig {
  const raw = parseConfigObject(source);
  return normalizeBasesConfig(raw, sourcePath);
}

export function serializeBasesConfig(config: BasesFileConfig): string {
  const lines: string[] = [];
  pushScalar(lines, "id", config.id);
  pushScalar(lines, "name", config.name);
  pushScalar(lines, "newItemFolder", config.newItemFolder);
  pushScalar(lines, "newItemTemplate", config.newItemTemplate);
  if (config.filter) pushJson(lines, "filters", config.filter);
  if (config.formulas && Object.keys(config.formulas).length > 0) pushRecord(lines, "formulas", config.formulas);
  if (config.summaries && Object.keys(config.summaries).length > 0) pushRecord(lines, "summaries", config.summaries);
  if (config.properties && Object.keys(config.properties).length > 0) pushJson(lines, "properties", config.properties);
  if (config.columns.length > 0) {
    lines.push("columns:");
    for (const column of config.columns) lines.push(`  - ${inlineObject(column as unknown as Record<string, unknown>)}`);
  }
  if (config.views?.length) {
    lines.push("views:");
    for (const view of config.views) {
      lines.push(`  - ${inlineObject({
        id: view.id,
        name: view.name,
        type: view.type,
        ...(view.order?.length ? { order: view.order } : {}),
        ...(view.limit != null ? { limit: view.limit } : {}),
      })}`);
      if (view.filter) lines.push(`    filters: ${JSON.stringify(view.filter)}`);
      if (view.sort?.length) lines.push(`    sort: ${JSON.stringify(view.sort)}`);
      if (view.groupBy?.length) lines.push(`    groupBy: ${JSON.stringify(view.groupBy[0])}`);
      if (view.summaries && Object.keys(view.summaries).length > 0) lines.push(`    summaries: ${JSON.stringify(view.summaries)}`);
      if (view.data && Object.keys(view.data).length > 0) lines.push(`    data: ${JSON.stringify(view.data)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function normalizeBasesConfig(raw: Partial<BasesConfigFile> | null | undefined, sourcePath = ""): BasesFileConfig {
  const id = stringOr(raw?.id, sourcePath || DEFAULT_BASES_CONFIG.id);
  const columns = normalizeColumns(raw?.columns) ?? DEFAULT_BASES_COLUMNS;
  const rootQuery = {
    ...(raw?.query ?? {}),
    filters: raw?.query?.filters ?? (isQueryFilterArray(raw?.filters) ? raw.filters : undefined),
    sort: raw?.query?.sort ?? raw?.sort,
  };
  const views = normalizeViews(raw?.views, columns);
  const activeView = stringOr(raw?.activeView, views[0]?.id ?? DEFAULT_BASES_CONFIG.activeView ?? "table");
  const activeDefinition = views.find((view) => view.id === activeView) ?? views[0];
  return {
    id,
    name: stringOr(raw?.name, sourcePath ? sourcePath.split("/").pop()?.replace(/\.base$/, "") ?? "Base" : DEFAULT_BASES_CONFIG.name),
    query: {
      ...rootQuery,
      ...(activeDefinition?.query ?? {}),
      filters: isQueryFilterArray(activeDefinition?.filters) ? activeDefinition.filters : activeDefinition?.query?.filters ?? rootQuery.filters,
      sort: activeDefinition?.sort ?? activeDefinition?.query?.sort ?? rootQuery.sort,
      limit: activeDefinition?.limit ?? activeDefinition?.query?.limit ?? rootQuery.limit,
    },
    filter: andBasesFilters(raw?.filter, isBasesFilterTree(raw?.filters) ? raw.filters : undefined, activeDefinition?.filter, isBasesFilterTree(activeDefinition?.filters) ? activeDefinition.filters : undefined),
    columns: activeDefinition?.columns ?? columns,
    formulas: raw?.formulas ?? {},
    summaries: raw?.summaries ?? {},
    properties: raw?.properties ?? {},
    newItemFolder: typeof raw?.newItemFolder === "string" ? raw.newItemFolder : undefined,
    newItemTemplate: typeof raw?.newItemTemplate === "string" ? raw.newItemTemplate : undefined,
    views,
    activeView: activeDefinition?.id ?? activeView,
    sourcePath,
  };
}

function isQueryFilterArray(value: unknown): value is NonNullable<BasesConfigFile["query"]>["filters"] {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && "property" in item);
}

function isBasesFilterTree(value: unknown): value is BasesConfigFileFilter {
  return typeof value === "string"
    || Boolean(value && typeof value === "object" && ("and" in value || "or" in value || "not" in value));
}

function parseConfigObject(source: string): Partial<BasesConfigFile> {
  const trimmed = source.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as Partial<BasesConfigFile>;
  } catch {
    return parseYamlLike(trimmed);
  }
}

function pushScalar(lines: string[], key: string, value: unknown): void {
  if (typeof value !== "string" || !value.trim()) return;
  lines.push(`${key}: ${quoteYaml(value)}`);
}

function pushRecord(lines: string[], key: string, value: Record<string, string>): void {
  lines.push(`${key}:`);
  for (const [name, item] of Object.entries(value)) lines.push(`  ${name}: ${quoteYaml(item)}`);
}

function pushJson(lines: string[], key: string, value: unknown): void {
  lines.push(`${key}: ${JSON.stringify(value)}`);
}

function inlineObject(value: Record<string, unknown>): string {
  return Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null && !(Array.isArray(item) && item.length === 0))
    .map(([key, item]) => `${key}: ${Array.isArray(item) || typeof item === "object" ? JSON.stringify(item) : quoteYaml(String(item))}`)
    .join(", ");
}

function quoteYaml(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : JSON.stringify(value);
}

function parseYamlLike(source: string): Partial<BasesConfigFile> {
  const result: Partial<BasesConfigFile> = {};
  const columns: BasesViewColumn[] = [];
  const filters: NonNullable<BasesConfigFile["filters"]> = [];
  const sort: NonNullable<BasesConfigFile["sort"]> = [];
  const views: BasesViewDefinition[] = [];
  const formulas: Record<string, string> = {};
  const summaries: Record<string, string> = {};
  let currentView: BasesViewDefinition | null = null;
  let section = "";

  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const sectionMatch = /^([A-Za-z][\w-]*):\s*$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const scalarMatch = /^([A-Za-z][\w-]*):\s*(.+)$/.exec(line);
    if (scalarMatch && !line.startsWith(" ")) {
      assignScalar(result, scalarMatch[1], scalarMatch[2]);
      continue;
    }
    const viewFieldMatch = /^\s{4}([A-Za-z][\w-]*):\s*(.+)$/.exec(line);
    if (section === "views" && currentView && viewFieldMatch) {
      assignViewField(currentView, viewFieldMatch[1], viewFieldMatch[2]);
      continue;
    }
    const recordMatch = /^\s{2}([^:\s][^:]*):\s*(.+)$/.exec(line);
    if (recordMatch && section === "formulas") {
      formulas[recordMatch[1].trim()] = String(parseValue(recordMatch[2].trim()));
      continue;
    }
    if (recordMatch && section === "summaries") {
      summaries[recordMatch[1].trim()] = String(parseValue(recordMatch[2].trim()));
      continue;
    }
    const itemMatch = /^\s*-\s*(.+)$/.exec(line);
    if (!itemMatch) continue;
    const item = parseInlineObject(itemMatch[1]);
    if (section === "columns") columns.push(normalizeColumn(item));
    else if (section === "views") {
      currentView = normalizeInlineView(item, views.length, columns.length > 0 ? columns : DEFAULT_BASES_COLUMNS);
      views.push(currentView);
    }
    else if (section === "filters") filters.push({
      property: stringOr(item.property, ""),
      operator: (stringOr(item.operator, "exists") as NonNullable<BasesConfigFile["filters"]>[number]["operator"]),
      value: item.value as NonNullable<BasesConfigFile["filters"]>[number]["value"],
    });
    else if (section === "sort") sort.push({
      property: stringOr(item.property, ""),
      direction: item.direction === "desc" ? "desc" : "asc",
    });
  }

  if (columns.length > 0) result.columns = columns;
  if (filters.length > 0) result.filters = filters;
  if (sort.length > 0) result.sort = sort;
  if (views.length > 0) result.views = views;
  if (Object.keys(formulas).length > 0) result.formulas = formulas;
  if (Object.keys(summaries).length > 0) result.summaries = summaries;
  return result;
}

function normalizeViews(raw: unknown, columns: BasesViewColumn[]): BasesViewDefinition[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      { id: "table", name: "Table", type: "table", columns },
      { id: "cards", name: "Cards", type: "cards", columns },
      { id: "list", name: "List", type: "list", columns },
    ];
  }
  return raw.map((item, index) => {
    const view = item && typeof item === "object" ? item as Partial<BasesViewDefinition> : {};
    return {
      id: stringOr(view.id, `view-${index + 1}`),
      name: stringOr(view.name, stringOr(view.id, `View ${index + 1}`)),
      type: stringOr(view.type, "table"),
      query: view.query,
      columns: normalizeColumns(view.columns) ?? columns,
      filters: view.filters,
      sort: view.sort,
      groupBy: view.groupBy,
      order: Array.isArray(view.order) ? view.order.map(String) : undefined,
      limit: view.limit,
      summaries: view.summaries,
      data: view.data,
    };
  });
}

function normalizeColumns(raw: unknown): BasesViewColumn[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((item, index) => normalizeColumn(item, index));
}

function normalizeColumn(raw: unknown, index = 0): BasesViewColumn {
  const item = raw && typeof raw === "object" ? raw as Partial<BasesViewColumn> : {};
  const property = stringOr(item.property, stringOr(item.id, "path"));
  return {
    id: stringOr(item.id, property || `column-${index + 1}`),
    property,
    title: stringOr(item.title, property),
    width: typeof item.width === "number" ? item.width : undefined,
    hidden: Boolean(item.hidden),
    formula: typeof item.formula === "string" ? item.formula : undefined,
    type: typeof item.type === "string" ? item.type : undefined,
  };
}

function assignScalar(result: Partial<BasesConfigFile>, key: string, value: string): void {
  if (key === "name" || key === "id" || key === "activeView") {
    result[key] = stripQuotes(value);
  }
  if (key === "newItemFolder" || key === "newItemTemplate") {
    result[key] = stripQuotes(value);
  }
  if (key === "filters") {
    result.filters = parseValue(value) as BasesConfigFile["filters"];
  }
  if (key === "properties") {
    result.properties = parseValue(value) as BasesConfigFile["properties"];
  }
  if (key === "limit") {
    result.query = { ...(result.query ?? {}), limit: Number(value) };
  }
}

function parseInlineObject(source: string): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  const normalized = source.replace(/^\{|\}$/g, "");
  for (const part of splitInlineParts(normalized)) {
    const index = part.indexOf(":");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    object[key] = parseValue(part.slice(index + 1).trim());
  }
  if (Object.keys(object).length === 0) object.property = stripQuotes(source.trim());
  return object;
}

function parseValue(value: string): unknown {
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  const unquoted = stripQuotes(value);
  if (unquoted === "true") return true;
  if (unquoted === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(unquoted)) return Number(unquoted);
  return unquoted;
}

function normalizeInlineView(raw: Record<string, unknown>, index: number, columns: BasesViewColumn[]): BasesViewDefinition {
  return {
    id: stringOr(raw.id, `view-${index + 1}`),
    name: stringOr(raw.name, stringOr(raw.id, `View ${index + 1}`)),
    type: stringOr(raw.type, "table"),
    columns,
    order: Array.isArray(raw.order) ? raw.order.map(String) : undefined,
    limit: typeof raw.limit === "number" ? raw.limit : undefined,
  };
}

function assignViewField(view: BasesViewDefinition, key: string, value: string): void {
  const parsed = parseValue(value);
  if (key === "filters") view.filters = parsed as BasesViewDefinition["filters"];
  if (key === "sort" && Array.isArray(parsed)) view.sort = parsed as BasesViewDefinition["sort"];
  if (key === "groupBy" && parsed && typeof parsed === "object") view.groupBy = [parsed as NonNullable<BasesViewDefinition["groupBy"]>[number]];
  if (key === "summaries" && parsed && typeof parsed === "object") view.summaries = parsed as BasesViewDefinition["summaries"];
  if (key === "data" && parsed && typeof parsed === "object") view.data = parsed as BasesViewDefinition["data"];
}

function splitInlineParts(source: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;
  for (const char of source) {
    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      current += char;
      continue;
    }
    if (!quote && (char === "[" || char === "{")) depth += 1;
    if (!quote && (char === "]" || char === "}")) depth = Math.max(0, depth - 1);
    if (char === "," && !quote && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
