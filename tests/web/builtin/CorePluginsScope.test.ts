import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import { corePlugins, nonParityFeatureScope } from "@web/builtin/CorePlugins";

const scopedCorePluginIds = nonParityFeatureScope
  .filter((feature) => feature.area.includes("core-plugin"))
  .map((feature) => feature.id);

describe("Core plugin non-parity scope", () => {
  it("keeps non-parity feature plugins documented, hidden and default-off", () => {
    const definitions = new Map(corePlugins.map((definition) => [definition.id, definition]));

    for (const id of scopedCorePluginIds) {
      const definition = definitions.get(id);
      expect(definition, `Expected ${id} to stay registered as a thin seam`).toBeDefined();
      expect(
        definition?.hiddenFromList,
        `Expected ${id} to stay out of user-facing core plugin scope`,
      ).toBe(true);
      expect(
        definition?.defaultOn,
        `Expected ${id} to stay outside the default feature scope`,
      ).toBe(false);
    }
  });

  it("does not enable non-parity feature plugins during default startup", async () => {
    const app = new App(document.createElement("div"));

    await app.ready;

    for (const id of scopedCorePluginIds) {
      const plugin = app.internalPlugins.getPluginById(id);
      expect(plugin, `Expected ${id} to be registered for compatibility`).not.toBeNull();
      expect(plugin?.enabled, `Expected ${id} to remain disabled unless explicitly enabled`).toBe(
        false,
      );
    }
  });
});
