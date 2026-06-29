import { describe, expect, it } from "vitest";
import type { App } from "../app/App";
import { DEFAULT_GRAPH_FILTER_OPTIONS, type GraphFilterOptions } from "./GraphOptions";
import { GraphDataEngine } from "./GraphDataEngine";

interface TestFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
}

interface TestCache {
  frontmatter?: Record<string, unknown>;
  tags?: Array<{ tag: string }>;
}

function testFile(path: string): TestFile {
  const name = path.split("/").pop() ?? path;
  const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
  return {
    path,
    name,
    extension,
    basename: name.replace(/\.[^.]+$/, ""),
  };
}

function filter(overrides: Partial<GraphFilterOptions> = {}): GraphFilterOptions {
  return { ...DEFAULT_GRAPH_FILTER_OPTIONS, ...overrides };
}

function engine(options: {
  paths: string[];
  cachedFiles?: string[];
  caches?: Record<string, TestCache>;
  resolvedLinks?: Record<string, Record<string, number>>;
  unresolvedLinks?: Record<string, Record<string, number>>;
  tags?: string[];
}): GraphDataEngine {
  const files = options.paths.map(testFile);
  const caches = options.caches ?? {};
  const app = {
    workspace: { activeEditor: null },
    vault: {
      getMarkdownFiles: () => files.filter((file) => file.extension === "md"),
      getAllLoadedFiles: () => files,
      getFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
    },
    metadataCache: {
      getCachedFiles: () => options.cachedFiles ?? files.filter((file) => file.extension === "md").map((file) => file.path),
      isUserIgnored: () => false,
      getCacheByPath: (path: string) => caches[path] ?? null,
      getFileCache: (file: TestFile | null) => file ? caches[file.path] ?? null : null,
      resolvedLinks: options.resolvedLinks,
      unresolvedLinks: options.unresolvedLinks,
    },
    linkGraph: { getGraph: () => [] },
    tagIndex: { getTags: () => options.tags ?? [] },
  } as unknown as App;
  return new GraphDataEngine(app);
}

function ids(data: { nodes: Array<{ id: string }> }): string[] {
  return data.nodes.map((node) => node.id).sort();
}

describe("GraphDataEngine", () => {
  it("builds Obsidian-style global nodes from metadata links, tags and unresolved links", () => {
    const data = engine({
      paths: ["A.md", "B.md", "Orphan.md", "Pic.png"],
      caches: {
        "A.md": { tags: [{ tag: "#Project" }] },
        "B.md": { tags: [{ tag: "#project" }] },
      },
      resolvedLinks: {
        "A.md": { "B.md": 1, "Pic.png": 1 },
        "Orphan.md": { "Orphan.md": 1 },
      },
      unresolvedLinks: {
        "B.md": { Missing: 1 },
      },
      tags: ["#Project"],
    }).collect(filter({ showAttachments: true, showTags: true, showOrphans: false }), false, []);

    expect(ids(data)).toEqual(["#Project", "A.md", "B.md", "Missing", "Pic.png"]);
    expect(data.nodes.find((node) => node.id === "A.md")?.type).toBe("");
    expect(data.nodes.find((node) => node.id === "Pic.png")?.type).toBe("attachment");
    expect(data.nodes.find((node) => node.id === "Missing")?.type).toBe("unresolved");
    expect(data.links).toEqual(expect.arrayContaining([
      { from: "A.md", to: "B.md", resolved: true },
      { from: "A.md", to: "Pic.png", resolved: true },
      { from: "B.md", to: "Missing", resolved: false },
      { from: "A.md", to: "#Project", resolved: true },
      { from: "B.md", to: "#Project", resolved: true },
    ]));
  });

  it("crops local graphs from global data with depth weights and without expanding through tags", () => {
    const data = engine({
      paths: ["A.md", "B.md", "C.md", "X.md"],
      caches: {
        "A.md": { tags: [{ tag: "#Project" }] },
        "X.md": { tags: [{ tag: "#Project" }] },
      },
      resolvedLinks: {
        "A.md": { "B.md": 1 },
        "B.md": { "C.md": 1 },
      },
      tags: ["#Project"],
    }).collect(filter({ showTags: true, localFile: "A.md", localJumps: 2, localForelinks: true, localBacklinks: true }), true, []);

    expect(ids(data)).toEqual(["#Project", "A.md", "B.md", "C.md"]);
    expect(data.nodes.find((node) => node.id === "A.md")?.links).toBe(30);
    expect(data.nodes.find((node) => node.id === "B.md")?.links).toBe(15);
    expect(data.nodes.find((node) => node.id === "C.md")?.links).toBe(0);
    expect(data.nodes.some((node) => node.id === "X.md")).toBe(false);
  });

  it("uses localInterlinks to restore links between already visible local nodes", () => {
    const graph = engine({
      paths: ["A.md", "B.md", "C.md"],
      resolvedLinks: {
        "A.md": { "B.md": 1, "C.md": 1 },
        "B.md": { "C.md": 1 },
      },
    });
    const base = filter({ localFile: "A.md", localJumps: 1, localForelinks: true, localBacklinks: false });
    const withoutInterlinks = graph.collect(filter({ ...base, localInterlinks: false }), true, []);
    const withInterlinks = graph.collect(filter({ ...base, localInterlinks: true }), true, []);

    expect(withoutInterlinks.links.some((link) => link.from === "B.md" && link.to === "C.md")).toBe(false);
    expect(withInterlinks.links.some((link) => link.from === "B.md" && link.to === "C.md")).toBe(true);
  });
});
