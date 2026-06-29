import type { App } from "../app/App";
import type { InternalPluginWrapper } from "./InternalPluginWrapper";

export interface InternalPluginDefinition {
  id: string;
  name: string;
  description?: string;
  hiddenFromList?: boolean;
  defaultOn: boolean;
  init(app: App, plugin: InternalPluginWrapper): void | Promise<void>;
  onEnable?(app: App, plugin: InternalPluginWrapper): void | Promise<void>;
  onDisable?(app: App, plugin: InternalPluginWrapper): void | Promise<void>;
  onUserEnable?(app: App, plugin: InternalPluginWrapper): void | Promise<void>;
  onUserDisable?(app: App, plugin: InternalPluginWrapper): void | Promise<void>;
  onExternalSettingsChange?(app: App, plugin: InternalPluginWrapper): void | Promise<void>;
}

export class InternalPluginRegistry {
  private definitions = new Map<string, InternalPluginDefinition>();

  register(definition: InternalPluginDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  get(id: string): InternalPluginDefinition | null {
    return this.definitions.get(id) ?? null;
  }

  list(): readonly InternalPluginDefinition[] {
    return [...this.definitions.values()];
  }
}
