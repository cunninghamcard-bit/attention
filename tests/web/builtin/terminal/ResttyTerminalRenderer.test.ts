import { describe, expect, it } from "vitest";
import { fontStackFamilies } from "@web/builtin/terminal/ResttyTerminalRenderer";

describe("fontStackFamilies", () => {
  it("unquotes, trims and de-dupes the stack in order", () => {
    expect(fontStackFamilies("\"Maple Mono NF\", Menlo, 'Menlo', Monaco")).toEqual([
      "Maple Mono NF",
      "Menlo",
      "Monaco",
    ]);
  });

  it("drops entries no local font face can ever match", () => {
    // Obsidian's token chain fills unset override/theme slots with a literal
    // '??' placeholder, and ends in CSS keywords — the browser skips those
    // silently, but restty would enumerate the system font library for each.
    expect(fontStackFamilies('"??", "??", ui-monospace, SFMono-Regular, Menlo, monospace')).toEqual(
      ["SFMono-Regular", "Menlo"],
    );
  });
});
