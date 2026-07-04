import type { App } from "../app/App";
import { DeveloperConsoleView } from "./DeveloperConsoleView";
import { registerAgentViews } from "../agent/AgentBuiltin";

export function registerBuiltinViews(app: App): void {
  app.viewRegistry.registerView("developer-console", (leaf) => new DeveloperConsoleView(leaf));
  registerAgentViews(app);
}
