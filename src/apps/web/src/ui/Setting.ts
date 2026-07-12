import type { App } from "../app/App";
import type { HSL, RGB } from "../core/ApiUtils";
import { Platform } from "../platform/Platform";
import { setIcon as renderIcon } from "./Icon";
import { setTooltip as setElementTooltip, type TooltipOptions } from "./Popover";

export type { TooltipOptions } from "./Popover";
export type SettingText = string | DocumentFragment | HTMLElement;

function clearElement(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function setContent(el: HTMLElement, value: SettingText): void {
  clearElement(el);
  if (typeof value === "string") el.textContent = value;
  else el.appendChild(value);
}

function setVisible(el: HTMLElement, visible: boolean): void {
  el.style.display = visible ? "" : "none";
}

function createDiv(parent: HTMLElement, className: string): HTMLDivElement {
  const el = parent.ownerDocument.createElement("div");
  el.className = className;
  parent.appendChild(el);
  return el;
}

function createDetachedDiv(parent: HTMLElement, className: string): HTMLDivElement {
  const el = parent.ownerDocument.createElement("div");
  el.className = className;
  return el;
}

function setComponentIcon(el: HTMLElement, icon: string): void {
  clearElement(el);
  renderIcon(el, icon);
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export class BaseComponent {
  disabled = false;

  then(callback: (component: this) => unknown): this {
    callback(this);
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }
}

export abstract class ValueComponent<T> extends BaseComponent {
  abstract getValue(): T;
  abstract setValue(value: T): this;

  registerOptionListener(record: Record<string, (value?: T) => T>, key: string): this {
    record[key] = (value?: T) => {
      if (value !== undefined) this.setValue(value);
      return this.getValue();
    };
    return this;
  }
}

export class ButtonComponent extends BaseComponent {
  buttonEl: HTMLButtonElement;
  private clickCallback?: (event: MouseEvent) => unknown | Promise<unknown>;

  constructor(parentEl: HTMLElement) {
    super();
    this.buttonEl = parentEl.ownerDocument.createElement("button");
    parentEl.appendChild(this.buttonEl);
    this.buttonEl.addEventListener("click", async (event) => {
      if (this.disabled || !this.clickCallback) return;
      this.setLoading(true);
      try {
        await this.clickCallback(event);
      } finally {
        this.setLoading(false);
      }
    });
  }

  override setDisabled(disabled: boolean): this {
    super.setDisabled(disabled);
    this.buttonEl.disabled = disabled;
    return this;
  }

  setLoading(loading: boolean): this {
    this.buttonEl.classList.toggle("mod-loading", loading);
    return this;
  }

  setCta(): this {
    this.buttonEl.classList.add("mod-cta");
    return this;
  }

  removeCta(): this {
    this.buttonEl.classList.remove("mod-cta");
    return this;
  }

  setWarning(): this {
    this.buttonEl.classList.add("mod-warning");
    return this;
  }

  setTooltip(text: string, options?: TooltipOptions): this {
    setElementTooltip(this.buttonEl, text, options);
    return this;
  }

  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }

  setIcon(icon: string): this {
    setComponentIcon(this.buttonEl, icon);
    return this;
  }

  setClass(className: string): this {
    this.buttonEl.classList.add(className);
    return this;
  }

  onClick(callback: (event: MouseEvent) => unknown | Promise<unknown>): this {
    this.clickCallback = callback;
    return this;
  }
}

export class ExtraButtonComponent extends BaseComponent {
  extraSettingsEl: HTMLDivElement;
  private changeCallback?: () => unknown;

  constructor(parentEl: HTMLElement) {
    super();
    this.extraSettingsEl = createDiv(parentEl, "clickable-icon extra-setting-button");
    this.setIcon("lucide-settings");
    this.extraSettingsEl.addEventListener("click", () => this.handleClick());
  }

  private handleClick(): void {
    if (this.disabled || !this.changeCallback) return;
    this.changeCallback();
  }

  override setDisabled(disabled: boolean): this {
    super.setDisabled(disabled);
    this.extraSettingsEl.classList.toggle("is-disabled", disabled);
    return this;
  }

  setTooltip(text: string, options?: TooltipOptions): this {
    setElementTooltip(this.extraSettingsEl, text, options);
    return this;
  }

  setIcon(icon: string): this {
    setComponentIcon(this.extraSettingsEl, icon);
    return this;
  }

  onClick(callback: () => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

export abstract class AbstractTextComponent<
  T extends HTMLInputElement | HTMLTextAreaElement = HTMLInputElement | HTMLTextAreaElement,
> extends ValueComponent<string> {
  inputEl: T;
  private changeCallback?: (value: string) => unknown;

  constructor(inputEl: T) {
    super();
    this.inputEl = inputEl;
    this.inputEl.spellcheck = false;
    this.inputEl.addEventListener("input", () => this.onChanged());
  }

  override setDisabled(disabled: boolean): this {
    super.setDisabled(disabled);
    this.inputEl.disabled = disabled;
    return this;
  }

  getValue(): string {
    return this.inputEl.value;
  }

  setValue(value: string): this {
    if (typeof value === "string") this.inputEl.value = value;
    return this;
  }

  setPlaceholder(text: string): this {
    this.inputEl.placeholder = text;
    return this;
  }

  onChanged(): void {
    this.changeCallback?.(this.inputEl.value);
  }

  onChange(callback: (value: string) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

export class TextComponent extends AbstractTextComponent<HTMLInputElement> {
  constructor(parentEl: HTMLElement) {
    const inputEl = parentEl.ownerDocument.createElement("input");
    inputEl.type = "text";
    parentEl.appendChild(inputEl);
    super(inputEl);
  }

  autoSelect(all = false): this {
    this.inputEl.focus();
    if (all) this.inputEl.select();
    else this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
    return this;
  }
}

export class SecretComponent extends TextComponent {
  constructor(
    readonly app: App,
    containerEl: HTMLElement,
  ) {
    super(containerEl);
    this.inputEl.type = "password";
    this.inputEl.autocomplete = "new-password";
  }
}

export class SearchComponent extends AbstractTextComponent<HTMLInputElement> {
  containerEl: HTMLDivElement;
  clearButtonEl: HTMLDivElement;

  constructor(parentEl: HTMLElement) {
    const containerEl = parentEl.ownerDocument.createElement("div");
    containerEl.className = "search-input-container";
    parentEl.appendChild(containerEl);

    const inputEl = parentEl.ownerDocument.createElement("input");
    inputEl.type = "search";
    inputEl.enterKeyHint = "search";
    containerEl.appendChild(inputEl);

    const clearButtonEl = parentEl.ownerDocument.createElement("div");
    clearButtonEl.className = "search-input-clear-button";
    containerEl.appendChild(clearButtonEl);

    super(inputEl);
    this.containerEl = containerEl;
    this.clearButtonEl = clearButtonEl;
    this.clearButtonEl.addEventListener("mousedown", (event) => event.preventDefault());
    this.clearButtonEl.addEventListener("click", () => {
      if (this.disabled) return;
      this.setValue("");
      this.onChanged();
      this.inputEl.focus();
    });
  }

  setClass(className: string): this {
    this.containerEl.classList.add(className);
    return this;
  }

  autoSelect(): this {
    this.inputEl.focus();
    this.inputEl.select();
    return this;
  }

  addRightDecorator(callback: (decoratorEl: HTMLElement) => unknown): this {
    const decoratorEl = this.containerEl.ownerDocument.createElement("div");
    decoratorEl.className = "input-right-decorator";
    this.containerEl.appendChild(decoratorEl);
    callback(decoratorEl);
    return this;
  }
}

export class TextAreaComponent extends AbstractTextComponent<HTMLTextAreaElement> {
  constructor(parentEl: HTMLElement) {
    const inputEl = parentEl.ownerDocument.createElement("textarea");
    parentEl.appendChild(inputEl);
    super(inputEl);
  }
}

export class MomentFormatComponent extends TextComponent {
  private defaultFormat = "";
  private sampleEl?: HTMLElement;

  setDefaultFormat(format: string): this {
    this.defaultFormat = format;
    this.setPlaceholder(format);
    this.updateSample();
    return this;
  }

  setSampleEl(sampleEl: HTMLElement): this {
    this.sampleEl = sampleEl;
    this.updateSample();
    return this;
  }

  override setValue(value: string): this {
    super.setValue(value);
    this.updateSample();
    return this;
  }

  override onChanged(): void {
    super.onChanged();
    this.updateSample();
  }

  updateSample(): this {
    if (!this.sampleEl) return this;
    const format = this.getValue() || this.defaultFormat;
    const momentFactory = (globalThis as { moment?: () => { format: (format: string) => string } })
      .moment;
    this.sampleEl.textContent = momentFactory ? momentFactory().format(format) : format;
    return this;
  }
}

export class DropdownComponent extends ValueComponent<string> {
  selectEl: HTMLSelectElement;
  private changeCallback?: (value: string) => unknown;

  constructor(parentEl: HTMLElement) {
    super();
    this.selectEl = parentEl.ownerDocument.createElement("select");
    this.selectEl.className = "dropdown";
    parentEl.appendChild(this.selectEl);
    this.selectEl.addEventListener("change", () => this.changeCallback?.(this.getValue()));
  }

  override setDisabled(disabled: boolean): this {
    super.setDisabled(disabled);
    this.selectEl.disabled = disabled;
    return this;
  }

  addOption(value: string, label: string): this {
    const optionEl = this.selectEl.ownerDocument.createElement("option");
    optionEl.value = value;
    optionEl.textContent = label;
    this.selectEl.appendChild(optionEl);
    return this;
  }

  addOptions(options: Record<string, string>): this {
    for (const value of Object.keys(options)) this.addOption(value, options[value]);
    return this;
  }

  getValue(): string {
    return this.selectEl.value;
  }

  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

export class ToggleComponent extends ValueComponent<boolean> {
  toggleEl: HTMLLabelElement;
  inputEl: HTMLInputElement;
  private on = false;
  private changeCallback?: (value: boolean) => unknown;

  constructor(parentEl: HTMLElement) {
    super();
    this.toggleEl = parentEl.ownerDocument.createElement("label");
    this.toggleEl.className = "checkbox-container";
    this.toggleEl.tabIndex = 0;
    parentEl.appendChild(this.toggleEl);

    this.inputEl = parentEl.ownerDocument.createElement("input");
    this.inputEl.type = "checkbox";
    this.inputEl.tabIndex = 0;
    this.toggleEl.appendChild(this.inputEl);
    this.inputEl.addEventListener("change", () => this.onClick());
  }

  override setDisabled(disabled: boolean): this {
    super.setDisabled(disabled);
    this.toggleEl.classList.toggle("is-disabled", disabled);
    return this;
  }

  getValue(): boolean {
    return this.on;
  }

  setValue(value: boolean): this {
    if (this.on === value) return this;
    this.on = value;
    this.toggleEl.classList.toggle("is-enabled", value);
    this.changeCallback?.(value);
    return this;
  }

  setSmall(): this {
    this.toggleEl.classList.add("mod-small");
    return this;
  }

  setTooltip(text: string, options?: TooltipOptions): this {
    setElementTooltip(this.toggleEl, text, options);
    return this;
  }

  onClick(): void {
    if (this.disabled) return;
    navigator.vibrate?.(100);
    this.setValue(!this.getValue());
  }

  onChange(callback: (value: boolean) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

export type Rgb = RGB;
export type Hsl = HSL;

function hexToRgb(value: string): RGB | null {
  const normalized = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const intValue = parseInt(normalized, 16);
  return { r: (intValue >> 16) & 255, g: (intValue >> 8) & 255, b: intValue & 255 };
}

function rgbToHex(value: RGB): string {
  const r = clamp(Math.round(value.r), 0, 255).toString(16).padStart(2, "0");
  const g = clamp(Math.round(value.g), 0, 255).toString(16).padStart(2, "0");
  const b = clamp(Math.round(value.b), 0, 255).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function rgbToHsl({ r, g, b }: RGB): HSL {
  const red = clamp(r, 0, 255) / 255;
  const green = clamp(g, 0, 255) / 255;
  const blue = clamp(b, 0, 255) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(100 * l) };
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h = 0;
  if (max === red) h = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) h = (blue - red) / delta + 2;
  else h = (red - green) / delta + 4;
  return { h: Math.round(60 * h), s: Math.round(100 * s), l: Math.round(100 * l) };
}

function hueToRgb(p: number, q: number, t: number): number {
  let hue = t;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToRgb(value: HSL): RGB {
  const h = clamp(value.h, 0, 360) / 360;
  const s = clamp(value.s, 0, 100) / 100;
  const l = clamp(value.l, 0, 100) / 100;
  if (s === 0) {
    const value = Math.round(l * 255);
    return { r: value, g: value, b: value };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, h) * 255),
    b: Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  };
}

export class ColorComponent extends ValueComponent<string> {
  colorPickerEl: HTMLInputElement;
  private changeCallback?: (value: string) => unknown;

  constructor(parentEl: HTMLElement) {
    super();
    this.colorPickerEl = parentEl.ownerDocument.createElement("input");
    this.colorPickerEl.type = "color";
    parentEl.appendChild(this.colorPickerEl);
    this.colorPickerEl.addEventListener("change", () => this.changeCallback?.(this.getValue()));
  }

  override setDisabled(disabled: boolean): this {
    super.setDisabled(disabled);
    this.colorPickerEl.disabled = disabled;
    return this;
  }

  getValue(): string {
    return this.colorPickerEl.value;
  }

  getValueRgb(): RGB {
    return hexToRgb(this.getValue()) ?? { r: 0, g: 0, b: 0 };
  }

  getValueHsl(): HSL {
    return rgbToHsl(this.getValueRgb());
  }

  getValueInt(): number {
    return parseInt(this.getValue().slice(1), 16);
  }

  setValue(value: string): this {
    if (this.colorPickerEl.value !== value) {
      this.colorPickerEl.value = value;
      this.changeCallback?.(this.getValue());
    }
    return this;
  }

  setValueRgb(value: RGB): this {
    return this.setValue(rgbToHex(value));
  }

  setValueHsl(value: HSL): this {
    return this.setValueRgb(hslToRgb(value));
  }

  setValueInt(value: number): this {
    return this.setValue(`#${value.toString(16).padStart(6, "0")}`);
  }

  onChange(callback: (value: string) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

export class ProgressBarComponent extends ValueComponent<number> {
  progressBar: HTMLDivElement;
  lineEl: HTMLDivElement;
  progressBarEl: HTMLDivElement;
  progressLineEl: HTMLDivElement;
  private value = 0;

  constructor(parentEl: HTMLElement) {
    super();
    this.progressBar = createDiv(parentEl, "setting-progress-bar");
    this.lineEl = createDiv(this.progressBar, "setting-progress-bar-inner");
    this.progressBarEl = this.progressBar;
    this.progressLineEl = this.lineEl;
  }

  getValue(): number {
    return this.value;
  }

  setValue(value: number): this {
    this.value = clamp(value, 0, 100);
    this.lineEl.style.width = `${this.value}%`;
    return this;
  }

  setVisibility(visible: boolean): this {
    this.progressBar.hidden = !visible;
    return this;
  }
}

export class SliderComponent extends ValueComponent<number> {
  sliderEl: HTMLInputElement;
  dynamicTooltip = false;
  instant = false;
  private displayFormat?: (value: number) => string;
  private changeCallback?: (value: number) => unknown;

  constructor(parentEl: HTMLElement) {
    super();
    this.sliderEl = parentEl.ownerDocument.createElement("input");
    this.sliderEl.type = "range";
    this.sliderEl.className = "slider";
    this.sliderEl.dataset.ignoreSwipe = "true";
    parentEl.appendChild(this.sliderEl);
    this.sliderEl.addEventListener("input", () => {
      navigator.vibrate?.(100);
      if (this.dynamicTooltip) this.showTooltip();
      if (this.instant) this.changeCallback?.(this.getValue());
    });
    this.sliderEl.addEventListener("change", () => {
      if (!this.instant) this.changeCallback?.(this.getValue());
    });
    this.sliderEl.addEventListener("click", (event) => event.stopPropagation());
  }

  override setDisabled(disabled: boolean): this {
    super.setDisabled(disabled);
    this.sliderEl.disabled = disabled;
    return this;
  }

  setInstant(instant: boolean): this {
    this.instant = instant;
    return this;
  }

  setLimits(min: number, max: number, step: number | "any"): this {
    this.sliderEl.min = String(min);
    this.sliderEl.max = String(max);
    this.sliderEl.step = String(step);
    return this;
  }

  getValue(): number {
    return this.sliderEl.valueAsNumber;
  }

  setValue(value: number): this {
    if (this.sliderEl.valueAsNumber !== value) {
      this.sliderEl.valueAsNumber = value;
      this.changeCallback?.(value);
    }
    return this;
  }

  getValuePretty(): string {
    const value = this.getValue();
    if (this.displayFormat) return this.displayFormat(value);
    return this.sliderEl.step === "any" || parseFloat(this.sliderEl.step) < 1
      ? value.toFixed(2)
      : value.toString();
  }

  setDisplayFormat(format: (value: number) => string): this {
    this.displayFormat = format;
    return this;
  }

  setDynamicTooltip(): this {
    this.dynamicTooltip = true;
    this.sliderEl.addEventListener("mouseenter", () => this.showTooltip());
    this.sliderEl.addEventListener("mouseleave", () => this.sliderEl.removeAttribute("aria-label"));
    this.sliderEl.addEventListener("touchend", () => this.sliderEl.removeAttribute("aria-label"));
    return this;
  }

  showTooltip(): void {
    setElementTooltip(this.sliderEl, this.getValuePretty(), { placement: "top" });
  }

  onChange(callback: (value: number) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

export class SettingGroup {
  groupEl: HTMLDivElement;
  headerEl: HTMLDivElement;
  headerInnerEl: HTMLDivElement;
  headingEl: HTMLDivElement;
  controlEl: HTMLDivElement;
  listEl: HTMLDivElement;
  itemsEl: HTMLDivElement;
  searchContainerEl?: HTMLDivElement;
  components: BaseComponent[] = [];

  constructor(parentEl: HTMLElement) {
    this.groupEl = createDiv(parentEl, "setting-group");
    this.headerEl = createDetachedDiv(parentEl, "setting-item setting-item-heading");
    this.headerInnerEl = createDiv(this.headerEl, "setting-item-name");
    this.headingEl = this.headerInnerEl;
    this.controlEl = createDiv(this.headerEl, "setting-item-control");
    this.listEl = createDiv(this.groupEl, "setting-items");
    this.itemsEl = this.listEl;
  }

  setHeading(text: SettingText): this {
    setContent(this.headerInnerEl, text);
    const isShown = this.headerEl.parentElement === this.groupEl;
    const hasContent = typeof text === "string" ? text.length > 0 : true;
    if (hasContent && !isShown) this.groupEl.prepend(this.headerEl);
    else if (!hasContent && isShown) this.headerEl.remove();
    return this;
  }

  addClass(...classes: string[]): this {
    for (const className of classes) this.groupEl.classList.add(className);
    return this;
  }

  addSetting(callback: (setting: Setting) => unknown): this {
    callback(new Setting(this.listEl));
    return this;
  }

  addSearch(callback: (component: SearchComponent) => unknown): this {
    if (!this.searchContainerEl) {
      this.searchContainerEl = this.groupEl.ownerDocument.createElement("div");
      this.searchContainerEl.className = "setting-group-search";
      this.groupEl.insertBefore(this.searchContainerEl, this.listEl);
    }
    const component = new SearchComponent(this.searchContainerEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addExtraButton(callback: (component: ExtraButtonComponent) => unknown): this {
    const component = new ExtraButtonComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }
}

export class Setting {
  settingEl: HTMLDivElement;
  infoEl: HTMLDivElement;
  nameEl: HTMLDivElement;
  descEl: HTMLDivElement;
  controlEl: HTMLDivElement;
  components: BaseComponent[] = [];

  constructor(parentEl: HTMLElement) {
    this.settingEl = createDiv(parentEl, "setting-item");
    this.infoEl = createDiv(this.settingEl, "setting-item-info");
    this.nameEl = createDiv(this.infoEl, "setting-item-name");
    this.descEl = createDiv(this.infoEl, "setting-item-description");
    this.controlEl = createDiv(this.settingEl, "setting-item-control");
  }

  setName(text: SettingText): this {
    setContent(this.nameEl, text);
    return this;
  }

  setDesc(text: SettingText): this {
    setContent(this.descEl, text);
    return this;
  }

  setClass(className: string): this {
    this.settingEl.classList.add(className);
    return this;
  }

  setTooltip(text: string, options?: TooltipOptions): this {
    setElementTooltip(this.nameEl, text, options);
    return this;
  }

  setHeading(): this {
    this.settingEl.classList.add("setting-item-heading");
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.settingEl.classList.toggle("is-disabled", disabled);
    for (const component of this.components) component.setDisabled(disabled);
    return this;
  }

  setNoInfo(): this {
    setVisible(this.infoEl, false);
    return this;
  }

  setVisibility(visible: boolean): this {
    setVisible(this.settingEl, visible);
    return this;
  }

  clear(): this {
    clearElement(this.controlEl);
    this.components = [];
    return this;
  }

  then(callback: (setting: this) => unknown): this {
    callback(this);
    return this;
  }

  addButton(callback: (component: ButtonComponent) => unknown): this {
    const component = new ButtonComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addExtraButton(callback: (component: ExtraButtonComponent) => unknown): this {
    const component = new ExtraButtonComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addToggle(callback: (component: ToggleComponent) => unknown): this {
    const component = new ToggleComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    this.settingEl.classList.add("mod-toggle");
    return this;
  }

  addText(callback: (component: TextComponent) => unknown): this {
    const component = new TextComponent(this.controlEl);
    if (!Platform.hasPhysicalKeyboard) {
      component.inputEl.addEventListener("keydown", (event) => {
        if (!event.isComposing && !event.defaultPrevented && event.key === "Enter")
          component.inputEl.blur();
      });
    }
    this.components.push(component);
    callback(component);
    return this;
  }

  addComponent<T extends BaseComponent>(factory: (controlEl: HTMLElement) => T): this {
    const component = factory(this.controlEl);
    this.components.push(component);
    return this;
  }

  addSearch(callback: (component: SearchComponent) => unknown): this {
    const component = new SearchComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addTextArea(callback: (component: TextAreaComponent) => unknown): this {
    const component = new TextAreaComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addMomentFormat(callback: (component: MomentFormatComponent) => unknown): this {
    const component = new MomentFormatComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addDropdown(callback: (component: DropdownComponent) => unknown): this {
    const component = new DropdownComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addColorPicker(callback: (component: ColorComponent) => unknown): this {
    const component = new ColorComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addProgressBar(callback: (component: ProgressBarComponent) => unknown): this {
    const component = new ProgressBarComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }

  addSlider(callback: (component: SliderComponent) => unknown): this {
    const component = new SliderComponent(this.controlEl);
    this.components.push(component);
    callback(component);
    return this;
  }
}
