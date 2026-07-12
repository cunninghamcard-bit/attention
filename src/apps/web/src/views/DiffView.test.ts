import { describe, expect, it } from "vitest";
import { App } from "../app/App";
import { DiffView, openFileCompare, openFileDiff } from "./DiffView";

describe("DiffView", () => {
  it("shows changed chunks between the file and the original", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const file = await app.vault.create("agent.ts", "const a = 1;\nconst b = 99;\nconst c = 3;\n");

    const leaf = await openFileDiff(app, file, "const a = 1;\nconst b = 2;\nconst c = 3;\n");
    const view = leaf.view as DiffView;

    expect(view).toBeInstanceOf(DiffView);
    expect(view.getIcon()).toBe("lucide-file-diff");
    expect(view.getDisplayText()).toBe("agent.ts (changes)");
    expect(view.getChunkCount()).toBe(1);
  });

  it("rejecting a chunk restores the original and saves to the vault", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const file = await app.vault.create("edit.ts", "line one\nAGENT EDIT\nline three\n");

    const leaf = await openFileDiff(app, file, "line one\nline two\nline three\n");
    const view = leaf.view as DiffView;
    expect(view.getChunkCount()).toBe(1);

    view.rejectAll();
    expect(view.getChunkCount()).toBe(0);
    expect(view.getViewData()).toContain("line two");
    await view.save();
    await expect(app.vault.read(file)).resolves.toContain("line two");
  });

  it("accepting a chunk keeps the edit and clears the chunk", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const file = await app.vault.create("keep.ts", "alpha\nNEW LINE\nomega\n");

    const leaf = await openFileDiff(app, file, "alpha\nomega\n");
    const view = leaf.view as DiffView;
    expect(view.getChunkCount()).toBe(1);

    view.acceptAll();
    expect(view.getChunkCount()).toBe(0);
    expect(view.getViewData()).toContain("NEW LINE");
  });

  it("compares two files with the second as editable target", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const baseline = await app.vault.create("v1.ts", "shared\nold\n");
    const target = await app.vault.create("v2.ts", "shared\nnew\n");

    const leaf = await openFileCompare(app, target, baseline);
    const view = leaf.view as DiffView;

    expect(view.file?.path).toBe("v2.ts");
    expect(view.getChunkCount()).toBe(1);
  });
});
