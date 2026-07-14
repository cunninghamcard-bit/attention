import { beforeEach, describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import { SettingsRenderer } from "@web/builtin/SettingsRenderer";
import { StyleSettingsTab } from "@web/builtin/StyleSettingsTab";

describe("Style settings placement", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  it("places the style settings tab in options", () => {
    const app = new App(document.createElement("div"));
    const host = document.createElement("div");
    const renderer = new SettingsRenderer(app, host);

    renderer.render();

    const tab = app.setting.getTabs().find((candidate) => candidate instanceof StyleSettingsTab);
    expect(tab).toBeInstanceOf(StyleSettingsTab);
    // A tab with no `section` falls through to "core-plugins" (SettingsRenderer.getTabSection).
    expect(tab?.section).toBe("options");
    expect(tab?.navEl?.parentElement?.dataset.section).toBe("options");
    expect(renderer.tabContainer.contains(tab?.navEl ?? null)).toBe(true);
  });
});
