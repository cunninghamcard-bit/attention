export interface GraphColor {
  a: number;
  rgb: number;
}

export interface GraphColorGroupOptions {
  query: string;
  color: GraphColor;
}

export interface GraphFilterOptions {
  query: string;
  showAttachments: boolean;
  hideUnresolved: boolean;
  showOrphans: boolean;
  showTags: boolean;
  localFile: string | null;
  localJumps: number;
  localInterlinks: boolean;
  localForelinks: boolean;
  localBacklinks: boolean;
}

export interface GraphDisplayOptions {
  showArrow: boolean;
  textFadeMultiplier: number;
  nodeSizeMultiplier: number;
  lineSizeMultiplier: number;
}

export interface GraphForceOptions {
  centerStrength: number;
  repelStrength: number;
  linkStrength: number;
  linkDistance: number;
}

export interface GraphPluginOptions {
  filterOptions: GraphFilterOptions;
  displayOptions: GraphDisplayOptions;
  forceOptions: GraphForceOptions;
  colorGroups: GraphColorGroupOptions[];
  scale: number;
  close: Record<string, boolean>;
}

export const DEFAULT_GRAPH_FILTER_OPTIONS: GraphFilterOptions = {
  showAttachments: false,
  hideUnresolved: false,
  showOrphans: true,
  showTags: false,
  localFile: null,
  localJumps: 1,
  localInterlinks: false,
  localForelinks: true,
  localBacklinks: true,
  query: "",
};

export const DEFAULT_GRAPH_DISPLAY_OPTIONS: GraphDisplayOptions = {
  showArrow: false,
  textFadeMultiplier: 0,
  nodeSizeMultiplier: 1,
  lineSizeMultiplier: 1,
};

export const DEFAULT_GRAPH_FORCE_OPTIONS: GraphForceOptions = {
  centerStrength: 0.1,
  repelStrength: 10,
  linkStrength: 1,
  linkDistance: 250,
};

export function createDefaultGraphPluginOptions(): GraphPluginOptions {
  return {
    filterOptions: { ...DEFAULT_GRAPH_FILTER_OPTIONS },
    displayOptions: { ...DEFAULT_GRAPH_DISPLAY_OPTIONS },
    forceOptions: { ...DEFAULT_GRAPH_FORCE_OPTIONS },
    colorGroups: [],
    scale: 1,
    close: {},
  };
}

export function cloneGraphPluginOptions(options: GraphPluginOptions): GraphPluginOptions {
  return {
    filterOptions: { ...DEFAULT_GRAPH_FILTER_OPTIONS, ...options.filterOptions },
    displayOptions: { ...DEFAULT_GRAPH_DISPLAY_OPTIONS, ...options.displayOptions },
    forceOptions: { ...DEFAULT_GRAPH_FORCE_OPTIONS, ...options.forceOptions },
    colorGroups: options.colorGroups.map((group) => ({ query: group.query, color: { ...group.color } })),
    scale: options.scale ?? 1,
    close: { ...options.close },
  };
}

export function assignGraphPluginOptions(target: GraphPluginOptions, source: Partial<GraphPluginOptions>): GraphPluginOptions {
  if (source.filterOptions) Object.assign(target.filterOptions, source.filterOptions);
  if (source.displayOptions) Object.assign(target.displayOptions, source.displayOptions);
  if (source.forceOptions) Object.assign(target.forceOptions, source.forceOptions);
  if (source.colorGroups) target.colorGroups = source.colorGroups.map((group) => ({ query: group.query, color: { ...group.color } }));
  if (typeof source.scale === "number") target.scale = source.scale;
  if (source.close) target.close = { ...target.close, ...source.close };
  return target;
}

export function graphColorToCss(color: GraphColor): string {
  const rgb = Math.max(0, Math.min(0xffffff, color.rgb));
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

export function cssColorToGraphColor(value: string, alpha = 1): GraphColor {
  const hex = value.startsWith("#") ? value.slice(1) : value;
  const rgb = Number.parseInt(hex.padEnd(6, "0").slice(0, 6), 16);
  return { a: alpha, rgb: Number.isFinite(rgb) ? rgb : 0x7f6df2 };
}
