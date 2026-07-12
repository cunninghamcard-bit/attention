import { describe, expect, it } from "vitest";
import type { GraphNode } from "./GraphDataEngine";
import { compileGraphSearchQuery } from "./GraphSearchQuery";

function node(overrides: Partial<GraphNode>): GraphNode {
  return {
    id: "Notes/Alpha.md",
    label: "Alpha",
    type: "file",
    resolved: true,
    x: 0,
    y: 0,
    links: 0,
    focused: false,
    colorClass: "color-fill",
    properties: {},
    ...overrides,
  };
}

describe("GraphSearchQuery", () => {
  it("matches phrase, negation and OR expressions", () => {
    const query = compileGraphSearchQuery("(\"daily note\" OR tag:project) -archive");
    expect(query.matchNode(node({ id: "Daily/Daily Note.md", label: "Daily Note" }))).toBe(true);
    expect(query.matchNode(node({ id: "#project", label: "#project", type: "tag" }))).toBe(true);
    expect(query.matchNode(node({ id: "Archive/Daily Note.md", label: "Daily Note Archive" }))).toBe(false);
  });

  it("matches frontmatter property expressions", () => {
    const query = compileGraphSearchQuery("[status:active] [priority>2]");
    expect(query.matchNode(node({ properties: { status: "active", priority: 3 } }))).toBe(true);
    expect(query.matchNode(node({ properties: { status: "active", priority: 1 } }))).toBe(false);
  });

  it("matches filepath and tag helpers used by graph filters", () => {
    expect(compileGraphSearchQuery("path:Projects").matchFilepath("Projects/Roadmap.md")).toBe(true);
    expect(compileGraphSearchQuery("tag:agent").matchTag("#agent")).toBe(true);
  });
});
