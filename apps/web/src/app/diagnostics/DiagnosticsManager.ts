import { Logger } from "./Logger";
import { ErrorReporter } from "./ErrorReporter";
import { PluginErrorBoundary } from "./PluginErrorBoundary";

export class DiagnosticsManager {
  readonly logger = new Logger();
  readonly errors = new ErrorReporter();
  readonly pluginBoundary = new PluginErrorBoundary(this.errors, this.logger);
}
