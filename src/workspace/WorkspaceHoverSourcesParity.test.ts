import { describe, expect, it } from "vitest";
import { App } from "../app/App";
import { Plugin } from "../plugin/Plugin";

class HoverSourcePlugin extends Plugin {
  readonly sourceInfo = { display: "Plugin source", defaultMod: true };

  override onload(): void {
    this.registerHoverLinkSource("plugin-source", this.sourceInfo);
  }
}

describe("Workspace hover link source parity", () => {
  it("stores hover link sources as own properties while keeping helper accessors", () => {
    const app = new App(document.createElement("div"));
    const first = { display: "Demo", defaultMod: true };
    const replacement = { display: "Replacement", defaultMod: false };

    app.workspace.registerHoverLinkSource("demo", first);

    expect(app.workspace.hoverLinkSources.demo).toBe(first);
    expect(app.workspace.hoverLinkSources.get("demo")).toEqual({ id: "demo", ...first });

    app.workspace.registerHoverLinkSource("demo", replacement);

    expect(app.workspace.hoverLinkSources.demo).toBe(replacement);
    expect(app.workspace.hoverLinkSources.list()).toContainEqual({ id: "demo", ...replacement });

    app.workspace.unregisterHoverLinkSource("demo");

    expect(app.workspace.hoverLinkSources.demo).toBeUndefined();
    expect(app.workspace.hoverLinkSources.get("demo")).toBeNull();
  });

  it("removes plugin hover link sources on unload", async () => {
    const app = new App(document.createElement("div"));
    const plugin = new HoverSourcePlugin(app, { id: "hover-plugin", name: "Hover Plugin", version: "1.0.0" });

    await plugin.load();

    expect(app.workspace.hoverLinkSources["plugin-source"]).toBe(plugin.sourceInfo);

    plugin.unload();

    expect(app.workspace.hoverLinkSources["plugin-source"]).toBeUndefined();
  });
});
