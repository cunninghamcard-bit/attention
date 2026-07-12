import { describe, expect, it } from "vitest";
import { App } from "../../app/App";

describe("WorkspaceLeaf event parity", () => {
  it("emits Obsidian's history-change event from leaf history updates", async () => {
    const app = new App(document.createElement("div"));
    const first = await app.vault.create("Leaf History First.md", "first");
    const second = await app.vault.create("Leaf History Second.md", "second");
    const leaf = await app.workspace.openFile(first, { active: true });
    const seen: string[] = [];
    const workspaceHistory: unknown[] = [];

    leaf.on<[...unknown[]]>("history-change", (...args) => {
      seen.push("history-change");
      expect(args).toEqual([]);
    });
    app.workspace.on("history-change", (...args) => workspaceHistory.push(args));

    await leaf.openFile(second, { active: true });
    await leaf.history.back();

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(workspaceHistory).toEqual([]);
  });
});
