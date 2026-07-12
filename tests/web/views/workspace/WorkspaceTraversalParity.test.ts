import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";

describe("Workspace traversal parity", () => {
  it("short-circuits iterateLeaves and returns whether traversal stopped", () => {
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();
    const seen: string[] = [];

    const stopped = app.workspace.iterateLeaves(app.workspace.rootSplit, (item) => {
      seen.push(item.id);
      return item === leaf;
    });

    expect(stopped).toBe(true);
    expect(seen).toEqual([leaf.id]);
    expect(app.workspace.iterateLeaves(app.workspace.leftSplit, () => true)).toBe(false);
  });

  it("supports Obsidian's callback-first scoped iterateLeaves form", () => {
    const app = new App(document.createElement("div"));
    const leaf = app.workspace.getLeaf();
    const seen: string[] = [];

    const stopped = app.workspace.iterateLeaves((item) => {
      seen.push(item.id);
      return true;
    }, app.workspace.rootSplit);

    expect(stopped).toBe(true);
    expect(seen).toEqual([leaf.id]);
  });

  it("does not treat single-callback iterateLeaves as iterateAllLeaves", () => {
    const app = new App(document.createElement("div"));
    const seen: string[] = [];

    const stopped = app.workspace.iterateLeaves((item) => {
      seen.push(item.id);
      return true;
    });

    expect(stopped).toBe(false);
    expect(seen).toEqual([]);
  });

  it("short-circuits iterateTabs and returns false when no tab group matches", () => {
    const app = new App(document.createElement("div"));
    const seen: string[] = [];

    const stopped = app.workspace.iterateTabs(app.workspace.rootSplit, (tabs) => {
      seen.push(tabs.id);
      return true;
    });

    expect(stopped).toBe(true);
    expect(seen).toHaveLength(1);
    expect(app.workspace.iterateTabs([], () => true)).toBe(false);
  });
});
