import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readGitHubPrPrefs, writeGitHubPrPrefs } from "@web/builtin/github/prefs";

const STORAGE_KEY = "attention-github-pr-prefs";
const RETIRED_STORAGE_KEY = "workbench-github-pr-prefs";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  } satisfies Storage);
});

afterEach(() => vi.unstubAllGlobals());

describe("GitHub PR preferences", () => {
  it("persists preferences under the Attention storage key", () => {
    const preferences = writeGitHubPrPrefs({
      owner: "cunninghamcard-bit",
      repo: "attention",
      filter: "all",
    });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual(preferences);
    expect(localStorage.getItem(RETIRED_STORAGE_KEY)).toBeNull();
    expect(readGitHubPrPrefs()).toEqual(preferences);
  });

  it("does not read the retired Workbench storage key", () => {
    localStorage.setItem(
      RETIRED_STORAGE_KEY,
      JSON.stringify({ owner: "legacy", repo: "legacy", filter: "closed" }),
    );

    expect(readGitHubPrPrefs()).toEqual({});
  });
});
