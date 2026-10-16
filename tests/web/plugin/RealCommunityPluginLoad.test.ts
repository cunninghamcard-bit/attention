import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { Plugin } from "@web/plugin/Plugin";
import type { PluginPackageSource } from "@web/plugin/PluginLoader";
import { normalizePluginManifest, type PluginManifestInput } from "@web/plugin/PluginManifest";
import {
  loadRealCommunityPlugin,
  REAL_COMMUNITY_PLUGINS,
  type RealCommunityPlugin,
} from "./fixtures/realCommunityPlugins";

class MemoryPluginSource implements PluginPackageSource {
  constructor(
    readonly manifest: PluginManifestInput,
    readonly mainJs: string,
  ) {}

  async list(): Promise<{ folders: string[]; files: string[] }> {
    return { folders: [this.manifest.id], files: [] };
  }

  async readText(path: string): Promise<string | null> {
    return path.endsWith("/main.js") ? this.mainJs : null;
  }

  async readJson<T>(path: string): Promise<T | null> {
    return path.endsWith("/manifest.json") ? (structuredClone(this.manifest) as T) : null;
  }
}

const cases = REAL_COMMUNITY_PLUGINS.map(
  (plugin) => [`${plugin.repo}@${plugin.tag}`, plugin] as const,
);
const evaluates = cases.filter(([, plugin]) => plugin.knownGap?.stage !== "evaluate");
const loadsCleanly = cases.filter(([, plugin]) => !plugin.knownGap);
const stillBroken = cases.filter(([, plugin]) => plugin.knownGap);

async function enableAndCollectErrors(fixture: RealCommunityPlugin) {
  const { manifest, mainJs } = await loadRealCommunityPlugin(fixture);
  const consoleError = vi.spyOn(console, "error");
  const app = new App(document.createElement("div"));
  await app.ready;
  app.pluginSecurity.setCommunityPluginsEnabled(true);
  await app.jsonStore.write("community-plugins.json", [manifest.id]);
  app.pluginLoader.setPackageSource(new MemoryPluginSource(manifest, mainJs));
  await app.pluginInstaller.initialize();
  await new Promise((resolve) => setTimeout(resolve, 200));
  return {
    app,
    manifest,
    errors: consoleError.mock.calls.map((args) => args.map(String).join(" ")),
  };
}

describe("real community plugin builds load through createPluginRequire", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
    document.body.classList.remove("emulate-mobile");
    // The desktop renderer runs with nodeIntegration (apps/desktop/main/window.ts), so
    // plugins reach Node built-ins through window.require there.
    Object.defineProperty(window, "require", {
      configurable: true,
      value: createRequire(import.meta.url),
    });
  });

  it.each(evaluates)(
    "%s evaluates main.js and constructs its Plugin subclass",
    async (_label, fixture) => {
      const { manifest, mainJs } = await loadRealCommunityPlugin(fixture);
      const app = new App(document.createElement("div"));
      const pkg = app.pluginLoader.registerPackage({ manifest, entry: "", mainJs });

      const plugin = pkg.factory?.(app, normalizePluginManifest(pkg.manifest));

      expect(plugin).toBeInstanceOf(Plugin);
    },
    60_000,
  );

  it.each(loadsCleanly)(
    "%s enables and runs onload without errors",
    async (_label, fixture) => {
      const { app, manifest, errors } = await enableAndCollectErrors(fixture);

      expect(errors).toEqual([]);
      expect(app.communityPlugins.get(manifest.id)?.error ?? null).toBeNull();
      expect(app.plugins.getPlugin(manifest.id)).toBeInstanceOf(Plugin);
    },
    60_000,
  );

  it.fails.each(stillBroken)(
    "%s still logs errors while enabling (known gap; drop knownGap once fixed)",
    async (_label, fixture) => {
      const { errors } = await enableAndCollectErrors(fixture);

      expect(errors).toEqual([]);
    },
    60_000,
  );
});
