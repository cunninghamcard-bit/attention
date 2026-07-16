import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@web/app/App";
import { AppearanceSettingTab } from "@web/builtin/AppearanceSettingTab";
import { fontAvailable, resetFontCatalogForTests } from "@web/builtin/AppearanceModals";

describe("AppearanceSettingTab", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    resetFontCatalogForTests();
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
    delete (window as Window & { electron?: unknown }).electron;
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
    expect(text).toContain("Choose the font used in the editor and reading view.");
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

  it("checks and updates installed community themes", async () => {
    const { app, tab } = await createTab(false);
    app.themes.registerTheme({
      id: "Alpha",
      name: "Alpha",
      version: "1.0.0",
      variables: {},
    });
    const update = {
      manifest: {
        id: "Alpha",
        name: "Alpha",
        version: "2.0.0",
        modes: ["light", "dark"] as Array<"light" | "dark">,
      },
      detailsState: "loaded" as const,
    };
    app.themeMarketplace.registerEntry(update);
    vi.spyOn(app.themeMarketplace, "loadCatalog").mockResolvedValue(1);
    vi.spyOn(app.themeMarketplace, "findUpdates").mockResolvedValue([update]);
    const install = vi.spyOn(app.themeInstaller, "update").mockResolvedValue({
      id: "Alpha",
      version: "2.0.0",
      installedAt: "now",
      enabled: false,
    });
    tab.display();

    clickSettingButton(tab.containerEl, "Current themes", "Check for updates");
    await vi.waitFor(() =>
      expect(findSetting(tab.containerEl, "Current themes").textContent).toContain(
        "1 update available",
      ),
    );
    clickSettingButton(tab.containerEl, "Current themes", "View updates");
    await vi.waitFor(() =>
      expect(document.body.querySelector(".modal.mod-community-theme")?.textContent).toContain(
        "Alpha",
      ),
    );
    clickSettingButton(tab.containerEl, "Current themes", "Update all themes");
    await vi.waitFor(() => expect(install).toHaveBeenCalledWith("Alpha"));
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

  it("manages all appearance font families", async () => {
    const { app, tab } = await createTab();

    await manageFont(tab.containerEl, "Interface font", "Avenir Next");
    expect(app.vault.getConfig("interfaceFontFamily")).toBe("Avenir Next");
    await manageFont(tab.containerEl, "Text font", "Iowan Old Style");
    expect(app.vault.getConfig("textFontFamily")).toBe("Iowan Old Style");
    await manageFont(tab.containerEl, "Monospace font", "JetBrains Mono");

    expect(app.vault.getConfig("interfaceFontFamily")).toBe("Avenir Next");
    expect(app.vault.getConfig("textFontFamily")).toBe("Iowan Old Style");
    expect(app.vault.getConfig("monospaceFontFamily")).toBe("JetBrains Mono");
    expect(document.body.style.getPropertyValue("--font-interface-override")).toBe('"Avenir Next"');
    expect(document.body.style.getPropertyValue("--font-text-override")).toBe('"Iowan Old Style"');
    expect(document.body.style.getPropertyValue("--font-monospace-override")).toBe(
      '"JetBrains Mono"',
    );
  });

  it("describes configured font fallback status", async () => {
    const fontsApi = {
      ready: Promise.resolve(),
      check: (query: string) => query.includes("Available Font"),
    };
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: fontsApi,
    });
    expect(await fontAvailable("Available Font")).toBe(true);
    expect(await fontAvailable("Missing Font")).toBe(false);

    const { app, tab } = await createTab(false);
    app.appearance.setFonts({ uiFont: "Available Font, Missing Font" });
    tab.display();

    const setting = findSetting(tab.containerEl, "Interface font");
    expect(setting.textContent).toContain("Fonts currently in effect:");
    expect(
      [...setting.querySelectorAll<HTMLElement>("li")].map(
        (item) => item.querySelector("span")?.textContent,
      ),
    ).toEqual(["Available Font", "Missing Font"]);
    await vi.waitFor(() => {
      expect(setting.querySelector('[aria-label="Font not found"]')).not.toBeNull();
    });

    app.appearance.setFonts({ uiFont: "Available Font" });
    tab.display();
    const single = findSetting(tab.containerEl, "Interface font");
    expect(single.textContent).toContain("Currently in effect:");
    expect(single.querySelector(".u-pop")?.textContent).toBe("Available Font");
  });

  it("opens the Obsidian-style font suggestion list", async () => {
    installElectron({
      ipcRenderer: {
        invoke: vi.fn(async (channel: string) =>
          channel === "get-fonts" ? ["Inter", "Source Code Pro", "Helvetica Neue"] : [],
        ),
      },
    });
    const { tab } = await createTab();
    findSetting(tab.containerEl, "Interface font").querySelector("button")!.click();
    const modal = document.body.querySelector<HTMLElement>(".modal.mod-font-manager")!;
    const input = modal.querySelector<HTMLInputElement>('input[type="text"]')!;
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Catalog load is async (get-fonts IPC + canvas probe).
    await vi.waitFor(() => {
      expect(document.body.querySelector(".suggestion-container .suggestion-item")).not.toBeNull();
    });
    expect(document.body.querySelector(".suggestion-container")?.textContent).toContain("Inter");
  });

  it("adds a font with Enter and keeps the add form mounted", async () => {
    const { tab } = await createTab();
    findSetting(tab.containerEl, "Interface font").querySelector("button")!.click();
    const modal = document.body.querySelector<HTMLElement>(".modal.mod-font-manager")!;
    const input = modal.querySelector<HTMLInputElement>('input[type="text"]')!;
    const formBefore = modal.querySelector(".setting-item")!;

    // Focused input opens the suggest popover; Enter is owned by keymap scope and
    // selects the highlighted suggestion, which must also add the font.
    input.focus();
    input.value = "Inter";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.body.querySelector(".suggestion-container")).not.toBeNull();
    });
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(modal.querySelector(".mobile-option-setting-item-name")?.textContent).toBe("Inter");
    expect(input.value).toBe("");
    expect(modal.querySelector(".setting-item")).toBe(formBefore);
    expect(modal.textContent).toContain("Font applied");
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

  it("toggles the mobile base font size action", async () => {
    const { app, tab } = await createTab();

    toggle(tab.containerEl, "Increase base font size on mobile", true);

    expect(app.vault.getConfig("baseFontSizeAction")).toBe(true);
  });

  it("toggles native menus and translucency", async () => {
    const { app, tab } = await createTab();

    toggle(tab.containerEl, "Native menus", true);
    toggle(tab.containerEl, "Translucent window", true);

    expect(app.vault.getConfig("nativeMenus")).toBe(true);
    expect(app.vault.getConfig("translucency")).toBe(true);
    expect(document.body.classList.contains("is-translucent")).toBe(true);
  });

  it("opens the ribbon configuration view", async () => {
    const { app, tab } = await createTab(false);
    app.workspace.leftRibbon.addRibbonItemButton(
      "test:ribbon-action",
      "lucide-star",
      "Test ribbon action",
      () => {},
    );
    tab.display();

    clickSettingButton(tab.containerEl, "Configure ribbon", "Manage");

    const modal = document.body.querySelector<HTMLElement>(".modal.mod-ribbon-manager")!;
    expect(modal).not.toBeNull();
    expect(modal.textContent).toContain("Configure ribbon");
    rowForRibbon(modal, "test:ribbon-action")
      .querySelector<HTMLElement>('[aria-label="Remove from ribbon"]')!
      .click();
    expect(
      app.workspace.leftRibbon.items.find((item) => item.id === "test:ribbon-action")?.hidden,
    ).toBe(true);
  });

  it("manages visible hidden and ordered ribbon actions", async () => {
    const { app, tab } = await createTab(false);
    const ribbon = app.workspace.leftRibbon;
    ribbon.addRibbonItemButton("alpha", "lucide-a-large-small", "Alpha", () => {});
    ribbon.addRibbonItemButton("beta", "lucide-bold", "Beta", () => {});
    ribbon.addRibbonItemButton("gamma", "lucide-gem", "Gamma", () => {});
    ribbon.setItemHidden("beta", true);
    const persist = vi.spyOn(app.workspace, "requestSaveLayout");
    tab.display();
    clickSettingButton(tab.containerEl, "Configure ribbon", "Manage");
    const modal = document.body.querySelector<HTMLElement>(".modal.mod-ribbon-manager")!;

    expect(modal.textContent).toContain("Additional ribbon items");
    rowForRibbon(modal, "beta").querySelector<HTMLElement>('[aria-label="Add to ribbon"]')!.click();
    expect(ribbon.items.find((item) => item.id === "beta")?.hidden).toBe(false);

    rowForRibbon(modal, "gamma")
      .querySelector<HTMLElement>('[aria-label="Drag to reorder"]')!
      .dispatchEvent(new Event("dragstart", { bubbles: true }));
    rowForRibbon(modal, "alpha").dispatchEvent(
      new MouseEvent("drop", { bubbles: true, clientY: 0 }),
    );
    expect(
      ribbon.items
        .map((item) => item.id)
        .filter((id) => id === "alpha" || id === "beta" || id === "gamma"),
    ).toEqual(["gamma", "alpha", "beta"]);
    expect(persist).toHaveBeenCalled();
  });

  it("changes and resets desktop zoom", async () => {
    const setZoomLevel = vi.fn();
    installElectron({
      webFrame: { getZoomLevel: () => 1.5, setZoomLevel },
    });
    const { tab } = await createTab();
    const setting = findSetting(tab.containerEl, "Zoom level");
    const slider = setting.querySelector<HTMLInputElement>('input[type="range"]')!;

    slider.value = "2";
    slider.dispatchEvent(new Event("change"));
    setting.querySelector<HTMLElement>('[aria-label="Restore default"]')!.click();

    expect(setZoomLevel).toHaveBeenNthCalledWith(1, 2);
    expect(setZoomLevel).toHaveBeenNthCalledWith(2, 0);
  });

  it("configures desktop frame icon and hardware acceleration", async () => {
    const send = vi.fn();
    const sendSync = vi.fn((channel: string, value?: unknown) => {
      if (channel === "frame") return value ?? "hidden";
      if (channel === "disable-gpu") return value ?? false;
      if (channel === "get-icon") return null;
      if (channel === "set-icon") return "data:image/png;base64,icon";
      return undefined;
    });
    installElectron({
      ipcRenderer: {
        send,
        sendSync,
        invoke: vi.fn().mockResolvedValue(["/tmp/icon.png"]),
      },
    });
    const { tab } = await createTab();

    select(tab.containerEl, "Frame style", "custom");
    clickSettingButton(tab.containerEl, "Custom icon", "Choose");
    await vi.waitFor(() =>
      expect(findSetting(tab.containerEl, "Custom icon").querySelector("img")?.hidden).toBe(false),
    );
    toggle(tab.containerEl, "Hardware acceleration", false);
    const relaunch = [...tab.containerEl.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Relaunch" && !button.hidden,
    )!;
    relaunch.click();

    expect(sendSync).toHaveBeenCalledWith("frame", "custom");
    expect(sendSync).toHaveBeenCalledWith("set-icon", "/tmp/icon.png");
    expect(sendSync).toHaveBeenCalledWith("disable-gpu", true);
    expect(send).toHaveBeenCalledWith("relaunch");
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

async function manageFont(parent: HTMLElement, name: string, value: string): Promise<void> {
  const setting = findSetting(parent, name);
  setting.querySelector<HTMLButtonElement>("button")!.click();
  const modal = document.body.querySelector<HTMLElement>(".modal.mod-font-manager")!;
  expect(modal.textContent).toContain(name);
  const input = modal.querySelector<HTMLInputElement>('input[type="text"]')!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  [...modal.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Add")!
    .click();
  [...modal.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Save")!
    .click();
  await Promise.resolve();
  expect(document.body.querySelector(".modal.mod-font-manager")).toBeNull();
}

function clickSettingButton(parent: HTMLElement, name: string, text: string): void {
  const setting = findSetting(parent, name);
  const button = [...setting.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === text,
  );
  expect(button, `button ${text} in ${name}`).toBeDefined();
  button!.click();
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

function rowForRibbon(parent: HTMLElement, id: string): HTMLElement {
  return parent.querySelector<HTMLElement>(`[data-ribbon-id="${id}"]`)!;
}

function installElectron(electron: Record<string, unknown>): void {
  Object.defineProperty(window, "electron", { configurable: true, value: electron });
}
