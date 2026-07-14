import type { App } from "../app/App";
import type { SettingTab } from "../app/SettingRegistry";
import type {
  ParsedBlock,
  StyleSetting,
  StyleSettingNode,
  StyleSettingVariableThemedColor,
  StyleSettingsParseError,
} from "../app/theme/StyleSettings";
import { MarkdownRenderer } from "../markdown/MarkdownRenderer";
import { ColorComponent, Setting, SettingGroup } from "../ui/Setting";
import { setIcon } from "../ui/Icon";

interface RowEntry {
  kind: "row";
  text: string;
  el: HTMLElement;
}

interface GroupEntry {
  kind: "group";
  text: string;
  groupEl: HTMLElement;
  iconEl?: HTMLElement;
  /** The user's collapse state; seeded from the heading's declared `collapsed`. */
  collapsed: boolean;
  children: Entry[];
}

type Entry = RowEntry | GroupEntry;

export class StyleSettingsTab implements SettingTab {
  readonly id = "style-settings";
  readonly name = "Style settings";
  readonly icon = "lucide-palette";
  readonly section = "options" as const;
  readonly navEl = document.createElement("div");
  readonly containerEl = document.createElement("div");
  private query = "";
  private entries: Entry[] = [];

  constructor(readonly app: App) {
    this.navEl.className = "vertical-tab-nav-item tappable";
    const iconEl = document.createElement("div");
    iconEl.className = "vertical-tab-nav-item-icon";
    setIcon(iconEl, this.icon);
    const titleEl = document.createElement("div");
    titleEl.className = "vertical-tab-nav-item-title";
    titleEl.textContent = this.name;
    const chevronEl = document.createElement("div");
    chevronEl.className = "vertical-tab-nav-item-chevron";
    this.navEl.append(iconEl, titleEl, chevronEl);
    this.containerEl.className = "vertical-tab-content style-settings";
    this.app.styleSettings.onExternalChange(() => {
      if (this.containerEl.isConnected) this.display();
    });
  }

  setQuery(query: string): void {
    this.query = query.trim().toLowerCase();
    this.applyQuery();
  }

  display(): void {
    this.containerEl.replaceChildren();
    this.entries = [];
    const errors = this.app.styleSettings.getErrors();
    if (errors.length > 0) this.renderErrors(errors);
    const blocks = this.app.styleSettings.getBlocks();
    if (blocks.length === 0) {
      new SettingGroup(this.containerEl)
        .setHeading("Style settings")
        .addSetting((setting) =>
          setting
            .setName("No style settings found")
            .setDesc("The active theme and enabled snippets declare no settings."),
        );
      return;
    }
    for (const block of blocks) this.entries.push(this.renderBlock(block));
    this.applyQuery();
  }

  hide(): void {
    this.containerEl.remove();
  }

  private renderErrors(errors: readonly StyleSettingsParseError[]): void {
    const group = new SettingGroup(this.containerEl).setHeading("Could not read style settings");
    for (const error of errors) {
      group.addSetting((setting) =>
        setting.setName(error.source || "Stylesheet").setDesc(error.message),
      );
    }
  }

  private renderBlock(block: ParsedBlock): GroupEntry {
    const group = new SettingGroup(this.containerEl).setHeading(block.name);
    const entry: GroupEntry = {
      kind: "group",
      text: block.name.toLowerCase(),
      groupEl: group.groupEl,
      collapsed: false,
      children: [],
    };
    entry.children = this.renderNodes(block, block.tree, group);
    return entry;
  }

  private renderNodes(
    block: ParsedBlock,
    nodes: readonly StyleSettingNode[],
    group: SettingGroup,
  ): Entry[] {
    const entries: Entry[] = [];
    for (const node of nodes) {
      entries.push(
        node.setting.type === "heading"
          ? this.renderHeading(block, node, group)
          : this.renderRow(block, node.setting, group),
      );
    }
    return entries;
  }

  private renderHeading(block: ParsedBlock, node: StyleSettingNode, parent: SettingGroup): Entry {
    const heading = node.setting as Extract<StyleSetting, { type: "heading" }>;
    const group = new SettingGroup(parent.listEl).setHeading(heading.title);
    const iconEl = group.headerEl.ownerDocument.createElement("div");
    iconEl.className = "tree-item-icon collapse-icon";
    setIcon(iconEl, "right-triangle");
    group.headerEl.prepend(iconEl);
    const entry: GroupEntry = {
      kind: "group",
      text: searchText(heading.title, heading.description),
      groupEl: group.groupEl,
      iconEl,
      collapsed: heading.collapsed,
      children: [],
    };
    group.headerEl.addEventListener("click", () => {
      entry.collapsed = !entry.collapsed;
      setCollapsed(entry, entry.collapsed);
    });
    entry.children = this.renderNodes(block, node.children, group);
    setCollapsed(entry, entry.collapsed);
    return entry;
  }

  private renderRow(block: ParsedBlock, setting: StyleSetting, group: SettingGroup): RowEntry {
    let el!: HTMLElement;
    group.addSetting((row) => {
      el = row.settingEl;
      this.buildControl(block, setting, row);
    });
    return {
      kind: "row",
      text: searchText(
        "title" in setting ? setting.title : "",
        "description" in setting ? setting.description : "",
      ),
      el,
    };
  }

  private buildControl(block: ParsedBlock, setting: StyleSetting, row: Setting): void {
    const store = this.app.styleSettings;
    const value = store.getValue(block.id, setting.id);
    const set = (next: unknown): void => store.setValue(block.id, setting.id, next);
    row.setName("title" in setting ? (setting.title ?? "") : "");

    switch (setting.type) {
      case "info-text":
        if (setting.markdown)
          void MarkdownRenderer.renderMarkdown(setting.description, row.descEl, "");
        else row.setDesc(setting.description);
        return;
      case "class-toggle":
        row.setDesc(setting.description ?? "");
        row.addToggle((toggle) => toggle.setValue(value === true).onChange((next) => set(next)));
        return;
      case "class-select":
        row.addDropdown((dropdown) => {
          if (setting.allowEmpty) dropdown.addOption("", "None");
          for (const option of setting.options) dropdown.addOption(option.value, option.label);
          dropdown
            .setValue(typeof value === "string" ? value : setting.default)
            .onChange((next) => set(next));
        });
        return;
      case "variable-select":
        row.addDropdown((dropdown) => {
          for (const option of setting.options) dropdown.addOption(option.value, option.label);
          dropdown
            .setValue(typeof value === "string" ? value : setting.default)
            .onChange((next) => set(next));
        });
        return;
      case "variable-text":
        row.setDesc(setting.description ?? "");
        row.addText((text) =>
          text
            .setPlaceholder(setting.default)
            .setValue(typeof value === "string" ? value : setting.default)
            .onChange((next) => set(next)),
        );
        return;
      case "variable-number":
        row.setDesc(setting.description ?? "");
        row.addText((text) => {
          text.inputEl.type = "number";
          text
            .setPlaceholder(String(setting.default))
            .setValue(String(typeof value === "number" ? value : setting.default))
            .onChange((next) => {
              const number = Number(next);
              if (next !== "" && Number.isFinite(number)) set(number);
              else store.resetValue(block.id, setting.id);
            });
        });
        return;
      case "variable-number-slider":
        row.setDesc(setting.description ?? "");
        row.addSlider((slider) =>
          slider
            .setLimits(setting.min, setting.max, setting.step)
            .setDynamicTooltip()
            .setValue(typeof value === "number" ? value : setting.default)
            .onChange((next) => set(next)),
        );
        return;
      case "variable-themed-color":
        row.setDesc(setting.description ?? "");
        this.buildColorControl(setting, row, typeof value === "string" ? value : undefined, set);
        return;
      default:
        return;
    }
  }

  /**
   * The colour picker is a native `<input type="color">` — 6-digit hex, no alpha
   * channel. An `hsl` colour with `opacity: true` therefore needs a second control
   * on the row: the picker carries the hue, the slider carries the alpha.
   *
   * An `rgb-values` colour gets the picker alone even if it declares
   * `opacity: true`: it emits a bare triplet, because the consuming CSS supplies
   * the alpha itself (`rgba(var(--canvas-color), 0.1)`). A slider there would
   * move nothing — and a control that silently does nothing is worse than none.
   */
  private buildColorControl(
    setting: StyleSettingVariableThemedColor,
    row: Setting,
    value: string | undefined,
    set: (next: string) => void,
  ): void {
    const current =
      value ??
      (this.app.appearance.isDarkMode() ? setting["default-dark"] : setting["default-light"]);
    let picker!: ColorComponent;
    let alpha = 1;
    const commit = (): void => set(formatColor(setting, picker, alpha));

    row.addColorPicker((color) => {
      picker = color;
      alpha = applyColor(color, current);
    });
    if (setting.opacity && setting.format === "hsl") {
      row.addSlider((slider) =>
        slider
          .setLimits(0, 100, 1)
          .setDynamicTooltip()
          .setDisplayFormat((percent) => `${percent}%`)
          .setValue(Math.round(alpha * 100))
          .onChange((percent) => {
            alpha = percent / 100;
            commit();
          }),
      );
    }
    picker.onChange(() => commit());
  }

  /** A match force-expands its ancestor headings; a heading with no match hides. */
  private applyQuery(): void {
    for (const entry of this.entries) this.filter(entry, false);
  }

  private filter(entry: Entry, forced: boolean): boolean {
    const query = this.query;
    if (entry.kind === "row") {
      const visible = !query || forced || entry.text.includes(query);
      entry.el.style.display = visible ? "" : "none";
      return visible;
    }
    const self = query.length > 0 && entry.text.includes(query);
    let matched = false;
    for (const child of entry.children) matched = this.filter(child, forced || self) || matched;
    const visible = !query || forced || self || matched;
    entry.groupEl.style.display = visible ? "" : "none";
    setCollapsed(entry, query.length > 0 && visible ? false : entry.collapsed);
    return visible;
  }
}

function setCollapsed(entry: GroupEntry, collapsed: boolean): void {
  if (!entry.iconEl) return;
  entry.groupEl.classList.toggle("is-collapsed", collapsed);
  entry.iconEl.classList.toggle("is-collapsed", collapsed);
}

function searchText(title?: string, description?: string): string {
  return `${title ?? ""} ${description ?? ""}`.toLowerCase();
}

/** Load a themed colour into the picker; returns the alpha the string carried. */
function applyColor(picker: ColorComponent, css: string): number {
  const text = css.trim();
  const parts = (text.match(/-?[\d.]+/g) ?? []).map(Number);
  if (/^hsla?\(/i.test(text)) picker.setValueHsl({ h: parts[0], s: parts[1], l: parts[2] });
  else if (/^rgba?\(/i.test(text)) picker.setValueRgb({ r: parts[0], g: parts[1], b: parts[2] });
  else return (picker.setValue(text), 1);
  return parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
}

/**
 * Emit the shape the theme declared its defaults in; the store emits the CSS.
 * Only an `hsl` colour carries an alpha — an `rgb-values` one is emitted as a
 * bare triplet, so there is no alpha to carry and no slider that could set one.
 */
function formatColor(
  setting: StyleSettingVariableThemedColor,
  picker: ColorComponent,
  alpha: number,
): string {
  if (setting.format === "hsl") {
    const { h, s, l } = picker.getValueHsl();
    return `hsla(${h}, ${s}%, ${l}%, ${Number(alpha.toFixed(2))})`;
  }
  const { r, g, b } = picker.getValueRgb();
  return `rgb(${r}, ${g}, ${b})`;
}
