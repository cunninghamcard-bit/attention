import { describe, expect, it } from "vitest";
import { App } from "@web/app/App";

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
    expect(app.viewRegistry.getViewCreatorByType("github-workspace")).toBeTruthy();
    expect(app.commands.findCommand("git:open-changes")).toBeTruthy();
    expect(app.commands.findCommand("github:open-workspace")).toBeTruthy();
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
