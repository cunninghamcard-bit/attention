import { beforeEach, describe, expect, it, vi } from "vitest";
import { createObsidianPluginModule } from "../api/ObsidianPluginModule";
import { RenderContext } from "../markdown/RenderContext";
import { SecretStorage } from "../storage/SecretStorage";
import { FileSystemAdapter } from "../vault/FileSystemAdapter";
import { Platform } from "../platform/Platform";
import { Menu } from "../ui/Menu";
import { App } from "./App";

class TestFileSystemAdapter extends FileSystemAdapter {
  existingPaths = new Set<string>(["Folder/Note.md"]);

  constructor() {
    super("/vault");
  }

  override getFilePath(path: string): string {
    return `file:///vault/${path}`;
  }

  override getFullPath(path: string): string {
    return `/vault/${path}`;
  }

  override async exists(path: string): Promise<boolean> {
    return this.existingPaths.has(path);
  }
}

describe("App public plugin API", () => {
  beforeEach(() => {
    document.body.classList.remove("theme-dark", "theme-light");
    document.body.style.removeProperty("--text-on-accent");
    document.body.style.removeProperty("--accent-h");
    document.body.style.removeProperty("--accent-s");
    document.body.style.removeProperty("--accent-l");
    document.body.style.removeProperty("--font-interface-override");
    document.body.style.removeProperty("--font-text-override");
    document.body.style.removeProperty("--font-print-override");
    document.body.style.removeProperty("--font-monospace-override");
    document.body.style.removeProperty("--font-text-size");
    document.body.style.removeProperty("--indent-size");
    document.documentElement.style.removeProperty("--interactive-accent");
    document.documentElement.style.removeProperty("font-size");
    Menu.useNativeMenu = false;
  });

  it("exposes the app render context and dark-mode helper", () => {
    const app = new App(document.createElement("div"));

    expect(app.renderContext).toBeInstanceOf(RenderContext);
    expect(app.renderContext.app).toBe(app);
    expect(app.renderContext.sourcePath).toBe("");
    expect(app.renderContext.containerEl).toBe(app.containerEl);
    expect(app.isDarkMode()).toBe(false);

    app.appearance.setBaseTheme("obsidian");
    expect(app.isDarkMode()).toBe(true);

    app.appearance.setBaseTheme("moonstone");
    expect(app.isDarkMode()).toBe(false);
  });

  it("uses Obsidian's document title and localStorage JSON semantics", () => {
    const previousTitle = document.title;
    const previousLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
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

    try {
      document.title = "Obsidian Canary";
      const app = new App(document.createElement("div"));

      expect(app.getAppTitle()).toBe("Obsidian Canary");
      expect(app.getAppTitle("Daily")).toBe("Daily - Obsidian Canary");

      app.saveLocalStorage("recent", ["open"]);
      expect(app.loadLocalStorage("recent")).toEqual(["open"]);

      values.set(`${app.appId}-broken`, "not-json");
      expect(app.loadLocalStorage("broken")).toBeNull();

      app.saveLocalStorage("recent", false);
      expect(app.loadLocalStorage("recent")).toBeNull();
    } finally {
      document.title = previousTitle;
      if (previousLocalStorage) Object.defineProperty(window, "localStorage", previousLocalStorage);
      else delete (window as Window & { localStorage?: Storage }).localStorage;
    }
  });

  it("exposes the Obsidian App theme facade over AppearanceManager", async () => {
    const app = new App(document.createElement("div"));
    await app.ready;
    const cssChange = vi.fn();
    app.workspace.on("css-change", cssChange);

    expect(app.getTheme()).toBe("moonstone");

    vi.useFakeTimers();
    try {
      app.changeTheme("obsidian");

      expect(app.vault.getConfig("theme")).toBe("obsidian");
      expect(app.isDarkMode()).toBe(true);
      expect(app.getTheme()).toBe("obsidian");
      expect(document.body.classList.contains("theme-dark")).toBe(true);
      expect(document.body.classList.contains("theme-light")).toBe(false);
      expect(app.containerEl.classList.contains("no-transition")).toBe(true);
      vi.advanceTimersByTime(199);
      expect(app.containerEl.classList.contains("no-transition")).toBe(true);
      vi.advanceTimersByTime(1);
      expect(app.containerEl.classList.contains("no-transition")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    expect(cssChange).toHaveBeenCalled();

    cssChange.mockClear();
    app.vault.setConfig("theme", "moonstone");
    app.updateTheme();

    expect(app.getTheme()).toBe("moonstone");
    expect(document.body.classList.contains("theme-light")).toBe(true);
    expect(document.body.classList.contains("theme-dark")).toBe(false);
    expect(cssChange).toHaveBeenCalled();
  });

  it("syncs native menu config to Menu like Obsidian", async () => {
    const previousMacOS = Platform.isMacOS;
    try {
      Platform.isMacOS = true;
      const app = new App(document.createElement("div"));
      await app.ready;

      expect(Menu.useNativeMenu).toBe(true);

      app.vault.setConfig("nativeMenus", false);
      expect(Menu.useNativeMenu).toBe(false);

      app.vault.setConfig("nativeMenus", true);
      expect(Menu.useNativeMenu).toBe(true);

      Platform.isMacOS = false;
      app.vault.setConfig("nativeMenus", null);
      expect(Menu.useNativeMenu).toBe(false);
    } finally {
      Platform.isMacOS = previousMacOS;
      Menu.useNativeMenu = false;
    }
  });

  it("exposes the Obsidian App accent color facade over body CSS variables", () => {
    const app = new App(document.createElement("div"));
    const initialAccentConfig = app.vault.getConfig("accentColor");

    app.setAccentColor("#ffffff");

    expect(document.body.style.getPropertyValue("--accent-h")).toBe("0");
    expect(document.body.style.getPropertyValue("--accent-s")).toBe("0%");
    expect(document.body.style.getPropertyValue("--accent-l")).toBe("100%");
    expect(document.body.style.getPropertyValue("--text-on-accent")).toBe("var(--text-on-accent-inverted)");
    expect(app.vault.getConfig("accentColor")).toBe(initialAccentConfig);

    app.vault.setConfig("accentColor", "#123456");
    app.updateAccentColor();

    expect(app.getAccentColor()).toBe("#123456");
    expect(document.body.style.getPropertyValue("--accent-h")).toBe("210");
    expect(document.body.style.getPropertyValue("--accent-s")).toBe("65%");
    expect(document.body.style.getPropertyValue("--accent-l")).toBe("20%");
    expect(document.body.style.getPropertyValue("--text-on-accent")).toBe("");

    app.vault.setConfig("accentColor", "");
    document.body.style.setProperty("--accent-h", "0");
    document.body.style.setProperty("--accent-s", "0%");
    document.body.style.setProperty("--accent-l", "100%");
    expect(app.getAccentColor()).toBe("#ffffff");

    app.setAccentColor("");

    expect(document.body.style.getPropertyValue("--accent-h")).toBe("");
    expect(document.body.style.getPropertyValue("--accent-s")).toBe("");
    expect(document.body.style.getPropertyValue("--accent-l")).toBe("");
    expect(document.body.style.getPropertyValue("--text-on-accent")).toBe("");
  });

  it("exposes Obsidian App typography and layout display updaters", () => {
    const app = new App(document.createElement("div"));
    const cssChange = vi.fn();
    app.workspace.on("css-change", cssChange);

    app.vault.setConfig("interfaceFontFamily", "Avenir Next, system-ui");
    app.vault.setConfig("textFontFamily", "Iowan Old Style");
    app.vault.setConfig("monospaceFontFamily", "JetBrains Mono");
    app.updateFontFamily();

    expect(document.body.style.getPropertyValue("--font-interface-override")).toBe("\"Avenir Next\", system-ui");
    expect(document.body.style.getPropertyValue("--font-text-override")).toBe("\"Iowan Old Style\"");
    expect(document.body.style.getPropertyValue("--font-print-override")).toBe("\"Iowan Old Style\"");
    expect(document.body.style.getPropertyValue("--font-monospace-override")).toBe("\"JetBrains Mono\"");

    app.vault.setConfig("baseFontSize", 42);
    app.updateFontSize();

    expect(document.body.style.getPropertyValue("--font-text-size")).toBe("30px");
    expect(document.documentElement.style.getPropertyValue("font-size")).toBe("30px");

    app.vault.setConfig("tabSize", 8);
    app.updateTabSize();

    expect(document.body.style.getPropertyValue("--indent-size")).toBe("8");

    app.vault.setConfig("showViewHeader", false);
    app.updateViewHeaderDisplay();
    expect(document.body.classList.contains("show-view-header")).toBe(false);

    app.vault.setConfig("showRibbon", false);
    app.updateRibbonDisplay();
    expect(document.body.classList.contains("show-ribbon")).toBe(false);

    app.vault.setConfig("showInlineTitle", true);
    app.updateInlineTitleDisplay();
    expect(document.body.classList.contains("show-inline-title")).toBe(true);

    app.vault.setConfig("floatingNavigation", true);
    app.updateFloatingNavigationDisplay();
    expect(document.body.classList.contains("is-floating-nav")).toBe(true);

    app.vault.setConfig("autoFullScreen", true);
    app.updateAutoFullScreenDisplay();
    expect(document.body.classList.contains("auto-full-screen")).toBe(true);
    expect(cssChange).toHaveBeenCalled();
  });

  it("provides SecretStorage on the app", () => {
    const app = new App(document.createElement("div"));
    const module = createObsidianPluginModule(app);

    expect(app.secretStorage).toBeInstanceOf(SecretStorage);
    expect(module.SecretStorage).toBe(SecretStorage);
    app.secretStorage.setSecret("api-key", "secret");

    expect(app.secretStorage.getSecret("api-key")).toBe("secret");
    expect(app.secretStorage.listSecrets()).toContain("api-key");
  });

  it("omits the markdown extension from Obsidian open URLs", async () => {
    const app = new App(document.createElement("div"));
    const note = await app.vault.create("Folder/My Note.md", "body");
    const image = await app.vault.create("Image.png", "body");

    expect(app.getObsidianUrl(note)).toContain("file=Folder%2FMy%20Note");
    expect(app.getObsidianUrl(note)).not.toContain(".md");
    expect(app.getObsidianUrl(image)).toContain("file=Image.png");
  });

  it("opens filesystem paths through Obsidian desktop and mobile adapter contracts", async () => {
    const app = new App(document.createElement("div"));
    const adapter = new TestFileSystemAdapter();
    const windowOpen = vi.fn();
    const showItemInFolder = vi.fn();
    const previousElectron = (globalThis as { electron?: unknown }).electron;
    const previousMobile = Platform.isMobile;
    const previousMobileApp = Platform.isMobileApp;
    const previousDesktopApp = Platform.isDesktopApp;
    Object.defineProperty(window, "open", { configurable: true, value: windowOpen });
    await app.ready;
    (app.vault as unknown as { adapter: TestFileSystemAdapter }).adapter = adapter;
    (globalThis as { electron?: unknown }).electron = { shell: { showItemInFolder } };

    try {
      Platform.isDesktopApp = true;
      await app.openWithDefaultApp("Folder/Note.md");
      expect(windowOpen).toHaveBeenCalledWith("file:///vault/Folder/Note.md", "_external");

      expect(app.showInFolder("Folder/Note.md")).toBeUndefined();
      await vi.waitFor(() => expect(showItemInFolder).toHaveBeenCalledWith("/vault/Folder/Note.md"));

      expect(app.showInFolder("Missing.md")).toBeUndefined();
      await vi.waitFor(() => expect(document.body.textContent).toContain("/vault/Missing.md"));
      expect(showItemInFolder).toHaveBeenCalledTimes(1);

      Platform.isDesktopApp = false;
      await app.openWithDefaultApp("Web.md");
      expect(app.showInFolder("Web.md")).toBeUndefined();
      expect(windowOpen).toHaveBeenCalledTimes(1);
      expect(showItemInFolder).toHaveBeenCalledTimes(1);

      const mobileOpen = vi.fn();
      Platform.isMobile = true;
      Platform.isMobileApp = true;
      (app.vault as unknown as { adapter: { open(path: string): void } }).adapter = { open: mobileOpen };
      await app.openWithDefaultApp("Mobile.md");
      expect(mobileOpen).toHaveBeenCalledWith("Mobile.md");

      (app.vault as unknown as { adapter: { open(path: string): Promise<void> } }).adapter = {
        open: vi.fn().mockRejectedValue(new Error("Native failed")),
      };
      await expect(app.openWithDefaultApp("Bad.md")).resolves.toBeUndefined();
      expect(document.body.textContent).toContain("Native failed");
    } finally {
      Platform.isMobile = previousMobile;
      Platform.isMobileApp = previousMobileApp;
      Platform.isDesktopApp = previousDesktopApp;
      if (previousElectron === undefined) delete (globalThis as { electron?: unknown }).electron;
      else (globalThis as { electron?: unknown }).electron = previousElectron;
      document.body.querySelectorAll(".notice").forEach((el) => el.remove());
    }
  });

  it("validates secret IDs and persists secrets across storage instances", () => {
    const storage = new SecretStorage();

    storage.setSecret("agent-token", "abc");

    expect(() => storage.setSecret("AgentToken", "abc")).toThrow(/Invalid secret ID/);
    expect(new SecretStorage().getSecret("agent-token")).toBe("abc");
  });
});
