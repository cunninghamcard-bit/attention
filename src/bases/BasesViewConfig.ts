import type { QueryFilter, QueryRequest, QuerySort } from "../query/QueryEngine";
import type { FileProperties } from "../properties/PropertyTypes";
import type { TFile, TFolder } from "../vault/TAbstractFile";
import type { BasesConfigFileFilter } from "./BasesFilter";
import { evaluateBaseFormula, parsePropertyId, serializePropertyId, type BasesPropertyId } from "./BasesProperty";
import type { BasesView } from "./BasesView";
import { NullValue, Value, valueFromUnknown } from "./BasesValues";

export type BasesAllOptions = BasesOptions | BasesOptionGroup<BasesOptions>;

export interface BasesOption {
  key: string;
  type: string;
  displayName: string;
  shouldHide?: () => boolean;
}

export interface BasesOptionGroup<T extends BasesOption> {
  type: "group";
  displayName: string;
  items: T[];
  shouldHide?: () => boolean;
}

export interface BasesDropdownOption extends BasesOption {
  type: "dropdown";
  default?: string;
  options: Record<string, string>;
}

export interface BasesFileOption extends BasesOption {
  type: "file";
  default?: string;
  placeholder?: string;
  filter?: (file: TFile) => boolean;
}

export interface BasesFolderOption extends BasesOption {
  type: "folder";
  default?: string;
  placeholder?: string;
  filter?: (folder: TFolder) => boolean;
}

export interface BasesFormulaOption extends BasesOption {
  type: "formula";
  default?: string;
  placeholder?: string;
}

export interface BasesMultitextOption extends BasesOption {
  type: "multitext";
  default?: string[];
}

export interface BasesPropertyOption extends BasesOption {
  type: "property";
  default?: string;
  placeholder?: string;
  filter?: (prop: BasesPropertyId) => boolean;
}

export interface BasesSliderOption extends BasesOption {
  type: "slider";
  default?: number;
  min?: number;
  max?: number;
  step?: number;
  instant?: boolean;
}

export interface BasesTextOption extends BasesOption {
  type: "text";
  default?: string;
  placeholder?: string;
}

export interface BasesToggleOption extends BasesOption {
  type: "toggle";
  default?: boolean;
}

export type BasesOptions =
  | BasesDropdownOption
  | BasesFileOption
  | BasesFolderOption
  | BasesFormulaOption
  | BasesMultitextOption
  | BasesPropertyOption
  | BasesSliderOption
  | BasesTextOption
  | BasesToggleOption;

export interface BasesViewColumn {
  id: string;
  property: string;
  title: string;
  width?: number;
  hidden?: boolean;
  formula?: string;
  type?: string;
}

export interface BasesViewFilter extends QueryFilter {}

export interface BasesViewSort extends QuerySort {}

export interface BasesViewGroup {
  property: string;
  direction?: "asc" | "desc";
}

export interface BasesViewDefinition {
  id: string;
  name: string;
  type: string;
  query?: QueryRequest;
  filter?: BasesConfigFileFilter;
  columns?: BasesViewColumn[];
  filters?: BasesConfigFileFilter | BasesViewFilter[];
  sort?: BasesViewSort[];
  groupBy?: BasesViewGroup[];
  order?: string[];
  limit?: number;
  summaries?: Record<string, string>;
  data?: Record<string, unknown>;
}

export interface BasesConfigFileView {
  type: string;
  name: string;
  filters?: BasesConfigFileFilter;
  groupBy?: {};
  order?: string[];
  summaries?: Record<string, string>;
}

export interface BasesFileConfig {
  id: string;
  name: string;
  query: QueryRequest;
  filter?: BasesConfigFileFilter;
  columns: BasesViewColumn[];
  formulas?: Record<string, string>;
  summaries?: Record<string, string>;
  properties?: Record<string, Record<string, unknown>>;
  newItemFolder?: string;
  newItemTemplate?: string;
  views?: BasesViewDefinition[];
  activeView?: string;
  sourcePath?: string;
}

export interface BasesConfigFile {
  id?: string;
  name?: string;
  query?: QueryRequest;
  filters?: BasesViewFilter[];
  filter?: BasesConfigFileFilter;
  sort?: BasesViewSort[];
  columns?: BasesViewColumn[];
  formulas?: Record<string, string>;
  summaries?: Record<string, string>;
  properties?: Record<string, Record<string, unknown>>;
  newItemFolder?: string;
  newItemTemplate?: string;
  views?: BasesViewDefinition[];
  activeView?: string;
}

export const DEFAULT_BASES_COLUMNS: BasesViewColumn[] = [
  { id: "file", property: "file.path", title: "File", type: "file" },
  { id: "tags", property: "note.tags", title: "Tags", type: "tags" },
];

export const DEFAULT_BASES_CONFIG: BasesFileConfig = {
  id: "default",
  name: "Base",
  query: {},
  filter: undefined,
  columns: DEFAULT_BASES_COLUMNS,
  formulas: {},
  summaries: {},
  properties: {},
  views: [
    {
      id: "table",
      name: "Table",
      type: "table",
      columns: DEFAULT_BASES_COLUMNS,
    },
    {
      id: "cards",
      name: "Cards",
      type: "cards",
      columns: DEFAULT_BASES_COLUMNS,
      order: ["file.name", "note.tags"],
    },
    {
      id: "list",
      name: "List",
      type: "list",
      columns: DEFAULT_BASES_COLUMNS,
      order: ["file.name", "note.tags"],
    },
  ],
  activeView: "table",
};

export type BasesSortToggle = "ASC" | "DESC" | "NONE" | "TOGGLE" | "asc" | "desc" | "none" | "toggle";

export class BasesViewConfig {
  constructor(readonly config: BasesFileConfig, readonly activeViewId = config.activeView) {}

  get name(): string {
    return this.activeView.name;
  }

  set name(value: string) {
    this.activeView.name = value;
  }

  get activeView(): BasesViewDefinition {
    const existing = this.config.views?.find((view) => view.id === this.activeViewId)
      ?? this.config.views?.find((view) => view.id === this.config.activeView)
      ?? this.config.views?.[0];
    if (existing) return existing;
    const fallback = { id: "table", name: "Table", type: "table", columns: this.config.columns };
    this.config.views = [fallback];
    this.config.activeView = fallback.id;
    return fallback;
  }

  get<T = unknown>(key: string, fallback?: T): T | undefined {
    return (this.activeView.data?.[key] as T | undefined) ?? fallback;
  }

  set(key: string, value: unknown): void {
    this.activeView.data = { ...(this.activeView.data ?? {}), [key]: value };
  }

  getAsPropertyId(key: string): BasesPropertyId | null {
    const value = this.get<string>(key);
    return typeof value === "string" ? parsePropertyId(value).id : null;
  }

  getEvaluatedFormula(view: BasesView, key: string): Value {
    const formula = this.config.formulas?.[key] ?? this.get<string>(key) ?? "";
    const file = view.data.data[0]?.properties;
    if (!file) return NullValue.value;
    return valueFromUnknown(evaluateBaseFormula(formula, file, this.config.formulas ?? {}));
  }

  getOrder(): BasesPropertyId[] {
    return [...(this.activeView.order ?? this.activeView.columns?.map((column) => column.property) ?? this.config.columns.map((column) => column.property))]
      .map((property) => parsePropertyId(property).id);
  }

  setOrder(order: string[]): void {
    this.activeView.order = [...order.map((property) => parsePropertyId(property).id)];
  }

  getSort(): Array<{ property: BasesPropertyId; direction: "ASC" | "DESC" }> {
    return [...(this.activeView.sort ?? this.config.query.sort ?? [])]
      .map((sort) => ({
        property: parsePropertyId(sort.property).id,
        direction: sort.direction.toUpperCase() === "DESC" ? "DESC" as const : "ASC" as const,
      }));
  }

  setSortProperty(property: string, direction: BasesSortToggle): void {
    const normalized = direction.toLowerCase();
    const id = parsePropertyId(property).id;
    const currentSort = [...(this.activeView.sort ?? this.config.query.sort ?? [])];
    const sort = currentSort.filter((item) => parsePropertyId(item.property).id !== id);
    const current = currentSort.find((item) => parsePropertyId(item.property).id === id);
    let nextDirection: "asc" | "desc" | null = normalized === "asc" || normalized === "desc" ? normalized : null;
    if (normalized === "toggle") {
      if (!current) nextDirection = "asc";
      else if (current.direction === "asc") nextDirection = "desc";
      else nextDirection = null;
    }
    if (nextDirection) sort.unshift({ property: id, direction: nextDirection });
    this.activeView.sort = sort;
  }

  getLimit(): number | undefined {
    return this.activeView.limit ?? this.config.query.limit;
  }

  setLimit(limit: number | undefined): void {
    this.activeView.limit = limit;
  }

  getGroupBy(): BasesViewGroup | null {
    return this.activeView.groupBy?.[0] ?? null;
  }

  setGroupBy(groupBy: BasesViewGroup | null): void {
    this.activeView.groupBy = groupBy ? [{ ...groupBy, property: parsePropertyId(groupBy.property).id }] : [];
  }

  getSummaryKey(property: string): string | null {
    const id = parsePropertyId(property).id;
    return this.activeView.summaries?.[id] ?? null;
  }

  setSummaryKey(property: string, summaryKey: string | null): void {
    const id = parsePropertyId(property).id;
    const summaries = { ...(this.activeView.summaries ?? {}) };
    if (summaryKey) summaries[id] = summaryKey;
    else delete summaries[id];
    this.activeView.summaries = summaries;
  }

  getDisplayName(property: string): string {
    const id = parsePropertyId(property).id;
    const column = this.activeView.columns?.find((item) => parsePropertyId(item.property).id === id)
      ?? this.config.columns.find((item) => parsePropertyId(item.property).id === id);
    if (column?.title) return column.title;
    return String(this.config.properties?.[id]?.displayName ?? serializePropertyId(id));
  }

  serialize(): BasesFileConfig {
    return structuredClone(this.config);
  }
}
