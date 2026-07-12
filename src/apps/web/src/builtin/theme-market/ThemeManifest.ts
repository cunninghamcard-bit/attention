export interface ThemeManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  modes: Array<"light" | "dark">;
  cssFile?: string;
  variables?: Record<string, string>;
}

export interface ThemePackage {
  manifest: ThemeManifest;
  cssText: string;
}
