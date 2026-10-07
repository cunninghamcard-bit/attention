import { afterEach } from "vitest";
import { App } from "@web/app/App";
import { cancelAnimation } from "@web/dom/Animate";

const apps = new Set<App>();

/** Create an app whose asynchronous work is disposed before jsdom teardown. */
export function createTestApp(): App {
  const app = new App(document.createElement("div"));
  apps.add(app);
  return app;
}

export async function disposeTestApps(): Promise<void> {
  try {
    for (const app of apps) {
      // Some component tests only exercise synchronous construction. Startup
      // must still finish before its listeners and views can be unloaded.
      await app.ready;
      await app.lifecycle.unload();
      for (const { plugin } of app.internalPlugins.list()) plugin.unload();

      // Keep detached view elements reachable until their animations are stopped.
      const elements = [app.containerEl, ...app.containerEl.querySelectorAll<HTMLElement>("*")];
      const closing: Promise<void>[] = [];
      app.workspace.iterateAllLeaves((leaf) => {
        closing.push(leaf.view.close());
      });
      await Promise.all(closing);
      // Vault writes index asynchronously. Drain them after unsubscribing views.
      await new Promise<void>((resolve) => app.metadataCache.onCleanCache(resolve));
      // Animation starts are batched on the next task; let that batch arm before
      // cancelling so it cannot recreate a timer after cleanup.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      for (const el of elements) cancelAnimation(el, true);
      app.workspace.requestResize.cancel();
      app.workspace.requestActiveLeafEvents.cancel();
      app.workspace.requestLayoutChangeEvents.cancel();
      app.workspace.requestSaveLayout.cancel();
      app.containerEl.remove();
    }
  } finally {
    apps.clear();
  }
}

afterEach(disposeTestApps);
