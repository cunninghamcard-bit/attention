import type { App } from "./App";
import type { SettingRegistry } from "./SettingRegistry";
import { FilteredFolderInputSuggest, FullPathFileInputSuggest } from "../suggest/FileInputSuggest";
import {
  DisplayValueComponent,
  Setting,
  SettingGroup,
  type ExtraButtonComponent,
  type SettingText,
} from "../ui/Setting";
import { setIcon } from "../ui/Icon";
import type { TFile, TFolder } from "../vault/TAbstractFile";

export type SettingSection = "options" | "core-plugins" | "community-plugins";
export type HexString = string;

export interface SettingControlBase<V, K extends string = string> {
  key: K;
  defaultValue?: V;
  validate?: (value: V) => string | void | Promise<string | void>;
  disabled?: boolean | (() => boolean);
}

export interface SettingToggleControl<K extends string = string> extends SettingControlBase<boolean, K> {
  type: "toggle";
}

export interface SettingDropdownControl<K extends string = string> extends SettingControlBase<string, K> {
  type: "dropdown";
  options: Record<string, string>;
}

export interface SettingTextControl<K extends string = string> extends SettingControlBase<string, K> {
  type: "text";
  placeholder?: string;
}

export interface SettingTextAreaControl<K extends string = string> extends SettingControlBase<string, K> {
  type: "textarea";
  placeholder?: string;
  rows?: number;
}

export interface SettingNumberControl<K extends string = string> extends SettingControlBase<number, K> {
  type: "number";
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number | "any";
}

export interface SettingFileControl<K extends string = string> extends SettingControlBase<string, K> {
  type: "file";
  placeholder?: string;
  filter?: (file: TFile) => boolean;
}

export interface SettingFolderControl<K extends string = string> extends SettingControlBase<string, K> {
  type: "folder";
  placeholder?: string;
  includeRoot?: boolean;
  filter?: (folder: TFolder) => boolean;
}

export interface SettingSliderControl<K extends string = string> extends SettingControlBase<number, K> {
  type: "slider";
  min: number;
  max: number;
  step: number;
  displayFormat?: (value: number) => string;
}

export interface SettingColorControl<K extends string = string> extends SettingControlBase<HexString, K> {
  type: "color";
}

export type SettingControl<K extends string = string> =
  | SettingToggleControl<K>
  | SettingDropdownControl<K>
  | SettingTextControl<K>
  | SettingTextAreaControl<K>
  | SettingNumberControl<K>
  | SettingFileControl<K>
  | SettingFolderControl<K>
  | SettingSliderControl<K>
  | SettingColorControl<K>;

export interface SettingDefinitionBase {
  name: string;
  desc?: string | DocumentFragment;
  aliases?: string[];
  searchable?: boolean | (() => boolean);
  visible?: boolean | (() => boolean);
}

export interface SettingDefinitionControl<K extends string = string> extends SettingDefinitionBase {
  control: SettingControl<K>;
  action?: never;
  render?: never;
}

export interface SettingDefinitionRender extends SettingDefinitionBase {
  control?: never;
  action?: never;
  render: (setting: Setting, group: SettingGroup) => void | (() => void);
}

export interface SettingDefinitionAction extends SettingDefinitionBase {
  action: (el: HTMLElement, index: number) => void;
  disabled?: boolean | (() => boolean);
  control?: never;
  render?: never;
}

export interface SettingDefinitionEmpty extends SettingDefinitionBase {
  control?: never;
  action?: never;
  render?: never;
}

export type SettingDefinition<K extends string = string> =
  | SettingDefinitionControl<K>
  | SettingDefinitionRender
  | SettingDefinitionAction
  | SettingDefinitionEmpty;

export interface SettingDefinitionAddItem {
  name: string;
  action: (el: HTMLElement) => void;
}

export interface SettingDefinitionPage<K extends string = string> {
  type: "page";
  name: string;
  desc?: string | DocumentFragment;
  displayValue?: string | (() => string);
  status?: "warning" | null | (() => "warning" | null);
  items?: SettingDefinitionItem<K>[];
  page?: () => SettingPage;
  visible?: boolean | (() => boolean);
}

export type SettingGroupItem<K extends string = string> = SettingDefinition<K> | SettingDefinitionPage<K>;

export interface SettingDefinitionGroup<K extends string = string> {
  type: "group" | "list";
  heading?: string;
  cls?: string;
  search?: {
    placeholder?: string;
    match: (def: SettingDefinition, query: string) => boolean;
  };
  extraButtons?: ((component: ExtraButtonComponent) => unknown)[];
  items?: SettingGroupItem<K>[];
  visible?: boolean | (() => boolean);
}

export interface SettingDefinitionList<K extends string = string> extends SettingDefinitionGroup<K> {
  type: "list";
  emptyState?: string | DocumentFragment;
  onReorder?: (oldIndex: number, newIndex: number) => void;
  onDelete?: (index: number) => void;
  addItem?: SettingDefinitionAddItem;
}

export type SettingDefinitionItem<K extends string = string> =
  | SettingDefinition<K>
  | SettingDefinitionGroup<K>
  | SettingDefinitionList<K>
  | SettingDefinitionPage<K>;

export abstract class SettingPage {
  rootEl: HTMLElement;
  titlebarEl: HTMLElement;
  containerEl: HTMLElement;
  title = "";

  constructor() {
    this.rootEl = document.createElement("div");
    this.rootEl.className = "setting-page";
    this.titlebarEl = document.createElement("div");
    this.titlebarEl.className = "setting-page-titlebar";
    this.containerEl = document.createElement("div");
    this.containerEl.className = "setting-page-content";
    this.rootEl.append(this.titlebarEl, this.containerEl);
  }

  abstract display(): void;

  hide(): void {
    this.containerEl.replaceChildren();
    this.rootEl.remove();
  }
}

export interface SettingTab {
  app?: App | null;
  setting?: SettingRegistry | null;
  id?: string;
  name?: string;
  icon?: string;
  section?: SettingSection;
  navEl?: HTMLElement | null;
  containerEl?: HTMLElement;
  settingItems?: SettingDefinitionItem[];
  setQuery?(query: string): void;
  getSettingDefinitions?(): SettingDefinitionItem[];
  update?(): void;
  getControlValue?(key: string): unknown;
  setControlValue?(key: string, value: unknown): void | Promise<void>;
  refreshDomState?(): void;
  displayDeclarative?(): boolean;
  display?(): void;
  hide?(): void;
}

export interface SettingTabRuntime extends SettingTab {
  app: App;
  setting: SettingRegistry;
  containerEl: HTMLElement;
  navEl: HTMLElement | null;
  settingItems: SettingDefinitionItem[];
  getSettingDefinitions(): SettingDefinitionItem[];
  update(): void;
  getControlValue(key: string): unknown;
  setControlValue(key: string, value: unknown): void | Promise<void>;
  setQuery(query: string): void;
  refreshDomState(): void;
  displayDeclarative(): boolean;
  display(): void;
  hide(): void;
}

type Booleanish = boolean | (() => boolean) | undefined;

type RenderedDomState = {
  visible?: () => boolean;
  search?: () => boolean;
  disabled?: () => boolean;
  setVisible?: (visible: boolean) => void;
  setDisabled?: (disabled: boolean) => void;
};

type GroupSearchFilter = {
  path: string;
  match: (def: SettingDefinition, query: string) => boolean;
};

function evaluateBoolean(value: Booleanish, fallback = true): boolean {
  if (typeof value === "function") return value();
  if (typeof value === "boolean") return value;
  return fallback;
}

function getDisplayText(value: string | (() => string) | undefined): string {
  return typeof value === "function" ? value() : value ?? "";
}

function getStatus(value: "warning" | null | (() => "warning" | null) | undefined): "warning" | null {
  return typeof value === "function" ? value() : value ?? null;
}

function getSettingText(value: string | DocumentFragment | undefined): SettingText | undefined {
  return value;
}

function getSearchText(value: string | DocumentFragment | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : value.textContent ?? "";
}

function splitClasses(value: string | undefined): string[] {
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

function isGroupDefinition(item: SettingDefinitionItem): item is SettingDefinitionGroup | SettingDefinitionList {
  return "type" in item && (item.type === "group" || item.type === "list");
}

function isListDefinition(item: SettingDefinitionGroup | SettingDefinitionList): item is SettingDefinitionList {
  return item.type === "list";
}

function isPageDefinition(item: SettingDefinitionItem | SettingGroupItem): item is SettingDefinitionPage {
  return "type" in item && item.type === "page";
}

function hasControl(definition: SettingDefinition): definition is SettingDefinitionControl {
  return "control" in definition && definition.control !== undefined;
}

function hasRender(definition: SettingDefinition): definition is SettingDefinitionRender {
  return "render" in definition && typeof definition.render === "function";
}

function hasAction(definition: SettingDefinition): definition is SettingDefinitionAction {
  return "action" in definition && typeof definition.action === "function";
}

export const SettingTab: { new(app: App, setting: SettingRegistry): SettingTabRuntime } = class SettingTab {
  app: App;
  setting: SettingRegistry;
  containerEl: HTMLElement;
  navEl: HTMLElement | null = null;
  id?: string;
  name?: string;
  icon?: string;
  section?: SettingSection;
  settingItems: SettingDefinitionItem[] = [];
  private declarativeCleanups: (() => void)[] = [];
  private renderedDomStates: RenderedDomState[] = [];
  private groupSearchQueries = new Map<string, string>();
  private query = "";

  constructor(app: App, setting: SettingRegistry) {
    this.app = app;
    this.setting = setting;
    this.containerEl = document.createElement("div");
    this.containerEl.className = "vertical-tab-content";
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
  }

  update(): void {
    this.settingItems = this.getSettingDefinitions() ?? [];
  }

  getControlValue(key: string): unknown {
    return this.app.vault.getConfig(key);
  }

  setControlValue(key: string, value: unknown): void | Promise<void> {
    this.app.vault.setConfig(key, value);
  }

  displayDeclarative(): boolean {
    this.update();
    if (this.settingItems.length === 0) {
      this.cleanupDeclarativeRender();
      return false;
    }

    this.cleanupDeclarativeRender();
    this.containerEl.replaceChildren();
    this.renderSettingItems(this.settingItems, this.containerEl);
    this.refreshDomState();
    return true;
  }

  display(): void {}

  setQuery(query: string): void {
    this.query = query.trim().toLowerCase();
    this.refreshDomState();
  }

  hide(): void {
    this.cleanupDeclarativeRender();
  }

  refreshDomState(): void {
    for (const state of this.renderedDomStates) {
      if (state.visible || state.search) state.setVisible?.((state.visible?.() ?? true) && (state.search?.() ?? true));
      if (state.disabled) state.setDisabled?.(state.disabled());
    }
  }

  private cleanupDeclarativeRender(): void {
    for (const cleanup of this.declarativeCleanups.splice(0)) cleanup();
    this.renderedDomStates = [];
  }

  private renderSettingItems(items: SettingDefinitionItem[], containerEl: HTMLElement, parentGroup?: SettingGroup, pathPrefix = "root"): void {
    let currentGroup = parentGroup;
    items.forEach((item, index) => {
      const path = `${pathPrefix}/${index}`;
      if (isGroupDefinition(item)) {
        currentGroup = undefined;
        this.renderGroup(item, containerEl, path);
        return;
      }

      if (!currentGroup) currentGroup = new SettingGroup(containerEl);
      this.renderGroupItem(item, currentGroup, index, undefined, path);
    });
  }

  private renderGroup(definition: SettingDefinitionGroup | SettingDefinitionList, containerEl: HTMLElement, path: string): SettingGroup {
    const group = new SettingGroup(containerEl);
    const listDefinition = isListDefinition(definition) ? definition : undefined;
    if (definition.heading) group.setHeading(definition.heading);
    group.addClass(...splitClasses(definition.cls));
    if (listDefinition) group.addClass("setting-list");
    if (listDefinition?.onReorder) group.addClass("mod-reorderable");
    for (const extraButton of definition.extraButtons ?? []) group.addExtraButton(extraButton);
    if (listDefinition?.addItem) {
      const addItem = listDefinition.addItem;
      group.addExtraButton((button) => {
        button.setIcon("lucide-plus").setTooltip(addItem.name).onClick(() => addItem.action(button.extraSettingsEl));
      });
    }
    if (definition.search) {
      const searchQuery = this.groupSearchQueries.get(path) ?? "";
      group.addSearch((search) => {
        if (definition.search?.placeholder) search.setPlaceholder(definition.search.placeholder);
        if (searchQuery) search.setValue(searchQuery);
        search.onChange((query) => {
          this.groupSearchQueries.set(path, query);
          this.refreshDomState();
        });
      });
    }

    const items = definition.items ?? [];
    const groupSearch = definition.search ? { path, match: definition.search.match } : undefined;
    if (listDefinition && items.length === 0 && listDefinition.emptyState) {
      const empty = new Setting(group.listEl).setName(listDefinition.emptyState);
      empty.setClass("setting-list-empty-state");
    } else {
      items.forEach((item, index) => this.renderGroupItem(item, group, index, listDefinition, `${path}/${index}`, groupSearch));
    }

    this.trackDomState({
      visible: () => evaluateBoolean(definition.visible),
      setVisible: (visible) => {
        group.groupEl.style.display = visible ? "" : "none";
      },
    });
    return group;
  }

  private renderGroupItem(
    item: SettingDefinition | SettingDefinitionPage,
    group: SettingGroup,
    index: number,
    list?: SettingDefinitionList,
    path?: string,
    groupSearch?: GroupSearchFilter,
  ): void {
    if (isPageDefinition(item)) {
      this.renderPage(item, group, index, list, path, groupSearch);
      return;
    }
    this.renderDefinition(item, group, index, list, groupSearch);
  }

  private renderDefinition(definition: SettingDefinition, group: SettingGroup, index: number, list?: SettingDefinitionList, groupSearch?: GroupSearchFilter): Setting {
    const setting = new Setting(group.listEl).setName(definition.name);
    const desc = getSettingText(definition.desc);
    if (desc) setting.setDesc(desc);
    setting.settingEl.dataset.settingName = definition.name;

    if (hasControl(definition)) {
      this.renderControl(setting, definition.control);
      this.trackDomState({
        visible: () => evaluateBoolean(definition.visible),
        search: () => this.matchesSettingSearch(definition, groupSearch),
        disabled: () => evaluateBoolean(definition.control.disabled, false),
        setVisible: (visible) => setting.setVisibility(visible),
        setDisabled: (disabled) => setting.setDisabled(disabled),
      });
    } else if (hasRender(definition)) {
      const cleanup = definition.render(setting, group);
      if (cleanup) this.declarativeCleanups.push(cleanup);
      this.trackDomState({
        visible: () => evaluateBoolean(definition.visible),
        search: () => this.matchesSettingSearch(definition, groupSearch),
        setVisible: (visible) => setting.setVisibility(visible),
      });
    } else if (hasAction(definition)) {
      setting.setClass("mod-clickable");
      setting.settingEl.tabIndex = 0;
      const run = () => {
        if (evaluateBoolean(definition.disabled, false)) return;
        definition.action(setting.settingEl, index);
      };
      setting.settingEl.addEventListener("click", run);
      setting.settingEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        run();
      });
      this.trackDomState({
        visible: () => evaluateBoolean(definition.visible),
        search: () => this.matchesSettingSearch(definition, groupSearch),
        disabled: () => evaluateBoolean(definition.disabled, false),
        setVisible: (visible) => setting.setVisibility(visible),
        setDisabled: (disabled) => setting.setDisabled(disabled),
      });
    } else {
      this.trackDomState({
        visible: () => evaluateBoolean(definition.visible),
        search: () => this.matchesSettingSearch(definition, groupSearch),
        setVisible: (visible) => setting.setVisibility(visible),
      });
    }

    this.attachListControls(setting, index, list);
    return setting;
  }

  private renderPage(definition: SettingDefinitionPage, group: SettingGroup, index: number, list?: SettingDefinitionList, path = `page/${index}`, groupSearch?: GroupSearchFilter): Setting {
    const setting = new Setting(group.listEl).setName(definition.name);
    const desc = getSettingText(definition.desc);
    if (desc) setting.setDesc(desc);
    setting.setClass("mod-page");
    setting.settingEl.tabIndex = 0;
    let displayValue: DisplayValueComponent | null = null;
    setting.addDisplayValue((display) => {
      displayValue = display;
      display.setValue(getDisplayText(definition.displayValue)).setStatus(getStatus(definition.status));
    });
    setting.addExtraButton((button) => button.setIcon("lucide-chevron-right"));
    const open = () => this.openPage(definition, path);
    setting.settingEl.addEventListener("click", open);
    setting.settingEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    });
    this.trackDomState({
      visible: () => evaluateBoolean(definition.visible),
      search: () => this.matchesPageSearch(definition, groupSearch),
      setVisible: (visible) => setting.setVisibility(visible),
    });
    this.trackDomState({
      disabled: () => false,
      setDisabled: () => {
        const status = getStatus(definition.status);
        setting.settingEl.classList.toggle("mod-warning", status === "warning");
        displayValue?.setValue(getDisplayText(definition.displayValue)).setStatus(status);
      },
    });
    setting.settingEl.dataset.settingPageIndex = String(index);
    this.attachListControls(setting, index, list);
    return setting;
  }

  private attachListControls(setting: Setting, index: number, list?: SettingDefinitionList): void {
    if (!list) return;
    setting.settingEl.dataset.settingListIndex = String(index);

    if (list.onReorder) {
      setting.settingEl.draggable = true;
      setting.setClass("mod-draggable");
      setting.addExtraButton((button) => {
        button.setIcon("lucide-grip-vertical").setTooltip("Drag to reorder");
        button.extraSettingsEl.classList.add("setting-list-drag-handle");
      });
      setting.settingEl.addEventListener("dragstart", (event) => {
        setting.settingEl.classList.add("is-being-dragged");
        event.dataTransfer?.setData("text/plain", String(index));
      });
      setting.settingEl.addEventListener("dragend", () => {
        setting.settingEl.classList.remove("is-being-dragged");
      });
      setting.settingEl.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      setting.settingEl.addEventListener("drop", (event) => {
        event.preventDefault();
        const rawIndex = event.dataTransfer?.getData("text/plain") ?? "";
        const oldIndex = Number.parseInt(rawIndex, 10);
        if (!Number.isInteger(oldIndex) || oldIndex === index) return;
        list.onReorder?.(oldIndex, index);
      });
    }

    if (list.onDelete) {
      setting.settingEl.tabIndex = 0;
      setting.addExtraButton((button) => {
        button.setIcon("lucide-trash-2").setTooltip("Delete").onClick(() => list.onDelete?.(index));
      });
      setting.settingEl.addEventListener("keydown", (event) => {
        if (event.key !== "Delete" && event.key !== "Backspace") return;
        event.preventDefault();
        list.onDelete?.(index);
      });
    }
  }

  private matchesSettingSearch(definition: SettingDefinition, groupSearch?: GroupSearchFilter): boolean {
    return this.matchesGlobalSettingSearch(definition) && this.matchesGroupSettingSearch(definition, groupSearch);
  }

  private matchesPageSearch(definition: SettingDefinitionPage, groupSearch?: GroupSearchFilter): boolean {
    return this.matchesGlobalPageSearch(definition) && this.matchesGroupPageSearch(definition, groupSearch);
  }

  private matchesGlobalSettingSearch(definition: SettingDefinition): boolean {
    if (!this.query) return true;
    if (!evaluateBoolean(definition.searchable, true)) return false;
    return this.getDefinitionSearchText(definition).includes(this.query);
  }

  private matchesGlobalPageSearch(definition: SettingDefinitionPage): boolean {
    if (!this.query) return true;
    return [
      definition.name,
      getSearchText(definition.desc),
      getDisplayText(definition.displayValue),
    ].join(" ").toLowerCase().includes(this.query);
  }

  private matchesGroupSettingSearch(definition: SettingDefinition, groupSearch?: GroupSearchFilter): boolean {
    if (!groupSearch) return true;
    const query = this.groupSearchQueries.get(groupSearch.path) ?? "";
    if (!query.trim()) return true;
    if (!evaluateBoolean(definition.searchable, true)) return true;
    return groupSearch.match(definition, query);
  }

  private matchesGroupPageSearch(_definition: SettingDefinitionPage, groupSearch?: GroupSearchFilter): boolean {
    if (!groupSearch) return true;
    const query = this.groupSearchQueries.get(groupSearch.path) ?? "";
    return !query.trim();
  }

  private getDefinitionSearchText(definition: SettingDefinition): string {
    return [
      definition.name,
      getSearchText(definition.desc),
      ...(definition.aliases ?? []),
    ].join(" ").toLowerCase();
  }

  private openPage(definition: SettingDefinitionPage, path: string): void {
    this.cleanupDeclarativeRender();
    this.containerEl.replaceChildren();
    const pageRootEl = this.containerEl.ownerDocument.createElement("div");
    pageRootEl.className = "setting-page";
    const titlebarEl = this.containerEl.ownerDocument.createElement("div");
    titlebarEl.className = "setting-page-titlebar";
    const backButtonEl = this.containerEl.ownerDocument.createElement("button");
    backButtonEl.className = "clickable-icon setting-page-back-button";
    setIcon(backButtonEl, "lucide-chevron-left");
    const titleEl = this.containerEl.ownerDocument.createElement("div");
    titleEl.className = "setting-page-title";
    titleEl.textContent = definition.name;
    titlebarEl.append(backButtonEl, titleEl);
    const pageContentEl = this.containerEl.ownerDocument.createElement("div");
    pageContentEl.className = "setting-page-content";
    pageRootEl.append(titlebarEl, pageContentEl);
    this.containerEl.appendChild(pageRootEl);
    backButtonEl.addEventListener("click", () => {
      this.displayDeclarative();
    });

    if (definition.page) {
      const page = definition.page();
      page.title = definition.name;
      pageContentEl.appendChild(page.rootEl);
      page.display();
      this.declarativeCleanups.push(() => page.hide());
    } else {
      this.renderSettingItems(definition.items ?? [], pageContentEl, undefined, `${path}/page`);
      this.refreshDomState();
    }
  }

  private renderControl(setting: Setting, control: SettingControl): void {
    const seed = this.getControlSeed(control);
    switch (control.type) {
      case "toggle": {
        const value = typeof seed === "boolean" ? seed : control.defaultValue ?? false;
        setting.addToggle((component) => {
          component.setValue(value);
          component.onChange((next) => this.handleControlChange(setting, control, next));
        });
        this.validateInitialValue(setting, control, value);
        break;
      }
      case "dropdown": {
        const firstOption = Object.keys(control.options)[0] ?? "";
        const value = typeof seed === "string" ? seed : control.defaultValue ?? firstOption;
        setting.addDropdown((component) => {
          component.addOptions(control.options).setValue(value);
          component.onChange((next) => this.handleControlChange(setting, control, next));
        });
        this.validateInitialValue(setting, control, value);
        break;
      }
      case "textarea": {
        const value = typeof seed === "string" ? seed : control.defaultValue ?? "";
        setting.addTextArea((component) => {
          if (control.placeholder) component.setPlaceholder(control.placeholder);
          if (control.rows) component.inputEl.rows = control.rows;
          component.setValue(value);
          component.onChange((next) => this.handleControlChange(setting, control, next));
        });
        this.validateInitialValue(setting, control, value);
        break;
      }
      case "number": {
        const value = this.coerceNumber(seed, control.defaultValue ?? 0, control.min, control.max);
        setting.addText((component) => {
          component.inputEl.type = "number";
          if (control.placeholder) component.setPlaceholder(control.placeholder);
          if (control.min !== undefined) component.inputEl.min = String(control.min);
          if (control.max !== undefined) component.inputEl.max = String(control.max);
          if (control.step !== undefined) component.inputEl.step = String(control.step);
          component.setValue(String(value));
          component.onChange((next) => {
            const numberValue = this.coerceNumber(Number.parseFloat(next), control.defaultValue ?? 0, control.min, control.max);
            this.handleControlChange(setting, control, numberValue);
          });
        });
        this.validateInitialValue(setting, control, value);
        break;
      }
      case "file":
      {
        const value = typeof seed === "string" ? seed : control.defaultValue ?? "";
        setting.addText((component) => {
          if (control.placeholder) component.setPlaceholder(control.placeholder);
          component.setValue(value);
          const suggest = new FullPathFileInputSuggest(this.app, component.inputEl, control.filter);
          this.declarativeCleanups.push(() => suggest.close());
          component.onChange((next) => this.handleControlChange(setting, control, next));
        });
        this.validateInitialValue(setting, control, value);
        break;
      }
      case "folder":
      {
        const value = typeof seed === "string" ? seed : control.defaultValue ?? "";
        setting.addText((component) => {
          if (control.placeholder) component.setPlaceholder(control.placeholder);
          component.setValue(value);
          const suggest = new FilteredFolderInputSuggest(this.app, component.inputEl, control.filter, false, control.includeRoot);
          this.declarativeCleanups.push(() => suggest.close());
          component.onChange((next) => this.handleControlChange(setting, control, next));
        });
        this.validateInitialValue(setting, control, value);
        break;
      }
      case "text": {
        const value = typeof seed === "string" ? seed : control.defaultValue ?? "";
        setting.addText((component) => {
          if (control.placeholder) component.setPlaceholder(control.placeholder);
          component.setValue(value);
          component.onChange((next) => this.handleControlChange(setting, control, next));
        });
        this.validateInitialValue(setting, control, value);
        break;
      }
      case "slider": {
        const value = this.coerceNumber(seed, control.defaultValue ?? control.min, control.min, control.max);
        setting.addSlider((component) => {
          component.setLimits(control.min, control.max, control.step);
          component.setValue(value);
          if (control.displayFormat) component.setDisplayFormat(control.displayFormat);
          component.onChange((next) => this.handleControlChange(setting, control, next));
        });
        this.validateInitialValue(setting, control, value);
        break;
      }
      case "color": {
        const value = typeof seed === "string" ? seed : control.defaultValue ?? "#000000";
        setting.addColorPicker((component) => {
          component.setValue(value);
          component.onChange((next) => this.handleControlChange(setting, control, next));
        });
        this.validateInitialValue(setting, control, value);
        break;
      }
    }
  }

  private getControlSeed(control: SettingControl): unknown {
    const value = this.getControlValue(control.key);
    return value === undefined || value === null ? control.defaultValue : value;
  }

  private coerceNumber(value: unknown, fallback: number, min?: number, max?: number): number {
    let next = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return next;
  }

  private validateInitialValue<V>(setting: Setting, control: SettingControlBase<V>, value: V): void {
    this.validateControl(setting, control, value, false);
  }

  private handleControlChange<V>(setting: Setting, control: SettingControlBase<V>, value: V): void {
    this.validateControl(setting, control, value, true);
  }

  private validateControl<V>(setting: Setting, control: SettingControlBase<V>, value: V, persist: boolean): void {
    void Promise.resolve(control.validate?.(value))
      .then((message) => {
        const error = typeof message === "string" && message.length > 0 ? message : "";
        setting.setErrorMessage(error);
        if (error || !persist) return;
        return this.setControlValue(control.key, value);
      })
      .then(() => {
        if (persist) this.refreshDomState();
      })
      .catch((error: unknown) => {
        setting.setErrorMessage(error instanceof Error ? error.message : String(error));
      });
  }

  private trackDomState(state: RenderedDomState): void {
    this.renderedDomStates.push(state);
  }
};
