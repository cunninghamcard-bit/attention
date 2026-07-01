import { describe, expect, it, vi } from "vitest";
import { debounce, getLanguage, normalizePath, stringifyYaml } from "./ApiUtils";

describe("Obsidian API utility parity", () => {
  it("normalizes empty paths to the vault root and returns NFC text", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("/./Cafe\u0301.md")).toBe("Café.md");
  });

  it("does not reset debounce timers unless requested", () => {
    vi.useFakeTimers();
    try {
      const calls: number[] = [];
      const debounced = debounce((value: number) => calls.push(value), 100);

      debounced(1);
      vi.advanceTimersByTime(50);
      debounced(2);
      vi.advanceTimersByTime(50);

      expect(calls).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stringifies YAML with Obsidian's null and wrapping options", () => {
    const value: Record<string, unknown> = {};
    value.first = { same: true };
    value.second = value.first;

    expect(stringifyYaml({ empty: null, value })).not.toContain("&a");
    expect(stringifyYaml({ empty: null })).toBe("empty:\n");
  });

  it("falls back to navigator.language when no app language is configured", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: () => null },
    });
    Object.defineProperty(window.navigator, "language", {
      configurable: true,
      value: "fr-CA",
    });

    expect(getLanguage()).toBe("fr-CA");
  });
});
