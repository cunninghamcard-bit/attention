import type { App } from "../app/App";

export interface PluginDebugInfo {
  id: string;
  name: string;
  version?: string;
  loaded: boolean;
}

export class PluginDevTools {
  constructor(readonly app: App) {}

  listPlugins(): PluginDebugInfo[] {
    return this.app.plugins.listPlugins().map((plugin) => ({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      loaded: true,
    }));
  }

  listCorePlugins(): Array<{ id: string; enabled: boolean; name: string }> {
    return this.app.internalPlugins.list().map((state) => ({
      id: state.id,
      enabled: state.enabled,
      name: state.definition.name,
    }));
  }

  listRecentLogs(): readonly import("../diagnostics/Logger").LogEntry[] {
    return this.app.diagnostics.logger.list();
  }

  listErrors(): readonly import("../diagnostics/ErrorReporter").ErrorReport[] {
    return this.app.diagnostics.errors.list();
  }
}
