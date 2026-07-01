import type { App } from "../app/App";
import { Plugin, type PluginManifest } from "./Plugin";
import { normalizePluginManifest, type PluginManifestInput, type RuntimePluginManifest } from "./PluginManifest";

export interface PluginState {
  id: string;
  manifest: PluginManifest;
  enabled: boolean;
  loading: boolean;
  error: string | null;
}

export class PluginManager {
  private plugins = new Map<string, Plugin>();
  private states = new Map<string, PluginState>();

  constructor(readonly app: App) {}

  async loadPlugin(manifest: PluginManifestInput, factory: (app: App, manifest: PluginManifest) => Plugin, userInitiated = false): Promise<Plugin> {
    return this.enablePlugin(manifest, factory, userInitiated);
  }

  async enablePlugin(manifest: PluginManifestInput, factory: (app: App, manifest: PluginManifest) => Plugin, userInitiated = false): Promise<Plugin> {
    const runtimeManifest = normalizePluginManifest(manifest);
    const existing = this.plugins.get(runtimeManifest.id);
    if (existing) return existing;
    const state = this.ensureState(runtimeManifest);
    state.loading = true;
    state.error = null;
    const plugin = factory(this.app, runtimeManifest);
    this.plugins.set(runtimeManifest.id, plugin);
    try {
      await plugin.load();
      if (runtimeManifest.styles?.trim()) plugin.registerCss(runtimeManifest.styles);
      await plugin.loadCSS();
      if (userInitiated) plugin.onUserEnable();
      state.enabled = true;
      this.app.workspace.trigger("community-plugin-loaded", plugin);
      return plugin;
    } catch (error) {
      state.enabled = false;
      state.error = error instanceof Error ? error.message : String(error);
      this.plugins.delete(manifest.id);
      this.reportPluginError(plugin, "load", error);
      throw error;
    } finally {
      state.loading = false;
    }
  }

  async unloadPlugin(id: string, userDisabled = false): Promise<void> {
    await this.disablePlugin(id, userDisabled);
  }

  async disablePlugin(id: string, userDisabled = false): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) return;
    plugin._userDisabled = userDisabled;
    const state = this.ensureState(plugin.manifest);
    state.loading = true;
    state.error = null;
    try {
      plugin.unload();
      this.plugins.delete(id);
      state.enabled = false;
      this.app.workspace.trigger("community-plugin-unloaded", plugin);
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      this.reportPluginError(plugin, "unload", error);
      throw error;
    } finally {
      state.loading = false;
    }
  }

  getPlugin(id: string): Plugin | null {
    return this.plugins.get(id) ?? null;
  }

  listPlugins(): readonly Plugin[] {
    return [...this.plugins.values()];
  }

  getState(id: string): PluginState | null {
    const state = this.states.get(id);
    return state ? { ...state } : null;
  }

  listStates(): readonly PluginState[] {
    return [...this.states.values()].map((state) => ({ ...state }));
  }

  private ensureState(manifest: RuntimePluginManifest): PluginState {
    let state = this.states.get(manifest.id);
    if (!state) {
      state = { id: manifest.id, manifest, enabled: false, loading: false, error: null };
      this.states.set(manifest.id, state);
    } else {
      state.manifest = manifest;
    }
    return state;
  }

  private reportPluginError(plugin: Plugin, phase: string, error: unknown): void {
    const source = `plugin:${plugin.manifest.id}:${phase}`;
    this.app.diagnostics.errors.report(source, error, true);
    this.app.diagnostics.logger.error(`Plugin ${plugin.manifest.id} failed during ${phase}`, error, source);
  }
}
