import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";

describe("Workspace readWorkspaceFile parity", () => {
  it("returns an empty layout object when the workspace file is missing", async () => {
    const app = new App(document.createElement("div"));

    await expect(app.workspace.readWorkspaceFile()).resolves.toEqual({});
  });

  it("reads the saved workspace file through the Workspace public API", async () => {
    const app = new App(document.createElement("div"));
    const layout = { active: "leaf-a", lastOpenFiles: ["Daily.md"] };

    await app.workspaceLayouts.writeWorkspaceFile(layout);

    await expect(app.workspace.readWorkspaceFile()).resolves.toMatchObject(layout);
  });
});
