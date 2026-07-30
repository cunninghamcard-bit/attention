/**
 * Input: None
 * Output: test suite
 * Pos: Test code
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { WebViewerView } from "@web/builtin/webviewer/WebViewerPlugin";
import type { WebViewerElementAdapter } from "@web/builtin/webviewer/WebViewerElementAdapter";

/**
 * Cmd+R has to reload the web viewer you are LOOKING AT. Two separate things
 * used to send it somewhere else, and both are covered here:
 *
 * - the native View menu shipped `role: "reload"`, whose target is Electron's
 *   `webContents.getFocusedWebContents()` — the first webContents of type
 *   "webview" that reports isFocused(), and a guest's isFocused() is the ROOT
 *   view's focus, so every guest in a focused window answers true. That is
 *   always the oldest-living web viewer, never the front one. Real Obsidian
 *   ships that item in dev builds only.
 * - the controller resolved its target by falling back to "the first web
 *   viewer anywhere" when the active leaf was not one. Obsidian resolves with
 *   `getActiveViewOfType` and nothing else.
 */

async function createApp() {
  const app = new App(document.createElement("div"));
  await app.ready;
  await app.internalPlugins.enable("webviewer");
  return app;
}

async function openViewer(app: App, url: string) {
  const leaf = app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: "webviewer", state: { url }, active: true });
  const view = leaf.view as WebViewerView;
  const adapter = (view as unknown as { adapter: WebViewerElementAdapter }).adapter;
  return { leaf, view, reload: vi.spyOn(adapter, "reload") };
}

describe("webviewer:refresh targets the active view", () => {
  it("follows the active leaf instead of the first web viewer that was opened", async () => {
    const app = await createApp();
    const first = await openViewer(app, "https://first.example/");
    const second = await openViewer(app, "https://second.example/");

    expect(app.workspace.activeLeaf).toBe(second.leaf);
    expect(app.commands.executeCommandById("webviewer:refresh")).toBe(true);
    expect(second.reload).toHaveBeenCalledTimes(1);
    expect(first.reload).not.toHaveBeenCalled();

    app.workspace.setActiveLeaf(first.leaf);
    app.commands.executeCommandById("webviewer:refresh");
    expect(first.reload).toHaveBeenCalledTimes(1);
    expect(second.reload).toHaveBeenCalledTimes(1);
  });

  it("goes inert with another tab in front rather than reaching into an open web viewer", async () => {
    const app = await createApp();
    const viewer = await openViewer(app, "https://first.example/");
    // A separate tab, so the web viewer stays open behind it — the exact shape
    // that made a "first web viewer anywhere" fallback fire at the wrong tab.
    app.workspace.setActiveLeaf(app.workspace.getLeaf("tab"));

    const controller = app.internalPlugins.getPluginById("webviewer")?.instance as {
      activeView(): WebViewerView | null;
    };
    expect(controller.activeView()).toBeNull();
    // checkCallback says "not available", so the hotkey falls through.
    expect(app.commands.executeCommandById("webviewer:refresh")).toBe(false);
    expect(viewer.reload).not.toHaveBeenCalled();

    expect(app.commands.findCommand("webviewer:refresh")?.hotkeys).toEqual([
      { modifiers: ["Mod"], key: "R" },
    ]);
    // Nothing in the native menu may own Cmd+R, or it would preempt the command.
    expect(collectRoles(app.desktopMenu.buildMenu())).not.toContain("reload");
  });
});

function collectRoles(items: Array<{ role?: string; submenu?: unknown }>): string[] {
  return items.flatMap((item) => [
    ...(item.role ? [item.role] : []),
    ...collectRoles((item.submenu ?? []) as Array<{ role?: string; submenu?: unknown }>),
  ]);
}
