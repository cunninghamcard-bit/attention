import { parseYaml } from "../../core/ApiUtils";
import type {
  HeadingLevel,
  ParsedBlock,
  StyleSetting,
  StyleSettingNode,
  StyleSettingOption,
  StyleSettingsParseError,
  StyleSettingsParseResult,
} from "./StyleSettings";

const SETTINGS_BLOCK = /\/\*\s*@settings\b([\s\S]*?)\*\//g;

/**
 * Read every `@settings` block out of a stylesheet. A malformed block is
 * reported in `errors` and contributes nothing to `blocks` — never a partial
 * tree, and never a throw, so the stylesheet still loads.
 */
export function parseStyleSettings(cssText: string, source = ""): StyleSettingsParseResult {
  const blocks: ParsedBlock[] = [];
  const errors: StyleSettingsParseError[] = [];
  for (const body of extractSettingsBlocks(cssText)) {
    try {
      blocks.push(parseBlock(body));
    } catch (error) {
      errors.push({ source, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { blocks, errors };
}

/** Nest a flat settings list: a setting belongs to the preceding heading. */
export function buildSettingTree(settings: readonly StyleSetting[]): StyleSettingNode[] {
  const roots: StyleSettingNode[] = [];
  const open: { level: HeadingLevel; node: StyleSettingNode }[] = [];
  for (const setting of settings) {
    const node: StyleSettingNode = { setting, children: [] };
    if (setting.type === "heading") {
      while (open.length > 0 && open[open.length - 1].level >= setting.level) open.pop();
    }
    (open[open.length - 1]?.node.children ?? roots).push(node);
    if (setting.type === "heading") open.push({ level: setting.level, node });
  }
  return roots;
}

function extractSettingsBlocks(cssText: string): string[] {
  const bodies: string[] = [];
  for (const match of cssText.matchAll(SETTINGS_BLOCK)) bodies.push(match[1]);
  return bodies;
}

function parseBlock(body: string): ParsedBlock {
  // yaml@2 throws on tab indentation, and the real block mixes tabs with
  // 4-space indentation — two spaces misaligns against the 4-space siblings.
  const raw: unknown = parseYaml(body.replace(/^\t+/gm, (tabs) => "    ".repeat(tabs.length)));
  if (!isRecord(raw)) throw new Error("settings block is not a YAML map");
  const id = asText(raw.id);
  if (!id) throw new Error("settings block has no id");
  if (!Array.isArray(raw.settings)) throw new Error(`settings block "${id}" has no settings list`);
  const settings = raw.settings.map(toSetting).filter((setting) => setting !== null);
  return { name: asText(raw.name) || id, id, settings, tree: buildSettingTree(settings) };
}

function toSetting(raw: unknown): StyleSetting | null {
  if (!isRecord(raw)) return null;
  const id = asText(raw.id);
  if (!id) return null;
  const title = asText(raw.title);
  const description = typeof raw.description === "string" ? raw.description : undefined;
  switch (raw.type) {
    case "heading":
      return {
        type: "heading",
        id,
        level: toLevel(raw.level),
        collapsed: raw.collapsed === true,
        title,
        description,
      };
    case "info-text":
      return {
        type: "info-text",
        id,
        markdown: raw.markdown === true,
        title: title || undefined,
        description: description ?? "",
      };
    case "class-toggle":
      return { type: "class-toggle", id, title, description };
    case "class-select":
      return {
        type: "class-select",
        id,
        title,
        allowEmpty: typeof raw.allowEmpty === "boolean" ? raw.allowEmpty : undefined,
        default: asText(raw.default),
        options: toOptions(raw.options),
      };
    case "variable-text":
      return {
        type: "variable-text",
        id,
        title,
        description,
        default: asText(raw.default),
        quotes: raw.quotes === true,
      };
    case "variable-number":
      return {
        type: "variable-number",
        id,
        title,
        description,
        default: asNumber(raw.default, 0),
        format: raw.format === "px" || raw.format === "em" ? raw.format : undefined,
      };
    case "variable-number-slider":
      return {
        type: "variable-number-slider",
        id,
        title,
        description,
        min: asNumber(raw.min, 0),
        max: asNumber(raw.max, 0),
        step: asNumber(raw.step, 1),
        default: asNumber(raw.default, 0),
      };
    case "variable-select":
      return {
        type: "variable-select",
        id,
        title,
        default: asText(raw.default),
        options: toOptions(raw.options),
      };
    case "variable-themed-color":
      return {
        type: "variable-themed-color",
        id,
        title,
        description,
        format: raw.format === "rgb-values" ? "rgb-values" : "hsl",
        opacity: raw.opacity === true,
        "default-light": asText(raw["default-light"]),
        "default-dark": asText(raw["default-dark"]),
      };
    default:
      return null;
  }
}

function toOptions(raw: unknown): StyleSettingOption[] {
  if (!Array.isArray(raw)) return [];
  const options: StyleSettingOption[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const value = asText(entry.value);
    if (!value) continue;
    options.push({ label: asText(entry.label) || value, value });
  }
  return options;
}

function toLevel(raw: unknown): HeadingLevel {
  const level = Math.round(asNumber(raw, 1));
  return (Math.min(4, Math.max(1, level)) as HeadingLevel) || 1;
}

function asText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return "";
}

function asNumber(raw: unknown, fallback: number): number {
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}
