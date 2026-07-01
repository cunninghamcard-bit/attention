import { describe, expect, it, vi } from "vitest";
import { resetActiveWindow, setActiveWindow } from "../dom/ActiveDocument";
import { debounce, getLanguage, normalizePath, stringifyYaml } from "./ApiUtils";

describe("Obsidian API utility parity", () => {
  it("normalizes empty paths to the vault root and returns NFC text", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("/./Cafe\u0301.md")).toBe("Café.md");
  });

  it("keeps debounce timers while running the latest pending args", () => {
    vi.useFakeTimers();
    try {
      const calls: number[] = [];
      const debounced = debounce((value: number) => calls.push(value), 100);

      debounced(1);
      vi.advanceTimersByTime(50);
      debounced(2);
      vi.advanceTimersByTime(50);

      expect(calls).toEqual([2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the active window as debounce timer owner", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const firstWindow = fakeTimerWindow(1);
      const secondWindow = fakeTimerWindow(2);
      const calls: string[] = [];
      const debounced = debounce((value: string) => calls.push(value), 100);

      setActiveWindow(firstWindow);
      debounced("first");
      expect(firstWindow.setTimeout).toHaveBeenCalledWith(expect.any(Function), 100);

      vi.setSystemTime(100);
      setActiveWindow(secondWindow);
      debounced("second");

      expect(firstWindow.clearTimeout).toHaveBeenCalledWith(1);
      expect(secondWindow.setTimeout).toHaveBeenCalledWith(expect.any(Function), 0);
      debounced.run();
      expect(calls).toEqual(["second"]);
    } finally {
      resetActiveWindow();
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

function fakeTimerWindow(timerId: number): Window {
  return {
    document,
    setTimeout: vi.fn(() => timerId),
    clearTimeout: vi.fn(),
  } as unknown as Window;
}
