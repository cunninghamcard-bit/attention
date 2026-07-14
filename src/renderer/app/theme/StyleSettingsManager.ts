import type { App } from "../App";
import { debounce } from "../../core/ApiUtils";
import type { EventRef } from "../../core/Events";
import { unregisterEventRef } from "../../core/EventRefInternal";
import type { ParsedBlock, StyleSetting, StyleSettingsParseError } from "./StyleSettings";
import { parseStyleSettings } from "./StyleSettingsParser";

const CONFIG_NAME = "style-settings";
/** A text or number control fires on every keystroke; one write per burst. */
const SAVE_DEBOUNCE = 250;

/** The whole persisted document: block id → setting id → the user's value. */
type StyleSettingsData = Record<string, Record<string, unknown>>;

interface StyleSource {
  id: string;
  cssText: string;
}

/**
 * Owns the settings a theme (or snippet) declares in its `@settings` block:
 * parses them, applies them, and persists them.
 *
 * Two tiers, and neither is negotiable:
 * - class tier — the setting id (`class-toggle`) or the selected option's value
 *   (`class-select`) goes onto `<body>` verbatim, un-namespaced, because that is
 *   what the theme's own CSS selects on.
 * - variable tier — `document.body.style.setProperty`. Not a `<style>` element,
 *   not `:root`: custom properties inherit and every variable in this app is
 *   declared on `<body>`, so a declaration on `<body>` itself always wins.
 */
export class StyleSettingsManager {
  private blocks: ParsedBlock[] = [];
  private parseErrors: StyleSettingsParseError[] = [];
  private values: StyleSettingsData = {};
  private corrupt = false;
  private appliedClasses: string[] = [];
  private appliedProperties: string[] = [];
  private sources: StyleSource[] = [];
  private dark = false;
  private lastSave = 0;
  private writing: Promise<void> = Promise.resolve();
  private readonly requestSave = debounce(() => this.queueWrite(), SAVE_DEBOUNCE, true);
  private configFileChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private refs: EventRef[] = [];
  private changeCallbacks: (() => void)[] = [];

  constructor(readonly app: App) {}

  /**
   * Read `.obsidian/style-settings.json`, parse the active theme's block, and
   * apply both tiers. `readConfigJson` returns `null` for a missing file but
   * `undefined` for a corrupt one — a corrupt file must be left alone, never
   * replaced with defaults.
   */
  async load(): Promise<void> {
    const data = await this.app.vault.readConfigJson<StyleSettingsData>(CONFIG_NAME);
    this.corrupt = data === undefined;
    this.values = isRecord(data) ? data : {};
    this.registerListeners();
    this.refresh();
  }

  /** Drop the applied classes and properties and detach every listener. */
  unload(): void {
    // A debounced save is still pending after the last keystroke — write it out
    // rather than losing it on the way down.
    void this.flushSave();
    for (const ref of this.refs) unregisterEventRef(ref);
    this.refs = [];
    this.cancelConfigFileChange();
    const body = this.getBody();
    for (const name of this.appliedClasses) body.classList.remove(name);
    for (const name of this.appliedProperties) body.style.removeProperty(name);
    this.appliedClasses = [];
    this.appliedProperties = [];
    this.blocks = [];
    this.parseErrors = [];
    this.sources = [];
    // `changeCallbacks` survives: the tab registers once, from the App constructor,
    // so clearing them here would leave it dead after one unload/load cycle.
  }

  /** Write any debounced save now, and wait for the write queue to drain. */
  async flushSave(): Promise<void> {
    this.requestSave.run();
    await this.writing;
  }

  /** The parsed blocks the settings tab renders, in load order. */
  getBlocks(): ParsedBlock[] {
    return this.blocks;
  }

  /** Blocks that failed to parse, so the tab can surface them. */
  getErrors(): StyleSettingsParseError[] {
    if (!this.corrupt) return this.parseErrors;
    return [
      ...this.parseErrors,
      {
        source: this.app.vault.getConfigFile(CONFIG_NAME),
        message: "could not be read; style settings will not be saved until it is repaired",
      },
    ];
  }

  /** The user's value, or `undefined` when the setting is at its default. */
  getValue(blockId: string, settingId: string): unknown {
    return this.values[blockId]?.[settingId];
  }

  /** Apply and persist, keyed by the declaring block's id. */
  setValue(blockId: string, settingId: string, value: unknown): void {
    const block = (this.values[blockId] ??= {});
    block[settingId] = value;
    this.apply();
    this.save();
  }

  /** Drop the user's value and fall back to the theme's declared default. */
  resetValue(blockId: string, settingId: string): void {
    const block = this.values[blockId];
    if (!block || !(settingId in block)) return;
    delete block[settingId];
    if (Object.keys(block).length === 0) delete this.values[blockId];
    this.apply();
    this.save();
  }

  /** Fires when the theme, the colour scheme, or another writer changed things. */
  onExternalChange(callback: () => void): void {
    this.changeCallbacks.push(callback);
  }

  private registerListeners(): void {
    if (this.refs.length > 0) return;
    this.refs.push(
      this.app.workspace.on("css-change", () => this.onCssChange()),
      this.app.vault.on<[string]>("raw", (path) => this.onRaw(path)),
    );
  }

  /**
   * `css-change` is a firehose — accent colour, font size, translucency, every
   * plugin and snippet style — and its typed overload drops the id. Reparse only
   * when a scanned stylesheet actually changed; re-emit when the scheme flipped.
   */
  private onCssChange(): void {
    const sources = this.collectSources();
    const dark = this.app.appearance.isDarkMode();
    if (sameSources(sources, this.sources)) {
      if (dark === this.dark) return;
      this.dark = dark;
      this.apply();
      this.notify();
      return;
    }
    this.refresh(sources);
    this.notify();
  }

  private onRaw(path: string): void {
    if (path === this.app.vault.getConfigFile(CONFIG_NAME)) this.onConfigFileChange();
  }

  private onConfigFileChange(): void {
    this.cancelConfigFileChange();
    this.configFileChangeTimer = setTimeout(() => {
      this.configFileChangeTimer = null;
      void this.handleConfigFileChange();
    }, 50);
  }

  /**
   * `JsonStore.write` re-enters this manager's own `raw` listener on every save,
   * so reload only when the file on disk is newer than our last write.
   */
  private async handleConfigFileChange(): Promise<void> {
    const stat = await this.app.jsonStore.stat(this.app.vault.getConfigFile(CONFIG_NAME));
    const mtime = stat?.mtime ?? 0;
    if (this.lastSave < mtime) {
      await this.load();
      this.notify();
    }
    this.lastSave = Math.max(this.lastSave, mtime);
  }

  private cancelConfigFileChange(): void {
    if (this.configFileChangeTimer == null) return;
    clearTimeout(this.configFileChangeTimer);
    this.configFileChangeTimer = null;
  }

  private save(): void {
    // A corrupt file is recoverable by hand; a whole-document write from memory
    // would replace 500+ settings with defaults. Refuse until it is repaired.
    if (this.corrupt) return;
    this.requestSave();
  }

  /**
   * One write at a time: two overlapping whole-document writes race, and their
   * mtimes can land out of order — which walks `lastSave` backwards and breaks
   * the echo-guard that keeps a save from reloading itself.
   */
  private queueWrite(): void {
    this.writing = this.writing.then(() => this.write()).catch(() => undefined);
  }

  private async write(): Promise<void> {
    if (this.corrupt) return;
    // Monotonic, so a same-millisecond pair of writes still stamps forward.
    const mtime = Math.max(Date.now(), this.lastSave + 1);
    this.lastSave = mtime;
    // The whole document, from memory, as of now — a queued write is never stale.
    await this.app.vault.writeConfigJson(CONFIG_NAME, this.values, { mtime });
  }

  /** Parse every scanned stylesheet and apply the result. */
  private refresh(sources: StyleSource[] = this.collectSources()): void {
    this.sources = sources;
    this.dark = this.app.appearance.isDarkMode();
    const blocks: ParsedBlock[] = [];
    const errors: StyleSettingsParseError[] = [];
    for (const source of sources) {
      const result = parseStyleSettings(source.cssText, source.id);
      blocks.push(...result.blocks);
      errors.push(...result.errors);
    }
    this.blocks = blocks;
    this.parseErrors = errors;
    this.apply();
  }

  /**
   * The active theme's text, read off the style element `CustomCss` writes —
   * `ThemeManager.getActiveTheme()` is null on the disk-fallback path.
   */
  private collectSources(): StyleSource[] {
    const sources: StyleSource[] = [];
    const styleEl = this.app.customCss.styleEl;
    const themeCss = styleEl.textContent ?? "";
    if (themeCss) sources.push({ id: styleEl.dataset.theme || "theme", cssText: themeCss });
    for (const snippet of this.app.cssSnippets.listSnippets()) {
      if (snippet.enabled) sources.push({ id: snippet.id, cssText: snippet.cssText });
    }
    return sources;
  }

  /** Rewrite both tiers from the parsed blocks, dropping whatever no longer applies. */
  private apply(): void {
    const body = this.getBody();
    const classes: string[] = [];
    const properties = new Map<string, string>();
    for (const block of this.blocks) {
      for (const setting of block.settings) this.collect(block.id, setting, classes, properties);
    }
    for (const name of this.appliedClasses) {
      if (!classes.includes(name)) body.classList.remove(name);
    }
    for (const name of this.appliedProperties) {
      if (!properties.has(name)) body.style.removeProperty(name);
    }
    for (const name of classes) body.classList.add(name);
    for (const [name, value] of properties) body.style.setProperty(name, value);
    this.appliedClasses = classes;
    this.appliedProperties = [...properties.keys()];
  }

  private collect(
    blockId: string,
    setting: StyleSetting,
    classes: string[],
    properties: Map<string, string>,
  ): void {
    const value = this.getValue(blockId, setting.id);
    switch (setting.type) {
      case "class-toggle":
        // The id *is* the class the theme's CSS selects on — never namespaced.
        if (value === true) pushClass(classes, setting.id);
        return;
      case "class-select": {
        // The selected option's value is the class; the select's id is a storage key.
        const selected = value === undefined ? setting.default : String(value);
        pushClass(classes, selected);
        return;
      }
      case "variable-themed-color": {
        const color =
          value === undefined
            ? setting[this.dark ? "default-dark" : "default-light"]
            : String(value);
        // rgb-values is consumed as rgba(var(--x), .1) — a wrapped rgb() would
        // nest and the whole declaration would be dropped.
        emit(properties, setting.id, setting.format === "rgb-values" ? toRgbTriplet(color) : color);
        return;
      }
      case "variable-number": {
        const number = value === undefined ? setting.default : value;
        emit(properties, setting.id, `${String(number)}${setting.format ?? ""}`);
        return;
      }
      case "variable-text": {
        const text = value === undefined ? setting.default : String(value);
        emit(properties, setting.id, setting.quotes ? JSON.stringify(text) : text);
        return;
      }
      case "variable-select":
      case "variable-number-slider":
        emit(properties, setting.id, String(value === undefined ? setting.default : value));
        return;
      default:
        return;
    }
  }

  private notify(): void {
    for (const callback of this.changeCallbacks) callback();
  }

  private getBody(): HTMLElement {
    return this.app.dom.appContainerEl.ownerDocument.body;
  }
}

/**
 * Class tokens come from a theme author's YAML — untrusted input, on the boot
 * path. `DOMTokenList.add` throws on an empty token or one carrying whitespace,
 * so a single fat-fingered id would take the whole app down before it starts.
 * Skip the token instead: the theme loses one option, the user keeps their app.
 */
function pushClass(classes: string[], token: string): void {
  if (token === "" || /\s/.test(token)) return;
  classes.push(token);
}

function emit(properties: Map<string, string>, id: string, value: string): void {
  // An empty value would override the theme's own declaration with nothing.
  if (value === "") return;
  properties.set(`--${id}`, value);
}

/**
 * `rgb(182, 175, 166)`, `#b6afa6` and a bare triplet all emit `182, 175, 166`.
 *
 * Alpha is dropped on purpose. `format: rgb-values` exists because the consuming
 * CSS supplies its own alpha — `rgba(var(--canvas-color), .1)` — so a fourth
 * channel here would land inside that `rgba()` and drop the declaration. A theme
 * may still declare `rgb-values` with `opacity: true`; the tab answers by not
 * offering the opacity slider, and an alpha that arrives regardless (an
 * `#rrggbbaa` value, an `rgba()` default) is discarded here rather than emitted.
 */
function toRgbTriplet(color: string): string {
  const value = color.trim();
  const hex = /^#?([0-9a-f]{3,8})$/i.exec(value);
  if (hex && [3, 4, 6, 8].includes(hex[1].length)) {
    const digits =
      hex[1].length <= 4
        ? hex[1]
            .split("")
            .map((digit) => `${digit}${digit}`)
            .join("")
        : hex[1];
    return [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16)).join(", ");
  }
  const parsed = /^rgba?\(([^)]*)\)$/i.exec(value);
  if (!parsed) return value;
  return parsed[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
}

/**
 * `css-change` fires for the accent colour, the font size, translucency and every
 * plugin and snippet style. Compare the sources themselves — concatenating or
 * hashing half a megabyte of theme CSS on each of those events is exactly the
 * work this guard exists to avoid, and a length mismatch short-circuits the rest.
 */
function sameSources(next: StyleSource[], previous: StyleSource[]): boolean {
  return (
    next.length === previous.length &&
    next.every(
      (source, index) =>
        source.id === previous[index].id && source.cssText === previous[index].cssText,
    )
  );
}

function isRecord(raw: unknown): raw is StyleSettingsData {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}
