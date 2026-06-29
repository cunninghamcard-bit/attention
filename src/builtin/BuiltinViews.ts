import type { App } from "../app/App";
import { DeveloperConsoleView } from "./DeveloperConsoleView";
import { BasesFileView } from "../bases/BasesView";

export function registerBuiltinViews(app: App): void {
  app.viewRegistry.registerView("developer-console", (leaf) => new DeveloperConsoleView(leaf));
  app.viewRegistry.registerView("bases", (leaf) => new BasesFileView(leaf));
  app.viewRegistry.registerExtensions(["base"], "bases");
}
