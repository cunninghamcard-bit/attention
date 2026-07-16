import { describe, expect, it } from "vitest";
import {
  buildFileTree,
  type TreeFileNode,
  buildHistoryRows,
  historyRowSelected,
  sourceKey,
  type ReviewFileSummary,
} from "@web/builtin/git/review/reviewNavModel";

/** A remote tree entry: `kind` is a literal union, which is what makes this the
 * interesting case — a widened `string` would intersect with "file" harmlessly. */
interface RemoteEntry {
  path: string;
  kind: "blob" | "tree";
  size: number;
}

/** Compile-time guard, and it has to be one: the runtime spread overwrites
 * `kind` either way, so no assertion about behaviour can tell a sound model from
 * an unsound one. Only the type differs. Under a plain `T & { kind: "file" }`
 * this leaf type reduces to `never` and the line below stops compiling — which
 * is the whole defect, and the only place it is visible. */
const _remoteLeafStaysConstructible: TreeFileNode<RemoteEntry> = {
  path: "src/main.ts",
  size: 1,
  kind: "file",
  name: "main.ts",
};
void _remoteLeafStaysConstructible;

describe("reviewNavModel tree", () => {
  it("lets a payload that names its own kind still discriminate", () => {
    // A remote tree entry carries `kind`/`type` of its own. Under a plain
    // intersection TypeScript reduced the whole node to `never` ("conflicting
    // types in some constituents") while the runtime spread just overwrote it —
    // a type describing something the code does not do. The leaf's own kind must
    // win, and the union must still discriminate.
    const entries: RemoteEntry[] = [
      { path: "src/main.ts", kind: "blob", size: 1 },
      { path: "docs/readme.md", kind: "blob", size: 2 },
    ];

    const tree = buildFileTree(entries);
    const folder = tree.find((node) => node.name === "src");
    if (folder?.kind !== "folder") throw new Error("expected a src folder");
    const leaf = folder.children[0];

    // `kind` discriminates to the tree's own value, not the payload's…
    expect(leaf.kind).toBe("file");
    // …and nothing else the caller sent was lost.
    expect(leaf).toMatchObject({ name: "main.ts", size: 1 });
  });

  it("carries a foreign payload through, so a second caller need not copy the tree", () => {
    // The review's status/additions were never load-bearing — the algorithm only
    // reads `path`. GitHub's repository files want the same folder structure with
    // their own record on the leaf, and a 95%-identical second tree model is the
    // duplication this generalisation exists to avoid.
    const entries = [
      { path: "src/main.ts", size: 120, sha: "aaa" },
      { path: "src/ui/Button.ts", size: 40, sha: "bbb" },
      { path: "README.md", size: 8, sha: "ccc" },
    ];

    const tree = buildFileTree(entries);

    expect(tree.map((node) => node.name)).toEqual(["src", "README.md"]);
    const src = tree.find((node) => node.name === "src");
    if (src?.kind !== "folder") throw new Error("src should be a folder");
    // Folders sort ahead of files, so `ui` leads and `main.ts` follows.
    expect(src.children.map((node) => node.name)).toEqual(["ui", "main.ts"]);
    const ui = src.children[0];
    if (ui.kind !== "folder") throw new Error("ui should be a folder");

    // The leaf is the caller's own record plus where it sits — not a lossy copy.
    expect(ui.children[0]).toMatchObject({ kind: "file", name: "Button.ts", size: 40, sha: "bbb" });
  });

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
