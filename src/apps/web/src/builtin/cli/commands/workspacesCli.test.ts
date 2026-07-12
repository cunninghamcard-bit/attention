import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../../app/App";
import type { WorkspacesController } from "../../Workspaces";

// workspaces is defaultOn, so awaiting corePluginsReady flips the buffered
// CLI handlers live — the same path the real wiring takes. `app.ready` is
// needed for layout ops (getLayout/changeLayout) to run against a real tree.
async function workspacesApp(): Promise<{ app: App; controller: WorkspacesController }> {
  const app = new App(document.createElement("div"));
  const plugin = app.internalPlugins.getPluginById("workspaces");
  if (!plugin) throw new Error("Expected core plugin workspaces");
  const controller = plugin.instance as WorkspacesController;
  await app.corePluginsReady;
  await app.ready;
  return { app, controller };
}

beforeEach(() => {
  Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
});

describe("workspaces CLI command", () => {
  it("returns the exact empty message with no saved workspaces", async () => {
    const { app } = await workspacesApp();
    expect(await app.cli.handleCli(["workspaces"])).toBe("No workspaces saved.");
    expect(await app.cli.handleCli(["workspaces", "total"])).toBe("0");
  });

  it("lists names in insertion order, marking the active one", async () => {
    const { app } = await workspacesApp();
    await app.cli.handleCli(["workspace:save", "name=Main"]);
    await app.cli.handleCli(["workspace:save", "name=Alt"]);
    expect(await app.cli.handleCli(["workspaces"])).toBe("Main\nAlt (active)");
    expect(await app.cli.handleCli(["workspaces", "total"])).toBe("2");
  });
});

describe("workspace:save CLI command", () => {
  it("saves the current layout under the name and marks it active", async () => {
    const { app, controller } = await workspacesApp();
    expect(await app.cli.handleCli(["workspace:save", "name=Main"])).toBe("Saved workspace: Main");
    expect(Object.keys(controller.options.workspaces)).toEqual(["Main"]);
    expect(controller.options.workspaces.Main.layout).toEqual(app.workspace.getLayout());
    expect(await app.cli.handleCli(["workspaces"])).toBe("Main (active)");
  });

  it("re-saves the active workspace when name is omitted", async () => {
    const { app, controller } = await workspacesApp();
    await app.cli.handleCli(["workspace:save", "name=Main"]);
    const before = controller.options.workspaces.Main.savedAt;
    expect(await app.cli.handleCli(["workspace:save"])).toBe("Saved workspace: Main");
    expect(Object.keys(controller.options.workspaces)).toEqual(["Main"]);
    expect(controller.options.workspaces.Main.savedAt >= before).toBe(true);
  });

  it("RETURNS (not throws) the missing-parameter string with no name and no active workspace", async () => {
    const { app } = await workspacesApp();
    expect(await app.cli.handleCli(["workspace:save"])).toBe(
      "Missing required parameter: name\nUsage: workspace:save name=<name>",
    );
  });

  it("silently overwrites an existing workspace of the same name", async () => {
    const { app, controller } = await workspacesApp();
    await app.cli.handleCli(["workspace:save", "name=Main"]);
    expect(await app.cli.handleCli(["workspace:save", "name=Main"])).toBe("Saved workspace: Main");
    expect(Object.keys(controller.options.workspaces)).toEqual(["Main"]);
  });
});

describe("workspace:load CLI command", () => {
  it("applies the saved layout and moves the active marker", async () => {
    const { app } = await workspacesApp();
    await app.cli.handleCli(["workspace:save", "name=Main"]);
    // Change the layout so the load has something observable to undo.
    const file = await app.vault.create("Note.md", "hello");
    await app.workspace.openFile(file, { active: true });
    expect(app.workspace.getLeavesOfType("markdown").length).toBeGreaterThan(0);
    await app.cli.handleCli(["workspace:save", "name=WithNote"]);

    expect(await app.cli.handleCli(["workspace:load", "name=Main"])).toBe("Loaded workspace: Main");
    expect(app.workspace.getLeavesOfType("markdown")).toHaveLength(0);
    expect(await app.cli.handleCli(["workspaces"])).toBe("Main (active)\nWithNote");
  });

  it("throws the missing-parameter string verbatim for an empty name", async () => {
    const { app } = await workspacesApp();
    // The dispatcher's required-flag check fires when the flag is absent...
    await expect(app.cli.handleCli(["workspace:load"])).rejects.toMatch(/^Missing required parameter: name=<name>/);
    // ...so exercise the handler's own guard with an empty value.
    await expect(app.cli.handleCli(["workspace:load", "name="])).rejects.toBe(
      "Missing required parameter: name\nUsage: workspace:load name=<name>",
    );
  });

  it("throws the not-found string verbatim", async () => {
    const { app } = await workspacesApp();
    await expect(app.cli.handleCli(["workspace:load", "name=Ghost"])).rejects.toBe('Workspace "Ghost" not found.');
  });
});

describe("workspace:delete CLI command", () => {
  it("deletes the named workspace", async () => {
    const { app, controller } = await workspacesApp();
    await app.cli.handleCli(["workspace:save", "name=Main"]);
    await app.cli.handleCli(["workspace:save", "name=Alt"]);
    expect(await app.cli.handleCli(["workspace:delete", "name=Main"])).toBe("Deleted workspace: Main");
    expect(Object.keys(controller.options.workspaces)).toEqual(["Alt"]);
    expect(await app.cli.handleCli(["workspaces"])).toBe("Alt (active)");
  });

  it("leaves the active pointer dangling when deleting the active workspace", async () => {
    const { app } = await workspacesApp();
    await app.cli.handleCli(["workspace:save", "name=Main"]);
    await app.cli.handleCli(["workspace:save", "name=Alt"]);
    await app.cli.handleCli(["workspace:delete", "name=Alt"]);
    // Faithful: active still points at "Alt", so nothing is marked.
    expect(await app.cli.handleCli(["workspaces"])).toBe("Main");
  });

  it("throws the missing-parameter and not-found strings verbatim", async () => {
    const { app } = await workspacesApp();
    await expect(app.cli.handleCli(["workspace:delete"])).rejects.toMatch(/^Missing required parameter: name=<name>/);
    await expect(app.cli.handleCli(["workspace:delete", "name="])).rejects.toBe(
      "Missing required parameter: name\nUsage: workspace:delete name=<name>",
    );
    await expect(app.cli.handleCli(["workspace:delete", "name=Ghost"])).rejects.toBe('Workspace "Ghost" not found.');
  });
});
