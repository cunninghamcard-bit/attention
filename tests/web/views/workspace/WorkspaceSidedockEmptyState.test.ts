import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";
import { WorkspaceSidedock } from "@web/views/workspace/WorkspaceSidedock";

// The "No views" placeholder is a sibling of the sidedock's children, so it has
// to be re-evaluated whenever the child list changes — otherwise it keeps the
// visible state it was constructed with and sits above a populated sidebar.

describe("sidedock empty state", () => {
  it("hides the placeholder once the left sidedock has children", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const left = app.workspace.leftSplit;
    expect(left).toBeInstanceOf(WorkspaceSidedock);
    const sidedock = left as WorkspaceSidedock;
    expect(sidedock.children.length).toBeGreaterThan(0);
    expect(sidedock.emptyStateEl.style.display).toBe("none");
  });

  it("tracks the placeholder against the child list on append and remove", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const sidedock = app.workspace.leftSplit as WorkspaceSidedock;
    const child = sidedock.children[0];
    expect(child).toBeDefined();

    // Restoring a layout clears the dock (placeholder back on screen) and then
    // re-appends the saved children, so append has to settle the placeholder.
    sidedock.removeChild(child);
    expect(sidedock.emptyStateEl.style.display).toBe("");
    sidedock.appendChild(child);
    expect(sidedock.emptyStateEl.style.display).toBe("none");
  });

  it("hides the placeholder after a layout restore repopulates the left sidedock", async () => {
    const app = new App(document.body.appendChild(document.createElement("div")));
    await app.ready;
    const sidedock = app.workspace.leftSplit as WorkspaceSidedock;
    // Restoring runs clearChildren first, which puts the placeholder back on
    // screen, then re-appends the saved children and expands the dock.
    await app.workspace.changeLayout(app.workspace.getLayout());
    expect(sidedock.children.length).toBeGreaterThan(0);
    expect(sidedock.collapsed).toBe(false);
    expect(sidedock.emptyStateEl.style.display).toBe("none");
  });
});
