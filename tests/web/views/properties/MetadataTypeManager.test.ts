import { describe, expect, it, vi } from "vitest";
import type { App } from "@web/app/App";
import { MetadataCache } from "@web/metadata/MetadataCache";
import { JsonStore } from "@web/storage/JsonStore";
import { Vault } from "@web/vault/Vault";
import { MetadataTypeManager, type TypesConfig } from "@web/views/properties/MetadataTypeManager";

describe("MetadataTypeManager", () => {
  it("loads property widgets from types.json and keeps Obsidian's fixed built-ins", async () => {
    const { manager, vault } = createMetadataTypeHarness();
    await vault.writeConfigJson<TypesConfig>("types", {
      types: {
        Rating: "number",
        Status: "checkbox",
        Ignored: "missing-widget",
      },
    });

    await manager.load();
    manager.updatePropertyInfoCache();

    expect(manager.getAssignedWidget("rating")).toBe("number");
    expect(manager.getAssignedWidget("status")).toBe("checkbox");
    expect(manager.getAssignedWidget("ignored")).toBeNull();
    expect(manager.getAssignedWidget("aliases")).toBe("aliases");
    expect(manager.getAssignedWidget("cssclasses")).toBe("multitext");
    expect(manager.getAssignedWidget("tags")).toBe("tags");
    expect(manager.getAllProperties().rating).toMatchObject({
      name: "Rating",
      widget: "number",
      occurrences: 0,
    });
    expect(manager.getPropertyInfo("missing")).toEqual({
      name: "missing",
      widget: "text",
      occurrences: 0,
    });
  });

  it("persists assigned widgets through the vault types config", async () => {
    const { manager, vault } = createMetadataTypeHarness();
    await manager.load();

    manager.setType("Rating", "number");
    await manager.save();

    await expect(vault.readConfigJson<TypesConfig>("types")).resolves.toMatchObject({
      types: {
        aliases: "aliases",
        cssclasses: "multitext",
        tags: "tags",
        Rating: "number",
      },
    });
  });

  it("reloads types.json from the raw config-file event after the debounce", async () => {
    const { manager, vault } = createMetadataTypeHarness();
    await manager.load();
    manager.registerListeners();
    vi.useFakeTimers();
    try {
      await vault.writeConfigJson<TypesConfig>("types", { types: { Status: "checkbox" } }, { mtime: 1_000 });
      await vi.advanceTimersByTimeAsync(49);
      expect(manager.getAssignedWidget("status")).toBeNull();

      await vi.advanceTimersByTimeAsync(1);
      expect(manager.getAssignedWidget("status")).toBe("checkbox");
    } finally {
      vi.useRealTimers();
      manager.unregisterListeners();
    }
  });

  it("refreshes property info when metadata cache finishes indexing", async () => {
    const { manager, metadataCache, vault } = createMetadataTypeHarness();
    await manager.load();
    manager.registerListeners();
    await vault.create("Note.md", "---\nrating: 5\n---\nBody");

    await metadataCache.clear();

    expect(manager.getPropertyInfo("rating")).toMatchObject({
      name: "rating",
      widget: "number",
      occurrences: 1,
    });
    manager.unregisterListeners();
  });

  it("aggregates property infos as a lowercase-keyed object on metadata cache", async () => {
    const { manager, metadataCache, vault } = createMetadataTypeHarness();
    await vault.writeConfigJson<TypesConfig>("types", { types: { Rating: "number" } });
    await manager.load();
    await vault.create("One.md", "---\nRating: 5\n---\nBody");
    await vault.create("Two.md", "---\nrating: 7\nactive: true\n---\nBody");

    await metadataCache.initialize();
    await Promise.resolve();
    await new Promise<void>((resolve) => metadataCache.onCleanCache(resolve));

    expect(metadataCache.getAllPropertyInfos()).toEqual({
      aliases: { name: "aliases", widget: "aliases", occurrences: 0 },
      cssclasses: { name: "cssclasses", widget: "multitext", occurrences: 0 },
      tags: { name: "tags", widget: "tags", occurrences: 0 },
      rating: { name: "Rating", widget: "number", occurrences: 2 },
      active: { name: "active", widget: "checkbox", occurrences: 1 },
    });
  });

  it("keeps expected and inferred metadata types separate like Obsidian", async () => {
    const { manager } = createMetadataTypeHarness();
    await manager.load();

    manager.setType("Start", "text");
    expect(manager.getPropertyTypeInfo("Start", "2026-06-21")).toMatchObject({
      expected: { type: "text" },
      inferred: { type: "text" },
    });

    manager.setType("Rating", "number");
    expect(manager.getPropertyTypeInfo("Rating", "high")).toMatchObject({
      expected: { type: "number" },
      inferred: { type: "text" },
    });
  });
});

function createMetadataTypeHarness(): { manager: MetadataTypeManager; metadataCache: MetadataCache; vault: Vault } {
  const jsonStore = new JsonStore();
  const vault = new Vault(undefined, undefined, jsonStore);
  const app = {
    vault,
    jsonStore,
  } as unknown as App;
  const metadataCache = new MetadataCache(vault, app);
  Object.assign(app, { metadataCache });
  const manager = new MetadataTypeManager(app);
  Object.assign(app, { metadataTypeManager: manager });
  jsonStore.on<[string]>("raw", (path) => vault.trigger("raw", path));
  return { manager, metadataCache, vault };
}
