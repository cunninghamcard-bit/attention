import type { Plugin } from "../plugin/Plugin";
import type { ObsidianPublicApi } from "./PublicApi";
import { createPublicApi } from "./PublicApi";

export interface PluginApiFacade extends ObsidianPublicApi {
  plugin: Plugin;
  registerCleanup(cleanup: () => void): void;
}

export function createPluginApiFacade(plugin: Plugin): PluginApiFacade {
  const api = createPublicApi(plugin.app);
  return {
    ...api,
    plugin,
    registerCleanup: (cleanup) => plugin.register(cleanup),
  };
}
