import { describe, expect, it } from "vitest";
import type { App } from "@web/app/App";
import { parseStyleSettings } from "@web/app/theme/StyleSettingsParser";
import { StyleSettingsTab } from "@web/builtin/StyleSettingsTab";

// The real block mixes tab and 4-space indentation, so the fixture does too:
// one tab is exactly one 4-space level.
const THEME_CSS = [
  "body { --ribbon-background: hsla(34, 34%, 90%, 1); }",
  "/* @settings",
  "",
  "name: Fixture",
  "id: fixture",
  "settings:",
  "    -",
  "        id: intro",
  "        type: info-text",
  "        markdown: true",
  "        description: 'Read the **docs** first.'",
  "    -",
  "        id: layout",
  "        type: heading",
  "        title: Layout",
  "        level: 1",
  "        collapsed: true",
  "\t-",
  "\t\tid: alt-folder-icons",
  "\t\ttype: class-toggle",
  "\t\ttitle: Folder Icons",
  "\t\tdescription: Use folders as collapse indicators",
  "    -",
  "        id: ribbon",
  "        type: heading",
  "        title: Ribbon",
  "        level: 2",
  "        collapsed: true",
  "    -",
  "        id: ribbon_styles",
  "        type: class-select",
  "        title: Ribbon Style",
  "        default: ribbon-default",
  "        options:",
  "            -",
  "                label: Default",
  "                value: ribbon-default",
  "            -",
  "                label: Slideout",
  "                value: ribbon-slideout",
  "    -",
  "        id: ribbon-background",
  "        type: variable-themed-color",
  "        title: Ribbon Background",
  "        format: hsl",
  "        opacity: true",
  "        default-light: 'hsla(34, 34%, 90%, 1)'",
  "        default-dark: 'hsla(31, 17%, 12%, 1)'",
  "    -",
  "        id: ribbon-width",
  "        type: variable-number",
  "        title: Ribbon Width",
  "        format: px",
  "        default: 44",
  "    -",
  "        id: canvas",
  "        type: heading",
  "        title: Canvas",
  "        level: 1",
  "        collapsed: false",
  "    -",
  "        id: canvas-color",
  "        type: variable-themed-color",
  "        title: Canvas Color",
  "        format: rgb-values",
  "        opacity: false",
  "        default-light: 'rgb(182, 175, 166)'",
  "        default-dark: 'rgb(182, 175, 166)'",
  "    -",
  "        id: canvas-tint",
  "        type: variable-themed-color",
  "        title: Canvas Tint",
  "        format: rgb-values",
  "        opacity: true",
  "        default-light: 'rgb(10, 20, 30)'",
  "        default-dark: 'rgb(10, 20, 30)'",
  "    -",
  "        id: canvas-font",
  "        type: variable-text",
  "        title: Canvas Font",
  "        quotes: true",
  "        default: Inter",
  "    -",
  "        id: canvas-line-height",
  "        type: variable-number-slider",
  "        title: Canvas Line Height",
  "        min: 1",
  "        max: 2",
  "        step: 0.1",
  "        default: 1.5",
  "    -",
  "        id: canvas-bullet",
  "        type: variable-select",
  "        title: Canvas Bullet",
  "        default: dot",
  "        options:",
  "            -",
  "                label: Dot",
  "                value: dot",
  "            -",
  "                label: Dash",
  "                value: dash",
  "*/",
].join("\n");

describe("StyleSettingsTab", () => {
  it("renders a control for every setting type", () => {
    const { tab, calls } = createTab();
    const container = tab.containerEl;

    expect(
      findRow(container, "Folder Icons").querySelector('input[type="checkbox"]'),
    ).not.toBeNull();
    expect(options(findRow(container, "Ribbon Style"))).toEqual([
      "ribbon-default",
      "ribbon-slideout",
    ]);
    expect(options(findRow(container, "Canvas Bullet"))).toEqual(["dot", "dash"]);
    expect(
      findRow(container, "Canvas Font").querySelector<HTMLInputElement>('input[type="text"]')!
        .value,
    ).toBe("Inter");
    expect(
      findRow(container, "Ribbon Width").querySelector<HTMLInputElement>('input[type="number"]')!
        .value,
    ).toBe("44");
    expect(
      findRow(container, "Canvas Line Height").querySelector<HTMLInputElement>(
        'input[type="range"]',
      )!.valueAsNumber,
    ).toBe(1.5);
    expect(findGroup(container, "Layout").querySelector(".collapse-icon")).not.toBeNull();
    expect(findRow(container, "").textContent).toContain("docs");

    // An alpha colour is a picker plus an opacity slider on the same row; a
    // colour without one is the picker alone.
    const themed = findRow(container, "Ribbon Background");
    expect(themed.querySelector('input[type="color"]')).not.toBeNull();
    const opacity = themed.querySelector<HTMLInputElement>('input[type="range"]')!;
    const plain = findRow(container, "Canvas Color");
    expect(plain.querySelector('input[type="color"]')).not.toBeNull();
    expect(plain.querySelector('input[type="range"]')).toBeNull();

    // An rgb-values colour emits a bare triplet — the consuming CSS supplies the
    // alpha — so it gets the picker alone even when it declares `opacity: true`:
    // a slider there would move nothing.
    const tint = findRow(container, "Canvas Tint");
    expect(tint.querySelector('input[type="color"]')).not.toBeNull();
    expect(tint.querySelector('input[type="range"]')).toBeNull();

    opacity.valueAsNumber = 50;
    opacity.dispatchEvent(new Event("change"));
    expect(calls.at(-1)![1]).toBe("ribbon-background");
    expect(calls.at(-1)![2]).toMatch(/^hsla\(\d+, \d+%, \d+%, 0\.5\)$/);
  });

  it("collapses headings as the theme declares", () => {
    const { tab } = createTab();
    const layout = findGroup(tab.containerEl, "Layout");

    expect(layout.classList.contains("is-collapsed")).toBe(true);
    expect(findGroup(tab.containerEl, "Ribbon").classList.contains("is-collapsed")).toBe(true);
    expect(findGroup(tab.containerEl, "Canvas").classList.contains("is-collapsed")).toBe(false);

    heading(layout).click();
    expect(layout.classList.contains("is-collapsed")).toBe(false);
    heading(layout).click();
    expect(layout.classList.contains("is-collapsed")).toBe(true);
  });

  it("reveals search matches inside collapsed sections", () => {
    const { tab } = createTab();
    const layout = findGroup(tab.containerEl, "Layout");
    const canvas = findGroup(tab.containerEl, "Canvas");

    tab.setQuery("folder");

    expect(layout.classList.contains("is-collapsed")).toBe(false);
    expect(layout.style.display).toBe("");
    expect(findRow(tab.containerEl, "Folder Icons").style.display).toBe("");
    expect(findGroup(tab.containerEl, "Ribbon").style.display).toBe("none");
    expect(canvas.style.display).toBe("none");

    tab.setQuery("");
    expect(layout.classList.contains("is-collapsed")).toBe(true);
    expect(canvas.style.display).toBe("");
  });
});

function createTab(): { tab: StyleSettingsTab; calls: [string, string, unknown][] } {
  document.body.replaceChildren();
  const { blocks, errors } = parseStyleSettings(THEME_CSS, "fixture");
  const calls: [string, string, unknown][] = [];
  const values = new Map<string, unknown>();
  const app = {
    appearance: { isDarkMode: () => false },
    styleSettings: {
      getBlocks: () => blocks,
      getErrors: () => errors,
      getValue: (_blockId: string, settingId: string) => values.get(settingId),
      setValue: (blockId: string, settingId: string, value: unknown) => {
        values.set(settingId, value);
        calls.push([blockId, settingId, value]);
      },
      resetValue: (_blockId: string, settingId: string) => values.delete(settingId),
      onExternalChange: () => {},
    },
  } as unknown as App;

  const tab = new StyleSettingsTab(app);
  document.body.appendChild(tab.containerEl);
  tab.display();
  return { tab, calls };
}

function findRow(container: HTMLElement, name: string): HTMLElement {
  const row = [
    ...container.querySelectorAll<HTMLElement>(".setting-item:not(.setting-item-heading)"),
  ].find((candidate) => candidate.querySelector(".setting-item-name")?.textContent === name);
  expect(row, `setting ${name || "(unnamed)"}`).toBeDefined();
  return row!;
}

function findGroup(container: HTMLElement, title: string): HTMLElement {
  const group = [...container.querySelectorAll<HTMLElement>(".setting-group")].find(
    (candidate) =>
      candidate.querySelector(":scope > .setting-item-heading > .setting-item-name")
        ?.textContent === title,
  );
  expect(group, `group ${title}`).toBeDefined();
  return group!;
}

function heading(group: HTMLElement): HTMLElement {
  return group.querySelector<HTMLElement>(":scope > .setting-item-heading")!;
}

function options(row: HTMLElement): string[] {
  return [...row.querySelectorAll<HTMLOptionElement>("option")].map((option) => option.value);
}
