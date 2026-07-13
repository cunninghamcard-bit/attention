import { describe, expect, it } from "vitest";
import { commitDiffBaseline, mergeCommitFileRows } from "@web/builtin/git/GitLogView";

describe("GitLogView helpers", () => {
  it("merges commit file status with numstat rows", () => {
    const rows = mergeCommitFileRows(
      [
        { path: "notes/a.md", status: "M" },
        { path: "notes/b.md", status: "A" },
      ],
      [
        { path: "notes/a.md", additions: 3, deletions: 1 },
        { path: "notes/b.md", additions: 7, deletions: 0 },
      ],
    );
    expect(rows).toEqual([
      { path: "notes/a.md", status: "M", additions: 3, deletions: 1 },
      { path: "notes/b.md", status: "A", additions: 7, deletions: 0 },
    ]);
  });

  it("uses an empty baseline for root commits", async () => {
    const git = { readFileAt: async () => null };
    await expect(commitDiffBaseline(git, "abc123", "notes/a.md")).resolves.toBe("");
    const asked: string[] = [];
    const git2 = {
      readFileAt: async (ref: string) => {
        asked.push(ref);
        return "old\n";
      },
    };
    await expect(commitDiffBaseline(git2, "abc123", "notes/a.md")).resolves.toBe("old\n");
    expect(asked).toEqual(["abc123~1"]);
  });
});
