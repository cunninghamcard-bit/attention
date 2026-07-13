import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { AppearanceSettingTab } from "@web/builtin/AppearanceSettingTab";

describe("AppearanceSettingTab", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
    Object.defineProperty(window, "focus", { configurable: true, value: () => {} });
  });

  it("renders Obsidian appearance groups in source order", async () => {
    const { tab } = await createTab();
    const groups = [...tab.containerEl.querySelectorAll<HTMLElement>(".setting-group")];

    expect(groups.map((group) => heading(group))).toEqual([
      "",
      "Interface",
      "Font",
      "Advanced",
      "CSS snippets",
    ]);
    expect(settingNames(groups[0]).slice(0, 4)).toEqual([
      "Base color scheme",
      "Accent color",
      "Themes",
      "Current themes",
    ]);
  });

  it("uses user-facing appearance copy", async () => {
    const { tab } = await createTab();
    const text = tab.containerEl.textContent ?? "";

    expect(text).not.toMatch(/document\.body|HSL variables|CSS cascade|CustomCss|source code/i);
    expect(text).toContain("Choose the color scheme used by the app.");
    expect(text).toContain("Font used in the editor and reading view.");
  });

  it("changes the base color scheme", async () => {
    const { app, tab } = await createTab();

    select(tab.containerEl, "Base color scheme", "obsidian");

    expect(app.vault.getConfig("theme")).toBe("obsidian");
    expect(document.body.classList.contains("theme-dark")).toBe(true);
  });

  it("changes and resets the accent color", async () => {
    const { app, tab } = await createTab();
    const setting = findSetting(tab.containerEl, "Accent color");
    const picker = setting.querySelector<HTMLInputElement>('input[type="color"]')!;
    const reset = setting.querySelector<HTMLElement>('[aria-label="Restore default"]')!;

    picker.value = "#336699";
    picker.dispatchEvent(new Event("change"));
    expect(app.vault.getConfig("accentColor")).toBe("#336699");
    expect(reset.classList.contains("is-disabled")).toBe(false);

    reset.click();
    expect(app.vault.getConfig("accentColor")).toBe("");
    expect(picker.value).toBe(app.appearance.getAccentColor());
    expect(reset.classList.contains("is-disabled")).toBe(true);
  });

  it("shows Default when no community theme is installed", async () => {
    const { app, tab } = await createTab();
    const control = findSetting(tab.containerEl, "Themes").querySelector<HTMLSelectElement>(
      "select",
    )!;

    expect([...control.options].map((option) => option.textContent)).toEqual(["Default"]);
    expect(control.value).toBe("");
    control.dispatchEvent(new Event("change"));
    expect(app.vault.getConfig("cssTheme")).toBe("");
    expect(app.customCss.styleEl.textContent).toBe("");
  });

  it("lists installed themes and opens the community browser", async () => {
    const { app, tab } = await createTab(false);
    app.themes.registerTheme({ id: "Alpha", name: "Alpha", variables: {} });
    app.themes.registerTheme({ id: "Beta", name: "Beta", variables: {} });
    tab.display();

    const options = [
      ...findSetting(tab.containerEl, "Themes").querySelectorAll<HTMLOptionElement>("option"),
    ].map((option) => option.textContent);
    expect(options).toEqual(["Default", "Alpha", "Beta"]);
    expect(findSetting(tab.containerEl, "Current themes").textContent).toContain("2 installed");

    clickButton(tab.containerEl, "Manage");
    expect(document.body.querySelector(".modal.mod-community-theme")).not.toBeNull();
  });

  it("toggles supported interface chrome", async () => {
    const { app, tab } = await createTab(false);
    app.vault.setConfig("showInlineTitle", true);
    app.vault.setConfig("showViewHeader", true);
    app.vault.setConfig("showRibbon", true);
    tab.display();

    toggle(tab.containerEl, "Show inline title", false);
    toggle(tab.containerEl, "Show view header", false);
    toggle(tab.containerEl, "Show ribbon", false);

    expect(app.vault.getConfig("showInlineTitle")).toBe(false);
    expect(app.vault.getConfig("showViewHeader")).toBe(false);
    expect(app.vault.getConfig("showRibbon")).toBe(false);
    expect(document.body.classList.contains("show-inline-title")).toBe(false);
    expect(document.body.classList.contains("show-view-header")).toBe(false);
    expect(document.body.classList.contains("show-ribbon")).toBe(false);
  });

  it("changes all appearance font families", async () => {
    const { app, tab } = await createTab();

    input(tab.containerEl, "Interface font", "Avenir Next");
    input(tab.containerEl, "Text font", "Iowan Old Style");
    input(tab.containerEl, "Monospace font", "JetBrains Mono");

    expect(app.vault.getConfig("interfaceFontFamily")).toBe("Avenir Next");
    expect(app.vault.getConfig("textFontFamily")).toBe("Iowan Old Style");
    expect(app.vault.getConfig("monospaceFontFamily")).toBe("JetBrains Mono");
    expect(document.body.style.getPropertyValue("--font-interface-override")).toBe('"Avenir Next"');
    expect(document.body.style.getPropertyValue("--font-text-override")).toBe('"Iowan Old Style"');
    expect(document.body.style.getPropertyValue("--font-monospace-override")).toBe(
      '"JetBrains Mono"',
    );
  });

  it("changes and resets the base font size", async () => {
    const { app, tab } = await createTab(false);
    app.appearance.setFontSize(20);
    tab.display();
    const setting = findSetting(tab.containerEl, "Font size");
    const slider = setting.querySelector<HTMLInputElement>('input[type="range"]')!;

    slider.value = "22";
    slider.dispatchEvent(new Event("change"));
    expect(app.vault.getConfig("baseFontSize")).toBe(22);
    expect(document.documentElement.style.fontSize).toBe("22px");

    setting.querySelector<HTMLElement>('[aria-label="Restore default"]')!.click();
    expect(app.vault.getConfig("baseFontSize")).toBe(16);
    expect(document.documentElement.style.fontSize).toBe("16px");
  });

  it("toggles native menus and translucency", async () => {
    const { app, tab } = await createTab();

    toggle(tab.containerEl, "Native menus", true);
    toggle(tab.containerEl, "Translucent window", true);

    expect(app.vault.getConfig("nativeMenus")).toBe(true);
    expect(app.vault.getConfig("translucency")).toBe(true);
    expect(document.body.classList.contains("is-translucent")).toBe(true);
  });

  it("reloads CSS snippets without duplicate rows", async () => {
    const { app, tab } = await createTab(false);
    app.cssSnippets.registerSnippet({
      id: "focus",
      name: "focus",
      cssText: ".focus {}",
      enabled: false,
    });
    const readSnippets = vi.spyOn(app.customCss, "readSnippets").mockResolvedValue();
    tab.display();

    await clickExtra(tab.containerEl, "Reload snippets");
    await clickExtra(tab.containerEl, "Reload snippets");

    expect(readSnippets).toHaveBeenCalledTimes(2);
    expect(settingNames(tab.containerEl).filter((name) => name === "focus")).toHaveLength(1);
    expect(findSetting(tab.containerEl, "focus").textContent).toContain(
      "vault/.obsidian/snippets/focus.css",
    );
  });

  it("shows the CSS snippets empty state", async () => {
    const { tab } = await createTab();
    const empty = findSetting(tab.containerEl, "No CSS snippets found");

    expect(empty.textContent).toContain("vault/.obsidian/snippets");
  });

  it("creates and opens appearance folders", async () => {
    const { app, tab } = await createTab();
    const exists = vi.spyOn(app.vault, "exists").mockResolvedValue(false);
    const createFolder = vi.spyOn(app.vault, "createFolder").mockResolvedValue(undefined as never);
    const open = vi.spyOn(app, "openWithDefaultApp").mockResolvedValue();

    await clickExtra(tab.containerEl, "Open themes folder");
    await clickExtra(tab.containerEl, "Open snippets folder");

    expect(exists).toHaveBeenCalledWith(".obsidian/themes");
    expect(exists).toHaveBeenCalledWith(".obsidian/snippets");
    expect(createFolder).toHaveBeenCalledWith(".obsidian/themes");
    expect(createFolder).toHaveBeenCalledWith(".obsidian/snippets");
    expect(open).toHaveBeenCalledWith(".obsidian/themes");
    expect(open).toHaveBeenCalledWith(".obsidian/snippets");
  });

  it("toggles a CSS snippet from Appearance", async () => {
    const { app, tab } = await createTab(false);
    app.cssSnippets.registerSnippet({
      id: "focus",
      name: "focus",
      cssText: ".focus {}",
      enabled: false,
    });
    const request = vi.spyOn(app.customCss, "requestLoadSnippets");
    tab.display();

    toggle(tab.containerEl, "focus", true);

    expect(app.vault.getConfig("enabledCssSnippets")).toEqual(["focus"]);
    expect(request).toHaveBeenCalled();
  });
});

async function createTab(display = true): Promise<{ app: App; tab: AppearanceSettingTab }> {
  const app = new App(document.createElement("div"));
  await app.ready;
  const tab = new AppearanceSettingTab(app);
  if (display) tab.display();
  return { app, tab };
}

function heading(group: HTMLElement): string {
  return (
    group.querySelector(":scope > .setting-item-heading .setting-item-name")?.textContent ?? ""
  );
}

function settingNames(parent: HTMLElement): string[] {
  return [...parent.querySelectorAll<HTMLElement>(".setting-item")]
    .filter((setting) => !setting.classList.contains("setting-item-heading"))
    .map((setting) => setting.querySelector(".setting-item-name")?.textContent ?? "");
}

function findSetting(parent: HTMLElement, name: string): HTMLElement {
  const setting = [...parent.querySelectorAll<HTMLElement>(".setting-item")].find(
    (item) => item.querySelector(".setting-item-name")?.textContent === name,
  );
  expect(setting, `setting ${name}`).toBeDefined();
  return setting!;
}

function select(parent: HTMLElement, name: string, value: string): void {
  const control = findSetting(parent, name).querySelector<HTMLSelectElement>("select")!;
  control.value = value;
  control.dispatchEvent(new Event("change"));
}

function input(parent: HTMLElement, name: string, value: string): void {
  const control = findSetting(parent, name).querySelector<HTMLInputElement>('input[type="text"]')!;
  control.value = value;
  control.dispatchEvent(new Event("input"));
}

function toggle(parent: HTMLElement, name: string, value: boolean): void {
  const control = findSetting(parent, name).querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  control.checked = value;
  control.dispatchEvent(new Event("change"));
}

function clickButton(parent: HTMLElement, text: string): void {
  const button = [...parent.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === text,
  );
  expect(button, `button ${text}`).toBeDefined();
  button!.click();
}

async function clickExtra(parent: HTMLElement, label: string): Promise<void> {
  const button = parent.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  expect(button, `extra button ${label}`).not.toBeNull();
  button!.click();
  await Promise.resolve();
  await Promise.resolve();
}
