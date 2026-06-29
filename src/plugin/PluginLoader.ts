import type { App } from "../app/App";
import { Plugin } from "./Plugin";
import { normalizePluginManifest, type PluginManifest, type PluginManifestInput, type PluginPackage } from "./PluginManifest";
import type { JsonStore } from "../storage/JsonStore";
import { createPluginRequire } from "./PluginRequire";
import { wrapCommonJsPluginSource } from "./PluginSource";

export type PluginModuleFactory = (app: App, manifest: PluginManifest) => Plugin;

export interface PluginPackageSource {
  list(path: string): Promise<string[] | { folders?: string[]; files?: string[] }>;
  readText(path: string): Promise<string | null>;
  readJson<T = unknown>(path: string): Promise<T | null>;
}

export class PluginLoader {
  private factories = new Map<string, PluginModuleFactory>();
  private packages = new Map<string, PluginPackage>();

  constructor(readonly app: App, private source: PluginPackageSource = new JsonStorePluginPackageSource(app.jsonStore)) {}

  setPackageSource(source: PluginPackageSource): void {
    this.source = source;
  }

  registerFactory(id: string, factory: PluginModuleFactory): void {
    this.factories.set(id, factory);
  }

  unregisterFactory(id: string): void {
    this.factories.delete(id);
  }

  registerPackage(pkg: PluginPackage): PluginPackage {
    const normalized = normalizePackage(pkg);
    const factory = normalized.factory ?? (normalized.mainJs ? compileCommonJsPlugin(normalized.mainJs, normalized.manifest.id) : undefined);
    const runnable = factory ? { ...normalized, factory } : normalized;
    this.packages.set(runnable.manifest.id, runnable);
    if (factory) this.registerFactory(runnable.manifest.id, factory);
    return runnable;
  }

  unregisterPackage(id: string): void {
    this.packages.delete(id);
    this.unregisterFactory(id);
  }

  getPackage(id: string): PluginPackage | null {
    return this.packages.get(id) ?? null;
  }

  listPackages(): readonly PluginPackage[] {
    return [...this.packages.values()];
  }

  async discoverPackages(pluginRoot = "plugins"): Promise<PluginPackage[]> {
    const listing = await this.source.list(pluginRoot);
    const folders = Array.isArray(listing) ? listing : listing.folders ?? [];
    const packages: PluginPackage[] = [];
    for (const folder of folders) {
      const dir = folder.includes("/") ? folder : `${pluginRoot}/${folder}`;
      const pkg = await this.discoverPackage(dir);
      if (pkg) packages.push(pkg);
    }
    return packages;
  }

  async discoverPackage(dir: string): Promise<PluginPackage | null> {
    try {
      const manifest = await this.source.readJson<PluginManifestInput>(`${dir}/manifest.json`);
      if (!manifest?.id) return null;
      const normalizedManifest = normalizeDiscoveredManifest(manifest, dir);
      const mainJs = await this.source.readText(`${dir}/main.js`).catch(() => null);
      const styles = await this.source.readText(`${dir}/styles.css`).catch(() => null);
      const pkg = this.registerPackage({
        manifest: normalizedManifest,
        dir,
        entry: `${dir}/main.js`,
        mainJs: mainJs ?? undefined,
        styles: styles ?? undefined,
        ...(mainJs ? { factory: compileCommonJsPlugin(mainJs, normalizedManifest.id) } : {}),
      });
      const existing = this.app.communityPlugins.get(pkg.manifest.id);
      this.app.communityPlugins.add({
        ...existing,
        manifest: pkg.manifest,
        installed: true,
        enabled: existing?.enabled ?? false,
        error: existing?.error ?? null,
      });
      return pkg;
    } catch (error) {
      console.error(`Failed to discover plugin in ${dir}`, error);
      return null;
    }
  }

  async loadPackage(pkgOrId: PluginPackage | string, userInitiated = false): Promise<Plugin> {
    const pkg = typeof pkgOrId === "string" ? this.packages.get(pkgOrId) : this.registerPackage(pkgOrId);
    if (!pkg) throw new Error(`Plugin package not registered: ${pkgOrId}`);
    const factory = pkg.factory ?? this.factories.get(pkg.manifest.id);
    if (!factory) throw new Error(`Plugin factory not registered: ${pkg.manifest.id}`);
    return this.app.plugins.enablePlugin(normalizePluginManifest({ ...pkg.manifest, styles: pkg.styles }, pkg.dir ?? pkg.manifest.dir), factory, userInitiated);
  }
}

function normalizeDiscoveredManifest(manifest: PluginManifestInput, dir: string): PluginManifest {
  return normalizePluginManifest(manifest, dir);
}

function normalizePackage(pkg: PluginPackage): PluginPackage {
  const dir = pkg.dir ?? pkg.manifest.dir ?? `plugins/${pkg.manifest.id}`;
  return {
    ...pkg,
    dir,
    entry: pkg.entry || `${dir}/main.js`,
    manifest: normalizePluginManifest(pkg.manifest, dir),
  };
}

class JsonStorePluginPackageSource implements PluginPackageSource {
  constructor(readonly store: JsonStore) {}

  async list(path: string): Promise<string[] | { folders?: string[]; files?: string[] }> {
    return this.store.list(path);
  }

  async readText(path: string): Promise<string | null> {
    return this.store.readText(path);
  }

  readJson<T = unknown>(path: string): Promise<T | null> {
    return this.store.read<T>(path);
  }
}

function compileCommonJsPlugin(source: string, pluginId: string): PluginModuleFactory {
  return (app, manifest) => {
    const exportsObject: Record<string, unknown> = {};
    const moduleObject: { exports: unknown } = { exports: exportsObject };
    const execute = window.eval(wrapCommonJsPluginSource(source, pluginId)) as (
      require: (id: string) => unknown,
      module: { exports: unknown },
      exports: Record<string, unknown>,
    ) => void;
    execute(createPluginRequire(app, pluginId), moduleObject, exportsObject);
    const exported = (moduleObject.exports || exportsObject) as { default?: unknown };
    const PluginClass = exported?.default ?? moduleObject.exports;
    if (!PluginClass || PluginClass === exportsObject && Object.keys(exportsObject).length === 0) {
      throw new Error(`No exports detected in plugin ${pluginId}`);
    }
    if (typeof PluginClass !== "function") throw new Error(`Plugin ${pluginId} did not export a plugin class`);
    const instance = new (PluginClass as new (app: App, manifest: PluginManifestInput) => Plugin)(app, manifest);
    if (!(instance instanceof Plugin)) throw new Error(`Plugin ${pluginId} must extend Plugin`);
    return instance;
  };
}
