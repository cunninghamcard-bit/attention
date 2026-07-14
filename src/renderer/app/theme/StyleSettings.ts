// The `@settings` YAML block a theme (or snippet) appends to its CSS, modelled
// off the shipping theme in .obsidian/themes/Primary/theme.css.

export type HeadingLevel = 1 | 2 | 3 | 4;

export interface StyleSettingOption {
  label: string;
  value: string;
}

export interface StyleSettingHeading {
  type: "heading";
  id: string;
  level: HeadingLevel;
  collapsed: boolean;
  title: string;
  description?: string;
}

export interface StyleSettingInfoText {
  type: "info-text";
  id: string;
  markdown?: boolean;
  title?: string;
  description: string;
}

export interface StyleSettingClassToggle {
  type: "class-toggle";
  id: string;
  title: string;
  description?: string;
  // No `default` field: the block ships none on any class-toggle, off is implicit.
}

export interface StyleSettingClassSelect {
  type: "class-select";
  id: string;
  title: string;
  allowEmpty?: boolean;
  // The selected option's `value` is the body class; this `default` and the
  // setting's own `id` are storage keys only.
  default: string;
  options: StyleSettingOption[];
}

export interface StyleSettingVariableText {
  type: "variable-text";
  id: string;
  title: string;
  description?: string;
  default: string;
  quotes?: boolean;
}

export interface StyleSettingVariableNumber {
  type: "variable-number";
  id: string;
  title: string;
  description?: string;
  default: number;
  format?: "px" | "em";
}

export interface StyleSettingVariableNumberSlider {
  type: "variable-number-slider";
  id: string;
  title: string;
  description?: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface StyleSettingVariableSelect {
  type: "variable-select";
  id: string;
  title: string;
  default: string;
  options: StyleSettingOption[];
}

export interface StyleSettingVariableThemedColor {
  type: "variable-themed-color";
  id: string;
  title: string;
  description?: string;
  // `hsl` emits the whole colour; `rgb-values` emits a bare triplet, because the
  // consuming CSS wraps it itself: rgba(var(--canvas-color), 0.1).
  format: "hsl" | "rgb-values";
  opacity: boolean;
  "default-light": string;
  "default-dark": string;
}

export type StyleSetting =
  | StyleSettingHeading
  | StyleSettingInfoText
  | StyleSettingClassToggle
  | StyleSettingClassSelect
  | StyleSettingVariableText
  | StyleSettingVariableNumber
  | StyleSettingVariableNumberSlider
  | StyleSettingVariableSelect
  | StyleSettingVariableThemedColor;

export type StyleSettingType = StyleSetting["type"];

/** A setting plus the settings it owns. Only a heading ever has children. */
export interface StyleSettingNode {
  setting: StyleSetting;
  children: StyleSettingNode[];
}

export interface ParsedBlock {
  name: string;
  id: string;
  /** Flat, in document order — the block declares no nesting. */
  settings: StyleSetting[];
  /** The same settings, nested by heading `level` + document order. */
  tree: StyleSettingNode[];
}

export interface StyleSettingsParseError {
  /** The theme or snippet id whose CSS carried the block. */
  source: string;
  message: string;
}

export interface StyleSettingsParseResult {
  blocks: ParsedBlock[];
  errors: StyleSettingsParseError[];
}
