import { describe, expect, it } from "vitest";
import { App } from "../app/App";
import { WorkspaceLeaf } from "./WorkspaceLeaf";
import { WorkspaceTabs } from "./WorkspaceTabs";

describe("Workspace parent insertion parity", () => {
  it("appends children when insertChild receives a negative index", () => {
    const app = new App(document.createElement("div"));
    const firstTabs = app.workspace.rootSplit.children[0];
    const appendedTabs = new WorkspaceTabs(app.workspace);

    app.workspace.rootSplit.insertChild(-1, appendedTabs);

    expect(app.workspace.rootSplit.children.at(-1)).toBe(appendedTabs);
    expect(app.workspace.rootSplit.children[0]).toBe(firstTabs);
  });

  it("appends tab leaves when insertChild receives a negative index", () => {
    const app = new App(document.createElement("div"));
    const first = app.workspace.getLeaf();
    if (!(first.parent instanceof WorkspaceTabs)) throw new Error("Expected root tabs");
    const appended = new WorkspaceLeaf(app.workspace);

    first.parent.insertChild(-1, appended, false);

    expect(first.parent.children.at(-1)).toBe(appended);
    expect(first.parent.children[0]).toBe(first);
  });
});
