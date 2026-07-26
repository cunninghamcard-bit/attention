import { describe, expect, it } from "vitest";
import { buildTerminalTheme } from "@web/builtin/terminal/GhosttyTerminalRenderer";

describe("buildTerminalTheme", () => {
  it("takes every color from an app design token — no bundled scheme", () => {
    const theme = buildTerminalTheme((token) => `<${token}>`);

    expect(theme.background).toBe("<--background-primary>");
    expect(theme.foreground).toBe("<--text-normal>");
    expect(theme.cursor).toBe("<--text-accent>");
    expect(theme.red).toBe("<--color-red>");
    // Nothing may be a hardcoded hex: the terminal follows light/dark and any
    // community theme only as long as every field comes from the token layer.
    expect(Object.entries(theme).filter(([, value]) => !value.startsWith("<--"))).toEqual([]);
  });

  it("never uses a translucent token — ghostty-web cannot blend alpha", () => {
    // --text-selection is hsla(…, 0.2); taken literally it would paint an
    // opaque near-white / near-black block over the selected cells.
    const asked: string[] = [];
    buildTerminalTheme((token) => {
      asked.push(token);
      return "#000000";
    });

    expect(asked).not.toContain("--text-selection");
  });

  it("always returns a complete theme — ghostty's buildWasmConfig turns missing fields black", () => {
    const required = [
      "background",
      "foreground",
      "cursor",
      "black",
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "white",
      "brightBlack",
      "brightRed",
      "brightGreen",
      "brightYellow",
      "brightBlue",
      "brightMagenta",
      "brightCyan",
      "brightWhite",
    ];
    const theme = buildTerminalTheme(() => "#123456");
    for (const key of required) {
      expect(theme[key], `theme missing ${key}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
