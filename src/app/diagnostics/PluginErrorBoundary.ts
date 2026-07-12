import type { Plugin } from "../../plugin/Plugin";
import type { ErrorReporter } from "./ErrorReporter";
import type { Logger } from "./Logger";

export class PluginErrorBoundary {
  constructor(readonly reporter: ErrorReporter, readonly logger: Logger) {}

  run(plugin: Plugin, phase: string, fn: () => void | Promise<void>): Promise<void> {
    return Promise.resolve()
      .then(fn)
      .catch((error) => {
        const source = `plugin:${plugin.manifest.id}:${phase}`;
        this.reporter.report(source, error, true);
        this.logger.error(`Plugin ${plugin.manifest.id} failed during ${phase}`, error, source);
      });
  }
}
