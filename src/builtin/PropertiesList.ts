import type { MetadataPropertyInfo } from "../properties/MetadataTypeManager";
import type { PropertyType, PropertyTypeDefinition } from "../properties/PropertyTypes";

export type PropertySortOrder = "alphabetical" | "alphabeticalReverse" | "frequency" | "frequencyReverse";

export interface PropertyListItem {
  id: string;
  name: string;
  widget: PropertyType;
  icon?: string;
  occurrences: number;
  reserved: boolean;
}

export const RESERVED_PROPERTY_KEYS = new Set(["aliases", "cssclasses", "tags"]);

export function buildPropertyListItems(
  properties: Record<string, MetadataPropertyInfo>,
  getTypeInfo: (type: PropertyType) => Pick<PropertyTypeDefinition, "icon"> | null,
  sortOrder: PropertySortOrder = "frequency",
  searchQuery = "",
): PropertyListItem[] {
  const query = searchQuery.trim().toLowerCase();
  return Object.entries(properties)
    .map(([id, info]) => ({
      id,
      name: info.name,
      widget: info.widget,
      icon: getTypeInfo(info.widget)?.icon,
      occurrences: info.occurrences,
      reserved: RESERVED_PROPERTY_KEYS.has(id),
    }))
    .filter((item) => !query || item.id.includes(query) || item.name.toLowerCase().includes(query))
    .sort((left, right) => comparePropertyItems(left, right, sortOrder));
}

export function readPropertySortOrder(value: unknown): PropertySortOrder {
  if (value === "alphabetical" || value === "alphabeticalReverse" || value === "frequency" || value === "frequencyReverse") return value;
  return "frequency";
}

function comparePropertyItems(left: PropertyListItem, right: PropertyListItem, sortOrder: PropertySortOrder): number {
  const byName = left.name.toLowerCase().localeCompare(right.name.toLowerCase(), undefined, { sensitivity: "base", numeric: true });
  if (sortOrder === "alphabetical") return byName;
  if (sortOrder === "alphabeticalReverse") return -byName;
  const byFrequency = right.occurrences - left.occurrences || byName;
  if (sortOrder === "frequencyReverse") return -byFrequency;
  return byFrequency;
}
