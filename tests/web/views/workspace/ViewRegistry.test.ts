import { describe, expect, it } from "vitest";
import { ViewRegistry } from "@web/views/workspace/ViewRegistry";
import { View } from "@web/views/View";

describe("ViewRegistry", () => {
  it("emits Obsidian-style view and extension registry events", () => {
    const registry = new ViewRegistry();
    const events: string[] = [];

    registry.on<[string]>("view-registered", (type) => events.push(`registered:${type}`));
    registry.on<[string]>("view-unregistered", (type) => events.push(`unregistered:${type}`));
    registry.on("extensions-updated", () => events.push("extensions"));

    registry.registerView("custom-view", (leaf) => new View(leaf));
    registry.registerExtensions(["custom"], "custom-view");

    expect(registry.getViewCreatorByType("custom-view")).toBeTypeOf("function");
    expect(registry.getTypeByExtension("custom")).toBe("custom-view");
    expect(events).toEqual(["registered:custom-view", "extensions"]);

    expect(() => registry.registerView("custom-view", (leaf) => new View(leaf))).toThrow(
      'Attempting to register an existing view type "custom-view"',
    );
    expect(() => registry.registerExtensions(["custom"], "other-view")).toThrow(
      'Attempting to register an existing file extension "custom"',
    );

    registry.unregisterView("custom-view");
    registry.unregisterView("missing-view");
    registry.unregisterExtensions(["custom"]);

    expect(events).toEqual(["registered:custom-view", "extensions", "unregistered:custom-view", "extensions"]);
  });
});
