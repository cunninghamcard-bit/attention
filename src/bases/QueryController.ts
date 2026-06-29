import { Component } from "../core/Component";
import { parsePropertyId, type BasesPropertyId } from "./BasesProperty";
import type { BasesViewContext } from "./BasesRegistry";
import { BasesViewConfig, type BasesFileConfig, type BasesViewDefinition } from "./BasesViewConfig";
import type { BasesQueryResult } from "./BasesQueryResult";

export interface BasesSortConfig {
  property: BasesPropertyId;
  direction: "ASC" | "DESC";
}

export class QueryController extends Component {
  app: BasesViewContext["app"];
  config: BasesViewConfig;
  baseConfig: BasesFileConfig;
  view: BasesViewDefinition;
  data: BasesQueryResult;
  allProperties: BasesPropertyId[];
  sourcePath: string;
  private refreshCallback: () => void;

  constructor(context: BasesViewContext) {
    super();
    this.app = context.app;
    this.baseConfig = context.config;
    this.config = new BasesViewConfig(this.baseConfig, context.view.id);
    this.view = context.view;
    this.data = context.result;
    this.allProperties = context.result.properties.map((property) => parsePropertyId(property).id);
    this.sourcePath = context.sourcePath;
    this.refreshCallback = context.refresh;
  }

  updateContext(context: BasesViewContext): void {
    this.baseConfig = context.config;
    this.config = new BasesViewConfig(this.baseConfig, context.view.id);
    this.view = context.view;
    this.data = context.result;
    this.allProperties = context.result.properties.map((property) => parsePropertyId(property).id);
    this.sourcePath = context.sourcePath;
    this.refreshCallback = context.refresh;
  }

  refresh(): void {
    this.refreshCallback();
  }

  get(key: string, fallback?: unknown): unknown {
    return this.config.get(key, fallback);
  }

  set(key: string, value: unknown): void {
    this.config.set(key, value);
  }

  getAsPropertyId(key: string): BasesPropertyId | null {
    return this.config.getAsPropertyId(key);
  }

  getOrder(): BasesPropertyId[] {
    return this.config.getOrder().map((property) => parsePropertyId(property).id);
  }

  getSort(): BasesSortConfig[] {
    return this.config.getSort().map((sort) => ({
      property: parsePropertyId(sort.property).id,
      direction: sort.direction.toUpperCase() === "DESC" ? "DESC" : "ASC",
    }));
  }

  getDisplayName(propertyId: BasesPropertyId): string {
    return this.config.getDisplayName(propertyId);
  }
}
