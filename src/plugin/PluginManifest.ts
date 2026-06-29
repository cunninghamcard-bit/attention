export interface PluginManifest {
  dir?: string;
  id: string;
  name: string;
  author: string;
  version: string;
  minAppVersion: string;
  description: string;
  authorUrl?: string;
  isDesktopOnly?: boolean;
}

export interface PluginManifestInput {
  dir?: string;
  id: string;
  name: string;
  author?: string;
  version: string;
  minAppVersion?: string;
  description?: string;
  authorUrl?: string;
  isDesktopOnly?: boolean;
  styles?: string;
}

export interface RuntimePluginManifest extends PluginManifest {
  styles?: string;
}

export interface PluginPackage {
  manifest: PluginManifestInput;
  entry: string;
  dir?: string;
  mainJs?: string;
  styles?: string;
  source?: PluginPackageSourceMetadata;
  factory?: import("./PluginLoader").PluginModuleFactory;
}

export interface PluginPackageSourceMetadata {
  repo?: string;
  version?: string;
  manifestUrl?: string;
  mainJsUrl?: string;
  stylesUrl?: string;
}

export function normalizePluginId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

export function normalizePluginManifest(manifest: PluginManifestInput, dir = manifest.dir): RuntimePluginManifest {
  const author = manifest.author && manifest.author.toLowerCase() !== "obsidian" ? manifest.author : "";
  return {
    ...manifest,
    ...(dir ? { dir } : {}),
    author,
    minAppVersion: manifest.minAppVersion ?? "0.0.0",
    description: manifest.description ?? "",
  };
}
