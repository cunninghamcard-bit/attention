// Completion-criteria guards for docs/architecture/shared-tree-item-component.
// Each `it` title matches a spec Scenario's Test selector verbatim.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const rel = (abs: string): string => abs.slice(ROOT.length + 1).replaceAll("\\", "/");

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "out", "dist"].includes(entry.name)) continue;
      walkTs(join(dir, entry.name), out);
    } else if (entry.name.endsWith(".ts")) out.push(join(dir, entry.name));
  }
  return out;
}

// The 12 tree views migrated onto TreeItem (record 0003).
const MIGRATED_VIEWS = [
  "builtin/FileExplorerView.ts",
  "builtin/OutlineView.ts",
  "builtin/Bookmarks.ts",
  "builtin/TagPaneView.ts",
  "builtin/BacklinksView.ts",
  "builtin/OutgoingLinksView.ts",
  "builtin/graph/GraphControls.ts",
  "builtin/git/GitChangesView.ts",
  "builtin/git/GitLogView.ts",
  "builtin/git/GitHistoryView.ts",
  "builtin/git/review/GitNavView.ts",
  "builtin/git/review/ReviewSurface.ts",
];

// Non-row reuse of the `.tree-item-self` class for styled SECTION HEADERS /
// TITLES — not collapsible/nesting tree rows (no chevron, no children, no
// cross-view alignment concern). Documented exceptions to single-primitive.
const HEADER_STYLING_ALLOWLIST = [
  "src/renderer/views/MarkdownView.ts", // embedded backlinks section headers
  "src/renderer/builtin/git/review/ReviewSurface.ts", // review sidebar title
];

describe("shared tree item component", () => {
  it("builds every tree row through the shared tree item", () => {
    // A className literal `"tree-item-self…` (quote, no dot) BUILDS a row's
    // self element; `".tree-item-self"` (quote-dot) merely queries one.
    const offenders = walkTs(join(ROOT, "src", "renderer"))
      .filter((f) => rel(f) !== "src/renderer/ui/TreeItem.ts")
      .filter((f) => /["'`]tree-item-self\b/.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter((r) => !HEADER_STYLING_ALLOWLIST.includes(r));
    expect(offenders).toEqual([]);
  });

  // Regression guard (not a spec selector). `.tree-item-icon` is the row's one
  // absolutely-positioned gutter box, and Obsidian plus every community theme
  // reads it as "the collapse chevron" — Primary repaints it grey at 0,3,0 and
  // loads after us, so a type icon wearing that class loses its palette across
  // a folder's whole subtree, and stacks on top of the chevron besides. Type
  // icons go in TreeItem's in-flow `iconEl` slot.
  it("keeps type icons out of the chevron gutter", () => {
    const gutterIcon = /["'`][^"'`]*\btree-item-icon\b[^"'`]*\bnav-[a-z]+-icon\b/;
    const offenders = walkTs(join(ROOT, "src", "renderer"))
      .filter((f) => rel(f) !== "src/renderer/ui/TreeItem.ts")
      .filter((f) => gutterIcon.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("exposes the tree item type-icon slot", () => {
    const src = read("src/renderer/ui/TreeItem.ts");
    expect(src).toContain("get iconEl");
    expect(src).toContain("tree-item-icon-inline");
  });

  it("replaces NavFolder with the tree item component", () => {
    expect(existsSync(join(ROOT, "src/renderer/ui/NavFolder.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "src/renderer/ui/TreeItem.ts"))).toBe(true);
  });

  it("exposes the Obsidian tree item surface", () => {
    const src = read("src/renderer/ui/TreeItem.ts");
    expect(src).toContain("class TreeItem");
    for (const method of ["setCollapsible", "setCollapsed", "addChild"]) {
      expect(src).toContain(method);
    }
    for (const cls of [
      "tree-item",
      "tree-item-self",
      "tree-item-inner",
      "tree-item-children",
      "collapse-icon",
    ]) {
      expect(src).toContain(cls);
    }
  });

  it("keeps tree rows aligned across views", () => {
    // Structural half of the Review:human alignment scenario: every migrated
    // view builds rows through the one shared component, so gutter / indent /
    // chevron geometry is identical by construction (the pixel median is the
    // human sign-off).
    const missing = MIGRATED_VIEWS.filter((v) => !/\bTreeItem\b/.test(read("src/renderer/" + v)));
    expect(missing).toEqual([]);
  });

  it("keeps markdown fold off the tree component", () => {
    for (const mod of [
      "src/renderer/views/MarkdownView.ts",
      "src/renderer/markdown/MarkdownPreviewRenderer.ts",
    ]) {
      expect(read(mod)).not.toMatch(/import[^;]*\bTreeItem\b[^;]*from\s+["'][^"']*TreeItem["']/);
    }
  });
});
