import { describe, expect, it } from "vitest";
import { buildBranchEntries, isPlausibleBranchName } from "@web/builtin/git/BranchSwitchModal";

const BRANCHES = [
  { name: "main", current: true },
  { name: "feature", current: false },
];

describe("BranchSwitchModal entries", () => {
  it("offers a create entry for unknown branch names", () => {
    const entries = buildBranchEntries(BRANCHES, "hotfix");
    expect(entries).toEqual([{ type: "create", name: "hotfix" }]);

    const partial = buildBranchEntries(BRANCHES, "feat");
    expect(partial[0]).toEqual({ type: "branch", name: "feature", current: false });
    expect(partial.at(-1)).toEqual({ type: "create", name: "feat" });
  });

  it("lists all branches for an empty query without a create entry", () => {
    const entries = buildBranchEntries(BRANCHES, "");
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.type === "branch")).toBe(true);
  });

  it("offers no create entry for names git would reject", () => {
    for (const bad of ["has space", "-lead", "a..b", "tail/", "x.lock", "a@{b}"]) {
      expect(isPlausibleBranchName(bad), bad).toBe(false);
      expect(buildBranchEntries(BRANCHES, bad).some((entry) => entry.type === "create")).toBe(
        false,
      );
    }
  });
});
