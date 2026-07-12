import { describe, expect, it } from "vitest";
import {
  buildReviewMarkdown,
  fingerprintContents,
  isViewed,
  readDiffStyle,
  readViewed,
  statusFromPorcelain,
  writeDiffStyle,
  writeViewed,
} from "@web/builtin/git/review/reviewModel";

describe("reviewModel", () => {
  it("maps porcelain codes to review statuses", () => {
    expect(statusFromPorcelain("??")).toBe("untracked");
    expect(statusFromPorcelain("A ")).toBe("added");
    expect(statusFromPorcelain(" M")).toBe("modified");
    expect(statusFromPorcelain("D ")).toBe("deleted");
    expect(statusFromPorcelain("R")).toBe("renamed");
  });

  it("fingerprints change when either side changes", () => {
    const base = fingerprintContents("old", "new");
    expect(fingerprintContents("old", "new")).toBe(base);
    expect(fingerprintContents("old", "newer")).not.toBe(base);
    expect(fingerprintContents("older", "new")).not.toBe(base);
    // The separator keeps ("ab","c") distinct from ("a","bc").
    expect(fingerprintContents("ab", "c")).not.toBe(fingerprintContents("a", "bc"));
  });

  it("persists viewed state per root and invalidates on fingerprint change", () => {
    writeViewed("/repo", { "a.ts": "f1" });
    const viewed = readViewed("/repo");
    expect(isViewed(viewed, { path: "a.ts", fingerprint: "f1" })).toBe(true);
    expect(isViewed(viewed, { path: "a.ts", fingerprint: "f2" })).toBe(false);
    expect(readViewed("/other")).toEqual({});
  });

  it("builds review markdown from non-empty drafts only", () => {
    const markdown = buildReviewMarkdown([
      { id: "1", path: "agent.ts", side: "additions", line: 12, body: "Should this be async?" },
      { id: "2", path: "b.ts", side: "deletions", line: 3, body: "   " },
    ]);
    expect(markdown).toContain("`agent.ts` — line 12 (new)");
    expect(markdown).toContain("Should this be async?");
    expect(markdown).not.toContain("b.ts");
    expect(buildReviewMarkdown([])).toBe("");
  });

  it("round-trips the diff style preference", () => {
    expect(readDiffStyle()).toBe("unified");
    writeDiffStyle("split");
    expect(readDiffStyle()).toBe("split");
  });
});
