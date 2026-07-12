import type { App } from "../../app/App";
import type { TFile } from "../../vault/TAbstractFile";
import type { PropertyType, PropertyValue } from "../../core/PropertyValue";

export type { PropertyType, PropertyValue };

export interface PropertyDefinition {
  id: string;
  name: string;
  type: PropertyType;
  icon?: string;
  hidden?: boolean;
}

export interface FileProperties {
  file: TFile;
  path: string;
  values: Record<string, PropertyValue>;
}

export interface PropertyTypeDefinition {
  type: PropertyType;
  name: string;
  icon: string;
  defaultValue: PropertyValue;
}

export interface PropertyTypeInfo {
  expected: PropertyTypeDefinition;
  inferred: PropertyTypeDefinition;
}

export interface PropertyWidgetContext {
  property: PropertyDefinition;
  value: PropertyValue;
  app?: App;
  sourcePath?: string;
  writeFile?(file: TFile, update: (source: string) => string): Promise<void>;
  onChange(value: PropertyValue): void;
  onDelete?(): void;
}

export interface PropertyTypeWidget {
  render(parent: HTMLElement, context: PropertyWidgetContext): void;
}

export interface PropertyUsage {
  property: PropertyDefinition;
  count: number;
  files: string[];
}
