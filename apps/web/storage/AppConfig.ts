import { Events } from "../core/Events";
import type { JsonStore } from "./JsonStore";

export interface CorePluginConfig {
  enabledPlugins: Record<string, boolean>;
}

export interface HotkeyConfig {
  hotkeys: Record<string, Array<{ modifiers: string[]; key: string }>>;
}

export interface AppConfigShape {
  appearance?: unknown;
  workspace?: unknown;
  corePlugins?: CorePluginConfig;
  hotkeys?: HotkeyConfig;
  communityPlugins?: string[] | Record<string, { enabled: boolean }>;
  theme?: string;
  cssTheme?: string | null;
  enabledCssSnippets?: string[];
  accentColor?: string;
  showViewHeader?: boolean;
  showRibbon?: boolean;
  nativeMenus?: boolean | null;
  textFontFamily?: string;
  interfaceFontFamily?: string;
  monospaceFontFamily?: string;
  baseFontSize?: number;
  baseFontSizeAction?: boolean;
  slidingSidebar?: boolean;
  floatingNavigation?: boolean;
  autoFullScreen?: boolean;
  translucency?: boolean;
}

const appearanceConfigKeys = new Set<keyof AppConfigShape>([
  "accentColor",
  "theme",
  "cssTheme",
  "enabledCssSnippets",
  "showViewHeader",
  "showRibbon",
  "nativeMenus",
  "translucency",
  "textFontFamily",
  "interfaceFontFamily",
  "monospaceFontFamily",
  "baseFontSize",
  "baseFontSizeAction",
  "slidingSidebar",
  "floatingNavigation",
  "autoFullScreen",
]);

export class AppConfigManager extends Events {
  private cache: AppConfigShape = {};
  private configTs = 0;
  private saving = false;
  private unreadable = false;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly store: JsonStore,
    readonly fileName = "app.json",
    readonly appearanceFileName = "appearance.json",
  ) {
    super();
  }

  async load(): Promise<AppConfigShape> {
    this.cache = (await this.readConfigFiles()) ?? {};
    this.configTs = Date.now();
    return this.getAll();
  }

  async save(): Promise<void> {
    // A config file that exists but will not parse reads back as `undefined`. This save
    // rewrites both files whole from memory, so it would replace a hand-repairable file
    // with defaults. Hold the write until the file reads cleanly again.
    if (this.unreadable) return;
    this.saving = true;
    const appConfig: AppConfigShape = {};
    const appearanceConfig: AppConfigShape = {};
    try {
      for (const [key, value] of Object.entries(this.cache) as Array<
        [keyof AppConfigShape, AppConfigShape[keyof AppConfigShape]]
      >) {
        if (appearanceConfigKeys.has(key)) appearanceConfig[key] = value as never;
        else appConfig[key] = value as never;
      }
      await this.store.write(this.fileName, appConfig);
      await this.store.write(this.appearanceFileName, appearanceConfig);
      this.configTs = Date.now();
    } finally {
      this.saving = false;
    }
  }

  async reload(): Promise<void> {
    this.clearReloadTimer();
    if (this.saving) return;
    const appStat = await this.store.stat(this.fileName);
    const appearanceStat = await this.store.stat(this.appearanceFileName);
    if (
      appStat &&
      appearanceStat &&
      appStat.mtime <= this.configTs &&
      appearanceStat.mtime <= this.configTs
    )
      return;

    this.configTs = Date.now();
    const next = await this.readConfigFiles();
    if (!next) return;
    const previous = this.cache;
    this.cache = { ...previous };

    for (const [key, value] of Object.entries(next) as Array<
      [keyof AppConfigShape, AppConfigShape[keyof AppConfigShape]]
    >) {
      if (hasEqualConfigValue(previous[key], value)) continue;
      this.cache[key] = value as never;
      this.trigger("config-changed", key);
    }

    for (const key of Object.keys(previous) as Array<keyof AppConfigShape>) {
      if (Object.prototype.hasOwnProperty.call(next, key)) continue;
      delete this.cache[key];
      this.trigger("config-changed", key);
    }
  }

  getAll(): AppConfigShape {
    return structuredClone(this.cache);
  }

  get<K extends keyof AppConfigShape>(key: K): AppConfigShape[K] | undefined {
    return this.cache[key];
  }

  async set<K extends keyof AppConfigShape>(key: K, value: AppConfigShape[K]): Promise<void> {
    if (hasEqualConfigValue(this.cache[key], value)) return;
    this.cache[key] = value;
    await this.save();
    this.trigger("config-changed", key);
  }

  requestReload(delay = 500): void {
    this.clearReloadTimer();
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.reload();
    }, delay);
  }

  cancelReload(): void {
    this.clearReloadTimer();
  }

  /** `undefined` when a config file exists but will not parse — see `save`. */
  private async readConfigFiles(): Promise<AppConfigShape | undefined> {
    const appConfig = await this.store.read<AppConfigShape>(this.fileName);
    const appearanceConfig = await this.store.read<AppConfigShape>(this.appearanceFileName);
    this.unreadable = appConfig === undefined || appearanceConfig === undefined;
    if (this.unreadable) return undefined;
    return migrateConfig({ ...appearanceConfig, ...appConfig });
  }

  private clearReloadTimer(): void {
    if (this.reloadTimer == null) return;
    clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
  }
}

function migrateConfig(config: AppConfigShape & { editorFontFamily?: string }): AppConfigShape {
  if (config.editorFontFamily && !config.textFontFamily)
    config.textFontFamily = config.editorFontFamily;
  delete config.editorFontFamily;
  return config;
}

function hasEqualConfigValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
