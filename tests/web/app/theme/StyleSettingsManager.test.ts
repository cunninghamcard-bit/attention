import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, provideJsonStoreAdapter } from "@web/app/App";
import { MemoryJsonStoreAdapter } from "@web/storage/JsonStore";
import { StyleSettingsManager } from "@web/app/theme/StyleSettingsManager";

// The manager reaches the parser through the module, so a delegating spy is the
// only way to prove a css-change did NOT reparse.
const { parseSpy } = vi.hoisted(() => ({ parseSpy: vi.fn() }));
vi.mock("@web/app/theme/StyleSettingsParser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@web/app/theme/StyleSettingsParser")>();
  parseSpy.mockImplementation(actual.parseStyleSettings);
  return { ...actual, parseStyleSettings: parseSpy };
});

// The real block mixes tabs with 4-space indentation and its themed colours ship
// whole CSS colours as defaults; the fixture reproduces that shape, not its size.
const FIXTURE_THEME = [
  "body {",
  "    --ribbon-background: hsla(34, 34%, 90%, 1);",
  "}",
  "/* @settings",
  "",
  "name: Fixture",
  "id: fixture",
  "settings:",
  "\t-",
  "\t\tid: interface",
  "\t\ttype: heading",
  "\t\ttitle: Interface",
  "\t\tlevel: 1",
  "\t\tcollapsed: true",
  "    -",
  "        id: alt-folder-icons",
  "        type: class-toggle",
  "        title: Toggle using Folders as Collapse Indicators",
  "    -",
  "        id: ribbon_styles",
  "        type: class-select",
  "        title: Ribbon Style",
  "        allowEmpty: false",
  "        default: ribbon-default",
  "        options:",
  "            -",
  "                label: Default",
  "                value: ribbon-default",
  "            -",
  "                label: Slide Out",
  "                value: ribbon-slideout",
  "    -",
  "        id: ribbon-background",
  "        type: variable-themed-color",
  "        title: Ribbon Background Color",
  "        format: hsl",
  "        opacity: true",
  "        default-light: 'hsla(34, 34%, 90%, 1)'",
  "        default-dark: 'hsla(220, 12%, 15%, 1)'",
  "\t-",
  "\t\tid: canvas-color",
  "\t\ttype: variable-themed-color",
  "\t\ttitle: Canvas Color 1",
  "\t\tformat: rgb-values",
  "\t\topacity: false",
  "\t\tdefault-light: 'rgb(182, 175, 166)'",
  "\t\tdefault-dark: 'rgb(182, 175, 166)'",
  "    -",
  "        id: ribbon-width",
  "        type: variable-number",
  "        title: Ribbon Width",
  "        default: 44",
  "        format: px",
  "    -",
  "        id: line-height",
  "        type: variable-number",
  "        title: Line Height",
  "        default: 1.5",
  "    -",
  "        id: font-heading",
  "        type: variable-text",
  "        title: Heading Font",
  "        default: Inter",
  "        quotes: true",
  "    -",
  "        id: cursor-style",
  "        type: variable-text",
  "        title: Cursor",
  "        default: pointer",
  "    -",
  "        id: editor-bgpattern",
  "        type: variable-select",
  "        title: Editor Background Pattern",
  "        default: editor-bgpattern-none",
  "        options:",
  "            -",
  "                label: None",
  "                value: editor-bgpattern-none",
  "            -",
  "                label: Dot Grid",
  "                value: editor-bgpattern-dotgrid",
  "    -",
  "        id: file-padding",
  "        type: variable-number-slider",
  "        title: File Padding",
  "        min: 0",
  "        max: 10",
  "        step: 1",
  "        default: 4",
  "*/",
].join("\n");

const SECOND_THEME = [
  "body { --heading-size: 2em; }",
  "/* @settings",
  "name: Second",
  "id: second",
  "settings:",
  "\t-",
  "\t\tid: centered-headings",
  "\t\ttype: class-toggle",
  "\t\ttitle: Centered Headings",
  "\t-",
  "\t\tid: heading-size",
  "\t\ttype: variable-number",
  "\t\ttitle: Heading Size",
  "\t\tdefault: 2",
  "\t\tformat: em",
  "*/",
].join("\n");

// Theme-authored ids are untrusted input: a class token that is empty or carries
// whitespace makes `DOMTokenList.add` throw, and this runs on the boot path.
const BROKEN_THEME = [
  "body { --heading-size: 2em; }",
  "/* @settings",
  "name: Broken",
  "id: broken",
  "settings:",
  "\t-",
  "\t\tid: alt folder icons",
  "\t\ttype: class-toggle",
  "\t\ttitle: Malformed Toggle",
  "\t-",
  "\t\tid: alt-folder-icons",
  "\t\ttype: class-toggle",
  "\t\ttitle: Toggle using Folders as Collapse Indicators",
  "\t-",
  "\t\tid: layout",
  "\t\ttype: class-select",
  "\t\ttitle: Layout",
  "\t\tdefault: two column",
  "\t\toptions:",
  "\t\t\t-",
  "\t\t\t\tlabel: Two Column",
  "\t\t\t\tvalue: two column",
  "\t\t\t-",
  "\t\t\t\tlabel: Single Column",
  "\t\t\t\tvalue: single-column",
  "\t-",
  "\t\tid: heading-size",
  "\t\ttype: variable-number",
  "\t\ttitle: Heading Size",
  "\t\tdefault: 2",
  "\t\tformat: em",
  "*/",
].join("\n");

const CONFIG_FILE = ".obsidian/style-settings.json";
const CORRUPT_FILE = '{ "fixture": { "alt-folder-icons": tru';

const apps: App[] = [];

describe("StyleSettingsManager", () => {
  beforeEach(() => {
    parseSpy.mockClear();
  });

  afterEach(() => {
    for (const app of apps) app.styleSettings.unload();
    apps.length = 0;
    provideJsonStoreAdapter(undefined);
    document.head
      .querySelectorAll("style[data-obsidian-reconstructed-css]")
      .forEach((style) => style.remove());
    document.body.className = "";
    document.body.removeAttribute("style");
  });

  it("applies a class toggle as a body class", async () => {
    const manager = await createManager();

    manager.setValue("fixture", "alt-folder-icons", true);

    expect(document.body.classList.contains("alt-folder-icons")).toBe(true);

    manager.setValue("fixture", "alt-folder-icons", false);

    expect(document.body.classList.contains("alt-folder-icons")).toBe(false);

    manager.setValue("fixture", "alt-folder-icons", true);
    manager.resetValue("fixture", "alt-folder-icons");

    expect(document.body.classList.contains("alt-folder-icons")).toBe(false);
  });

  it("applies the selected class option value", async () => {
    const manager = await createManager();

    expect(document.body.classList.contains("ribbon-default")).toBe(true);

    manager.setValue("fixture", "ribbon_styles", "ribbon-slideout");

    expect(document.body.classList.contains("ribbon-slideout")).toBe(true);
    expect(document.body.classList.contains("ribbon-default")).toBe(false);
    // The select's own id is a storage key, never a class.
    expect(document.body.classList.contains("ribbon_styles")).toBe(false);
  });

  it("rejects a malformed theme class token", async () => {
    // The ids and option values come from a theme author's YAML, and DOMTokenList.add
    // throws on an empty token or one carrying whitespace. The class-select's default
    // is applied on the boot path, so a throw here would mean the app never starts.
    const app = await createApp({ theme: "Broken" });
    const manager = app.styleSettings;

    // Startup ran to completion, and the block's usable settings applied anyway.
    expect(manager.getBlocks().map((block) => block.id)).toEqual(["broken"]);
    expect(document.body.style.getPropertyValue("--heading-size")).toBe("2em");
    expect([...document.body.classList]).not.toContain("two column");

    manager.setValue("broken", "alt folder icons", true);
    manager.setValue("broken", "alt-folder-icons", true);
    manager.setValue("broken", "layout", "single-column");

    // Only the malformed token is skipped; its neighbours are untouched.
    expect(document.body.classList.contains("alt-folder-icons")).toBe(true);
    expect(document.body.classList.contains("single-column")).toBe(true);
    expect(
      [...document.body.classList].filter((token) => /\s/.test(token) || token === ""),
    ).toEqual([]);
    expect(document.body.className).not.toContain("alt folder icons");
  });

  it("overrides a theme declared variable", async () => {
    const app = await createApp();
    const manager = app.styleSettings;
    // The theme declares the property on `body`, which is what makes :root and a
    // late <style> unwinnable: a declaration on the element beats an inherited one.
    expect(app.customCss.styleEl.textContent).toContain(
      "--ribbon-background: hsla(34, 34%, 90%, 1)",
    );
    const stylesBefore = [...document.querySelectorAll("style")];

    manager.setValue("fixture", "ribbon-background", "hsla(0, 0%, 0%, 1)");

    // The mechanism is the contract: an inline custom property on <body>. jsdom does
    // not implement the custom-property cascade, so no getComputedStyle assertion can
    // prove the override beats the theme — what proves it is the carrier it lands on.
    expect(document.body.getAttribute("style")).toContain(
      "--ribbon-background: hsla(0, 0%, 0%, 1)",
    );
    expect(document.body.style.getPropertyValue("--ribbon-background")).toBe("hsla(0, 0%, 0%, 1)");
    // Not a <style>: none was injected, and none was rewritten to carry the value.
    const stylesAfter = [...document.querySelectorAll("style")];
    expect(stylesAfter.length).toBe(stylesBefore.length);
    expect(stylesAfter.every((style, index) => style === stylesBefore[index])).toBe(true);
    for (const style of stylesAfter) {
      expect(style.textContent ?? "").not.toContain("hsla(0, 0%, 0%, 1)");
    }
    // Not :root, and not <html> — a custom property inherited from either loses to the
    // theme's own `body { --ribbon-background }` at any specificity or source order.
    const declaring = stylesAfter.filter((style) =>
      (style.textContent ?? "").includes("--ribbon-background"),
    );
    expect(declaring).toEqual([app.customCss.styleEl]);
    expect(document.documentElement.style.getPropertyValue("--ribbon-background")).toBe("");
  });

  it("emits each variable type in its consuming format", async () => {
    const manager = await createManager();

    expect(emitted()).toEqual({
      // No user value: the theme's declared defaults, in the formats the CSS consumes.
      "--ribbon-background": "hsla(34, 34%, 90%, 1)",
      "--canvas-color": "182, 175, 166",
      "--ribbon-width": "44px",
      "--line-height": "1.5",
      "--font-heading": '"Inter"',
      "--cursor-style": "pointer",
      "--editor-bgpattern": "editor-bgpattern-none",
      "--file-padding": "4",
    });

    manager.setValue("fixture", "ribbon-background", "hsla(0, 0%, 0%, 1)");
    // opacity: false colours get the hex picker alone, so a hex lands here.
    manager.setValue("fixture", "canvas-color", "#df5a5a");
    manager.setValue("fixture", "ribbon-width", 60);
    manager.setValue("fixture", "line-height", 1.2);
    manager.setValue("fixture", "font-heading", "Fira Sans");
    manager.setValue("fixture", "cursor-style", "default");
    manager.setValue("fixture", "editor-bgpattern", "editor-bgpattern-dotgrid");
    manager.setValue("fixture", "file-padding", 8);

    expect(emitted()).toEqual({
      "--ribbon-background": "hsla(0, 0%, 0%, 1)",
      // A bare triplet: app.css consumes it as rgba(var(--canvas-color), .1), and
      // a wrapped rgb() would nest and drop the declaration.
      "--canvas-color": "223, 90, 90",
      "--ribbon-width": "60px",
      "--line-height": "1.2",
      "--font-heading": '"Fira Sans"',
      "--cursor-style": "default",
      "--editor-bgpattern": "editor-bgpattern-dotgrid",
      "--file-padding": "8",
    });

    // A theme may pair `rgb-values` with `opacity: true`. The alpha belongs to the
    // consuming rgba(var(--canvas-color), .1), so an alpha that arrives regardless is
    // dropped — a fourth channel would nest inside that rgba() and drop the whole rule.
    manager.setValue("fixture", "canvas-color", "#df5a5a80");

    expect(document.body.style.getPropertyValue("--canvas-color")).toBe("223, 90, 90");
  });

  it("applies the themed default for the active scheme", async () => {
    const app = await createApp();

    expect(document.body.classList.contains("theme-light")).toBe(true);
    expect(document.body.style.getPropertyValue("--ribbon-background")).toBe(
      "hsla(34, 34%, 90%, 1)",
    );

    app.appearance.setBaseTheme("obsidian");

    expect(document.body.style.getPropertyValue("--ribbon-background")).toBe(
      "hsla(220, 12%, 15%, 1)",
    );

    app.appearance.setBaseTheme("moonstone");

    expect(document.body.style.getPropertyValue("--ribbon-background")).toBe(
      "hsla(34, 34%, 90%, 1)",
    );
  });

  it("persists style settings across a reload", async () => {
    const adapter = new MemoryJsonStoreAdapter();
    const first = await createApp({ adapter });
    first.styleSettings.setValue("fixture", "alt-folder-icons", true);
    first.styleSettings.setValue("fixture", "ribbon-width", 60);
    await flushWrites(first);
    first.styleSettings.unload();

    expect(document.body.classList.contains("alt-folder-icons")).toBe(false);
    expect(document.body.style.getPropertyValue("--ribbon-width")).toBe("");
    expect(await adapter.readJson(first.vault.getConfigFile("style-settings"))).toEqual({
      fixture: { "alt-folder-icons": true, "ribbon-width": 60 },
    });

    const second = await createApp({ adapter });

    expect(second.styleSettings.getValue("fixture", "alt-folder-icons")).toBe(true);
    expect(document.body.classList.contains("alt-folder-icons")).toBe(true);
    expect(document.body.style.getPropertyValue("--ribbon-width")).toBe("60px");
  });

  it("refuses to overwrite a corrupt settings file", async () => {
    const adapter = new CorruptJsonStoreAdapter();
    // The file exists but cannot be parsed, so `readConfigJson` answers undefined.
    adapter.corruptPaths.add(CONFIG_FILE);
    await adapter.writeText(CONFIG_FILE, CORRUPT_FILE);
    const writeJson = vi.spyOn(adapter, "writeJson");

    const app = await createApp({ adapter });
    const manager = app.styleSettings;
    manager.setValue("fixture", "alt-folder-icons", true);
    await flushWrites(app);

    expect(app.vault.getConfigFile("style-settings")).toBe(CONFIG_FILE);
    expect(writeJson.mock.calls.map((call) => call[0])).not.toContain(CONFIG_FILE);
    expect(await adapter.readText(CONFIG_FILE)).toBe(CORRUPT_FILE);
    expect(manager.getErrors().map((error) => error.source)).toContain(CONFIG_FILE);
  });

  it("does not reload on its own save", async () => {
    const app = await createApp();
    const manager = app.styleSettings;
    const readConfigJson = vi.spyOn(app.vault, "readConfigJson");
    const writeConfigJson = vi.spyOn(app.vault, "writeConfigJson");

    // A text control fires onChange on every keystroke, so a font name is a burst of
    // whole-document writes. They must collapse into one and never overlap: racing
    // writes land their mtimes out of order and walk `lastSave` backwards, which is
    // the value the echo-guard reads.
    for (const font of ["I", "In", "Int", "Inte", "Inter"]) {
      manager.setValue("fixture", "font-heading", font);
    }
    manager.setValue("fixture", "alt-folder-icons", true);
    await manager.flushSave();
    await settleConfigFileChange();

    expect(writeConfigJson).toHaveBeenCalledTimes(1);
    expect(manager.getValue("fixture", "font-heading")).toBe("Inter");
    // JsonStore.write re-enters our own `raw` listener; the mtime guard swallows it.
    expect(readConfigJson.mock.calls.map((call) => call[0])).not.toContain("style-settings");

    // A write from anyone else does reload — the guard discriminates, not ignores.
    await app.jsonStore.write(
      "style-settings.json",
      { fixture: { "ribbon-width": 72 } },
      { mtime: Date.now() + 10_000 },
    );
    await settleConfigFileChange();

    expect(readConfigJson.mock.calls.map((call) => call[0])).toContain("style-settings");
    expect(manager.getValue("fixture", "ribbon-width")).toBe(72);
    expect(document.body.style.getPropertyValue("--ribbon-width")).toBe("72px");
  });

  it("rebuilds style settings when the theme changes", async () => {
    const app = await createApp();
    const manager = app.styleSettings;
    manager.setValue("fixture", "alt-folder-icons", true);
    manager.setValue("fixture", "ribbon-background", "hsla(0, 0%, 0%, 1)");

    app.themes.setTheme("Second");
    await app.customCss.requestLoadTheme.run();

    expect(manager.getBlocks().map((block) => block.id)).toEqual(["second"]);
    expect(document.body.classList.contains("alt-folder-icons")).toBe(false);
    expect(document.body.style.getPropertyValue("--ribbon-background")).toBe("");
    expect(document.body.style.getPropertyValue("--heading-size")).toBe("2em");

    app.themes.setTheme("Fixture");
    await app.customCss.requestLoadTheme.run();

    // Values stay keyed by the declaring block, so switching back restores them.
    expect(document.body.classList.contains("alt-folder-icons")).toBe(true);
    expect(document.body.style.getPropertyValue("--ribbon-background")).toBe("hsla(0, 0%, 0%, 1)");
    expect(document.body.style.getPropertyValue("--heading-size")).toBe("");
  });

  it("ignores unrelated css change events", async () => {
    const app = await createApp();
    const manager = app.styleSettings;
    const blocks = manager.getBlocks();
    parseSpy.mockClear();

    app.appearance.setAccentColor("#ff0000");
    app.appearance.setFontSize(18);
    app.customCss.setTranslucency(true);
    app.customCss.registerPluginStyle("dataview", ".dataview { color: red; }");
    app.workspace.trigger("css-change", "snippet:focus");

    expect(parseSpy).not.toHaveBeenCalled();
    expect(manager.getBlocks()).toBe(blocks);
  });
});

class CorruptJsonStoreAdapter extends MemoryJsonStoreAdapter {
  readonly corruptPaths = new Set<string>();

  // Vault.readJson answers `undefined` for a file it could not parse, and `null`
  // only for one that is not there — the same tri-state the real
  // FileSystemJsonStoreAdapter produces off an unparseable file on disk.
  override async readJson<T>(path: string): Promise<T | null | undefined> {
    if (this.corruptPaths.has(path)) return undefined;
    return super.readJson<T>(path);
  }
}

async function createApp(
  options: { adapter?: MemoryJsonStoreAdapter; theme?: string } = {},
): Promise<App> {
  if (options.adapter) provideJsonStoreAdapter(options.adapter);
  const app = new App(document.createElement("div"));
  apps.push(app);
  void app.jsonStore.writeText("themes/Fixture.css", FIXTURE_THEME);
  void app.jsonStore.writeText("themes/Second.css", SECOND_THEME);
  void app.jsonStore.writeText("themes/Broken.css", BROKEN_THEME);
  app.vault.setConfig("cssTheme", options.theme ?? "Fixture");
  // AppLifecycle loads app.styleSettings once the theme and snippets are applied.
  await app.ready;
  return app;
}

async function createManager(): Promise<StyleSettingsManager> {
  return (await createApp()).styleSettings;
}

/**
 * What the fixture's variable settings put on `<body>`. Scoped to the fixture's
 * own ids: the app itself writes font and accent properties on the same element.
 */
function emitted(): Record<string, string> {
  const ids = [
    "ribbon-background",
    "canvas-color",
    "ribbon-width",
    "line-height",
    "font-heading",
    "cursor-style",
    "editor-bgpattern",
    "file-padding",
  ];
  return Object.fromEntries(
    ids.map((id) => [`--${id}`, document.body.style.getPropertyValue(`--${id}`)]),
  );
}

/** Saves are debounced and serialized, so a test waits for the queue, not a tick. */
function flushWrites(app: App): Promise<void> {
  return app.styleSettings.flushSave();
}

/** The config-file `raw` listener debounces by 50ms, like MetadataTypeManager. */
function settleConfigFileChange(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120));
}
