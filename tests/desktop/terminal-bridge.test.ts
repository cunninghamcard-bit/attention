/**
 * Input: apps/desktop/preload/terminal-bridge
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { describe, expect, it } from "vitest";
import { defaultLang } from "../../apps/desktop/preload/terminal-bridge";

// A shell spawned without any locale drops zsh into the C locale, where zle
// counts the prompt's UTF-8 glyphs by byte and kill-line repaints over the
// prompt. The bridge must hand the shell a LANG the way Terminal.app does.
describe("defaultLang", () => {
  it("respects a locale the user already has", () => {
    expect(defaultLang({ LANG: "de_DE.UTF-8" })).toBe("de_DE.UTF-8");
  });

  it("defers to LC_ALL / LC_CTYPE without inventing a LANG next to them", () => {
    expect(defaultLang({ LC_ALL: "en_US.UTF-8" })).toBeUndefined();
    expect(defaultLang({ LC_CTYPE: "UTF-8" })).toBeUndefined();
  });

  it("derives a UTF-8 LANG from the system locale when none is set", () => {
    const lang = defaultLang({});
    expect(lang).toMatch(/^[a-z]{2,3}_[A-Z]{2}\.UTF-8$/);
  });
});
