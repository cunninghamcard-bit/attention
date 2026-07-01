import { describe, expect, it, vi } from "vitest";
import type { HSL, RGB } from "../api/ApiUtils";
import { Platform } from "../platform/Platform";
import {
  ButtonComponent,
  ColorComponent,
  DropdownComponent,
  ExtraButtonComponent,
  ProgressBarComponent,
  SearchComponent,
  SecretComponent,
  Setting,
  SettingGroup,
  SliderComponent,
  TextComponent,
  MomentFormatComponent,
  ToggleComponent,
} from "./Setting";

function parent(): HTMLDivElement {
  return document.createElement("div");
}

describe("Setting components", () => {
  it("chains BaseComponent.then and registers option listeners through ValueComponent", () => {
    const host = parent();
    const text = new TextComponent(host).setValue("alpha");
    const seen = vi.fn();
    const options: Record<string, (value?: string) => string> = {};

    expect(text.then(seen)).toBe(text);
    text.registerOptionListener(options, "name");

    expect(seen).toHaveBeenCalledWith(text);
    expect(options.name()).toBe("alpha");
    expect(options.name("beta")).toBe("beta");
    expect(text.getValue()).toBe("beta");
  });

  it("keeps button loading state around async clicks and supports explicit loading", async () => {
    const host = parent();
    const button = new ButtonComponent(host);
    let resolveClick!: () => void;
    button.onClick(() => new Promise<void>((resolve) => { resolveClick = resolve; }));

    button.buttonEl.click();
    expect(button.buttonEl.classList.contains("mod-loading")).toBe(true);

    resolveClick();
    await Promise.resolve();
    await Promise.resolve();
    expect(button.buttonEl.classList.contains("mod-loading")).toBe(false);

    button.setLoading(true).setCta().setWarning().setDestructive().removeCta();
    expect(button.buttonEl.classList.contains("mod-loading")).toBe(true);
    expect(button.buttonEl.classList.contains("mod-warning")).toBe(true);
    expect(button.buttonEl.classList.contains("mod-destructive")).toBe(true);
    expect(button.buttonEl.classList.contains("mod-cta")).toBe(false);

    button.removeDestructive();
    expect(button.buttonEl.classList.contains("mod-destructive")).toBe(false);
  });

  it("creates SecretComponent as an Obsidian password input", () => {
    const host = parent();
    const app = {} as never;
    const callback = vi.fn();
    const secret = new SecretComponent(app, host).setValue("token").onChange(callback);

    expect(secret.inputEl.type).toBe("password");
    expect(secret.inputEl.autocomplete).toBe("new-password");
    expect(secret.getValue()).toBe("token");

    secret.inputEl.value = "next";
    secret.inputEl.dispatchEvent(new Event("input"));

    expect(callback).toHaveBeenCalledWith("next");
  });

  it("blocks disabled extra button clicks and uses the Obsidian default icon", () => {
    const host = parent();
    const callback = vi.fn();
    const button = new ExtraButtonComponent(host).onClick(callback);

    expect(button.extraSettingsEl.querySelector("svg")).toBeTruthy();
    button.setDisabled(true);
    button.extraSettingsEl.click();
    expect(callback).not.toHaveBeenCalled();

    button.setDisabled(false);
    button.extraSettingsEl.click();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("matches dropdown addOptions and change callback semantics", () => {
    const host = parent();
    const callback = vi.fn();
    const dropdown = new DropdownComponent(host)
      .addOptions({ a: "Alpha", b: "Beta" })
      .onChange(callback)
      .setValue("b");

    expect(dropdown.getValue()).toBe("b");
    expect(callback).not.toHaveBeenCalled();

    dropdown.selectEl.value = "a";
    dropdown.selectEl.dispatchEvent(new Event("change"));
    expect(callback).toHaveBeenCalledWith("a");
  });

  it("updates toggle state through setValue and ignores disabled clicks", () => {
    const host = parent();
    const callback = vi.fn();
    const toggle = new ToggleComponent(host).onChange(callback);

    toggle.setValue(true);
    expect(toggle.getValue()).toBe(true);
    expect(toggle.toggleEl.classList.contains("is-enabled")).toBe(true);
    expect(callback).toHaveBeenCalledWith(true);

    toggle.setValue(true);
    expect(callback).toHaveBeenCalledTimes(1);

    toggle.setDisabled(true).onClick();
    expect(toggle.getValue()).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("clears search input through the clear button and reruns onChange", () => {
    const host = parent();
    const callback = vi.fn();
    const search = new SearchComponent(host).setValue("needle").onChange(callback);

    search.clearButtonEl.click();

    expect(search.getValue()).toBe("");
    expect(callback).toHaveBeenCalledWith("");

    search.setValue("disabled");
    callback.mockClear();
    search.setDisabled(true);
    search.clearButtonEl.click();

    expect(search.getValue()).toBe("disabled");
    expect(callback).not.toHaveBeenCalled();

    const decorated = new SearchComponent(host);
    let decorator: HTMLElement | null = null;
    decorated.addRightDecorator((el) => {
      decorator = el;
    });
    expect([...decorated.containerEl.children].map((child) => child.className)).toEqual([
      "",
      "search-input-clear-button",
      "input-right-decorator",
    ]);
    expect(decorator).toBe(decorated.containerEl.lastElementChild);
  });

  it("converts color values through rgb, hsl, and integer helpers", () => {
    const host = parent();
    const callback = vi.fn();
    const color = new ColorComponent(host).onChange(callback).setValue("#336699");
    const rgb: RGB = color.getValueRgb();
    const hsl: HSL = color.getValueHsl();

    expect(rgb).toEqual({ r: 51, g: 102, b: 153 });
    expect(hsl).toMatchObject({ h: expect.any(Number), s: expect.any(Number), l: expect.any(Number) });
    expect(color.getValueInt()).toBe(0x336699);

    color.setValueRgb({ r: 255, g: 0, b: 16 });
    expect(color.getValue()).toBe("#ff0010");
    expect(callback).toHaveBeenLastCalledWith("#ff0010");
  });

  it("clamps progress and emits slider callbacks like Obsidian", () => {
    const host = parent();
    const progress = new ProgressBarComponent(host).setValue(130);
    expect(progress.getValue()).toBe(100);
    expect(progress.progressBar).toBe(progress.progressBarEl);
    expect(progress.lineEl).toBe(progress.progressLineEl);
    expect(progress.progressLineEl.style.width).toBe("100%");
    progress.setVisibility(false);
    expect(progress.progressBar.hidden).toBe(true);
    progress.setVisibility(true);
    expect(progress.progressBar.hidden).toBe(false);

    const callback = vi.fn();
    const slider = new SliderComponent(host).setLimits(0, 10, 1).onChange(callback);
    slider.setValue(4);
    expect(callback).toHaveBeenCalledWith(4);

    callback.mockClear();
    slider.sliderEl.value = "5";
    slider.sliderEl.dispatchEvent(new Event("change"));
    expect(callback).toHaveBeenCalledWith(5);

    slider.setDynamicTooltip().setDisplayFormat((value) => `${value}px`);
    slider.sliderEl.value = "6";
    slider.sliderEl.dispatchEvent(new Event("input"));
    expect(slider.sliderEl.getAttribute("aria-label")).toBe("6px");
    expect(slider.sliderEl.dataset.tooltipPosition).toBe("top");
    expect(slider.sliderEl.hasAttribute("title")).toBe(false);
    slider.sliderEl.dispatchEvent(new Event("touchend"));
    expect(slider.sliderEl.hasAttribute("aria-label")).toBe(false);

    const parentClick = vi.fn();
    host.addEventListener("click", parentClick);
    slider.sliderEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("builds Setting DOM, tracks components, clears controls, and cascades disabled state", () => {
    const host = parent();
    const callbackReturn = { ignored: true };
    const setting = new Setting(host)
      .setName("Name")
      .setDesc("Description")
      .setHeading()
      .addText((text) => {
        text.setValue("hello");
        return callbackReturn;
      })
      .addToggle((toggle) => toggle.setValue(true));

    expect(setting).toBeInstanceOf(Setting);
    expect(setting.nameEl.textContent).toBe("Name");
    expect(setting.descEl.textContent).toBe("Description");
    expect(setting.settingEl.classList.contains("setting-item-heading")).toBe(true);
    expect(setting.settingEl.classList.contains("mod-toggle")).toBe(true);
    expect(setting.components).toHaveLength(2);

    setting.setDisabled(true);
    expect(setting.settingEl.classList.contains("is-disabled")).toBe(true);
    expect(setting.components.every((component) => component.disabled)).toBe(true);

    setting.clear();
    expect(setting.controlEl.childElementCount).toBe(0);
    expect(setting.components).toHaveLength(0);
  });

  it("sets MomentFormat default format as placeholder and updates sample text", () => {
    const host = parent();
    const sampleEl = document.createElement("span");
    const momentFactory = vi.fn(() => ({ format: (format: string) => `sample:${format}` }));
    vi.stubGlobal("moment", momentFactory);

    const component = new MomentFormatComponent(host)
      .setSampleEl(sampleEl)
      .setDefaultFormat("YYYY-MM-DD");

    expect(component.inputEl.placeholder).toBe("YYYY-MM-DD");
    expect(sampleEl.textContent).toBe("sample:YYYY-MM-DD");

    component.setValue("HH:mm");

    expect(sampleEl.textContent).toBe("sample:HH:mm");
    vi.unstubAllGlobals();
  });

  it("only adds Enter blur to text settings when no physical keyboard is available", () => {
    const original = Platform.hasPhysicalKeyboard;
    const host = parent();
    try {
      Object.defineProperty(Platform, "hasPhysicalKeyboard", { configurable: true, value: true });
      let desktopText: TextComponent | null = null;
      new Setting(host).addText((text) => {
        desktopText = text;
      });
      const desktopBlur = vi.spyOn(desktopText!.inputEl, "blur");
      desktopText!.inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(desktopBlur).not.toHaveBeenCalled();

      Object.defineProperty(Platform, "hasPhysicalKeyboard", { configurable: true, value: false });
      let mobileText: TextComponent | null = null;
      new Setting(host).addText((text) => {
        mobileText = text;
      });
      const mobileBlur = vi.spyOn(mobileText!.inputEl, "blur");
      mobileText!.inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(mobileBlur).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(Platform, "hasPhysicalKeyboard", { configurable: true, value: original });
    }
  });

  it("attaches and detaches SettingGroup headings and stores header components", () => {
    const host = parent();
    const group = new SettingGroup(host);

    expect(group.headerEl.parentElement).toBeNull();
    group.setHeading("Plugins");
    expect(group.headerEl.parentElement).toBe(group.groupEl);

    group.addExtraButton((button) => button.setTooltip("Options"));
    group.addSearch((search) => search.setValue("query"));
    group.addSetting((setting) => setting.setName("Child"));

    expect(group.components).toHaveLength(2);
    expect(group.searchContainerEl?.classList.contains("setting-group-search")).toBe(true);
    expect(group.listEl.querySelector(".setting-item-name")?.textContent).toBe("Child");

    group.setHeading("");
    expect(group.headerEl.parentElement).toBeNull();
  });
});
