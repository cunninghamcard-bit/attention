import { describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import type { Command } from "@web/app/commands/CommandManager";
import { createGitPluginDefinition } from "@web/builtin/git/GitPlugin";
import type { InternalPluginWrapper } from "@web/plugin/InternalPluginWrapper";

/** The git surface rides the core-plugin lifecycle: registered when the
 * plugin is on, gone when it is toggled off — original dual-track shape. */
async function readyApp(): Promise<App> {
  const app = new App(document.createElement("div"));
  await app.ready;
  await app.corePluginsReady;
  return app;
}

describe("git and github core plugins", () => {
  it("register their views and commands by default", async () => {
    const app = await readyApp();
    expect(app.viewRegistry.getViewCreatorByType("git-changes")).toBeTruthy();
    expect(app.viewRegistry.getViewCreatorByType("git-nav")).toBeTruthy();
    expect(app.viewRegistry.getViewCreatorByType("github-workspace")).toBeTruthy();
    expect(app.commands.findCommand("git:open-changes")).toBeTruthy();
    expect(app.commands.findCommand("git:open-nav")).toBeTruthy();
    expect(app.commands.findCommand("github:open-workspace")).toBeTruthy();
  });

  it("names the navigator command open git navigator", async () => {
    const app = await readyApp();
    const commands: Command[] = [];
    const plugin = {
      registerViewType: vi.fn(),
      registerGlobalCommand(command: Command) {
        commands.push(command);
        return command;
      },
    } as unknown as InternalPluginWrapper;
    createGitPluginDefinition().init(app, plugin);
    expect(commands.find((command) => command.id === "git:open-nav")?.name).toBe(
      "Open git navigator",
    );
  });

  it("keeps the git surface free of commit affordances", async () => {
    const app = await readyApp();
    // No dedicated commit view, no commit command — the git-changes view's
    // missing commit box is asserted on the real DOM in the desktop e2e.
    expect(app.viewRegistry.getViewCreatorByType("git-composer")).toBeFalsy();
    expect(app.commands.findCommand("git:open-commit")).toBeFalsy();
    expect(app.viewRegistry.getViewCreatorByType("git-changes")).toBeTruthy();
  });

  it("unregister the surface when toggled off", async () => {
    const app = await readyApp();
    await app.internalPlugins.disable("git", true);
    expect(app.viewRegistry.getViewCreatorByType("git-changes")).toBeFalsy();
    expect(app.commands.findCommand("git:open-changes")).toBeFalsy();
    await app.internalPlugins.enable("git", true);
    expect(app.viewRegistry.getViewCreatorByType("git-changes")).toBeTruthy();
  });

  it("owns pull requests on the cloud side; local surface survives without it", async () => {
    const app = await readyApp();
    expect(app.commands.findCommand("github:open-pull-requests")).toBeTruthy();
    await app.internalPlugins.disable("github", true);
    expect(app.viewRegistry.getViewCreatorByType("git-prs")).toBeFalsy();
    expect(app.commands.findCommand("github:open-pull-requests")).toBeFalsy();
    expect(app.viewRegistry.getViewCreatorByType("git-changes")).toBeTruthy();
    expect(app.viewRegistry.getViewCreatorByType("git-log")).toBeTruthy();
    expect(app.viewRegistry.getViewCreatorByType("git-review")).toBeTruthy();
  });
});
