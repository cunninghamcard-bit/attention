import type { PropertyValue } from "../core/PropertyValue";

export interface ParsedFrontmatter {
  hasFrontmatter: boolean;
  valid: boolean;
  error?: string;
  values: Record<string, PropertyValue>;
  body: string;
  raw: string;
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n)?/;

export function parseFrontmatter(source: string): ParsedFrontmatter {
  const match = source.match(FRONTMATTER_RE);
  if (!match) {
    return {
      hasFrontmatter: false,
      valid: true,
      values: {},
      body: source,
      raw: "",
    };
  }
  const error = validateYamlSubset(match[1]);
  return {
    hasFrontmatter: true,
    valid: !error,
    ...(error ? { error } : {}),
    values: error ? {} : parseYamlSubset(match[1]),
    body: source.slice(match[0].length),
    raw: match[1],
  };
}

export function getFrontmatterValues(source: string): Record<string, PropertyValue> {
  return parseFrontmatter(source).values;
}

export function setFrontmatterProperty(source: string, propertyId: string, value: PropertyValue): string {
  return updateFrontmatter(source, (values) => {
    if (value == null || isEmptyArray(value)) delete values[propertyId];
    else values[propertyId] = value;
  });
}

export function insertFrontmatterProperty(source: string, propertyId: string, value: PropertyValue = null): string {
  const trimmed = propertyId.trim();
  if (!trimmed) return source;
  return updateFrontmatter(source, (values) => {
    if (!Object.prototype.hasOwnProperty.call(values, trimmed)) values[trimmed] = value;
  });
}

export function deleteFrontmatterProperty(source: string, propertyId: string): string {
  return updateFrontmatter(source, (values) => {
    delete values[propertyId];
  });
}

export function deleteFrontmatterProperties(source: string, propertyIds: readonly string[]): string {
  const targets = new Set(propertyIds.map((id) => id.toLowerCase()));
  return updateFrontmatter(source, (values) => {
    for (const key of Object.keys(values)) {
      if (targets.has(key.toLowerCase())) delete values[key];
    }
  });
}

export function mergeFrontmatterProperties(source: string, incoming: Record<string, PropertyValue>): string {
  return updateFrontmatter(source, (values) => {
    mergeFrontmatterValues(values, incoming);
  });
}

export function renameFrontmatterProperty(source: string, oldId: string, newId: string): string {
  const trimmed = newId.trim();
  if (!trimmed || trimmed === oldId) return source;
  return updateFrontmatter(source, (values) => {
    if (!(oldId in values)) return;
    if (Object.prototype.hasOwnProperty.call(values, trimmed)) mergeFrontmatterValues(values, { [trimmed]: values[oldId] });
    else renameFrontmatterKeyPreservingOrder(values, oldId, trimmed);
    delete values[oldId];
  });
}

export function reorderFrontmatterProperty(source: string, propertyId: string, targetIndex: number): string {
  return updateFrontmatter(source, (values) => {
    if (!Object.prototype.hasOwnProperty.call(values, propertyId)) return;
    const value = values[propertyId];
    delete values[propertyId];
    const entries = Object.entries(values);
    const clamped = Math.max(0, Math.min(targetIndex, entries.length));
    const reorderedEntries = [
      ...entries.slice(0, clamped),
      [propertyId, value] as [string, PropertyValue],
      ...entries.slice(clamped),
    ];
    for (const key of Object.keys(values)) delete values[key];
    for (const [key, entryValue] of reorderedEntries) values[key] = entryValue;
  });
}

export function sortFrontmatterProperties(source: string, descending = false): string {
  const collator = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true });
  return updateFrontmatter(source, (values) => {
    const sortedKeys = Object.keys(values).sort((left, right) => (
      descending ? -collator.compare(left, right) : collator.compare(left, right)
    ));
    const sorted = sortedKeys.map((key) => [key, values[key]] as [string, PropertyValue]);
    for (const key of Object.keys(values)) delete values[key];
    for (const [key, value] of sorted) values[key] = value;
  });
}

export function mergeFrontmatterValues(target: Record<string, PropertyValue>, incoming: Record<string, PropertyValue>): void {
  if (Object.keys(incoming).length === 0) return;
  for (const [key, incomingValue] of Object.entries(incoming)) {
    const existingValue = target[key];
    if (existingValue) {
      if (Array.isArray(existingValue) && Array.isArray(incomingValue)) {
        target[key] = uniqueValues([...existingValue, ...incomingValue]);
      } else if (isPlainObject(existingValue) && incomingValue !== null && isPlainObject(incomingValue)) {
        mergeFrontmatterValues(existingValue, incomingValue);
      } else if (incomingValue !== null) {
        target[key] = incomingValue;
      }
    } else {
      target[key] = incomingValue;
    }
  }
}

export function renameFrontmatterKeyPreservingOrder(values: Record<string, PropertyValue>, oldId: string, newId: string): void {
  for (const key of Object.keys(values)) {
    const value = values[key];
    delete values[key];
    values[key === oldId ? newId : key] = value;
  }
}

export function updateFrontmatter(source: string, update: (values: Record<string, PropertyValue>) => void): string {
  const parsed = parseFrontmatter(source);
  if (!parsed.valid) return source;
  const values = { ...parsed.values };
  update(values);
  const block = serializeFrontmatter(values);
  if (!block) return parsed.body.replace(/^\r?\n/, "");
  return `${block}${parsed.body}`;
}

export function serializeFrontmatter(values: Record<string, PropertyValue>): string {
  const entries = Object.entries(values).filter(([, value]) => !isEmptyArray(value));
  if (entries.length === 0) return "";
  const lines = ["---"];
  for (const [key, value] of entries) lines.push(...serializeProperty(key, value));
  lines.push("---", "");
  return lines.join("\n");
}

export function serializeFrontmatterProperties(values: Record<string, PropertyValue>): string {
  const block = serializeFrontmatter(values);
  if (!block) return "";
  return block.replace(/^---\n/, "").replace(/\n---\n?$/, "");
}

export function coercePropertyValue(type: string, value: unknown): PropertyValue {
  if (value == null) return null;
  if (type === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (type === "checkbox") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return ["true", "yes", "1", "on"].includes(value.trim().toLowerCase());
    return Boolean(value);
  }
  if (type === "tags" || type === "aliases" || type === "multitext") {
    if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
    return splitList(String(value));
  }
  return String(value);
}

function parseYamlSubset(raw: string): Record<string, PropertyValue> {
  const values: Record<string, PropertyValue> = {};
  const lines = raw.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    index += 1;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const keyMatch = /^([^:#][^:]*):(?:\s*(.*))?$/.exec(line);
    if (!keyMatch) continue;
    const key = keyMatch[1].trim();
    const rest = keyMatch[2] ?? "";
    if (rest.trim()) {
      values[key] = parseScalarOrInlineArray(rest.trim());
      continue;
    }

    const childLines: string[] = [];
    while (index < lines.length) {
      if (!/^\s+/.test(lines[index])) break;
      childLines.push(lines[index].replace(/^  /, ""));
      index += 1;
    }
    values[key] = parseIndentedBlock(childLines);
  }
  return values;
}

function validateYamlSubset(raw: string): string | null {
  const lines = raw.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    index += 1;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) return "Unexpected indentation in properties";
    const keyMatch = /^([^:#][^:]*):(?:\s*(.*))?$/.exec(line);
    if (!keyMatch || !keyMatch[1].trim()) return "Invalid property line";
    if ((keyMatch[2] ?? "").trim()) continue;

    while (index < lines.length) {
      if (!/^\s+/.test(lines[index])) break;
      const childLine = lines[index].replace(/^  /, "");
      index += 1;
      if (!childLine.trim() || childLine.trimStart().startsWith("#")) continue;
      if (/^\s*-\s*/.test(childLine)) continue;
      const childKeyMatch = /^([^:#][^:]*):(?:\s*(.*))?$/.exec(childLine);
      if (!childKeyMatch || !childKeyMatch[1].trim()) return "Invalid nested property line";
    }
  }
  return null;
}

function parseIndentedBlock(lines: string[]): PropertyValue {
  if (lines.length === 0) return null;
  if (lines.every((line) => /^\s*-\s*/.test(line))) {
    return lines.map((line) => {
      const match = /^\s*-\s*(.*)$/.exec(line);
      return parseScalarOrInlineArray(match?.[1]?.trim() ?? "");
    });
  }
  return parseYamlSubset(lines.join("\n"));
}

function parseScalarOrInlineArray(value: string): PropertyValue {
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitCsv(inner).map((item) => String(parseScalar(item.trim())));
  }
  return parseScalar(value);
}

function parseScalar(value: string): PropertyValue {
  const unquoted = stripQuotes(value);
  if (unquoted === "") return "";
  const lower = unquoted.toLowerCase();
  if (lower === "true" || lower === "yes") return true;
  if (lower === "false" || lower === "no") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(unquoted)) return Number(unquoted);
  return unquoted;
}

function serializeProperty(key: string, value: PropertyValue): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return [`${key}:`, ...value.flatMap((item) => serializeArrayItem(item, 2))];
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, item]) => item != null && !isEmptyArray(item));
    if (entries.length === 0) return [`${key}: {}`];
    return [`${key}:`, ...entries.flatMap(([childKey, childValue]) => indentLines(serializeProperty(childKey, childValue), 2))];
  }
  if (value == null) return [`${key}:`];
  return [`${key}: ${quoteIfNeeded(value)}`];
}

function serializeArrayItem(value: PropertyValue, indent: number): string[] {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}- []`];
    return [`${prefix}-`, ...value.flatMap((item) => serializeArrayItem(item, indent + 2))];
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, item]) => item != null && !isEmptyArray(item));
    if (entries.length === 0) return [`${prefix}- {}`];
    const [first, ...rest] = entries.flatMap(([childKey, childValue]) => serializeProperty(childKey, childValue));
    return [`${prefix}- ${first}`, ...rest.map((line) => `${prefix}  ${line}`)];
  }
  if (value == null) return [`${prefix}- null`];
  return [`${prefix}- ${quoteIfNeeded(value)}`];
}

function indentLines(lines: string[], spaces: number): string[] {
  const prefix = " ".repeat(spaces);
  return lines.map((line) => `${prefix}${line}`);
}

function quoteIfNeeded(value: string | number | boolean): string {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === "") return "\"\"";
  if (/[:#\[\]{},&*?|\-<>=!%@`]/.test(value) || /^\s|\s$/.test(value)) return JSON.stringify(value);
  return value;
}

function stripQuotes(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function splitList(value: string): string[] {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function splitCsv(value: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of value) {
    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      current += char;
      continue;
    }
    if (char === "," && !quote) {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) items.push(current);
  return items;
}

function isEmptyArray(value: PropertyValue): boolean {
  return Array.isArray(value) && value.length === 0;
}

function isPlainObject(value: PropertyValue): value is { [key: string]: PropertyValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueValues(values: PropertyValue[]): PropertyValue[] {
  const seen = new Set<string>();
  const result: PropertyValue[] = [];
  for (const value of values) {
    const key = typeof value === "object" ? JSON.stringify(value) : `${typeof value}:${String(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
