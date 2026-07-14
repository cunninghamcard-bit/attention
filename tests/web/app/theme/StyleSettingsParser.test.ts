import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSettingTree, parseStyleSettings } from "@web/app/theme/StyleSettingsParser";
import type {
  StyleSetting,
  StyleSettingNode,
  StyleSettingType,
} from "@web/app/theme/StyleSettings";

// vitest's root config lives at the repo root, so tests always run with cwd there.
// The fixture is a verbatim excerpt of the real theme below — tabs, nested option
// maps and all nine types — because the theme itself is gitignored and 1.7MB, so
// on a clean clone it is simply absent. The excerpt is the contract; the whole
// theme is an extra check, taken only where it happens to be installed.
const FIXTURE = join(process.cwd(), "tests/fixtures/themes/primary-theme-excerpt.css");
const REAL_THEME = join(process.cwd(), ".obsidian/themes/Primary/theme.css");

// The nested list-of-maps the repo's hand-rolled frontmatter parser silently
// collapsed to its last entry. Identical in the excerpt and in the whole theme.
const STATUS_BAR_STYLE: StyleSetting = {
  id: "interface_status-bar-style",
  type: "class-select",
  title: "Status Bar Style",
  allowEmpty: false,
  default: "sb-default",
  options: [
    { label: "On Top", value: "sb-default" },
    { label: "Visible Full Length", value: "sb-style-full" },
    { label: "Slide Up Full Length", value: "sb-style-slideupfull" },
    { label: "Slide Out", value: "sb-style-slideout" },
    { label: "Floating", value: "sb-style-floating" },
  ],
};

const MALFORMED_BLOCK = [
  "body { --fixture: 1; }",
  "/* @settings",
  "name: Broken",
  "id: broken",
  "settings:",
  "\t-",
  "\t\tid: alt-folder-icons",
  "\t\ttype: class-toggle",
  '\t\ttitle: "unterminated',
  "*/",
].join("\n");

describe("StyleSettingsParser", () => {
  it("parses a real theme settings block", () => {
    const css = readFileSync(FIXTURE, "utf8");
    // The hazard is the theme's tab indentation: yaml@2 throws on the raw block,
    // and a 2-space expansion throws too. A detabbed fixture would hide the bug.
    expect(css).toMatch(/^\t+id: /m);

    const { blocks, errors } = parseStyleSettings(css, "Primary");

    expect(errors).toEqual([]);
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block.id).toBe("primary-theme");
    expect(block.name).toBe("Primary Theme Settings");
    // Nothing merged or dropped: every excerpted item is back, one per type.
    expect(block.settings).toHaveLength(16);
    expect(countTypes(block.settings)).toEqual({
      heading: 6,
      "variable-text": 3,
      "info-text": 1,
      "variable-number": 1,
      "class-toggle": 1,
      "class-select": 1,
      "variable-select": 1,
      "variable-number-slider": 1,
      "variable-themed-color": 1,
    });
    expect(find(block.settings, "interface_status-bar-style")).toEqual(STATUS_BAR_STYLE);
    // The flat list nests by declared heading level, 1 through 4.
    expect(headingLevels(block.tree)).toEqual([1, 2, 3, 4]);

    if (!existsSync(REAL_THEME)) return;
    // Extra, on a machine that actually has the theme installed: the whole block.
    const whole = parseStyleSettings(readFileSync(REAL_THEME, "utf8"), "Primary");
    expect(whole.errors).toEqual([]);
    expect(whole.blocks[0].settings).toHaveLength(517);
    expect(countTypes(whole.blocks[0].settings)).toEqual({
      "variable-themed-color": 266,
      "variable-text": 90,
      heading: 69,
      "variable-number": 39,
      "info-text": 21,
      "class-toggle": 19,
      "variable-select": 6,
      "class-select": 5,
      "variable-number-slider": 2,
    });
    expect(find(whole.blocks[0].settings, "interface_status-bar-style")).toEqual(STATUS_BAR_STYLE);
  });

  it("surfaces a malformed settings block", () => {
    const css = `${MALFORMED_BLOCK}\n${validBlock()}`;

    const result = parseStyleSettings(css, "Broken");

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source).toBe("Broken");
    expect(result.errors[0].message).toBeTruthy();
    // No partial tree from the bad block; the rest of the stylesheet still loads.
    expect(result.blocks.map((block) => block.id)).toEqual(["good"]);
    expect(result.blocks[0].settings).toHaveLength(1);
  });

  it("builds a heading tree from flat settings", () => {
    const tree = buildSettingTree([
      heading("interface", 1),
      toggle("alt-folder-icons"),
      heading("typography", 2),
      toggle("zero-tab-anim"),
      heading("headings", 3),
      heading("h1", 4),
      toggle("h1-caps"),
      heading("editor", 2),
      toggle("editor-focus"),
    ]);

    expect(shape(tree)).toEqual([
      {
        id: "interface",
        children: [
          { id: "alt-folder-icons", children: [] },
          {
            id: "typography",
            children: [
              { id: "zero-tab-anim", children: [] },
              {
                id: "headings",
                children: [{ id: "h1", children: [{ id: "h1-caps", children: [] }] }],
              },
            ],
          },
          { id: "editor", children: [{ id: "editor-focus", children: [] }] },
        ],
      },
    ]);
  });
});

function validBlock(): string {
  return [
    "/* @settings",
    "name: Good",
    "id: good",
    "settings:",
    "\t-",
    "\t\tid: works",
    "\t\ttype: class-toggle",
    "\t\ttitle: Works",
    "*/",
  ].join("\n");
}

function heading(id: string, level: 1 | 2 | 3 | 4): StyleSetting {
  return { type: "heading", id, level, collapsed: true, title: id };
}

function toggle(id: string): StyleSetting {
  return { type: "class-toggle", id, title: id };
}

function find(settings: StyleSetting[], id: string): StyleSetting | undefined {
  return settings.find((setting) => setting.id === id);
}

function countTypes(settings: StyleSetting[]): Partial<Record<StyleSettingType, number>> {
  const counts: Partial<Record<StyleSettingType, number>> = {};
  for (const setting of settings) counts[setting.type] = (counts[setting.type] ?? 0) + 1;
  return counts;
}

/** The longest chain of heading levels down the tree. */
function headingLevels(nodes: readonly StyleSettingNode[]): number[] {
  let longest: number[] = [];
  for (const node of nodes) {
    const chain =
      node.setting.type === "heading"
        ? [node.setting.level, ...headingLevels(node.children)]
        : headingLevels(node.children);
    if (chain.length > longest.length) longest = chain;
  }
  return longest;
}

function shape(nodes: StyleSettingNode[]): unknown[] {
  return nodes.map((node) => ({ id: node.setting.id, children: shape(node.children) }));
}
