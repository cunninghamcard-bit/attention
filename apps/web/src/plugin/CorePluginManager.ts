import type { App } from "../app/App";
import { Events } from "../core/Events";
import type { InternalPluginDefinition } from "./InternalPlugin";
import { InternalPluginWrapper } from "./InternalPluginWrapper";

export interface CorePluginState {
  id: string;
  readonly enabled: boolean;
  definition: InternalPluginDefinition;
  plugin: InternalPluginWrapper;
}

export const CORE_PLUGIN_MIGRATION_IDS = [
  "file-explorer",
  "global-search",
  "switcher",
  "graph",
  "canvas",
  "backlink",
  "outgoing-link",
  "tag-pane",
  "page-preview",
  "daily-notes",
  "templates",
  "note-composer",
  "command-palette",
  "slash-command",
  "editor-status",
  "starred",
  "bookmarks",
  "markdown-importer",
  "zk-prefixer",
  "random-note",
  "outline",
  "word-count",
  "slides",
  "audio-recorder",
  "workspaces",
  "file-recovery",
  "publish",
  "sync",
] as const;

export class CorePluginManager extends Events {
  private states = new Map<string, CorePluginState>();
  private config: Record<string, boolean> = {};
  private saveConfigTimer: number | undefined;

  constructor(readonly app: App) {
    super();
    this.app.vault.on<[string]>("raw", (path) => this.onRaw(path));
  }

  register(definition: InternalPluginDefinition): void {
    if (this.states.has(definition.id))
      throw new Error(`Core plugin is already registered: ${definition.id}`);
    const plugin = new InternalPluginWrapper(this.app, definition, this);
    plugin.init();
    const state: CorePluginState = {
      id: definition.id,
      definition,
      plugin,
      get enabled() {
        return plugin.enabled;
      },
    };
    this.states.set(definition.id, state);
  }

  getPluginById(id: string): InternalPluginWrapper | null {
    return this.states.get(id)?.plugin ?? null;
  }

  getEnabledPluginById<T = unknown>(id: string): T | null {
    const state = this.states.get(id);
    if (!state?.enabled) return null;
    return (state.plugin.instance ?? null) as T | null;
  }

  async enable(id: string, userInitiated = false): Promise<void> {
    const state = this.states.get(id);
    if (!state || state.enabled) return;
    await state.plugin.enable(userInitiated);
  }

  async disable(id: string, userInitiated = false): Promise<void> {
    const state = this.states.get(id);
    if (!state || !state.enabled) return;
    await state.plugin.disable(userInitiated);
  }

  async enableDefaults(): Promise<void> {
    await this.loadConfig();
    let needsSave = false;
    for (const state of this.states.values()) {
      const configured = this.config[state.id];
      const lockedDisabled =
        state.definition.hiddenFromList && state.definition.defaultOn === false;
      const shouldEnable = lockedDisabled ? false : (configured ?? state.definition.defaultOn);
      if (configured === undefined) {
        this.config[state.id] = shouldEnable;
        needsSave = true;
      } else if (lockedDisabled && configured !== shouldEnable) {
        this.config[state.id] = shouldEnable;
        needsSave = true;
      }
      if (shouldEnable) await state.plugin.enable(false);
    }
    if (needsSave) this.requestSaveConfig();
  }

  list(): readonly CorePluginState[] {
    return [...this.states.values()];
  }

  requestSaveConfig(): void {
    if (this.saveConfigTimer !== undefined) window.clearTimeout(this.saveConfigTimer);
    this.saveConfigTimer = window.setTimeout(() => {
      this.saveConfigTimer = undefined;
      void this.saveConfig();
    }, 500);
  }

  private async loadConfig(): Promise<void> {
    const raw = await this.app.vault.readConfigJson<Record<string, boolean> | string[]>(
      "core-plugins",
    );
    if (Array.isArray(raw)) {
      const migrated =
        (await this.app.vault.readConfigJson<Record<string, boolean>>("core-plugins-migration")) ??
        {};
      for (const id of CORE_PLUGIN_MIGRATION_IDS) migrated[id] = raw.includes(id);
      this.config = migrated;
      this.requestSaveConfig();
      return;
    }
    this.config = raw ?? {};
  }

  private async saveConfig(): Promise<void> {
    for (const state of this.states.values()) this.config[state.id] = state.enabled;
    await this.app.vault.writeConfigJson("core-plugins", this.config);
  }

  private onRaw(path: string): void {
    if (!isDirectConfigJson(path, this.app.vault.configDir)) return;
    const id = path.slice(this.app.vault.configDir.length + 1, -".json".length);
    const state = this.states.get(id);
    if (!state?.enabled) return;
    void state.plugin.onConfigFileChange();
  }
}

function isDirectConfigJson(path: string, configDir: string): boolean {
  if (!path.startsWith(`${configDir}/`) || !path.endsWith(".json")) return false;
  return !path.slice(configDir.length + 1).includes("/");
}
