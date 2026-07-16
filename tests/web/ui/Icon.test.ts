import { beforeEach, describe, expect, it } from "vitest";
import { addIcon, getIcon, getIconIds, removeIcon, setIcon } from "@web/ui/Icon";

describe("setIcon", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("uses Obsidian's svg-icon child contract instead of a data-icon marker", () => {
    const el = document.createElement("button");
    const plus = setIcon(el, "lucide-plus");

    expect(el.dataset.icon).toBeUndefined();
    expect(el.classList.contains("has-icon")).toBe(false);
    expect(plus.tagName.toLowerCase()).toBe("svg");
    expect(plus.classList.contains("svg-icon")).toBe(true);
    expect(plus.classList.contains("lucide-plus")).toBe(true);
    expect(setIcon(el, "lucide-plus")).toBe(plus);

    const x = setIcon(el, "lucide-x");
    expect(x).not.toBe(plus);
    expect(el.firstElementChild).toBe(x);
    expect(el.querySelectorAll("svg")).toHaveLength(1);

    expect(setIcon(el, "missing-plugin-icon")).toBeNull();
    expect(el.querySelector("svg")).toBeNull();
  });

  it("ships the users glyph used by follower surfaces", () => {
    const icon = setIcon(document.createElement("span"), "lucide-users");
    expect(icon?.classList.contains("lucide-users")).toBe(true);
  });

  it("resolves legacy icon aliases to their targets (real Ym map)", () => {
    // "create-new" -> "edit" -> lucide-edit; back it with a custom icon so the
    // resolution is verified without depending on the loaded lucide set.
    addIcon("edit", '<path d="M0 0h1"/>');
    const el = document.createElement("button");
    const icon = setIcon(el, "create-new");
    expect(icon).not.toBeNull();
    expect(icon!.classList.contains("edit")).toBe(true);
    removeIcon("edit");
  });

  it("renders plugin-added custom icons with Obsidian's custom SVG viewBox contract", () => {
    addIcon("plugin-gem", '<circle cx="50" cy="50" r="40" fill="currentColor"/>');

    const icon = getIcon("plugin-gem");
    expect(icon?.classList.contains("svg-icon")).toBe(true);
    expect(icon?.classList.contains("plugin-gem")).toBe(true);
    expect(icon?.getAttribute("viewBox")).toBe("0 0 100 100");
    expect(icon?.getAttribute("width")).toBeNull();
    expect(icon?.getAttribute("height")).toBeNull();
    expect(icon?.getAttribute("xmlns")).toBeNull();
    expect(icon?.getAttribute("stroke")).toBeNull();
    expect(icon?.querySelector("circle")?.getAttribute("r")).toBe("40");
    expect(getIconIds()).toContain("plugin-gem");

    const el = document.createElement("button");
    const rendered = setIcon(el, "plugin-gem");
    expect(rendered?.getAttribute("viewBox")).toBe("0 0 100 100");

    removeIcon("plugin-gem");
    expect(getIcon("plugin-gem")).toBeNull();
  });

  it("does not let custom lucide-prefixed icons override built-in lucide icons", () => {
    addIcon("lucide-plus", '<path d="M50 10 90 90H10Z"/>');

    const custom = getIcon("lucide-plus");
    expect(custom?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(custom?.querySelector("path")?.getAttribute("d")).toBe("M5 12h14");
    expect(getIconIds().filter((id) => id === "lucide-plus")).toHaveLength(2);

    removeIcon("lucide-plus");
    const restored = getIcon("lucide-plus");
    expect(restored?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(restored?.getAttribute("stroke")).toBe("currentColor");
    expect(getIconIds().filter((id) => id === "lucide-plus")).toHaveLength(1);
  });

  it("uses raw addIcon keys and the raw setIcon argument for no-op checks", () => {
    addIcon(" spaced-icon ", '<path d="M0 0h100v100H0Z"/>');

    expect(getIconIds()).toContain(" spaced-icon ");
    removeIcon("spaced-icon");
    expect(getIconIds()).toContain(" spaced-icon ");

    const el = document.createElement("button");
    const first = setIcon(el, "file");
    expect(first?.classList.contains("lucide-file")).toBe(true);
    const second = setIcon(el, "file");
    expect(second).not.toBe(first);
    expect(el.querySelectorAll("svg")).toHaveLength(1);

    removeIcon(" spaced-icon ");
    expect(getIconIds()).not.toContain(" spaced-icon ");
  });
});
