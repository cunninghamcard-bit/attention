import { describe, expect, it } from "vitest";
import { buildPropertyListItems } from "./PropertiesList";
import type { MetadataPropertyInfo } from "../properties/MetadataTypeManager";
import type { PropertyType, PropertyTypeDefinition } from "../properties/PropertyTypes";

describe("PropertiesPlugin property list", () => {
  it("builds Obsidian-style property rows from metadataTypeManager properties", () => {
    const items = buildPropertyListItems(createPropertyInfos(), getTypeInfo, "frequency");

    expect(items.map((item) => `${item.id}:${item.occurrences}`)).toEqual([
      "rating:4",
      "active:2",
      "aliases:0",
    ]);
    expect(items.find((item) => item.id === "aliases")).toMatchObject({
      name: "aliases",
      widget: "aliases",
      reserved: true,
    });
  });

  it("supports alphabetical sorting and lower-case property filtering", () => {
    expect(buildPropertyListItems(createPropertyInfos(), getTypeInfo, "alphabetical").map((item) => item.id)).toEqual([
      "active",
      "aliases",
      "rating",
    ]);
    expect(buildPropertyListItems(createPropertyInfos(), getTypeInfo, "frequency", "RAT").map((item) => item.id)).toEqual(["rating"]);
  });
});

function createPropertyInfos(): Record<string, MetadataPropertyInfo> {
  return {
    aliases: { name: "aliases", widget: "aliases", occurrences: 0 },
    active: { name: "active", widget: "checkbox", occurrences: 2 },
    rating: { name: "Rating", widget: "number", occurrences: 4 },
  };
}

function getTypeInfo(type: PropertyType): Pick<PropertyTypeDefinition, "icon"> | null {
  return { icon: `icon-${type}` };
}
