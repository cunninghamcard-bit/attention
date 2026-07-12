import { describe, expect, it } from "vitest";
import { BUNDLED_FONT_FACES, buildTerminalTheme, DEFAULT_FONT_STACK } from "@web/builtin/terminal/GhosttyTerminalRenderer";

describe("buildTerminalTheme", () => {
  it("uses exact bundled font families and real normal/bold Nerd faces", () => {
    expect(DEFAULT_FONT_STACK).toContain('"Workbench Nerd Symbols"');
    expect(BUNDLED_FONT_FACES.filter((face) => face.family === "Workbench Nerd Symbols").map((face) => face.weight)).toEqual(["400", "700"]);
  });

  it("uses the paper-toned light scheme for light appearance", () => {
    const theme = buildTerminalTheme(false);
    expect(theme.background).toBe("#fffcf0");
    expect(theme.foreground).toBe("#100f0f");
    expect(theme.red).toBe("#af3029");
  });

  it("uses the purple-cursor dark scheme for dark appearance", () => {
    const theme = buildTerminalTheme(true);
    expect(theme.background).toBe("#15141b");
    expect(theme.cursor).toBe("#8e6ad9");
    // The source scheme maps ANSI black to light text so black-on-dark stays readable.
    expect(theme.black).toBe("#c8c6cc");
  });

  it("always returns a complete theme — ghostty's buildWasmConfig turns missing fields black", () => {
    const required = [
      "background", "foreground", "cursor",
      "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
      "brightBlack", "brightRed", "brightGreen", "brightYellow",
      "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
    ];
    for (const dark of [false, true]) {
      const theme = buildTerminalTheme(dark);
      for (const key of required) {
        expect(theme[key], `${dark ? "dark" : "light"} theme missing ${key}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
