import type { App } from "../app/App";
import { DeveloperConsoleView } from "./DeveloperConsoleView";
import { BasesFileView } from "../bases/BasesView";
import { registerAgentViews } from "../agent/AgentBuiltin";

export function registerBuiltinViews(app: App): void {
  app.viewRegistry.registerView("developer-console", (leaf) => new DeveloperConsoleView(leaf));
  app.viewRegistry.registerView("bases", (leaf) => new BasesFileView(leaf));
  app.viewRegistry.registerExtensions(["base"], "bases");
  registerAgentViews(app);
}
