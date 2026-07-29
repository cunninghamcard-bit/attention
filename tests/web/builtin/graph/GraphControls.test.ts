/**
 * Input: None
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { describe, expect, it } from "vitest";
import { GraphControls } from "@web/builtin/graph/GraphControls";
import { createDefaultGraphPluginOptions } from "@web/builtin/graph/GraphOptions";

// The filter search row used to be a bare <input>, which meant our OWN
// faithful CSS — `.setting-item.mod-search-setting .setting-item-control
// .search-input-container` — had nothing in the DOM to select. It is now a
// real Setting, matching the structure app.css already ships styles for.
describe("GraphControls filter search", () => {
  it("renders the search row as a Setting wearing mod-search-setting", () => {
    const controls = new GraphControls(createDefaultGraphPluginOptions(), {
      isLocal: false,
      isAnimating: () => false,
      onChange: () => {},
      onResetPan: () => {},
      onToggleAnimate: () => {},
    });
    const root = document.createElement("div");
    controls.render(root);

    const setting = root.querySelector(".setting-item.mod-search-setting");
    expect(setting).not.toBeNull();
    expect(setting?.querySelector(".search-input-container input[type='search']")).not.toBeNull();
    expect(setting?.querySelector(".search-input-clear-button")).not.toBeNull();
  });

  it("still drives options.filterOptions.query and onChange on input", () => {
    const options = createDefaultGraphPluginOptions();
    let changed = 0;
    const controls = new GraphControls(options, {
      isLocal: false,
      isAnimating: () => false,
      onChange: () => {
        changed += 1;
      },
      onResetPan: () => {},
      onToggleAnimate: () => {},
    });
    const root = document.createElement("div");
    controls.render(root);

    const input = root.querySelector<HTMLInputElement>(".search-input-container input");
    if (!input) throw new Error("missing search input");
    input.value = "readme";
    input.dispatchEvent(new Event("input"));

    expect(options.filterOptions.query).toBe("readme");
    expect(changed).toBe(1);
  });
});
