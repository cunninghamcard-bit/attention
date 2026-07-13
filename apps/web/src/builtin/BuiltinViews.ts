import type { App } from "../app/App";
import { DeveloperConsoleView } from "./DeveloperConsoleView";

export function registerBuiltinViews(app: App): void {
  app.viewRegistry.registerView("developer-console", (leaf) => new DeveloperConsoleView(leaf));
}
