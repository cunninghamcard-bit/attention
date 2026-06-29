import type { FileProperties } from "../properties/PropertyTypes";
import type { BasesViewColumn } from "./BasesViewConfig";
import { evaluateBaseFormula, getBasesPropertyValue } from "./BasesProperty";
import type { FormulaContext } from "./BasesProperty";
import { ListValue, NullValue, NumberValue, StringValue, Value, valueFromUnknown } from "./BasesValues";
import type { TFile } from "../vault/TAbstractFile";

export class BasesEntry implements FormulaContext {
  readonly file: TFile;

  constructor(readonly properties: FileProperties, readonly formulas: Record<string, string> = {}) {
    this.file = properties.file;
  }

  getValue(propertyId: string): Value | null {
    return valueFromUnknown(getBasesPropertyValue(this.properties, propertyId, this.formulas));
  }
}

export class BasesEntryGroup {
  readonly key: Value;

  constructor(key: unknown, readonly entries: BasesEntry[]) {
    this.key = valueFromUnknown(key);
  }

  hasKey(): boolean {
    return !(this.key instanceof NullValue) && this.key.isTruthy();
  }
}

export interface BasesQueryCell {
  columnId: string;
  value: Value | null;
  display?: string;
  error?: string;
}

export interface BasesQueryRow {
  path: string;
  cells: BasesQueryCell[];
  file: FileProperties;
}

export class BasesQueryResult {
  readonly data: BasesEntry[];
  readonly groupedData: BasesEntryGroup[];
  readonly properties: string[];

  constructor(
    readonly columns: BasesViewColumn[],
    readonly rows: BasesQueryRow[],
    readonly total: number,
    readonly formulas: Record<string, string> = {},
    readonly groups?: Array<{ key: string; rows: BasesQueryRow[] }>,
  ) {
    this.data = rows.map((row) => new BasesEntry(row.file, formulas));
    this.groupedData = groups?.map((group) => new BasesEntryGroup(group.key, group.rows.map((row) => new BasesEntry(row.file, formulas))))
      ?? [new BasesEntryGroup(NullValue.value, this.data)];
    this.properties = columns.map((column) => column.property);
  }

  getSummaryValue(_queryController: unknown, entries: BasesEntry[], prop: string, summaryKey: string): Value {
    if (summaryKey === "count") return new NumberValue(entries.length);
    const values = entries.map((entry) => entry.getValue(prop)).filter((value): value is Value => Boolean(value && !(value instanceof NullValue)));
    if (summaryKey === "unique") return new NumberValue(new Set(values.map((value) => value.toString())).size);
    if (summaryKey === "values") return new ListValue(values);
    const numbers = values.map((value) => Number(value.toString())).filter((value) => Number.isFinite(value));
    if (summaryKey === "sum") return new NumberValue(numbers.reduce((sum, value) => sum + value, 0));
    if (summaryKey === "average" || summaryKey === "avg") return numbers.length ? new NumberValue(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : NullValue.value;
    if (summaryKey === "min") return numbers.length ? new NumberValue(Math.min(...numbers)) : NullValue.value;
    if (summaryKey === "max") return numbers.length ? new NumberValue(Math.max(...numbers)) : NullValue.value;
    return new StringValue("");
  }
}

export function buildBasesQueryResult(files: FileProperties[], columns: BasesViewColumn[], total = files.length, formulas: Record<string, string> = {}): BasesQueryResult {
  const rows = files.map((file) => ({
      path: file.path,
      file,
      cells: columns.map((column) => {
        if (column.formula) {
          try {
            const value = valueFromUnknown(evaluateBaseFormula(column.formula, file, formulas));
            return { columnId: column.id, value, display: formatValue(value) };
          } catch (error) {
            return {
              columnId: column.id,
              value: NullValue.value,
              display: "",
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }
        const value = valueFromUnknown(getBasesPropertyValue(file, column.property, formulas));
        return { columnId: column.id, value, display: formatValue(value) };
      }),
    }));
  return new BasesQueryResult(columns, rows, total, formulas);
}

export function groupBasesQueryResult(result: BasesQueryResult, property: string): BasesQueryResult {
  const groups = new Map<string, BasesQueryRow[]>();
  for (const row of result.rows) {
    const value = property === "path" ? row.path : getBasesPropertyValue(row.file, property, result.formulas);
    const key = formatValue(value) || "(empty)";
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }
  return new BasesQueryResult(result.columns, result.rows, result.total, result.formulas, [...groups.entries()].map(([key, rows]) => ({ key, rows })));
}

export function formatValue(value: unknown): string {
  if (value instanceof Value) return value.toString();
  if (Array.isArray(value)) return value.join(", ");
  if (value == null) return "";
  return String(value);
}
