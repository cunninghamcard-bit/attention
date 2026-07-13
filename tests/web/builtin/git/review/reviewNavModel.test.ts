import { describe, expect, it } from "vitest";
import {
  buildFileTree,
  buildHistoryRows,
  historyRowSelected,
  sourceKey,
  type ReviewFileSummary,
} from "@web/builtin/git/review/reviewNavModel";

describe("reviewNavModel tree", () => {
  it("builds a hierarchical tree from changed paths", () => {
    const files: ReviewFileSummary[] = [
      { path: "src/a.ts", status: "modified", additions: 1, deletions: 0 },
      { path: "src/lib/b.ts", status: "added", additions: 4, deletions: 0 },
      { path: "README.md", status: "modified", additions: 2, deletions: 1 },
    ];
    const tree = buildFileTree(files);
    expect(tree.map((node) => node.name).sort()).toEqual(["README.md", "src"]);
    const src = tree.find((node) => node.kind === "folder" && node.name === "src");
    expect(src?.kind).toBe("folder");
    if (src?.kind !== "folder") return;
    const names = src.children.map((child) => child.name).sort();
    expect(names).toEqual(["a.ts", "lib"]);
    const lib = src.children.find((child) => child.kind === "folder" && child.name === "lib");
    expect(lib?.kind).toBe("folder");
    if (lib?.kind !== "folder") return;
    expect(lib.children).toEqual([
      expect.objectContaining({ kind: "file", name: "b.ts", path: "src/lib/b.ts" }),
    ]);
  });

  it("orders folders before files at every level", () => {
    const tree = buildFileTree([
      { path: "zz.ts", status: "modified", additions: 1, deletions: 0 },
      { path: "lib/a.ts", status: "modified", additions: 1, deletions: 0 },
      { path: "lib/zz.ts", status: "modified", additions: 1, deletions: 0 },
      { path: "lib/core/a.ts", status: "modified", additions: 1, deletions: 0 },
    ]);

    expect(tree.map((node) => `${node.kind}:${node.name}`)).toEqual(["folder:lib", "file:zz.ts"]);
    const lib = tree[0];
    expect(lib.kind).toBe("folder");
    if (lib.kind !== "folder") return;
    expect(lib.children.map((node) => `${node.kind}:${node.name}`)).toEqual([
      "folder:core",
      "file:a.ts",
      "file:zz.ts",
    ]);
  });

  it("compresses single-child folder chains", () => {
    const tree = buildFileTree([
      {
        path: "src/app/components/x.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
      },
    ]);

    expect(tree).toEqual([
      {
        kind: "folder",
        name: "src/app/components",
        path: "src/app/components",
        children: [
          expect.objectContaining({
            kind: "file",
            name: "x.ts",
            path: "src/app/components/x.ts",
          }),
        ],
      },
    ]);
  });

  it("names sources with stable keys", () => {
    expect(sourceKey({ kind: "working-tree" })).toBe("working-tree");
    expect(sourceKey({ kind: "commit", ref: "abcdef1" })).toBe("commit:abcdef1");
  });
});

describe("reviewNavModel history", () => {
  it("history rows lead with uncommitted changes", () => {
    const rows = buildHistoryRows([
      {
        hash: "aaa111",
        shortHash: "aaa111",
        author: "Ada",
        date: "2026-07-13T00:00:00Z",
        subject: "seed",
      },
    ]);
    expect(rows[0]).toEqual({
      kind: "working-tree",
      key: "working-tree",
      subject: "Uncommitted changes",
    });
    expect(rows[1]).toMatchObject({ kind: "commit", ref: "aaa111", subject: "seed" });
  });

  it("marks commit rows selected against commit source", () => {
    const rows = buildHistoryRows([
      {
        hash: "abcdef1",
        shortHash: "abcdef1",
        author: "Ada",
        date: "2026-07-13T00:00:00Z",
        subject: "fix",
      },
    ]);
    const commitRow = rows[1];
    expect(commitRow.kind).toBe("commit");
    if (commitRow.kind !== "commit") return;
    expect(historyRowSelected(commitRow, { kind: "commit", ref: "abcdef1" })).toBe(true);
    expect(historyRowSelected(commitRow, { kind: "working-tree" })).toBe(false);
  });

  it("selecting uncommitted restores working-tree source", () => {
    const rows = buildHistoryRows([]);
    expect(historyRowSelected(rows[0], { kind: "working-tree" })).toBe(true);
    expect(historyRowSelected(rows[0], { kind: "commit", ref: "x" })).toBe(false);
  });
});
